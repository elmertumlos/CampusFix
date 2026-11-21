import QRCode from "qrcode/lib/browser.js";
import {
  CATEGORIES, CUSTOM_CATEGORY_MAX_LENGTH, CUSTOM_LOCATION_MAX_LENGTH, DISMISSAL_REASONS, LOCATIONS, STATUSES, STATUS_NOTE_MAX_LENGTH, reportReference
} from "./catalog.js";
import { readReportPeriod, reportPeriodScope, reportsCsv } from "./report-period.js";
import { reportAnalytics } from "./report-analytics.js";
import { REPORT_WINDOW_SECONDS, TURNSTILE_ORIGIN, saveProtectedReport, verifyReportChallenge } from "./report-protection.js";
import { deliverReportPush, retryReportPushes } from "./report-push.js";
import { decodeIssuePhoto, PHOTO_MAX_BASE64_LENGTH, sharedReportPhoto, staffReportPhoto } from "./report-photo.js";
import { renderPage } from "./views.js";

const COOKIE = "campusfix_staff";
const REPORT_COOKIE = "campusfix_reporter";
const SESSION_SECONDS = 8 * 60 * 60;
const PASSWORD_ITERATIONS = 100000;
const MIN_PASSWORD_LENGTH = 12;
const ASSETS = new Set([
  "/app.js", "/styles.css", "/isatu-seal.png", "/favicon.png", "/report-map.js", "/report-photo.js", "/analytics.js",
  "/vendor/leaflet/leaflet.css", "/vendor/leaflet/leaflet.js",
  "/vendor/leaflet/images/layers.png", "/vendor/leaflet/images/layers-2x.png",
  "/vendor/leaflet/images/marker-icon.png", "/vendor/leaflet/images/marker-icon-2x.png",
  "/vendor/leaflet/images/marker-shadow.png"
]);
const MAP_TILE_ORIGIN = "https://tile.openstreetmap.org";
const TOKEN_PATTERN = /^[0-9a-f]{64}$/;
const JSON_BODY_LIMIT = 12_000;
const TRACKING_PATH = /^\/(?:api\/)?track\/([A-Z0-9]{6}|[0-9a-f]{32}(?:[0-9a-f]{32})?)(\/photo)?$/;
const PHOTO_PATH = /^\/photo\/([0-9a-f]{32}(?:[0-9a-f]{32})?)(\/image)?$/;
const RESPONSE_HEADERS = {
  "Cache-Control": "no-store",
  "Content-Security-Policy": "default-src 'self'; img-src 'self' data:; base-uri 'none'; frame-ancestors 'none'; object-src 'none'; form-action 'self'",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff"
};
const MAP_CSP = RESPONSE_HEADERS["Content-Security-Policy"].replace("img-src 'self' data:", "img-src 'self' data: " + MAP_TILE_ORIGIN);

function json(value, status = 200, extraHeaders = {}) {
  return Response.json(value, { status, headers: { ...RESPONSE_HEADERS, ...extraHeaders } });
}

function page(kind, data = {}, status = 200, headers = {}) {
  return new Response(renderPage(kind, data), {
    status,
    headers: { ...RESPONSE_HEADERS, "Content-Type": "text/html; charset=utf-8", ...headers }
  });
}

function redirect(location) {
  return new Response(null, { status: 303, headers: { ...RESPONSE_HEADERS, Location: location } });
}

function hex(bytes) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function randomToken(byteLength = 32) {
  return hex(crypto.getRandomValues(new Uint8Array(byteLength)));
}

async function hash(value) {
  const bytes = new TextEncoder().encode(value);
  return new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
}

function fromHex(value) {
  return Uint8Array.from(value.match(/../g), (byte) => Number.parseInt(byte, 16));
}

async function derivePassword(password, salt) {
  const bytes = new TextEncoder().encode(password);
  const key = await crypto.subtle.importKey("raw", bytes, "PBKDF2", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", iterations: PASSWORD_ITERATIONS, salt },
    key,
    256
  ));
}

async function staffAccount(env) {
  const stored = await env.DB.prepare("SELECT username, password_salt, password_hash, version FROM staff_account WHERE id = 1").first();
  if (stored) return stored;
  if (!env.STAFF_USERNAME || !env.STAFF_PASSWORD) return null;
  return { username: env.STAFF_USERNAME, version: 0 };
}

