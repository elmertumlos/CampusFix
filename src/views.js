import { CATEGORIES, CUSTOM_CATEGORY_MAX_LENGTH, CUSTOM_LOCATION_MAX_LENGTH, DISMISSAL_REASONS, LOCATIONS, STATUS_NOTE_MAX_LENGTH } from "./catalog.js";
import { TURNSTILE_ACTION, TURNSTILE_ORIGIN } from "./report-protection.js";
import { PHOTO_MAX_BYTES, PHOTO_MAX_EDGE } from "./report-photo.js";

const icons = {
  inbox: '<path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5 4h14l3 8v6a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-6z"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  check: '<circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/>',
  pin: '<path d="M19 10c0 5-7 10-7 10s-7-5-7-10a7 7 0 1 1 14 0Z"/><circle cx="12" cy="10" r="2"/>',
  refresh: '<path d="M20 7v5h-5M4 17v-5h5"/><path d="M6 8a7 7 0 0 1 11-3l3 4M4 15l3 4a7 7 0 0 0 11-3"/>',
  search: '<circle cx="10.5" cy="10.5" r="5.5"/><path d="m15 15 5 5"/>',
  qr: '<rect x="3" y="3" width="6" height="6" rx="1"/><rect x="15" y="3" width="6" height="6" rx="1"/><rect x="3" y="15" width="6" height="6" rx="1"/><path d="M15 15h2v2h4v4h-6v-2m6-6v.01"/>',
  lock: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3m-4 4v3"/>',
  bell: '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9m-8 12a2 2 0 0 0 4 0"/>',
  download: '<path d="M12 3v12m-4-4 4 4 4-4M5 16v4h14v-4"/>'
};

const icon = (name) => '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + icons[name] + "</svg>";
const escape = (value) => String(value).replace(/[&<>"']/g, (char) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
})[char]);

function header(kind) {
  const staff = ["dashboard", "analytics", "qr", "settings"].includes(kind);
  const nav = staff
    ? '<a href="/staff"' + (kind === "dashboard" ? ' aria-current="page"' : "") + '>Reports</a>' +
      '<a href="/staff?view=analytics"' + (kind === "analytics" ? ' aria-current="page"' : "") + '>Analytics</a>' +
      '<a href="/staff/settings"' + (kind === "settings" ? ' aria-current="page"' : "") + '>Settings</a>' +
      '<button class="header-action" type="button" data-sign-out>Sign out</button>' +
      '<button class="header-action notification-bell" type="button" aria-label="Notifications" aria-expanded="false" aria-controls="notification-panel" data-notification-bell>' +
      icon("bell") + '<span class="notification-badge" data-notification-badge aria-hidden="true" hidden></span></button>'
    : ["login", "report", "track", "photo"].includes(kind) ? "" : '<a href="/staff/login">Staff sign-in</a>';
  return '<header class="site-header"><div class="header-inner">' +
    '<a class="brand" href="' + (staff ? "/staff" : "/report") + '">' +
    '<img src="/isatu-seal.png" alt="" width="48" height="48"><span><strong>CampusFix</strong>' +
    '<small>Iloilo Science and Technology University</small></span></a>' +
    (nav ? '<nav aria-label="Main navigation">' + nav + "</nav>" : "") +
    (staff ? notificationPanel() : "") +
    "</div></header>";
}

function notificationPanel() {
  return `
    <section class="card notification-panel" id="notification-panel" aria-labelledby="notification-heading" hidden>
      <div class="notification-heading">
        <h2 id="notification-heading">Notifications</h2>
        <button class="button" type="button" data-notifications-read disabled>Mark all as read</button>
      </div>
      <p class="notification-message" data-notification-message role="status">Loading notifications…</p>
      <ul class="notification-list" data-notification-list></ul>
    </section>
    <p class="sr-only" data-notification-announcement role="status"></p>`;
}

