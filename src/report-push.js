const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SCOPE = "https://www.googleapis.com/auth/firebase.messaging";
const encoder = new TextEncoder();
let currentToken;
let tokenRequest;

function base64Url(bytes) {
  return btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

const encode = (value) => base64Url(encoder.encode(JSON.stringify(value)));

async function authorize(credentials) {
  const now = Math.floor(Date.now() / 1000);
  const claims = encode({ alg: "RS256", typ: "JWT", kid: credentials.private_key_id }) + "." + encode({
    iss: credentials.client_email, scope: SCOPE, aud: TOKEN_URL, iat: now, exp: now + 3600
  });
  const pem = credentials.private_key.replace(/-----[^-]+-----|\s/g, "");
  const key = await crypto.subtle.importKey("pkcs8", Uint8Array.from(atob(pem), (byte) => byte.charCodeAt(0)),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, encoder.encode(claims));
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: claims + "." + base64Url(new Uint8Array(signature))
    }),
    signal: AbortSignal.timeout(8000)
  });
  if (!response.ok) throw new Error("FCM authorization returned HTTP " + response.status);
  const result = await response.json();
  if (!result.access_token) throw new Error("FCM did not return an access token.");
  return { value: result.access_token, expires: now + result.expires_in - 60, keyId: credentials.private_key_id };
}

async function accessToken(credentials) {
  const now = Math.floor(Date.now() / 1000);
  if (currentToken?.keyId === credentials.private_key_id && currentToken.expires > now) return currentToken.value;
  if (!tokenRequest) {
    tokenRequest = authorize(credentials).then((token) => { currentToken = token; }).finally(() => { tokenRequest = null; });
  }
  await tokenRequest;
  return currentToken.value;
}

async function sendReport(credentials, bearer, token, reportId) {
  const response = await fetch("https://fcm.googleapis.com/v1/projects/" + encodeURIComponent(credentials.project_id) + "/messages:send", {
    method: "POST",
    headers: { Authorization: "Bearer " + bearer, "Content-Type": "application/json" },
    body: JSON.stringify({
      message: {
        token,
        data: { type: "new_report", reportId: String(reportId) },
        android: { priority: "high", ttl: "86400s" }
      }
    }),
    signal: AbortSignal.timeout(8000)
  });
  if (response.ok) return "sent";
  const error = await response.json().catch(() => null);
  if (error?.error?.details?.some((detail) => ["UNREGISTERED", "SENDER_ID_MISMATCH"].includes(detail.errorCode))) return "stale";
  throw new Error("FCM send returned HTTP " + response.status);
}

export async function deliverReportPush(env, reportId) {
  if (!env.FIREBASE_SERVICE_ACCOUNT) return;
  const now = Date.now();
  const job = await env.DB.prepare(`
    UPDATE report_push_jobs SET available_ms = ?, attempts = attempts + 1
    WHERE report_id = ? AND available_ms <= ? RETURNING attempts
  `).bind(now + 120000, reportId, now).first();
  if (!job) return;

  try {
    const { results: devices } = await env.DB.prepare(`
      SELECT device.installation, device.token FROM staff_push_devices AS device
      JOIN reports ON reports.id = ?
      WHERE device.credential_version = COALESCE((SELECT version FROM staff_account WHERE id = 1), 0)
        AND device.registered_at <= reports.created_at
        AND NOT EXISTS (SELECT 1 FROM report_push_receipts AS receipt
          WHERE receipt.report_id = reports.id AND receipt.installation = device.installation)
    `).bind(reportId).all();

    if (devices.length) {
      const credentials = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT);
      const bearer = await accessToken(credentials);
      let firstFailure;
      for (let index = 0; index < devices.length; index += 4) {
        const group = devices.slice(index, index + 4);
        const outcomes = await Promise.allSettled(group.map((device) => sendReport(credentials, bearer, device.token, reportId)));
        const updates = [];
        for (const [position, outcome] of outcomes.entries()) {
          const device = group[position];
          if (outcome.status === "rejected") firstFailure ??= outcome.reason;
          else if (outcome.value === "stale") {
            updates.push(env.DB.prepare("DELETE FROM staff_push_devices WHERE installation = ? AND token = ?").bind(device.installation, device.token));
          } else {
            updates.push(env.DB.prepare("INSERT OR IGNORE INTO report_push_receipts (report_id, installation) VALUES (?, ?)").bind(reportId, device.installation));
          }
        }
        if (updates.length) await env.DB.batch(updates);
      }
      if (firstFailure) throw firstFailure;
    }
    await env.DB.prepare("DELETE FROM report_push_jobs WHERE report_id = ?").bind(reportId).run();
  } catch (error) {
    console.error("CampusFix report notification delivery failed", reportId, error.message);
    if (job.attempts >= 6) {
      await env.DB.prepare("DELETE FROM report_push_jobs WHERE report_id = ?").bind(reportId).run();
      return;
    }
    const retry = Date.now() + (2 ** (job.attempts - 1)) * 60000;
    await env.DB.prepare("UPDATE report_push_jobs SET available_ms = ? WHERE report_id = ?").bind(retry, reportId).run();
  }
}

export async function retryReportPushes(env) {
  if (!env.FIREBASE_SERVICE_ACCOUNT) return;
  const cutoff = new Date(Date.now() - 86400000).toISOString();
  await env.DB.prepare(`
    DELETE FROM report_push_jobs WHERE report_id IN (SELECT id FROM reports WHERE created_at < ?)
  `).bind(cutoff).run();
  const { results } = await env.DB.prepare("SELECT report_id FROM report_push_jobs WHERE available_ms <= ? ORDER BY report_id LIMIT 8")
    .bind(Date.now()).all();
  for (const row of results) await deliverReportPush(env, row.report_id);
}