async function verifyPassword(env, account, password) {
  if (account.version === 0) {
    const [expected, actual] = await Promise.all([hash(env.STAFF_PASSWORD), hash(password)]);
    return crypto.subtle.timingSafeEqual(expected, actual);
  }
  const actual = await derivePassword(password, fromHex(account.password_salt));
  return crypto.subtle.timingSafeEqual(fromHex(account.password_hash), actual);
}

function requestToken(request, name = COOKIE) {
  const cookie = request.headers.get("Cookie") ?? "";
  const token = cookie.split(";").map((part) => part.trim()).find((part) => part.startsWith(name + "="))?.slice(name.length + 1);
  return TOKEN_PATTERN.test(token ?? "") ? token : null;
}

function staffCookie(url, value, maxAge) {
  const flags = "; Path=/; HttpOnly; SameSite=Strict; Max-Age=" + maxAge;
  return COOKIE + "=" + value + flags + (url.protocol === "https:" ? "; Secure" : "");
}

async function staffSession(request, env) {
  const token = requestToken(request);
  if (!token) return null;
  const bootstrapUsername = env.STAFF_USERNAME && env.STAFF_PASSWORD ? env.STAFF_USERNAME : null;
  const session = await env.DB.prepare(`
    SELECT sessions.credential_version AS version, COALESCE(account.username, ?) AS username
    FROM staff_sessions AS sessions
    LEFT JOIN staff_account AS account ON account.id = 1
    WHERE sessions.token_hash = ? AND sessions.expires_at > ?
      AND sessions.credential_version = COALESCE(account.version, 0)
  `).bind(bootstrapUsername, hex(await hash(token)), Date.now()).first();
  return session?.username ? session : null;
}

async function readBody(request, limit = JSON_BODY_LIMIT) {
  if (!request.headers.get("Content-Type")?.startsWith("application/json") || !request.body) return null;
  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let text = "";
  let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        await reader.cancel();
        return null;
      }
      text += decoder.decode(value, { stream: true });
    }
    const value = JSON.parse(text + decoder.decode());
    return value && typeof value === "object" && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  } finally {
    reader.releaseLock();
  }
}

const field = (body, key) => typeof body?.[key] === "string" ? body[key].trim() : "";

function readCoordinate(value, limit) {
  if (typeof value === "string" && /^-?(?:\d+(?:\.\d+)?|\.\d+)$/.test(value)) value = Number(value);
  if (!Number.isFinite(value) || Math.abs(value) > limit) return null;
  return Number(value.toFixed(6));
}

function formatReport(row) {
  const { id, location, custom_location, category, custom_category, title, description, status, created_at, updated_at, version,
    latitude, longitude, duplicate_of, dismissed_at, dismissal_reason } = row;
  const locationLabel = location === "other" && custom_location ? custom_location : LOCATIONS.get(location) ?? location;
  const categoryLabel = category === "Other" && custom_category ? custom_category : category;
  return {
    id, reference: reportReference(id), trackingCode: row.tracking_code, location: locationLabel, category: categoryLabel,
    title, description, status: dismissed_at ? "dismissed" : status, statusNote: row.status_note,
    createdAt: created_at, updatedAt: updated_at, version,
    duplicate: duplicate_of ? { id: duplicate_of, reference: reportReference(duplicate_of) } : null,
    dismissalReason: dismissal_reason,
    pin: latitude != null && longitude != null ? { latitude, longitude } : null,
    hasIssuePhoto: Boolean(row.issue_photo_hash)
  };
}

function reportReceipt(row, status) {
  const reference = reportReference(row.id);
  return json({
    reference,
    trackingCode: row.tracking_code,
    trackingPath: "/track/" + row.tracking_token,
    photoPath: "/photo/" + row.tracking_token
  }, status);
}

async function replaySubmission(env, submissionKey, report) {
  if (!submissionKey) return null;
  const previous = await env.DB.prepare("SELECT * FROM reports WHERE submission_key = ?").bind(submissionKey).first();
  if (!previous) return null;
  if (Object.keys(report).some((key) => previous[key] !== report[key])) {
    return json({ error: "The submission changed. Reload the form and try again." }, 409);
  }
  return reportReceipt(previous, 200);
}