function reportPage({ location, turnstileSiteKey }) {
  const needsCustomLocation = location === "other";
  const locations = [...LOCATIONS].map(([id, label]) =>
    '<option value="' + id + '"' + (id === location ? " selected" : "") + ">" + escape(label) + "</option>").join("");
  const categories = CATEGORIES.map((category) => "<option>" + escape(category) + "</option>").join("");
  return `
    <main class="narrow page-content" id="main-content">
      <div class="page-heading"><div class="feature-icon">${icon("pin")}</div>
        <h1>Report a campus issue</h1>
        <p>Tell the maintenance team what needs fixing and where to find it.</p>
      </div>
      <section class="card form-card" id="report-entry" aria-label="Issue report">
        <form id="report-form" method="post">
          <div class="form-grid">
            <label>Location<select name="location" required><option value="">Select a location</option>${locations}</select></label>
            <label>Category<select name="category" required><option value="">Select a category</option>${categories}</select></label>
          </div>
          <label data-custom-for="location" data-custom-value="other"${needsCustomLocation ? "" : " hidden"}>Specify campus location
            <input name="customLocation" maxlength="${CUSTOM_LOCATION_MAX_LENGTH}" placeholder="e.g. Engineering Building, Room 204"${needsCustomLocation ? " required" : " disabled"}>
          </label>
          <label data-custom-for="category" data-custom-value="Other" hidden>Specify category
            <input name="customCategory" maxlength="${CUSTOM_CATEGORY_MAX_LENGTH}" placeholder="e.g. Internet connectivity" disabled>
          </label>
          <details class="report-map" id="report-map">
            <summary>${icon("pin")}<span>Pin the location on a map</span><span class="map-optional">Optional</span></summary>
            <div class="map-content">
              <p class="map-help" id="map-help">Tap or click to drop a pin. You can also pan the map and pin its center.</p>
              <div class="map-frame">
                <div id="map-picker" role="region" aria-label="Campus location map" aria-describedby="map-help"></div>
                <span class="map-crosshair" aria-hidden="true"></span>
              </div>
              <p class="map-help" data-map-message role="status">Loading map…</p>
              <div class="actions">
                <button class="button" type="button" data-map-center disabled>Pin map center</button>
                <button class="button" type="button" data-map-clear hidden>Clear pin</button>
              </div>
            </div>
            <input type="hidden" name="latitude" disabled>
            <input type="hidden" name="longitude" disabled>
          </details>
          <label>Issue title<input name="title" required minlength="3" maxlength="100" placeholder="e.g. Leaking faucet"></label>
          <label>Description<textarea name="description" required minlength="10" maxlength="1000" rows="4" placeholder="Describe the issue and its exact location."></textarea></label>
          <fieldset class="issue-photo-field">
            <legend>Add a photo <span class="map-optional">Optional</span></legend>
            <p class="form-message">One photo, automatically compressed to ${PHOTO_MAX_BYTES / 1000} KB or less.</p>
            <input id="issue-photo-camera" type="file" accept="image/*" capture="environment" hidden>
            <input id="issue-photo-library" type="file" accept="image/*" hidden>
            <div class="actions">
              <button type="button" class="button" data-issue-photo-pick="#issue-photo-camera">Take photo</button>
              <button type="button" class="button" data-issue-photo-pick="#issue-photo-library">Choose photo</button>
              <button type="button" class="button" data-issue-photo-remove hidden>Remove photo</button>
            </div>
            <p class="form-message" data-issue-photo-name role="status"></p>
          </fieldset>
          ${turnstileSiteKey ? '<div class="cf-turnstile" data-sitekey="' + escape(turnstileSiteKey) + '" data-action="' + TURNSTILE_ACTION + '" data-size="compact" data-appearance="interaction-only"></div>' : ""}
          <p class="form-message" data-form-error role="alert" hidden></p>
          <button class="button primary" type="submit">Submit report</button>
        </form>
        <p class="tracking-page-link"><a href="/track">Track an existing report</a></p>
      </section>
      <section class="card form-card receipt" id="report-receipt" hidden>
        <div class="feature-icon success">${icon("check")}</div>
        <h2 tabindex="-1">Report received</h2>
        <div class="receipt-code">
          <label for="receipt-code">Tracking code</label>
          <input id="receipt-code" type="text" readonly spellcheck="false" aria-describedby="receipt-code-help">
          <p id="receipt-code-help">Save this code and paste it on the <a href="/track">tracking page</a> to check the status later.</p>
          <button class="button primary" type="button" data-copy-code>Copy tracking code</button>
        </div>
        <p class="form-message" role="status" data-copy-message></p>
        <p class="tracking-page-link"><a data-report-photo-link>Private photo link</a></p>
      </section>
    </main>`;
}

