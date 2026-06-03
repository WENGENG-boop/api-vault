// features/status.js — health & latency monitoring (providers / models / connection latency).
import { h, icon } from "../dom.js";
import { ui, setUi } from "../store.js";
import { compact, int, pct, ms, relTime, latencyClass } from "../format.js";
import * as A from "../analytics.js";
import { card, stat, badge, dot, segmented, chips, searchBox, sparkline, uptimeBar, table } from "../ui.js";

const VIEWS = [{ value: "providers", label: "Providers" }, { value: "models", label: "Models" }, { value: "latency", label: "Connection Latency" }];
const HEALTH = [{ value: "", label: "All" }, { value: "healthy", label: "Healthy" }, { value: "issues", label: "Issues" }, { value: "inactive", label: "Inactive" }];
const SORTS = [{ value: "calls", label: "Calls" }, { value: "name", label: "Name" }, { value: "fastest", label: "Fastest" }, { value: "success", label: "Success rate" }];
const DAY = 86400e3;

export function renderStatus(s) {
  const st = ui("status", { view: "providers", health: "", sort: "calls", q: "", range: "24h", expanded: null });
  const events7d = s.usageEvents.filter((e) => new Date(e.startedAt).getTime() >= Date.now() - 7 * DAY);
  const avgLat = events7d.length ? events7d.reduce((a, e) => a + (e.latencyMs || 0), 0) / events7d.length : null;
  const activeGateways = new Set(s.usageEvents.map((e) => e.providerId)).size;
  const modelsMonitored = new Set(s.usageEvents.map((e) => e.model).filter(Boolean)).size;

  return h("div.stack",
    h("div.page-head",
      h("div.titles", h("h1", "Status"), h("div.sub", "Health, latency and uptime across providers and models")),
      h("div.actions", segmented(VIEWS, st.view, (view) => setUi("status", { view })))),
    h("div.grid.cols-4",
      stat("Avg latency (7d)", avgLat == null ? "—" : ms(avgLat), null, { sm: true }),
      stat("Total requests", int(s.usageEvents.length), null, { sm: true }),
      stat("Active gateways", int(activeGateways), null, { sm: true }),
      stat("Models monitored", int(modelsMonitored), null, { sm: true })),
    st.view === "latency" ? latencyView(s, st) : entityView(s, st));
}

/* ----------------------- providers / models view ----------------------- */
function entityView(s, st) {
  const isProviders = st.view === "providers";
  let rows = isProviders ? providerRows(s) : modelRows(s);
  const q = st.q.toLowerCase();
  rows = rows.filter((r) => !q || r.name.toLowerCase().includes(q));
  rows = rows.filter((r) => {
    if (st.health === "healthy") return r.successRate != null && r.successRate >= 99;
    if (st.health === "issues") return r.successRate != null && r.successRate < 99;
    if (st.health === "inactive") return r.calls === 0;
    return true;
  });
  rows.sort((a, b) => st.sort === "name" ? a.name.localeCompare(b.name) : st.sort === "fastest" ? (a.avgLatency ?? 1e9) - (b.avgLatency ?? 1e9) : st.sort === "success" ? (b.successRate ?? -1) - (a.successRate ?? -1) : b.calls - a.calls);

  return h("div.stack",
    h("div.spread.wrap", { style: { gap: "8px" } },
      h("div.row.wrap", { style: { gap: "8px" } }, chips(HEALTH, st.health, (v) => setUi("status", { health: v }))),
      h("div.row", { style: { gap: "8px" } },
        h("span.muted", { style: { fontSize: "var(--fz-xs)" } }, "SORT"), segmented(SORTS, st.sort, (v) => setUi("status", { sort: v })),
        searchBox(st.q, "Search…", (v) => setUi("status", { q: v }), "status-q"))),
    rows.length ? h("div", rows.map((r) => entityRow(r, st))) : h("div.empty", h("h4", "Nothing matches"), h("p", "Adjust filters above.")));
}

function providerRows(s) {
  return s.providers.map((p) => {
    const ps = A.providerStats(s.usageEvents, p.id);
    const lats = s.usageEvents.filter((e) => e.providerId === p.id && e.latencyMs).map((e) => e.latencyMs);
    const trend = (p.latencyHourly || []).slice(-24).map((b) => (b.count ? b.sum / b.count : 0));
    const uptime = (p.latencyHourly || []).slice(-48);
    return { kind: "provider", id: p.id, name: p.name, status: p.status, baseUrl: p.baseUrl, latencyMs: p.latencyMs, lastCheckedAt: p.lastCheckedAt,
      calls: ps.calls, calls7: ps.calls7, successRate: ps.successRate, avgLatency: ps.avgLatency, trend, uptime, quant: A.quantiles(lats), recent: A.recentRequests(s.usageEvents, p.id, null, 15) };
  });
}

function modelRows(s) {
  return A.modelStats(s.usageEvents).map((m) => ({
    kind: "model", id: m.model, name: m.model, status: m.successRate >= 99 ? "available" : m.calls ? "degraded" : "unknown",
    calls: m.calls, calls7: m.calls, successRate: m.successRate, avgLatency: m.avgLatency, providerName: m.providerName,
    trend: A.hourlyLatencyFromEvents(s.usageEvents, m.model, 24), uptime: [], quant: A.quantiles(m.lat), recent: A.recentRequests(s.usageEvents, null, m.model, 15),
  }));
}

function healthClass(r) { return r.calls === 0 ? "idle" : r.successRate == null ? "idle" : r.successRate >= 99 ? "ok" : r.successRate >= 90 ? "warn" : "err"; }