async function submitReport(request, url, env, context) {
  const body = await readBody(request, JSON_BODY_LIMIT + PHOTO_MAX_BASE64_LENGTH);
  const location = field(body, "location");
  const customLocation = location === "other" ? field(body, "customLocation") : null;
  const category = field(body, "category");
  const customCategory = category === "Other" ? field(body, "customCategory") : null;
  const title = field(body, "title");
  const description = field(body, "description");
  if (!LOCATIONS.has(location) || !CATEGORIES.includes(category) ||
      title.length < 3 || title.length > 100 || description.length < 10 || description.length > 1000) {
    return json({ error: "Check the location, category, title and description, then try again." }, 400);
  }
  if (location === "other" && (!customLocation || customLocation.length > CUSTOM_LOCATION_MAX_LENGTH)) {
    return json({ error: "Enter a campus location of up to " + CUSTOM_LOCATION_MAX_LENGTH + " characters." }, 400);
  }
  if (category === "Other" && (!customCategory || customCategory.length > CUSTOM_CATEGORY_MAX_LENGTH)) {
    return json({ error: "Enter a category of up to " + CUSTOM_CATEGORY_MAX_LENGTH + " characters." }, 400);
  }
  const latitude = readCoordinate(body.latitude, 90);
  const longitude = readCoordinate(body.longitude, 180);
  if ((body.latitude != null || body.longitude != null) && (latitude === null || longitude === null)) {
    return json({ error: "Choose a valid location on the map or clear the pin." }, 400);
  }
  const userKey = body.submissionKey;
  if (userKey !== undefined && (typeof userKey !== "string" || !/^[0-9a-f]{32}$/.test(userKey))) {
    return json({ error: "Reload the report form and try again." }, 400);
  }
  const issuePhoto = body.issuePhoto === undefined ? null : decodeIssuePhoto(body.issuePhoto);
  if (body.issuePhoto !== undefined && !issuePhoto) {
    return json({ error: "Choose a readable photo of 250 KB or less after compression." }, 400);
  }
  const issuePhotoHash = issuePhoto ? hex(new Uint8Array(await crypto.subtle.digest("SHA-256", issuePhoto))) : null;
  const reporter = requestToken(request, REPORT_COOKIE);
  const browserKey = reporter ? hex(await hash(reporter)) : null;
  const submissionKey = userKey ? hex(await hash((reporter ?? "") + ":" + userKey)) : null;
  const report = {
    location, custom_location: customLocation, category, custom_category: customCategory,
    title, description, latitude, longitude, issue_photo_hash: issuePhotoHash
  };
  const previous = await replaySubmission(env, submissionKey, report);
  if (previous) return previous;

  const challenge = await verifyReportChallenge(body, url, env);
  if (challenge) {
    return (await replaySubmission(env, submissionKey, report)) ?? json({ error: challenge.error }, challenge.status);
  }

  const row = await saveProtectedReport(env, report, {
    token: randomToken(16), submissionKey, browserKey, address: request.headers.get("CF-Connecting-IP") ?? "local", issuePhoto
  });
  if (row) {
    if (env.FIREBASE_SERVICE_ACCOUNT) context.waitUntil(deliverReportPush(env, row.id));
    return reportReceipt(row, 201);
  }
  return (await replaySubmission(env, submissionKey, report)) ?? json({
    error: "Too many reports were submitted. Wait a minute and try again."
  }, 429, { "Retry-After": String(REPORT_WINDOW_SECONDS) });
}

async function trackReport(code, env, image) {
  const trackingColumn = code.length === 6 ? "tracking_code" : "tracking_token";
  if (image) {
    const photo = await env.DB.prepare(`
      SELECT photos.jpeg
      FROM reports JOIN report_photos AS photos ON photos.report_id = reports.id
      WHERE reports.${trackingColumn} = ? AND reports.dismissed_at IS NULL
    `).bind(code).first();
    return jpegResponse(photo);
  }
  const report = await env.DB.prepare(`
    SELECT reports.status, reports.dismissed_at, reports.status_note,
      (
        SELECT events.created_at FROM report_events AS events
        WHERE events.report_id = reports.id AND events.status = reports.status
        ORDER BY events.version DESC LIMIT 1
      ) AS status_at,
      photos.revision AS photo_revision, photos.shared_at AS photo_shared_at
    FROM reports LEFT JOIN report_photos AS photos ON photos.report_id = reports.id
    WHERE reports.${trackingColumn} = ?
  `).bind(code).first();
  if (!report) return json({ error: "No report matches this tracking code." }, 404);
  if (report.dismissed_at) return json({ status: "dismissed", statusAt: report.dismissed_at });
  const result = { status: report.status, statusAt: report.status_at };
  if (report.status_note) result.statusNote = report.status_note;
  if (report.photo_revision !== null) {
    result.photoPath = "/api/track/" + code + "/photo?v=" + report.photo_revision;
    result.photoSharedAt = report.photo_shared_at;
  }
  return json(result);
}