function loginPage(updated) {
  return `
    <main class="narrow login-page page-content" id="main-content">
      <section class="card form-card">
        <div class="page-heading"><img class="login-seal" src="/favicon.png" alt="ISAT U seal" width="48" height="48">
          <h1>Staff sign-in</h1><p>Sign in to view and update campus maintenance reports.</p>
        </div>
        ${updated ? '<p class="confirmation" role="status">Credentials updated. Sign in with your updated details.</p>' : ""}
        <form id="login-form" method="post">
          <label>Username<input name="username" autocomplete="username" required maxlength="100"></label>
          <label>Password<input type="password" name="password" autocomplete="current-password" required maxlength="256"></label>
          <p class="form-message" data-form-error role="alert" hidden></p>
          <button type="submit" class="button primary full-width">Sign in</button>
        </form>
      </section>
    </main>`;
}

function settingsPage({ username, minPasswordLength }) {
  return `
    <main class="narrow page-content" id="main-content">
      <div class="page-heading"><div class="feature-icon">${icon("lock")}</div>
        <h1>Settings</h1><p>Manage your staff sign-in credentials.</p>
      </div>
      <section class="card form-card" aria-label="Staff credentials">
        <form id="settings-form" method="post">
          <label>Username<input name="username" value="${escape(username)}" autocomplete="username" required maxlength="100"></label>
          <label>Current password<input type="password" name="currentPassword" autocomplete="current-password" required maxlength="256"></label>
          <div class="form-grid">
            <label>New password<input type="password" name="newPassword" autocomplete="new-password" minlength="${minPasswordLength}" maxlength="256" aria-describedby="password-hint"></label>
            <label>Confirm new password<input type="password" name="confirmPassword" autocomplete="new-password" maxlength="256"></label>
          </div>
          <p class="form-message" id="password-hint">Use at least ${minPasswordLength} characters for a new password. Leave both new password fields blank to keep your current password.</p>
          <p class="form-message" data-form-error role="alert" hidden></p>
          <button type="submit" class="button primary">Save credentials</button>
        </form>
      </section>
    </main>`;
}

function reportPeriodToolbar() {
  return `
      <div class="card dashboard-toolbar">
        <details class="period-panel">
          <summary class="period-summary">
            ${icon("clock")}
            <span><strong>Report period</strong> <span data-period-summary role="status">All dates · Philippine time</span></span>
          </summary>
          <form id="period-form">
            <div class="period-controls">
              <label>Period type<select name="period">
                <option value="all">All dates</option>
                <option value="day">Day</option>
                <option value="month">Month</option>
                <option value="year">Year</option>
              </select></label>
              <label data-period-bound hidden><span>Start date</span><input name="from" disabled></label>
              <label data-period-bound hidden><span>End date (optional)</span><input name="to" disabled></label>
              <button type="submit" class="button primary">Apply period</button>
            </div>
            <p class="form-message" data-period-error role="alert" hidden></p>
          </form>
        </details>
        <a class="button dashboard-export" href="/api/staff/reports.csv" data-export-period>${icon("download")} Download CSV</a>
      </div>`;
}