function entityRow(r, st) {
  const open = st.expanded === r.kind + ":" + r.id;
  const head = h("div.lrow-head", { onClick: () => setUi("status", { expanded: open ? null : r.kind + ":" + r.id }) },
    icon("chevron", 14, { class: "chev" }),
    h("div.lrow-title", dot(healthClass(r)), r.name, r.providerName && badge(r.providerName, "accent")),
    h("div.row", { style: { marginLeft: "auto", gap: "20px", alignItems: "center" } },
      r.trend?.some((x) => x) ? sparkline(r.trend, { w: 90, h: 26, color: r.successRate >= 99 ? "var(--ok)" : "var(--warn)" }) : null,
      metric("Success", r.successRate == null ? "—" : pct(r.successRate, 1)),
      metric("Avg", r.avgLatency ? ms(r.avgLatency) : "—"),
      metric("7d calls", int(r.calls7 ?? r.calls))));
  return h("div.lrow" + (open ? ".open" : ""), head, open && entityBody(r));
}

const metric = (label, value) => h("div.lrow-metric", h("span.m-label", label), h("span.m-value", value));

function entityBody(r) {
  return h("div.lrow-body",
    h("div.grid.cols-2",
      card({ title: "Latency distribution" }, h("div.quantiles",
        q("p50", r.quant.p50), q("p95", r.quant.p95), q("p99", r.quant.p99), q("peak", r.quant.peak))),
      card({ title: "Connection" }, h("dl.kv",
        r.baseUrl ? [h("dt", "Base URL"), h("dd", h("code.truncate", { style: { maxWidth: "260px", display: "inline-block" } }, r.baseUrl))] : null,
        h("dt", "Ping"), h("dd", r.latencyMs ? h("span", { class: latencyClass(r.latencyMs) }, ms(r.latencyMs)) : "—"),
        h("dt", "Status"), h("dd", badge(r.status || "unknown", r.status === "available" ? "ok" : r.status === "degraded" ? "warn" : null, { dot: true })),
        h("dt", "Last checked"), h("dd", relTime(r.lastCheckedAt))))),
    r.uptime?.length ? h("div.mt4", card({ title: "Uptime (last 48h)" }, uptimeBar(r.uptime))) : null,
    h("div.mt4", card({ title: `Recent requests (${r.recent.length})`, flush: true },
      table([{ label: "Time" }, { label: "Model" }, { label: "Status" }, { label: "Latency", num: true }],
        r.recent, (e) => h("tr",
          h("td", h("span.muted", relTime(e.startedAt))),
          h("td", h("code.cell-mono", e.model || "—")),
          h("td", badge(String(e.status), e.ok ? "ok" : "err")),
          h("td.num", { class: latencyClass(e.latencyMs) }, ms(e.latencyMs))), { emptyText: "No requests" }))));
}

const q = (label, value) => h("div.q", h("span.ql", label), h("span.qv", value == null ? "—" : ms(value)));

/* ----------------------- connection latency view ----------------------- */
const LAT_RANGES = [{ value: "1h", label: "1 hour" }, { value: "24h", label: "24 hours" }, { value: "7d", label: "7 days" }];

function latencyView(s, st) {
  const hours = st.range === "1h" ? 1 : st.range === "7d" ? 168 : 24;
  return h("div.stack",
    h("div.spread", h("span.section-title", { style: { margin: 0 } }, "Time range"), segmented(LAT_RANGES, st.range, (v) => setUi("status", { range: v }))),
    card({ title: h("span", { style: { display: "flex", gap: "8px", alignItems: "center" } }, icon("wifi", 14), "Provider connections"), actions: h("span.muted", { style: { fontSize: "var(--fz-xs)" } }, "probed every 10s") },
      h("div.stack.tight", s.providers.map((p) => latencySeriesRow(p.name, providerSeries(p, hours), p.latencyMs)))),
    card({ title: h("span", { style: { display: "flex", gap: "8px", alignItems: "center" } }, icon("models", 14), "Models"), actions: h("span.muted", { style: { fontSize: "var(--fz-xs)" } }, "from real calls") },
      h("div.stack.tight", A.modelStats(s.usageEvents).slice(0, 8).map((m) => latencySeriesRow(m.model, A.hourlyLatencyFromEvents(s.usageEvents, m.model, hours), m.avgLatency)))));
}

function providerSeries(p, hours) {
  const buckets = (p.latencyHourly || []).slice(-hours);
  return buckets.map((b) => (b.count ? b.sum / b.count : 0));
}

function latencySeriesRow(name, series, current) {
  const valid = series.filter((x) => x > 0);
  const avg = valid.length ? valid.reduce((a, b) => a + b, 0) / valid.length : null;
  return h("div.spread", { style: { padding: "8px 10px", border: "1px solid var(--border)", borderRadius: "var(--r1)", background: "var(--surface)" } },
    h("div.row", { style: { gap: "10px", minWidth: 0, flex: 1 } },
      h("strong.truncate", { style: { fontSize: "var(--fz-sm)", width: "160px" } }, name),
      series.some((x) => x) ? sparkline(series, { w: 240, h: 28, color: "var(--accent)" }) : h("span.muted", { style: { fontSize: "var(--fz-xs)" } }, "no data")),
    h("div.row", { style: { gap: "16px" } },
      metric("Avg", avg ? ms(avg) : "—"),
      metric("Now", current ? ms(current) : "—")));
}