async function signIn(request, url, env) {
  const account = await staffAccount(env);
  if (!account) {
    return json({ error: "Staff sign-in has not been configured." }, 503);
  }
  const body = await readBody(request);
  const username = field(body, "username");
  const password = typeof body?.password === "string" ? body.password : "";
  if (!username || !password || username.length > 100 || password.length > 256) {
    return json({ error: "Enter your staff username and password." }, 400);
  }
  if (!(await verifyPassword(env, account, password)) || username !== account.username) {
    return json({ error: "That username or password is incorrect." }, 401);
  }
  const token = randomToken();
  const previous = requestToken(request);
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare("DELETE FROM staff_sessions WHERE expires_at <= ? OR token_hash = ? OR credential_version < ?")
      .bind(now, previous ? hex(await hash(previous)) : "", account.version),
    env.DB.prepare("INSERT INTO staff_sessions (token_hash, expires_at, credential_version) VALUES (?, ?, ?)")
      .bind(hex(await hash(token)), now + SESSION_SECONDS * 1000, account.version)
  ]);
  return json({ ok: true }, 200, { "Set-Cookie": staffCookie(url, token, SESSION_SECONDS) });
}

async function signOut(request, url, env) {
  const token = requestToken(request);
  if (token) {
    const tokenHash = hex(await hash(token));
    await env.DB.batch([
      env.DB.prepare("DELETE FROM staff_push_devices WHERE session_hash = ?").bind(tokenHash),
      env.DB.prepare("DELETE FROM staff_sessions WHERE token_hash = ?").bind(tokenHash)
    ]);
  }
  return json({ ok: true }, 200, { "Set-Cookie": staffCookie(url, "", 0) });
}

async function registerPushDevice(request, env, session) {
  if (!env.FIREBASE_SERVICE_ACCOUNT) return json({ error: "Push notifications are unavailable." }, 503);
  const body = await readBody(request);
  const installation = field(body, "installation");
  const token = field(body, "token");
  if (!/^[a-f0-9]{32}$/.test(installation) || !/^[A-Za-z0-9_:\-]{20,4096}$/.test(token)) {
    return json({ error: "Invalid Android device registration." }, 400);
  }
  const sessionHash = hex(await hash(requestToken(request)));
  const device = await env.DB.prepare(`
    INSERT INTO staff_push_devices (installation, token, session_hash, credential_version, registered_at)
    SELECT ?, ?, token_hash, credential_version, ?
    FROM staff_sessions WHERE token_hash = ? AND expires_at > ? AND credential_version = ?
      AND credential_version = COALESCE((SELECT version FROM staff_account WHERE id = 1), 0)
    ON CONFLICT (installation) DO UPDATE SET token = excluded.token, session_hash = excluded.session_hash,
      credential_version = excluded.credential_version,
      registered_at = CASE WHEN staff_push_devices.credential_version = excluded.credential_version
        THEN staff_push_devices.registered_at ELSE excluded.registered_at END
    RETURNING installation
  `).bind(installation, token, new Date().toISOString(), sessionHash, Date.now(), session.version).first();
  return device ? json({ ok: true }) : json({ error: "Sign in to enable Android notifications." }, 401);
}