function dashboardPage() {
  const reasons = DISMISSAL_REASONS.map((reason) => "<option>" + escape(reason) + "</option>").join("");
  const stats = [
    ["new", "New", "inbox"],
    ["in_progress", "In progress", "clock"],
    ["resolved", "Resolved", "check"]
  ].map(([status, label, glyph]) => `
    <button class="card stat" type="button" aria-pressed="false" aria-controls="report-list" data-filter="${status}">
      <span class="stat-icon ${status}">${icon(glyph)}</span>
      <span class="stat-content"><span>${label}</span><strong data-count="${status}">–</strong></span>
    </button>`).join("");
  return `
    <main class="wide page-content dashboard" id="main-content">
      <div class="dashboard-heading">
        <h1>Maintenance Dashboard</h1>
        <button class="button" type="button" data-refresh>${icon("refresh")} Refresh</button>
      </div>
      <div class="stats" role="group" aria-label="Report counts">${stats}</div>
      ${reportPeriodToolbar()}
      <div class="dashboard-grid">
        <section class="card queue" aria-labelledby="queue-heading">
          <div class="queue-heading"><h2 id="queue-heading" tabindex="-1">Report queue</h2><span class="queue-count" data-queue-count>–</span></div>
          <label class="search-field">${icon("search")}<span class="sr-only">Search reports</span><input type="search" data-search placeholder="Search by title, location or code"></label>
          <div class="filters" role="group" aria-label="Filter by status">
            <button type="button" aria-pressed="true" data-filter="all">All in queue</button>
            <button type="button" aria-pressed="false" data-filter="new">New</button>
            <button type="button" aria-pressed="false" data-filter="in_progress">In progress</button>
            <button type="button" aria-pressed="false" data-filter="resolved">Resolved</button>
            <button type="button" aria-pressed="false" data-filter="dismissed">Dismissed</button>
          </div>
          <p class="empty" data-queue-message role="status">Loading reports…</p>
          <ul class="report-list" id="report-list"></ul>
        </section>
        <section class="card detail" aria-label="Report details">
          <p class="empty" data-empty-detail>Select a report to view its details.</p>
          <div data-report-detail hidden>
            <a class="detail-back" href="#queue-heading">Back to queue</a>
            <div class="detail-heading"><span class="reference" data-detail-ref></span><span class="status" data-detail-status></span></div>
            <h2 data-detail-title tabindex="-1"></h2>
            <p class="detail-description" data-detail-description></p>
            <p class="duplicate-note" data-duplicate-note hidden>Possible duplicate of <a data-duplicate-link></a>.</p>
            <dl class="report-facts">
              <div><dt>Location</dt><dd data-detail-location></dd></div>
              <div><dt>Tracking code</dt><dd><strong class="tracking-code" data-detail-tracking-code></strong></dd></div>
              <div><dt>Category</dt><dd data-detail-category></dd></div>
              <div><dt>Received</dt><dd data-detail-date></dd></div>
              <div data-detail-pin-row hidden><dt>Map pin</dt><dd><a data-detail-pin rel="noreferrer">Open in OpenStreetMap</a></dd></div>
              <div data-dismissal-row hidden><dt>Dismissal reason</dt><dd data-dismissal-reason></dd></div>
            </dl>
            <div class="detail-location-map" data-staff-map hidden>
              <div class="map-frame">
                <div id="staff-map-picker" role="region" aria-label="Map of the reported location"></div>
              </div>
              <p class="form-message" data-staff-map-message role="status"></p>
            </div>
            <figure class="detail-photo" data-issue-photo-details hidden>
              <figcaption>Reporter’s photo</figcaption>
              <img class="report-photo" data-issue-photo-image alt="Photo of the issue attached by the reporter">
            </figure>
            <div class="shared-photo-controls" data-shared-photo hidden>
              <figure class="detail-photo">
                <figcaption>Photo shared with the reporter</figcaption>
                <img class="report-photo" data-shared-photo-preview alt="Maintenance photo shared with the reporter">
              </figure>
              <div class="actions">
                <button type="button" class="button" data-copy-photo-link>Copy photo link</button>
                <a data-open-photo-link>Open photo link</a>
                <button type="button" class="button danger" data-remove-photo>Remove photo</button>
              </div>
            </div>
            <p class="form-message" data-photo-feedback role="status"></p>
            <form id="status-form">
              <label for="status-select">Update status</label>
              <select id="status-select" name="status"><option value="new">New</option><option value="in_progress">In progress</option><option value="resolved">Resolved</option></select>
              <label class="status-note-label" for="status-note">Note for reporter <span>(optional)</span></label>
              <textarea id="status-note" name="statusNote" rows="3" maxlength="${STATUS_NOTE_MAX_LENGTH}" placeholder="e.g. A replacement part has been ordered."></textarea>
              <button class="button primary" type="submit" disabled>Save update</button>
            </form>
            <p class="form-message" data-status-message role="status"></p>
            <details class="photo-controls" data-photo-panel hidden>
              <summary>Share a photo</summary>
              <form id="report-photo-form">
                <label>Choose or take a photo<input type="file" name="photo" accept="image/*" aria-describedby="photo-limit" required></label>
                <p class="form-message" id="photo-limit">One photo per report, compressed to ${PHOTO_MAX_BYTES / 1000} KB or less.</p>
                <button type="submit" class="button">Share photo</button>
              </form>
            </details>
            <details class="dismiss-controls" data-dismiss-controls>
              <summary>Dismiss report</summary>
              <form id="dismiss-form">
                <label>Reason<select name="reason" required><option value="">Select a reason</option>${reasons}</select></label>
                <button class="button danger" type="submit">Dismiss report</button>
              </form>
            </details>
          </div>
        </section>
      </div>
    </main>`;
}

