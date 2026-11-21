const find = (selector) => document.querySelector(selector);
const statusNames = { new: "New", in_progress: "In progress", resolved: "Resolved", dismissed: "Dismissed" };
const dateFormatter = new Intl.DateTimeFormat("en-PH", {
  month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", timeZone: "Asia/Manila"
});

function make(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function setStatus(element, status) {
  element.textContent = statusNames[status];
  element.dataset.status = status;
}

async function api(path, { method = "GET", body } = {}) {
  const binary = body instanceof Blob;
  const response = await fetch(path, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": binary ? body.type : "application/json" },
    body: binary ? body : JSON.stringify(body)
  });
  const data = await response.json();
  if (!response.ok) {
    throw Object.assign(new Error(data.error ?? "Something went wrong. Please try again."), { status: response.status, data });
  }
  return data;
}

function errorMessage(error) {
  return error.status ? error.message : "CampusFix could not connect. Please try again.";
}

function bindForm(form, submit) {
  const button = form.querySelector("button[type=submit]");
  const errorText = form.querySelector("[data-form-error]");
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (button.disabled) return;
    button.disabled = true;
    errorText.hidden = true;
    try {
      await submit(Object.fromEntries(new FormData(form)));
    } catch (error) {
      errorText.textContent = errorMessage(error);
      errorText.hidden = false;
    } finally {
      button.disabled = false;
    }
  });
}

function studentReport() {
  const form = find("#report-form");
  const receipt = find("#report-receipt");
  const trackingCode = find("#receipt-code");
  const feedback = find("[data-copy-message]");
  const photo = initIssuePhotoPicker();
  let submission;
  for (const field of form.querySelectorAll("[data-custom-for]")) {
    const select = form.elements.namedItem(field.dataset.customFor);
    const input = field.querySelector("input");
    const sync = () => {
      const required = select.value === field.dataset.customValue;
      field.hidden = !required;
      input.disabled = !required;
      input.required = required;
    };
    select.addEventListener("change", sync);
    sync();
  }

  bindForm(form, async ({ "cf-turnstile-response": challenge, ...body }) => {
    photo.setBusy(true);
    try {
      body.issuePhoto = await photo.read();
      const contents = JSON.stringify(body);
      if (submission?.contents !== contents) {
        const bytes = crypto.getRandomValues(new Uint8Array(16));
        const key = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
        submission = { contents, key };
      }
      const report = await api("/api/reports", {
        method: "POST", body: { ...body, submissionKey: submission.key, "cf-turnstile-response": challenge }
      });
      trackingCode.value = report.trackingCode;
      find("[data-report-photo-link]").href = report.photoPath;
      find("#report-entry").hidden = true;
      receipt.hidden = false;
      receipt.querySelector("h2").focus();
    } catch (error) {
      if (challenge) window.turnstile?.reset();
      throw error;
    } finally {
      photo.setBusy(false);
    }
  });
  find("[data-copy-code]").addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(trackingCode.value);
      feedback.textContent = "Tracking code copied.";
    } catch {
      trackingCode.focus();
      trackingCode.select();
      feedback.textContent = "Copy the selected tracking code.";
    }
  });
}

function login() {
  bindForm(find("#login-form"), async (body) => {
    await api("/api/staff/login", { method: "POST", body });
    location.assign("/staff");
  });
}

function settings() {
  bindForm(find("#settings-form"), async ({ confirmPassword, ...body }) => {
    if (confirmPassword !== body.newPassword) {
      throw Object.assign(new Error("The new passwords do not match."), { status: 400 });
    }
    try {
      await api("/api/staff/account", { method: "PATCH", body });
      location.replace("/staff/login?updated=1");
    } catch (error) {
      if (error.status === 401) location.replace("/staff/login");
      else throw error;
    }
  });
}

const signOut = find("[data-sign-out]");
if (signOut) {
  signOut.addEventListener("click", async () => {
    signOut.disabled = true;
    try {
      await api("/api/staff/logout", { method: "POST" });
      location.replace("/staff/login");
    } catch (error) {
      const message = find("[data-global-message]");
      message.textContent = errorMessage(error);
      message.hidden = false;
      signOut.disabled = false;
    }
  });
}