async function changeCredentials(request, url, env, session) {
  const body = await readBody(request);
  const username = field(body, "username");
  const currentPassword = typeof body?.currentPassword === "string" ? body.currentPassword : "";
  const newPassword = body?.newPassword ?? "";
  if (!username || username.length > 100 || !currentPassword || currentPassword.length > 256) {
    return json({ error: "Enter a username and your current password." }, 400);
  }
  if (typeof newPassword !== "string" || (newPassword && (!newPassword.trim() || newPassword.length < MIN_PASSWORD_LENGTH || newPassword.length > 256))) {
    return json({ error: "Use at least " + MIN_PASSWORD_LENGTH + " characters for your new password." }, 400);
  }
  if (username === session.username && (!newPassword || newPassword === currentPassword)) {
    return json({ error: "Enter a different username or password to save a change." }, 400);
  }
  const account = await staffAccount(env);
  if (!account || account.version !== session.version) return json({ error: "Sign in again to change your credentials." }, 401);
  if (!(await verifyPassword(env, account, currentPassword))) {
    return json({ error: "The current password is incorrect." }, 400);
  }

  let salt = account.password_salt;
  let digest = account.password_hash;
  if (newPassword || account.version === 0) {
    const randomSalt = crypto.getRandomValues(new Uint8Array(16));
    salt = hex(randomSalt);
    digest = hex(await derivePassword(newPassword || currentPassword, randomSalt));
  }

  const changed = await env.DB.prepare(`
    INSERT INTO staff_account (id, username, password_salt, password_hash, version)
    VALUES (1, ?, ?, ?, ?)
    ON CONFLICT (id) DO UPDATE SET username = excluded.username, password_salt = excluded.password_salt,
      password_hash = excluded.password_hash, version = excluded.version
    WHERE staff_account.version = ?
    RETURNING version
  `).bind(username, salt, digest, account.version + 1, account.version).first();
  if (!changed) return json({ error: "The credentials were changed in another session. Sign in again." }, 401);
  return json({ ok: true }, 200, { "Set-Cookie": staffCookie(url, "", 0) });
}

async function staffReports(url, env, exportCsv) {
  const period = readReportPeriod(url.searchParams);
  if (period.error) return json({ error: period.error }, 400);
  const { where, values } = reportPeriodScope(period);
  const statement = env.DB.prepare("SELECT * FROM reports" + where + " ORDER BY created_at DESC, id DESC").bind(...values);
  const { results } = await statement.all();
  const reports = results.map(formatReport);
  if (!exportCsv) return json({ reports });

  const csv = reportsCsv(reports, period);
  return new Response(csv.contents, {
    headers: {
      ...RESPONSE_HEADERS,
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="' + csv.filename + '"'
    }
  });
}

async function staffNotifications(env) {
  const [state, recent] = await env.DB.batch([
    env.DB.prepare(`
      SELECT last_read_report_id,
        (SELECT COUNT(*) FROM reports WHERE id > last_read_report_id AND tracking_token IS NOT NULL) AS unread_count
      FROM staff_notification_state WHERE id = 1
    `),
    env.DB.prepare("SELECT * FROM reports WHERE tracking_token IS NOT NULL ORDER BY id DESC LIMIT 10")
  ]);
  const { last_read_report_id, unread_count } = state.results[0];
  const notifications = recent.results.map((row) => {
    const { id, reference, title, location, createdAt } = formatReport(row);
    return { id, reference, title, location, createdAt, unread: id > last_read_report_id };
  });
  return json({ notifications, unreadCount: unread_count, throughId: notifications[0]?.id ?? 0 });
}

async function readNotifications(request, env) {
  const body = await readBody(request);
  if (!Number.isSafeInteger(body?.throughId) || body.throughId < 1) {
    return json({ error: "Choose which notifications to mark as read." }, 400);
  }
  await env.DB.prepare(`
    UPDATE staff_notification_state SET last_read_report_id = MAX(
      last_read_report_id,
      MIN(?, COALESCE((SELECT MAX(id) FROM reports WHERE tracking_token IS NOT NULL), 0))
    ) WHERE id = 1
  `).bind(body.throughId).run();
  return staffNotifications(env);
}

async function updateReport(request, env, id) {
  const body = await readBody(request);
  if (!STATUSES.includes(body?.status) || !Number.isSafeInteger(body?.version) || body.version < 1) {
    return json({ error: "Choose a valid report status." }, 400);
  }
  const note = typeof body.statusNote === "string" ? body.statusNote.trim() : null;
  if (body.statusNote !== undefined && (note === null || note.length > STATUS_NOTE_MAX_LENGTH)) {
    return json({ error: "Enter a status note of up to " + STATUS_NOTE_MAX_LENGTH + " characters." }, 400);
  }
  const row = await env.DB.prepare(`
    UPDATE reports
    SET status = ?, status_note = COALESCE(?, status_note),
      updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), version = version + 1
    WHERE id = ? AND version = ? AND dismissed_at IS NULL
      AND (status != ? OR status_note != COALESCE(?, status_note))
    RETURNING *
  `).bind(body.status, note, id, body.version, body.status, note).first();
  if (row) return json({ report: formatReport(row) });
  const current = await env.DB.prepare("SELECT * FROM reports WHERE id = ?").bind(id).first();
  if (!current) return json({ error: "Report not found." }, 404);
  if (current.dismissed_at) return json({ error: "This report was dismissed.", report: formatReport(current) }, 409);
  if (current.status === body.status && (note === null || note === current.status_note)) {
    return json({ report: formatReport(current) });
  }
  return json({ error: "This report was updated by another session. Review its latest status.", report: formatReport(current) }, 409);
}

