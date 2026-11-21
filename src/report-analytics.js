import { LOCATIONS } from "./catalog.js";
import { MANILA_OFFSET, reportPeriodScope } from "./report-period.js";

const formats = { day: "%Y-%m-%d", month: "%Y-%m", year: "%Y" };
const dayMs = 86_400_000;
const monthIndex = (date) => date.getUTCFullYear() * 12 + date.getUTCMonth();
const manilaDate = (date) => new Date(Date.parse(date) + MANILA_OFFSET);
const yearKey = (year) => String(year).padStart(4, "0");

function trendRange(period, rows) {
  const first = rows.map((row) => row.first).sort()[0];
  const last = rows.map((row) => row.last).sort().at(-1);
  const start = manilaDate(period.start ?? first);
  const end = period.end ? new Date(manilaDate(period.end).getTime() - 1) : manilaDate(last);
  const days = Math.floor(end.getTime() / dayMs) - Math.floor(start.getTime() / dayMs) + 1;
  const months = monthIndex(end) - monthIndex(start) + 1;
  const unit = days <= 31 ? "day" : months <= 24 ? "month" : "year";
  return { start, end, days, months, unit };
}

function trendPoints(range, rows) {
  const { start, end, days, months, unit } = range;
  const width = { day: 10, month: 7, year: 4 }[unit];
  const counts = new Map();
  for (const { bucket, count } of rows) {
    const key = bucket.slice(0, width);
    counts.set(key, (counts.get(key) ?? 0) + count);
  }
  if (unit === "day") {
    return Array.from({ length: days }, (_, index) => {
      const date = new Date(start.getTime() + index * dayMs).toISOString().slice(0, 10);
      return { from: date, to: date, count: counts.get(date) ?? 0 };
    });
  }
  if (unit === "month") {
    return Array.from({ length: months }, (_, index) => {
      const month = monthIndex(start) + index;
      const date = yearKey(Math.floor(month / 12)) + "-" + String(month % 12 + 1).padStart(2, "0");
      return { from: date, to: date, count: counts.get(date) ?? 0 };
    });
  }
  const startYear = start.getUTCFullYear();
  const years = end.getUTCFullYear() - startYear + 1;
  const step = Math.ceil(years / 24);
  const points = [];
  for (let offset = 0; offset < years; offset += step) {
    const span = Math.min(step, years - offset);
    let count = 0;
    for (let index = 0; index < span; index += 1) count += counts.get(yearKey(startYear + offset + index)) ?? 0;
    points.push({ from: yearKey(startYear + offset), to: yearKey(startYear + offset + span - 1), count });
  }
  return points;
}

export async function reportAnalytics(db, period) {
  const { where, values } = reportPeriodScope(period);
  const scoped = (query, tail = "") => db.prepare(query + " FROM reports" + where + tail).bind(...values);
  const fixedRange = period.start ? trendRange(period, []) : null;
  const format = formats[fixedRange?.unit ?? "day"];
  const [statuses, categories, locations, trend] = await db.batch([
    scoped(`
      SELECT CASE WHEN dismissed_at IS NULL THEN status ELSE 'dismissed' END AS current_status,
        COUNT(*) AS count, MIN(created_at) AS first, MAX(created_at) AS last
    `, " GROUP BY current_status"),
    scoped(`
      SELECT CASE WHEN category = 'Other' AND custom_category IS NOT NULL THEN custom_category ELSE category END AS label,
        COUNT(*) AS count
    `, " GROUP BY label ORDER BY count DESC, label COLLATE NOCASE, label LIMIT 8"),
    scoped(`
      SELECT location, CASE WHEN location = 'other' THEN custom_location END AS custom_location,
        COUNT(*) AS count
    `, " GROUP BY location, CASE WHEN location = 'other' THEN custom_location END"),
    scoped("SELECT strftime('" + format + "', created_at, '+8 hours') AS bucket, COUNT(*) AS count", " GROUP BY bucket")
  ]);
  const counts = { new: 0, in_progress: 0, resolved: 0, dismissed: 0 };
  for (const { current_status, count } of statuses.results) counts[current_status] = count;
  const locationCounts = new Map();
  for (const { location, custom_location, count } of locations.results) {
    const label = custom_location || LOCATIONS.get(location) || location;
    locationCounts.set(label, (locationCounts.get(label) ?? 0) + count);
  }
  const topLocations = [...locationCounts.entries()].map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label)).slice(0, 8);
  const empty = { counts, categories: categories.results, locations: topLocations };
  if (statuses.results.length === 0) return { ...empty, trend: { unit: "day", points: [] } };
  const range = fixedRange ?? trendRange(period, statuses.results);
  return { ...empty, trend: { unit: range.unit, points: trendPoints(range, trend.results) } };
}