function staffNotifications(bell) {
  const endpoint = "/api/staff/notifications";
  const panel = find("#notification-panel");
  const badge = find("[data-notification-badge]");
  const readButton = find("[data-notifications-read]");
  const message = find("[data-notification-message]");
  const list = find("[data-notification-list]");
  const announcement = find("[data-notification-announcement]");
  let current;
  let loading;
  let marking = false;

  function render(snapshot) {
    const { notifications, unreadCount } = snapshot;
    if (current && unreadCount > current.unreadCount) {
      announcement.textContent = "New maintenance reports. " + unreadCount + " unread.";
    }
    if (JSON.stringify(notifications) !== JSON.stringify(current?.notifications)) {
      list.replaceChildren(...notifications.map((report) => {
        const row = make("li");
        const link = make("a", "notification-item");
        link.href = "/staff?report=" + report.id;
        link.dataset.unread = String(report.unread);
        if (report.unread) link.append(make("span", "sr-only", "Unread: "));
        const received = make("time", "", dateFormatter.format(new Date(report.createdAt)));
        received.dateTime = report.createdAt;
        link.append(
          make("strong", "", report.title),
          make("span", "", report.reference + " · " + report.location),
          received
        );
        row.append(link);
        return row;
      }));
    }
    current = snapshot;
    badge.textContent = unreadCount > 99 ? "99+" : String(unreadCount);
    badge.hidden = unreadCount === 0;
    bell.setAttribute("aria-label", unreadCount ? "Notifications, " + unreadCount + " unread" : "Notifications");
    readButton.disabled = marking || unreadCount === 0;
    message.textContent = "No report submissions yet.";
    message.hidden = notifications.length > 0;
  }

  function showError(error) {
    message.textContent = errorMessage(error);
    message.hidden = false;
    if (error.status === 401) clearInterval(timer);
  }

  function refresh() {
    if (loading || marking) return;
    loading = api(endpoint).then(render).catch(showError).finally(() => { loading = null; });
  }

  function setOpen(open) {
    panel.hidden = !open;
    bell.setAttribute("aria-expanded", String(open));
    if (open) refresh();
  }

  bell.addEventListener("click", () => setOpen(panel.hidden));
  document.addEventListener("click", (event) => {
    if (!panel.hidden && !bell.contains(event.target) && !panel.contains(event.target)) setOpen(false);
  });
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || panel.hidden) return;
    event.preventDefault();
    setOpen(false);
    bell.focus();
  });
  readButton.addEventListener("click", async () => {
    if (marking || !current?.unreadCount) return;
    const throughId = current.throughId;
    marking = true;
    readButton.disabled = true;
    try {
      await loading;
      render(await api(endpoint, { method: "PATCH", body: { throughId } }));
    } catch (error) {
      showError(error);
    } finally {
      marking = false;
      readButton.disabled = !current?.unreadCount;
    }
  });

  const refreshWhenVisible = () => {
    if (document.visibilityState === "visible") refresh();
  };
  const timer = setInterval(refreshWhenVisible, 10000);
  document.addEventListener("visibilitychange", refreshWhenVisible);
  refresh();
}

const notificationBell = find("[data-notification-bell]");
if (notificationBell) staffNotifications(notificationBell);

function initReportPeriodToolbar(load) {
  const periodForm = find("#period-form");
  const periodPanel = periodForm.closest("details");
  const periodControl = periodForm.elements.namedItem("period");
  const periodButton = periodForm.querySelector("button");
  const periodSummary = find("[data-period-summary]");
  const periodError = find("[data-period-error]");
  const exportLink = find("[data-export-period]");

  function syncPeriodFields() {
    const unit = periodControl.value;
    const rules = {
      day: { type: "date", label: "date", placeholder: "YYYY-MM-DD", pattern: "[0-9]{4}-[0-9]{2}-[0-9]{2}" },
      month: { type: "month", label: "month", placeholder: "YYYY-MM", pattern: "[0-9]{4}-[0-9]{2}" },
      year: { type: "text", label: "year", placeholder: "YYYY", pattern: "[0-9]{4}" }
    }[unit];
    for (const field of periodForm.querySelectorAll("[data-period-bound]")) {
      const input = field.querySelector("input");
      field.hidden = !rules;
      input.disabled = !rules;
      input.required = Boolean(rules) && input.name === "from";
      input.value = "";
      if (!rules) continue;
      input.type = rules.type;
      input.placeholder = rules.placeholder;
      input.pattern = rules.pattern;
      input.maxLength = rules.placeholder.length;
      input.inputMode = unit === "year" ? "numeric" : "";
      field.querySelector("span").textContent = input.name === "from"
        ? "Start " + rules.label : "End " + rules.label + " (optional)";
    }
    periodError.hidden = true;
  }

  function periodLabel(query) {
    const from = query.get("from");
    if (!from) return "All dates · Philippine time";
    const unit = query.get("period");
    const suffix = { day: "", month: "-01", year: "-01-01" }[unit];
    const display = new Intl.DateTimeFormat("en-PH", {
      timeZone: "UTC",
      year: "numeric",
      month: unit === "year" ? undefined : "short",
      day: unit === "day" ? "numeric" : undefined
    });
    const print = (value) => display.format(new Date(value + suffix + "T00:00:00Z"));
    const to = query.get("to") || from;
    return (from === to ? print(from) : print(from) + " – " + print(to)) + " · Philippine time";
  }

  periodControl.addEventListener("change", syncPeriodFields);
  periodForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const query = periodControl.value === "all" ? new URLSearchParams() : new URLSearchParams(new FormData(periodForm));
    if (await load(query)) {
      const focused = periodForm.contains(document.activeElement);
      periodPanel.open = false;
      if (focused) periodPanel.querySelector("summary").focus({ preventScroll: true });
    }
  });
  syncPeriodFields();

  return {
    setBusy(busy) { periodButton.disabled = busy; },
    clearError() { periodError.hidden = true; },
    showError(message) {
      periodError.textContent = message;
      periodError.hidden = false;
    },
    show(query) {
      periodSummary.textContent = periodLabel(query);
      exportLink.href = "/api/staff/reports.csv" + (query.size ? "?" + query : "");
    }
  };
}