function analyticsPage() {
  return `
    <main class="wide page-content dashboard" id="main-content">
      <div class="dashboard-heading">
        <h1>Report analytics</h1>
        <button class="button" type="button" data-analytics-refresh>${icon("refresh")} Refresh</button>
      </div>
      ${reportPeriodToolbar()}
      <p class="card analytics-message" data-analytics-message role="status">Loading analytics…</p>
      <div data-analytics-results hidden>
        <div class="stats" role="group" aria-label="Report totals">
          <div class="card stat"><span class="stat-icon new">${icon("inbox")}</span><span class="stat-content"><span>Total reports</span><strong data-metric="total"></strong></span></div>
          <div class="card stat"><span class="stat-icon in_progress">${icon("clock")}</span><span class="stat-content"><span>Open</span><strong data-metric="open"></strong></span></div>
          <div class="card stat"><span class="stat-icon resolved">${icon("check")}</span><span class="stat-content"><span>Resolved</span><strong data-metric="resolved"></strong></span></div>
        </div>
        <div class="analytics-grid">
          <section class="card analytics-card analytics-trend" aria-labelledby="trend-heading">
            <div class="analytics-card-heading">
              <h2 id="trend-heading">Reports received</h2>
              <p data-trend-summary role="status"></p>
            </div>
            <div class="trend-scroll" data-trend-scroll>
              <div class="trend-chart" data-trend-chart>
                <div class="trend-scale" data-trend-scale aria-hidden="true"></div>
                <div class="trend-columns" data-trend-columns role="group" aria-label="Reports by date"></div>
              </div>
            </div>
          </section>
          <section class="card analytics-card" aria-labelledby="status-heading">
            <div class="analytics-card-heading"><h2 id="status-heading">Current status</h2></div>
            <div class="status-breakdown" data-status-breakdown aria-hidden="true"></div>
            <ul class="analytics-list status-legend" data-status-legend></ul>
          </section>
          <section class="card analytics-card" aria-labelledby="categories-heading">
            <div class="analytics-card-heading"><h2 id="categories-heading">Top categories</h2></div>
            <ul class="analytics-list analytics-ranking" data-analytics-categories></ul>
          </section>
          <section class="card analytics-card" aria-labelledby="locations-heading">
            <div class="analytics-card-heading"><h2 id="locations-heading">Top locations</h2></div>
            <ul class="analytics-list analytics-ranking" data-analytics-locations></ul>
          </section>
        </div>
      </div>
    </main>`;
}

function trackPage({ hasCode }) {
  return `
    <main class="narrow page-content track-page" id="main-content">
      <div class="page-heading"><h1>Track a report</h1></div>
      <section class="card form-card">
        ${hasCode ? "" : `
        <form id="tracking-code-form" method="post">
          <label>Tracking code
            <input name="trackingCode" type="text" placeholder="e.g. K7M2Q9" required maxlength="96" autocomplete="off" autocapitalize="characters" spellcheck="false">
          </label>
          <p class="form-message" data-form-error role="alert" hidden></p>
          <button class="button primary" type="submit">Check status</button>
        </form>`}
        <div class="track-status-region" role="status">
          <p class="form-message" data-track-message>${hasCode ? "Checking status…" : ""}</p>
          <div class="tracking-result" data-track-result hidden>
            <p class="tracking-status">
              <span class="tracking-status-label">
                <span>Status</span>
                <span class="tracking-time" hidden>Set <time data-track-status-time></time></span>
              </span>
              <span class="status" data-track-status></span>
            </p>
            <div class="tracking-note" data-track-note-section hidden>
              <strong>Staff update</strong>
              <p data-track-note></p>
            </div>
            <figure class="tracking-photo" data-track-photo hidden>
              <figcaption>
                <span>Photo from staff</span>
                <span class="tracking-time" hidden>Attached <time data-track-photo-time></time></span>
                <span class="tracking-time" data-track-photo-time-unknown hidden>Attachment time unavailable</span>
              </figcaption>
              <img class="report-photo" data-track-photo-image alt="Photo shared by maintenance staff">
            </figure>
          </div>
        </div>
      </section>
    </main>`;
}