async function dismissReport(request, env, id) {
  const body = await readBody(request);
  if (!DISMISSAL_REASONS.includes(body?.reason) || !Number.isSafeInteger(body?.version) || body.version < 1) {
    return json({ error: "Choose a dismissal reason." }, 400);
  }
  const now = new Date().toISOString();
  const report = await env.DB.prepare(`
    UPDATE reports SET dismissed_at = ?, dismissal_reason = ?, updated_at = ?, version = version + 1
    WHERE id = ? AND version = ? AND dismissed_at IS NULL
    RETURNING *
  `).bind(now, body.reason, now, id, body.version).first();
  if (report) return json({ report: formatReport(report) });
  const current = await env.DB.prepare("SELECT * FROM reports WHERE id = ?").bind(id).first();
  if (!current) return json({ error: "Report not found." }, 404);
  if (current.dismissal_reason === body.reason) return json({ report: formatReport(current) });
  return json({ error: "This report was updated by another session. Review its latest details.", report: formatReport(current) }, 409);
}

function locationQr(url, location) {
  const reportUrl = new URL("/report", url);
  reportUrl.searchParams.set("location", location);
  const { modules } = QRCode.create(reportUrl.href, { errorCorrectionLevel: "M" });
  const size = modules.size + 8;
  const path = [];
  for (let y = 0; y < modules.size; y += 1) {
    for (let x = 0; x < modules.size; x += 1) {
      if (modules.get(y, x)) path.push("M" + (x + 4) + " " + (y + 4) + "h1v1h-1z");
    }
  }
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + size + " " + size +
    '" shape-rendering="crispEdges"><rect width="100%" height="100%" fill="#fff"/><path fill="#000" d="' + path.join("") + '"/></svg>';
  return new Response(svg, { headers: { ...RESPONSE_HEADERS, "Content-Type": "image/svg+xml; charset=utf-8" } });
}

function jpegResponse(row) {
  if (!row) return new Response(null, { status: 404, headers: RESPONSE_HEADERS });
  return new Response(Uint8Array.from(row.jpeg), {
    headers: { ...RESPONSE_HEADERS, "Content-Type": "image/jpeg", "Cross-Origin-Resource-Policy": "same-origin" }
  });
}