function dashboard() {
  let reports = [];
  const requestedReport = Number(new URLSearchParams(location.search).get("report"));
  let selectedId = Number.isSafeInteger(requestedReport) && requestedReport > 0 ? requestedReport : null;
  let filter = "all";
  let busy = false;
  let appliedPeriod = new URLSearchParams();
  const list = find(".report-list");
  const search = find("[data-search]");
  const queueMessage = find("[data-queue-message]");
  const form = find("#status-form");
  const statusSelect = find("#status-select");
  const statusNote = find("#status-note");
  const saveButton = form.querySelector("button");
  let statusDraftFor;
  const dismissBox = find("[data-dismiss-controls]");
  const dismissForm = find("#dismiss-form");
  const dismissButton = dismissForm.querySelector("button");
  const photoPanel = initReportPhotoPanel();
  const showStaffMap = initStaffReportMap();
  const issuePhoto = find("[data-issue-photo-details]");
  const issuePhotoImage = find("[data-issue-photo-image]");
  const refresh = find("[data-refresh]");
  const feedback = find("[data-status-message]");
  const countElements = [...document.querySelectorAll("[data-count]")];
  const filters = [...document.querySelectorAll("[data-filter]")];
  const periodToolbar = initReportPeriodToolbar(load);
  const receivedDate = new Intl.DateTimeFormat("en-PH", {
    month: "short", day: "numeric", year: "numeric", timeZone: "Asia/Manila"
  });

  const selected = () => reports.find((report) => report.id === selectedId);

  function updateControls() {
    refresh.disabled = busy;
    periodToolbar.setBusy(busy);
    const report = selected();
    const unavailable = busy || !report || report.status === "dismissed";
    statusSelect.disabled = unavailable;
    statusNote.disabled = unavailable;
    saveButton.disabled = unavailable ||
      (statusSelect.value === report.status && statusNote.value.trim() === (report.statusNote ?? ""));
    dismissButton.disabled = unavailable;
  }

  function render() {
    const query = search.value.trim().toLowerCase();
    const visible = reports.filter((report) => {
      const text = [report.reference, report.trackingCode, report.title, report.location, report.category].join(" ").toLowerCase();
      const matchesStatus = filter === "all" ? report.status !== "dismissed" : filter === report.status;
      return matchesStatus && text.includes(query);
    });
    if (!visible.some((report) => report.id === selectedId)) selectedId = visible[0]?.id ?? null;

    for (const count of countElements) {
      count.textContent = reports.filter((report) => report.status === count.dataset.count).length;
    }
    for (const button of filters) button.setAttribute("aria-pressed", String(button.dataset.filter === filter));
    find("[data-queue-count]").textContent = visible.length;
    queueMessage.textContent = reports.length ? "No reports match these filters."
      : appliedPeriod.has("from") ? "No reports were received in this period." : "No reports have been submitted yet.";
    queueMessage.hidden = visible.length > 0;
    list.replaceChildren(...visible.map((report) => {
      const row = make("li");
      const button = make("button", "report-row");
      button.type = "button";
      button.dataset.reportId = report.id;
      button.setAttribute("aria-pressed", String(report.id === selectedId));
      const details = make("span", "row-details");
      const meta = make("span", "row-meta");
      meta.append(make("span", "tracking-code", report.trackingCode), make("span", "row-location", report.location));
      if (report.hasIssuePhoto) meta.append(make("span", "row-photo", "Photo attached"));
      details.append(make("strong", "", report.title), meta);
      const summary = make("span", "row-summary");
      const status = make("span", "status");
      setStatus(status, report.status);
      const date = make("time", "", receivedDate.format(new Date(report.createdAt)));
      date.dateTime = report.createdAt;
      summary.append(status, date);
      button.append(details, summary);
      row.append(button);
      return row;
    }));

    const report = selected();
    find("[data-report-detail]").hidden = !report;
    find("[data-empty-detail]").hidden = Boolean(report);
    photoPanel.show(report?.status === "dismissed" ? null : report?.id);
    showStaffMap(report);
    issuePhoto.hidden = !report?.hasIssuePhoto;
    if (report?.hasIssuePhoto) {
      const issuePhotoPath = "/api/staff/reports/" + report.id + "/issue-photo";
      if (issuePhotoImage.getAttribute("src") !== issuePhotoPath) issuePhotoImage.src = issuePhotoPath;
    } else {
      issuePhotoImage.removeAttribute("src");
    }
    if (report) {
      find("[data-detail-ref]").textContent = report.reference;
      find("[data-detail-tracking-code]").textContent = report.trackingCode;
      find("[data-detail-title]").textContent = report.title;
      find("[data-detail-description]").textContent = report.description;
      find("[data-detail-location]").textContent = report.location;
      find("[data-detail-pin-row]").hidden = !report.pin;
      const mapLink = find("[data-detail-pin]");
      if (report.pin) {
        const { latitude, longitude } = report.pin;
        mapLink.href = `https://www.openstreetmap.org/?mlat=${latitude}&mlon=${longitude}#map=19/${latitude}/${longitude}`;
      } else {
        mapLink.removeAttribute("href");
      }
      find("[data-detail-category]").textContent = report.category;
      find("[data-detail-date]").textContent = dateFormatter.format(new Date(report.createdAt));
      setStatus(find("[data-detail-status]"), report.status);
      if (statusDraftFor?.id !== report.id || statusDraftFor.version !== report.version) {
        statusSelect.value = report.status;
        statusNote.value = report.statusNote ?? "";
        statusDraftFor = report;
      }
      const dismissed = report.status === "dismissed";
      form.hidden = dismissed;
      dismissBox.hidden = dismissed;
      dismissBox.open = false;
      dismissForm.reset();
      find("[data-dismissal-row]").hidden = !dismissed;
      find("[data-dismissal-reason]").textContent = report.dismissalReason ?? "";
      find("[data-duplicate-note]").hidden = !report.duplicate;
      if (report.duplicate) {
        const link = find("[data-duplicate-link]");
        link.textContent = report.duplicate.reference;
        link.href = "/staff?report=" + report.duplicate.id;
      }
    }
    updateControls();
  }

  async function load(query = appliedPeriod) {
    if (busy) return;
    busy = true;
    updateControls();
    periodToolbar.clearError();
    const argumentsString = query.size ? "?" + query : "";
    try {
      ({ reports } = await api("/api/staff/reports" + argumentsString));
      if (selectedId === requestedReport && selected()?.status === "dismissed") filter = "dismissed";
      appliedPeriod = query;
      periodToolbar.show(query);
      feedback.textContent = "";
      render();
      return true;
    } catch (error) {
      if (error.status === 401) location.replace("/staff/login");
      else if (query !== appliedPeriod) {
        periodToolbar.showError(errorMessage(error));
      }
      else {
        queueMessage.textContent = errorMessage(error);
        queueMessage.hidden = false;
      }
    } finally {
      busy = false;
      updateControls();
    }
  }

  for (const button of filters) {
    button.addEventListener("click", () => {
      const status = button.dataset.filter;
      filter = button.classList.contains("stat") && filter === status ? "all" : status;
      feedback.textContent = "";
      render();
    });
  }
  search.addEventListener("input", () => {
    feedback.textContent = "";
    render();
  });
  list.addEventListener("click", (event) => {
    const button = event.target.closest("[data-report-id]");
    if (!button) return;
    selectedId = Number(button.dataset.reportId);
    feedback.textContent = "";
    render();
    if (matchMedia("(max-width: 760px)").matches) {
      find("[data-detail-title]").focus({ preventScroll: true });
      find(".detail").scrollIntoView({ block: "start" });
    } else {
      list.querySelector('[data-report-id="' + selectedId + '"]').focus({ preventScroll: true });
    }
  });
  refresh.addEventListener("click", () => load());
  statusSelect.addEventListener("change", updateControls);
  statusNote.addEventListener("input", updateControls);

  async function mutateReport(path, changes) {
    const report = selected();
    if (!report || busy) return;
    busy = true;
    feedback.textContent = "";
    updateControls();
    let updated;
    try {
      ({ report: updated } = await api("/api/staff/reports/" + report.id + path, {
        method: "PATCH", body: { ...changes, version: report.version }
      }));
      feedback.textContent = updated.status === "dismissed"
        ? report.reference + " dismissed."
        : updated.status === report.status ? "Status note saved."
          : report.reference + " updated to " + statusNames[updated.status].toLowerCase() + ".";
    } catch (error) {
      if (error.status === 401) location.replace("/staff/login");
      updated = error.data?.report;
      feedback.textContent = errorMessage(error);
    } finally {
      busy = false;
      if (updated) {
        reports = reports.map((item) => item.id === updated.id ? updated : item);
        if (selectedId === updated.id) {
          if (updated.status === "dismissed") filter = "dismissed";
          else if (filter !== "all" && filter !== updated.status) filter = "all";
        }
        render();
        if (updated.status === "dismissed" && selectedId === updated.id) find("[data-detail-title]").focus({ preventScroll: true });
      } else {
        updateControls();
      }
    }
  }

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    if (!saveButton.disabled) mutateReport("", { status: statusSelect.value, statusNote: statusNote.value.trim() });
  });
  dismissForm.addEventListener("submit", (event) => {
    event.preventDefault();
    if (!dismissButton.disabled) mutateReport("/dismiss", { reason: dismissForm.elements.namedItem("reason").value });
  });
  load();
}

