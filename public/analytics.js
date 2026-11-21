function initAnalytics() {
  const toolbar = initReportPeriodToolbar(load);
  const refresh = find("[data-analytics-refresh]");
  const results = find("[data-analytics-results]");
  const message = find("[data-analytics-message]");
  const trendScroll = find("[data-trend-scroll]");
  const countFormat = new Intl.NumberFormat("en-PH");
  let appliedPeriod = new URLSearchParams();
  let busy = false;
  let selectedTrendColumn;

  function revealTrendSelection() {
    if (!selectedTrendColumn) return;
    const visible = trendScroll.getBoundingClientRect();
    const selected = selectedTrendColumn.getBoundingClientRect();
    if (selected.left < visible.left || selected.right > visible.right) {
      trendScroll.scrollLeft += (selected.left + selected.right - visible.left - visible.right) / 2;
    }
  }

  function renderTrend({ unit, points }) {
    const summary = find("[data-trend-summary]");
    const chart = find("[data-trend-chart]");
    const columns = find("[data-trend-columns]");
    const scaleLabels = find("[data-trend-scale]");
    const dateSuffix = { day: "", month: "-01", year: "-01-01" }[unit];
    const dateOptions = { timeZone: "UTC", year: "numeric" };
    if (unit !== "year") dateOptions.month = "short";
    if (unit === "day") dateOptions.day = "numeric";
    const dateFormat = new Intl.DateTimeFormat("en-PH", dateOptions);
    const shortFormat = unit === "year" ? dateFormat : new Intl.DateTimeFormat("en-PH", {
      ...dateOptions, year: unit === "day" ? undefined : "2-digit"
    });
    const dateLabel = (key, formatter = dateFormat) => formatter.format(new Date(key + dateSuffix + "T00:00:00Z"));
    const largest = Math.max(...points.map((point) => point.count));
    const scale = largest <= 1 ? 1 : Math.ceil(largest / 2) * 2;
    const spacing = Math.ceil(points.length / 5);
    selectedTrendColumn = undefined;
    chart.style.setProperty("--trend-count", points.length);
    scaleLabels.replaceChildren(...[scale, scale === 1 ? "" : scale / 2, 0]
      .map((count) => make("span", "", count === "" ? "" : countFormat.format(count))));
    columns.replaceChildren(...points.map((point, index) => {
      const label = point.from === point.to ? dateLabel(point.from) : dateLabel(point.from) + " – " + dateLabel(point.to);
      const value = countFormat.format(point.count) + (point.count === 1 ? " report" : " reports");
      const description = label + " · " + value;
      const column = make("button", "trend-column");
      column.type = "button";
      column.setAttribute("aria-pressed", "false");
      column.setAttribute("aria-label", description);
      column.title = description;
      const slot = make("span", "trend-slot");
      const bar = make("span", "trend-bar");
      bar.style.setProperty("--fraction", point.count / scale);
      slot.append(bar);
      const isTick = index === 0 || index === points.length - 1 || (index % spacing === 0 && points.length - 1 - index >= spacing);
      const tick = make("span", "trend-tick", isTick ? dateLabel(point.from, shortFormat) : "");
      tick.setAttribute("aria-hidden", "true");
      column.append(slot, tick);
      column.addEventListener("click", () => {
        selectedTrendColumn?.setAttribute("aria-pressed", "false");
        selectedTrendColumn = column;
        selectedTrendColumn.setAttribute("aria-pressed", "true");
        summary.textContent = description;
      });
      return column;
    }));
    const latest = points.findLastIndex((point) => point.count > 0);
    trendScroll.scrollLeft = 0;
    columns.children[latest]?.click();
    revealTrendSelection();
  }

  function renderStatuses(counts, total) {
    const bands = [];
    const items = Object.entries(counts).map(([status, count]) => {
      const colorClass = "analytics-status-" + status;
      if (count) {
        const band = make("span", colorClass);
        band.style.flexGrow = count;
        bands.push(band);
      }
      const item = make("li");
      const label = make("span", "analytics-status-label");
      const dot = make("span", "analytics-dot " + colorClass);
      dot.setAttribute("aria-hidden", "true");
      label.append(dot, document.createTextNode(statusNames[status]));
      item.append(label, make("strong", "", countFormat.format(count)),
        make("span", "analytics-percent", Math.round((count / total) * 100) + "%"));
      return item;
    });
    find("[data-status-breakdown]").replaceChildren(...bands);
    find("[data-status-legend]").replaceChildren(...items);
  }

  function renderRanking(selector, items) {
    const highest = items[0]?.count;
    find(selector).replaceChildren(...items.map(({ label, count }) => {
      const row = make("li");
      const line = make("div", "rank-label");
      line.append(make("span", "", label), make("strong", "", countFormat.format(count)));
      const rail = make("div", "rank-rail");
      rail.setAttribute("aria-hidden", "true");
      const bar = make("span");
      bar.style.setProperty("--fraction", count / highest);
      rail.append(bar);
      row.append(line, rail);
      return row;
    }));
  }

  function render(data) {
    const total = Object.values(data.counts).reduce((sum, count) => sum + count, 0);
    results.hidden = !total;
    message.hidden = Boolean(total);
    if (!total) {
      message.textContent = "No reports were received in this period.";
      return;
    }
    find('[data-metric="total"]').textContent = countFormat.format(total);
    find('[data-metric="open"]').textContent = countFormat.format(data.counts.new + data.counts.in_progress);
    find('[data-metric="resolved"]').textContent = countFormat.format(data.counts.resolved);
    renderTrend(data.trend);
    renderStatuses(data.counts, total);
    renderRanking("[data-analytics-categories]", data.categories);
    renderRanking("[data-analytics-locations]", data.locations);
  }

  async function load(query = appliedPeriod) {
    if (busy) return false;
    busy = true;
    refresh.disabled = true;
    toolbar.setBusy(true);
    toolbar.clearError();
    try {
      const data = await api("/api/staff/analytics" + (query.size ? "?" + query : ""));
      appliedPeriod = query;
      toolbar.show(query);
      render(data);
      return true;
    } catch (error) {
      if (error.status === 401) location.replace("/staff/login");
      else if (query !== appliedPeriod) toolbar.showError(errorMessage(error));
      else {
        message.textContent = errorMessage(error);
        message.hidden = false;
      }
      return false;
    } finally {
      busy = false;
      refresh.disabled = false;
      toolbar.setBusy(false);
    }
  }

  refresh.addEventListener("click", () => load());
  window.addEventListener("resize", revealTrendSelection);
  load();
}