async function route(request, env, context) {
  const url = new URL(request.url);
  const { pathname } = url;
  const { method } = request;
  if (ASSETS.has(pathname) && (method === "GET" || method === "HEAD")) return env.ASSETS.fetch(request);
  const tracking = TRACKING_PATH.exec(pathname);

  if (pathname.startsWith("/api/")) {
    if (method !== "GET" && request.headers.get("Origin") !== url.origin) {
      return json({ error: "Open CampusFix directly and try again." }, 403);
    }
    if (pathname === "/api/reports" && method === "POST") return submitReport(request, url, env, context);
    if (pathname === "/api/staff/login" && method === "POST") return signIn(request, url, env);
    if (pathname === "/api/staff/logout" && method === "POST") return signOut(request, url, env);
    if (tracking && method === "GET") return trackReport(tracking[1], env, Boolean(tracking[2]));
    if (pathname.startsWith("/api/staff/")) {
      const session = await staffSession(request, env);
      if (!session) return json({ error: "Sign in to continue." }, 401);
      if (pathname === "/api/staff/push-devices" && method === "POST") return registerPushDevice(request, env, session);
      if (pathname === "/api/staff/account" && method === "PATCH") return changeCredentials(request, url, env, session);
      if (pathname === "/api/staff/notifications") {
        if (method === "GET") return staffNotifications(env);
        if (method === "PATCH") return readNotifications(request, env);
      }
      if (method === "GET" && (pathname === "/api/staff/reports" || pathname === "/api/staff/reports.csv")) {
        return staffReports(url, env, pathname.endsWith(".csv"));
      }
      if (method === "GET" && pathname === "/api/staff/analytics") {
        const period = readReportPeriod(url.searchParams);
        if (period.error) return json({ error: period.error }, 400);
        return json(await reportAnalytics(env.DB, period));
      }
      const issuePhoto = /^\/api\/staff\/reports\/([1-9][0-9]*)\/issue-photo$/.exec(pathname);
      if (issuePhoto && method === "GET" && Number.isSafeInteger(Number(issuePhoto[1]))) {
        return jpegResponse(await env.DB.prepare("SELECT jpeg FROM report_issue_photos WHERE report_id = ?")
          .bind(Number(issuePhoto[1])).first());
      }
      const photo = /^\/api\/staff\/reports\/([1-9][0-9]*)\/photo$/.exec(pathname);
      if (photo && Number.isSafeInteger(Number(photo[1])) && ["GET", "PUT", "DELETE"].includes(method)) {
        const result = await staffReportPhoto(request, env.DB, Number(photo[1]), method === "PUT" ? randomToken() : null);
        return result.error ? json({ error: result.error }, result.status) : json(result);
      }
      const report = /^\/api\/staff\/reports\/([1-9][0-9]*)(\/dismiss)?$/.exec(pathname);
      if (report && method === "PATCH" && Number.isSafeInteger(Number(report[1]))) {
        const id = Number(report[1]);
        return report[2] ? dismissReport(request, env, id) : updateReport(request, env, id);
      }
    }
    return json({ error: "Page not found." }, 404);
  }

  if (method === "GET") {
    if (pathname === "/") return redirect("/report");
    if (pathname === "/report") {
      const location = url.searchParams.get("location");
      const turnstileSiteKey = env.TURNSTILE_SITE_KEY && env.TURNSTILE_SECRET_KEY ? env.TURNSTILE_SITE_KEY : null;
      const headers = {
        "Content-Security-Policy": MAP_CSP
      };
      if (!requestToken(request, REPORT_COOKIE)) {
        headers["Set-Cookie"] = REPORT_COOKIE + "=" + randomToken() + "; Path=/; HttpOnly; SameSite=Lax; Max-Age=86400" +
          (url.protocol === "https:" ? "; Secure" : "");
      }
      if (turnstileSiteKey) {
        headers["Content-Security-Policy"] += "; script-src 'self' " + TURNSTILE_ORIGIN + "; frame-src " + TURNSTILE_ORIGIN;
      }
      return page("report", { location: LOCATIONS.has(location) ? location : null, turnstileSiteKey }, 200, headers);
    }
    if (pathname === "/track" || pathname === "/track/") return page("track");
    if (tracking && !tracking[2]) return page("track", { hasCode: true });
    const photo = PHOTO_PATH.exec(pathname);
    if (photo) {
      const record = await sharedReportPhoto(env.DB, photo[1], Boolean(photo[2]));
      if (!photo[2]) return page("photo", { imagePath: record ? pathname + "/image" : null });
      return jpegResponse(record);
    }
    if (pathname === "/staff/login") {
      return await staffSession(request, env) ? redirect("/staff") : page("login", { updated: url.searchParams.get("updated") === "1" });
    }
    if (pathname === "/staff" || pathname === "/staff/qr" || pathname === "/staff/settings") {
      const session = await staffSession(request, env);
      if (!session) return redirect("/staff/login");
      if (pathname === "/staff/settings") return page("settings", { username: session.username, minPasswordLength: MIN_PASSWORD_LENGTH });
      if (pathname === "/staff") {
        if (url.searchParams.get("view") === "analytics") return page("analytics");
        return page("dashboard", {}, 200, { "Content-Security-Policy": MAP_CSP });
      }
      return page("qr");
    }
    const qr = /^\/qr\/([a-z-]+)\.svg$/.exec(pathname);
    if (qr && LOCATIONS.has(qr[1]) && qr[1] !== "other") return locationQr(url, qr[1]);
  }
  return page("missing", {}, 404);
}

export default {
  async fetch(request, env, context) {
    try {
      return await route(request, env, context);
    } catch (error) {
      console.error(error);
      if (new URL(request.url).pathname.startsWith("/api/")) {
        return json({ error: "CampusFix could not complete the request. Please try again." }, 500);
      }
      return page("error", {}, 500);
    }
  },
  scheduled(event, env, context) {
    context.waitUntil(retryReportPushes(env));
  }
};
