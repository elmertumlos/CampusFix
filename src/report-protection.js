const BROWSER_LIMIT = 3;
const NETWORK_LIMIT = 40;
export const REPORT_WINDOW_SECONDS = 60;
export const TURNSTILE_ORIGIN = "https://challenges.cloudflare.com";
export const TURNSTILE_ACTION = "campusfix_report";

export async function verifyReportChallenge(body, url, env) {
  if (!env.TURNSTILE_SITE_KEY && !env.TURNSTILE_SECRET_KEY) return null;
  const unavailable = { status: 503, error: "Verification is temporarily unavailable. Try again shortly." };
  if (!env.TURNSTILE_SITE_KEY || !env.TURNSTILE_SECRET_KEY) return unavailable;
  const token = body?.["cf-turnstile-response"];
  const invalid = { status: 400, error: "Complete the verification on the form and try again." };
  if (typeof token !== "string" || !token || token.length > 2048) return invalid;

  try {
    const response = await fetch(TURNSTILE_ORIGIN + "/turnstile/v0/siteverify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ secret: env.TURNSTILE_SECRET_KEY, response: token }),
      signal: AbortSignal.timeout(5000)
    });
    if (!response.ok) return unavailable;
    const result = await response.json();
    const localTest = ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) &&
      /^[123]x0{31}AA$/.test(env.TURNSTILE_SECRET_KEY);
    return result.success === true &&
      (localTest || (result.hostname === url.hostname && result.action === TURNSTILE_ACTION)) ? null : invalid;
  } catch {
    return unavailable;
  }
}

async function networkKey(env, address) {
  const { network_salt } = await env.DB.prepare("SELECT network_salt FROM report_protection_settings WHERE id = 1").first();
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", encoder.encode(network_salt), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(address));
  return btoa(String.fromCharCode(...new Uint8Array(signature)));
}

export async function saveProtectedReport(env, report, { token, submissionKey, browserKey, address, issuePhoto }) {
  const network = await networkKey(env, address);
  const now = Date.now();
  const cutoff = now - REPORT_WINDOW_SECONDS * 1000;
  const { location, custom_location, category, custom_category, title, description, latitude, longitude, issue_photo_hash } = report;
  const statements = [
    env.DB.prepare(`
      INSERT INTO reports (tracking_token, submission_key, location, custom_location, category, custom_category, title, description, latitude, longitude, issue_photo_hash, duplicate_of)
      SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, (
        SELECT id FROM reports
        WHERE location = ? AND category = ? AND status IN ('new', 'in_progress') AND dismissed_at IS NULL
          AND COALESCE(lower(custom_location), '') = COALESCE(lower(?), '')
          AND COALESCE(lower(custom_category), '') = COALESCE(lower(?), '')
          AND lower(trim(title, ' .!?')) = lower(trim(?, ' .!?'))
        ORDER BY id LIMIT 1
      )
      WHERE (SELECT COUNT(*) FROM report_throttle WHERE browser_key = ? AND created_ms > ?) < ?
        AND (SELECT COUNT(*) FROM report_throttle WHERE network_key = ? AND created_ms > ?) < ?
      ON CONFLICT (submission_key) DO NOTHING
    `).bind(
      token, submissionKey, location, custom_location, category, custom_category, title, description, latitude, longitude, issue_photo_hash,
      location, category, custom_location, custom_category, title,
      browserKey, cutoff, BROWSER_LIMIT, network, cutoff, NETWORK_LIMIT
    ),
    env.DB.prepare(`
      INSERT INTO report_throttle (created_ms, browser_key, network_key)
      SELECT ?, ?, ? WHERE EXISTS (SELECT 1 FROM reports WHERE tracking_token = ?)
    `).bind(now, browserKey, network, token),
    env.DB.prepare("DELETE FROM report_throttle WHERE created_ms <= ?").bind(cutoff)
  ];
  if (issuePhoto) {
    statements.push(env.DB.prepare(`
      INSERT INTO report_issue_photos (report_id, jpeg)
      SELECT id, ? FROM reports WHERE tracking_token = ?
    `).bind(issuePhoto, token));
  }
  // Read the code after the insert trigger assigns it.
  statements.push(env.DB.prepare("SELECT id, tracking_token, tracking_code FROM reports WHERE tracking_token = ?").bind(token));
  const created = (await env.DB.batch(statements)).at(-1);
  return created.results[0];
}