function tracking() {
  const form = find("#tracking-code-form");
  const result = find("[data-track-result]");
  const status = find("[data-track-status]");
  const statusTime = find("[data-track-status-time]");
  const noteSection = find("[data-track-note-section]");
  const note = find("[data-track-note]");
  const photo = find("[data-track-photo]");
  const photoImage = find("[data-track-photo-image]");
  const photoTime = find("[data-track-photo-time]");
  const photoTimeUnknown = find("[data-track-photo-time-unknown]");
  const message = find("[data-track-message]");
  photoImage.addEventListener("error", () => {
    photo.hidden = true;
  });

  function setTime(element, timestamp) {
    if (timestamp) {
      element.dateTime = timestamp;
      element.textContent = dateFormatter.format(new Date(timestamp)) + " PHT";
    }
    element.parentElement.hidden = !timestamp;
  }

  async function showStatus(code) {
    const report = await api("/api/track/" + code);
    setStatus(status, report.status);
    setTime(statusTime, report.statusAt);
    noteSection.hidden = !report.statusNote;
    note.textContent = report.statusNote ?? "";
    photo.hidden = !report.photoPath;
    setTime(photoTime, report.photoSharedAt);
    photoTimeUnknown.hidden = !report.photoPath || Boolean(report.photoSharedAt);
    if (report.photoPath) photoImage.src = report.photoPath;
    else photoImage.removeAttribute("src");
    message.textContent = "";
    result.hidden = false;
  }

  if (form) {
    const codeInput = form.elements.trackingCode;
    codeInput.addEventListener("input", () => {
      result.hidden = true;
    });
    bindForm(form, async ({ trackingCode }) => {
      result.hidden = true;
      const value = trackingCode.trim();
      const code = value.length === 6 ? value.toUpperCase() : value.replace(/[-\s]/g, "").toLowerCase();
      if (!/^(?:[A-Z0-9]{6}|[0-9a-f]{32}(?:[0-9a-f]{32})?)$/.test(code)) {
        throw Object.assign(new Error("Enter the six-character tracking code from your report confirmation."), { status: 400 });
      }
      codeInput.readOnly = true;
      try {
        await showStatus(code);
      } finally {
        codeInput.readOnly = false;
      }
    });
  } else {
    showStatus(location.pathname.split("/")[2]).catch((error) => {
      message.textContent = errorMessage(error);
    });
  }
}

const start = { report: studentReport, login, dashboard, settings, track: tracking };
if (document.body.dataset.page === "analytics") initAnalytics();
else start[document.body.dataset.page]?.();