function photoPage({ imagePath }) {
  return `
    <main class="narrow page-content track-page" id="main-content">
      <div class="page-heading"><h1>Report photo</h1></div>
      <section class="card form-card">
        ${imagePath ? '<img class="report-photo" src="' + escape(imagePath) + '" alt="Maintenance photo shared by staff">' : '<p>A photo isn’t available for this report yet.</p>'}
      </section>
    </main>`;
}

function qrPage() {
  const cards = [...LOCATIONS].filter(([id]) => id !== "other").map(([id, label]) => `
    <article class="card qr-card">
      <h2>${escape(label)}</h2>
      <img src="/qr/${id}.svg" width="144" height="144" alt="Report QR code for ${escape(label)}">
      <div class="actions"><a href="/report?location=${id}">Open form</a>
      <a class="button" href="/qr/${id}.svg" download="campusfix-${id}.svg">${icon("download")} Download</a></div>
    </article>`).join("");
  return `
    <main class="wide page-content" id="main-content">
      <div class="page-heading"><div class="feature-icon">${icon("qr")}</div>
        <h1>Location QR codes</h1><p>Each code opens the report form with its campus location already selected.</p>
      </div>
      <section class="qr-grid" aria-label="Campus locations">${cards}</section>
    </main>`;
}

export function renderPage(kind, data) {
  const pages = {
    report: ["Report a campus issue", () => reportPage(data)],
    login: ["Staff sign-in", () => loginPage(data.updated)],
    dashboard: ["Maintenance Dashboard", dashboardPage],
    analytics: ["Report analytics", analyticsPage],
    settings: ["Settings", () => settingsPage(data)],
    track: ["Track a report", () => trackPage(data)],
    photo: ["Report photo", () => photoPage(data)],
    qr: ["Location QR codes", qrPage],
    missing: ["Page not found", () => '<main class="narrow page-content" id="main-content"><h1>Page not found</h1><p><a href="/report">Return to CampusFix</a></p></main>'],
    error: ["Something went wrong", () => '<main class="narrow page-content" id="main-content"><h1>Something went wrong</h1><p>Please try reloading the page.</p></main>']
  };
  const [title, body] = pages[kind];
  const hasMap = kind === "report" || kind === "dashboard";
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="theme-color" content="#111873">
    <title>${title} | CampusFix</title>
    <link rel="icon" type="image/png" sizes="64x64" href="/favicon.png">
    ${hasMap ? '<link rel="stylesheet" href="/vendor/leaflet/leaflet.css">' : ""}
    <link rel="stylesheet" href="/styles.css">
    ${kind === "report" && data.turnstileSiteKey ? '<script src="' + TURNSTILE_ORIGIN + '/turnstile/v0/api.js" async defer></script>' : ""}
    ${hasMap ? '<script src="/vendor/leaflet/leaflet.js" defer></script><script src="/report-map.js" defer></script>' : ""}
    ${["report", "dashboard"].includes(kind) ? '<script src="/report-photo.js" defer></script>' : ""}
    ${kind === "analytics" ? '<script src="/analytics.js" defer></script>' : ""}
    <script src="/app.js" defer></script>
  </head>
  <body data-page="${kind}"${["report", "dashboard"].includes(kind) ? ' data-photo-max-bytes="' + PHOTO_MAX_BYTES + '" data-photo-max-edge="' + PHOTO_MAX_EDGE + '"' : ""}>
    <a class="skip-link" href="#main-content">Skip to content</a>
    ${header(kind)}
    ${body()}
    <p class="global-message" role="alert" data-global-message hidden></p>
  </body>
</html>`;
}
