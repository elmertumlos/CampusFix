export const MANILA_OFFSET = 8 * 60 * 60 * 1000;
const periodPatterns = {
  day: /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/,
  month: /^[0-9]{4}-[0-9]{2}$/,
  year: /^[0-9]{4}$/
};
const suffix = { day: "", month: "-01", year: "-01-01" };
const statusNames = { new: "New", in_progress: "In progress", resolved: "Resolved", dismissed: "Dismissed" };

function calendarDate(value, unit) {
  if (!periodPatterns[unit].test(value) || value.startsWith("0000")) return null;
  const isoDate = value + suffix[unit];
  const date = new Date(isoDate + "T00:00:00.000Z");
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === isoDate ? date : null;
}

export function readReportPeriod(params) {
  const unit = params.get("period") ?? "all";
  if (unit === "all") return { unit };
  if (!Object.hasOwn(periodPatterns, unit)) return { error: "Choose a day, month, or year." };

  const from = params.get("from") ?? "";
  const to = params.get("to") || from;
  const start = calendarDate(from, unit);
  const end = calendarDate(to, unit);
  if (!start || !end) return { error: "Enter a valid start " + unit + " and optional end " + unit + "." };
  if (end < start) return { error: "The end of the period must be on or after the start." };

  if (unit === "day") end.setUTCDate(end.getUTCDate() + 1);
  if (unit === "month") end.setUTCMonth(end.getUTCMonth() + 1);
  if (unit === "year") end.setUTCFullYear(end.getUTCFullYear() + 1);

  return {
    unit, from, to,
    start: new Date(start.getTime() - MANILA_OFFSET).toISOString(),
    end: new Date(end.getTime() - MANILA_OFFSET).toISOString()
  };
}

export function reportPeriodScope(period) {
  return period.unit === "all"
    ? { where: "", values: [] }
    : { where: " WHERE created_at >= ? AND created_at < ?", values: [period.start, period.end] };
}

function csvCell(value) {
  const text = String(value);
  // Keep user-entered values from being interpreted as spreadsheet formulas.
  const safe = /^[\s\uFEFF]*[=+@-]|^[\t\r\n]/.test(text) ? "'" + text : text;
  return '"' + safe.replaceAll('"', '""') + '"';
}

function manilaTimestamp(timestamp) {
  return new Date(Date.parse(timestamp) + MANILA_OFFSET).toISOString().replace("Z", "+08:00");
}

export function reportsCsv(reports, period) {
  const rows = [["Reference", "Issue", "Location", "Category", "Description", "Status", "Received (PHT)", "Updated (PHT)", "Dismissal reason"]];
  for (const report of reports) {
    rows.push([
      report.reference, report.title, report.location, report.category, report.description, statusNames[report.status],
      manilaTimestamp(report.createdAt), manilaTimestamp(report.updatedAt), report.dismissalReason ?? ""
    ]);
  }
  const label = period.unit === "all" ? "all-dates" : period.from === period.to ? period.from : period.from + "_to_" + period.to;
  return {
    filename: "campusfix-reports-" + label + ".csv",
    contents: "\uFEFF" + rows.map((row) => row.map(csvCell).join(",")).join("\r\n") + "\r\n"
  };
}
