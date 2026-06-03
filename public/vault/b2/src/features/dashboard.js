// features/dashboard.js — Action Center, KPI cards, daily trend, heatmap, distributions, connection status.
import { h, icon } from "../dom.js";
import { store, ui, setUi, set, emit } from "../store.js";
import { catOf } from "../shell.js";
import { api } from "../api.js";
import { compact, int, money, ms, dur, relTime, latencyClass, tokensOf } from "../format.js";
import * as A from "../analytics.js";
import { estimateEventCost, catalogIndex } from "../pricing.js";
import { card, badge, segmented, kpiCard, stackedBars, heatmap, donutList, dot, withBusy, toast } from "../ui.js";

const nav = (tab) => set({ tab, category: catOf(tab) });
const RANGES = [{ value: "all", label: "All" }, { value: "30d", label: "30d" }, { value: "7d", label: "7d" }, { value: "today", label: "Today" }];
const TRI = [{ value: "token", label: "Token" }, { value: "cost", label: "Cost" }, { value: "duration", label: "Duration" }];
const DUO = [{ value: "token", label: "Token" }, { value: "cost", label: "Cost" }];
const TREND_COLORS = { output: "var(--accent)", input: "#56b0f6", cached: "#45c463" };

export function renderDashboard(s) {
  const st = ui("dash", { range: "30d", trend: "token", heat: "token", dist: "token" });
  const idx = catalogIndex(s.modelCatalog);
  const costOf = (e) => estimateEventCost(e, idx.get(e.model) || idx.get(e.modelId))?.cost ?? 0;
  const w = A.windowBounds(st.range);
  const events = A.inRange(s.usageEvents, st.range);
  const rolls = A.rollupsInWindow(s.usageRollups, w.start, w.end);
  // Cost & token totals fold in archived rollups, so compacted history is never lost.
  const cur = mergeBundle(A.bundle(events, costOf), A.rollupTokenCost(s.usageRollups, costOf, w.start, w.end));
  let pre = null;
  if (w.prevStart != null) {
    const prevEvents = s.usageEvents.filter((e) => { const t = +new Date(e.startedAt); return t >= w.prevStart && t < w.prevEnd; });
    pre = mergeBundle(A.bundle(prevEvents, costOf), A.rollupTokenCost(s.usageRollups, costOf, w.prevStart, w.prevEnd));
  }

  return h("div.stack",
    h("div.page-head",
      h("div.titles", h("h1", "Dashboard"), h("div.sub", "Usage, spend and activity across your gateway")),
      h("div.actions", segmented(RANGES, st.range, (range) => setUi("dash", { range })))),
    actionCenter(s),
    s.usageEvents.length || rolls.length ? null : guidanceBanner(s),
    kpiRows(cur, pre, st),
    trendCard(s.usageEvents, st, costOf),
    heatCard(events, st, costOf),
    distributions(events.concat(rolls), st, costOf),
    connectionCard(s),
  );
}

// Token / cost / message totals = live events + archived rollups (no data loss).
// Session / time metrics stay event-based (rollups hold no per-request timestamps).
function mergeBundle(b, r) {
  return {
    ...b,
    estCost: b.estCost + r.estCost,
    totalTokens: b.totalTokens + r.totalTokens,
    input: b.input + r.input,
    output: b.output + r.output,
    cached: b.cached + r.cached,
    userMessages: b.userMessages + r.calls,
    totalMessages: b.totalMessages + r.calls * 2,
  };
}

/* --------------------------- Action Center --------------------------- */
const DISMISS_KEY = "av-dismissed-actions-v1";
function readDismissed() {
  try { return JSON.parse(localStorage.getItem(DISMISS_KEY) || "{}"); } catch { return {}; }
}
function isDismissed(key, sig) { return readDismissed()[key] === sig; }
function dismissAction(key, sig) {
  const d = readDismissed();
  d[key] = sig;
  localStorage.setItem(DISMISS_KEY, JSON.stringify(d));
  emit();
}

function actionCenter(s) {
  const items = [];
  if (!s.providers.length)
    items.push(act("err", "providers", "No providers yet", "Add an upstream provider and API key to start routing.", "Add Provider", () => nav("providers")));
  else if (!s.proxyTokens.length)
    items.push(act("warn", "tokens", "Create a proxy token", "You have providers but no proxy token to expose them safely.", "Create Token", () => nav("proxy-tokens")));
  else if (!s.proxyTokens.some((t) => t.allowedModels?.length))
    items.push(act("warn", "models", "Configure model mapping", "Map public model names to upstream models on a token.", "Configure", () => nav("proxy-tokens")));

  const fail = s.usageEvents.find((e) => !e.ok);
  if (fail) {
    // Dismiss is keyed to the latest failure, so the alert reappears when a NEW request fails.
    const sig = String(fail.id || fail.startedAt || "");
    if (!isDismissed("failed", sig)) {
      const failCount = s.totals?.failedCalls ?? s.usageEvents.filter((e) => !e.ok).length;
      items.push(act("err", "alert", `${failCount} failed request${failCount > 1 ? "s" : ""}`, `Latest: ${fail.status} · ${fail.model || "—"} · ${fail.error || "error"}`, "View Usage", () => nav("usage"), () => dismissAction("failed", sig)));
    }
  }
  if (s.localServices.length && !s.cloudflared?.running)
    items.push(act("warn", "globe", "Tunnel is off", "You run local services but Cloudflared is not active — they aren't reachable publicly.", "Start Tunnel", () => nav("local-services")));

  if (!items.length)
    items.push(act("ok", "check", "All systems go", "Providers, tokens and tunnel are configured. Nothing needs attention.", null, null));

  return card({ title: h("span", { style: { display: "flex", gap: "8px", alignItems: "center" } }, icon("zap", 15), "Action Center") },
    h("div.actions-center", items));
}

function act(kind, ic, title, desc, btnLabel, onClick, onDismiss) {
  const trailing = [];
  if (btnLabel) trailing.push(h("button.btn.sm", { onClick }, btnLabel, icon("chevron", 13)));
  if (onDismiss) trailing.push(h("button.ai-dismiss", { title: "Dismiss", attrs: { "aria-label": "Dismiss" }, onClick: onDismiss }, icon("x", 14)));
  return h("div.action-item." + kind,
    h("div.ai-icon", icon(ic, 16)),
    h("div.ai-text", h("div.ai-title", title), h("div.ai-desc", desc)),
    trailing.length ? h("div.ai-actions", trailing) : null);
}

// Disabled-state guidance: when there is no usage to chart, point the user at the next step
// instead of hiding the dashboard.
function guidanceBanner(s) {
  const next = !s.providers.length
    ? { msg: "Add an upstream provider and API key to start routing requests.", label: "Add provider", tab: "providers" }
    : !s.proxyTokens.length
    ? { msg: "Create a proxy token to expose your providers and measure usage.", label: "Create token", tab: "proxy-tokens" }
    : { msg: "No requests recorded yet — send a call through your proxy URL and these metrics fill in.", label: "View usage", tab: "usage" };
  return h("div.action-item.warn",
    h("div.ai-icon", icon("zap", 16)),
    h("div.ai-text", h("div.ai-title", "Bring the dashboard to life"), h("div.ai-desc", next.msg)),
    h("div.ai-actions", h("button.btn.sm", { onClick: () => nav(next.tab) }, next.label, icon("chevron", 13))));
}

/* --------------------------- KPI cards --------------------------- */
function kpiRows(cur, pre, st) {
  const noCmp = st.range === "all" || !pre;
  const d = (key) => (noCmp ? null : pctChange(cur[key], pre[key]));
  return h("div.stack.tight",
    h("div.grid.cols-5",
      kpiCard({ label: "Est. cost", value: "≈ " + money(cur.estCost), info: "Projected from the built-in pricing table — estimate only, not billed.", delta: d("estCost") }),
      kpiCard({ label: "Total tokens", value: compact(cur.totalTokens), delta: d("totalTokens") }),
      kpiCard({ label: "Input tokens", value: compact(cur.input), delta: d("input") }),
      kpiCard({ label: "Output tokens", value: compact(cur.output), delta: d("output") }),
      kpiCard({ label: "Cached tokens", value: compact(cur.cached), info: "Cached input tokens, billed at the cheaper cached rate.", delta: d("cached") })),
    h("div.grid.cols-5",
      kpiCard({ label: "Active time", value: dur(cur.activeMs), info: "Time spent inside active sessions (a gap over 30 min starts a new session).", delta: d("activeMs") }),
      kpiCard({ label: "Total span", value: dur(cur.totalMs), info: "Wall-clock from the first to the last request in range.", delta: d("totalMs") }),
      kpiCard({ label: "Sessions", value: int(cur.sessions), info: "Requests grouped by activity; a gap over 30 min starts a new session.", delta: d("sessions") }),
      kpiCard({ label: "Total messages", value: int(cur.totalMessages), info: "Counts each request as one user message plus one assistant reply.", delta: d("totalMessages") }),
      kpiCard({ label: "User messages", value: int(cur.userMessages), info: "One per request you sent through the gateway.", delta: d("userMessages") })));
}

function pctChange(cur, prev) {
  if (prev === 0) return cur > 0 ? { isNew: true } : { pct: 0 };
  return { pct: ((cur - prev) / prev) * 100 };
}

/* --------------------------- Charts --------------------------- */
const legendRow = (pairs) => h("div.chart-legend", pairs.map(([name, color]) => h("span.cl-item", h("span.cl-dot", { style: { background: color } }), name)));

function trendCard(allEvents, st, costOf) {
  const mode = st.trend;
  const days = A.dailyStacks(allEvents, 30, costOf);
  let rows, legend, fmt;
  if (mode === "cost") {
    rows = days.map((dy) => ({ label: dy.label, segs: [{ value: dy.cost, color: TREND_COLORS.output }] }));
    legend = legendRow([["Est. cost", TREND_COLORS.output]]);
    fmt = (v) => "$" + (v || 0).toFixed(2);
  } else if (mode === "duration") {
    rows = days.map((dy) => ({ label: dy.label, segs: [{ value: dy.durMs, color: TREND_COLORS.input }] }));
    legend = legendRow([["Duration", TREND_COLORS.input]]);
    fmt = (v) => dur(v);
  } else {
    rows = days.map((dy) => ({ label: dy.label, segs: [
      { value: dy.tout, color: TREND_COLORS.output },
      { value: dy.tin, color: TREND_COLORS.input },
      { value: dy.tcached, color: TREND_COLORS.cached },
    ] }));
    legend = legendRow([["Output", TREND_COLORS.output], ["Input", TREND_COLORS.input], ["Cached", TREND_COLORS.cached]]);
    fmt = (v) => compact(v);
  }
  const axis = [days[0]?.label, days[Math.floor(days.length / 2)]?.label, days[days.length - 1]?.label];
  return card({
    title: h("span", "Daily trend ", h("span.muted", { style: { fontWeight: 400, fontSize: "var(--fz-sm)" } }, "· last 30 days")),
    actions: h("div.row", { style: { gap: "var(--s4)" } }, legend, segmented(TRI, mode, (v) => setUi("dash", { trend: v }))),
  }, stackedBars(rows, { axis, fmt }));
}

function heatCard(events, st, costOf) {
  const mode = st.heat;
  const valueOf = mode === "cost" ? costOf : mode === "duration" ? (e) => e.latencyMs || 0 : (e) => tokensOf(e);
  const fmt = mode === "cost" ? (v) => "$" + (v || 0).toFixed(2) : mode === "duration" ? dur : (v) => compact(v);
  return card({
    title: h("span", "Activity heatmap ", h("span.muted", { style: { fontWeight: 400, fontSize: "var(--fz-sm)" } }, "· week × hour")),
    actions: segmented(TRI, mode, (v) => setUi("dash", { heat: v })),
  }, heatmap(A.weekHour(events, valueOf), { fmt }));
}

/* --------------------------- Distributions --------------------------- */
function distributions(items, st, costOf) {
  const mode = st.dist;
  const valueOf = mode === "cost" ? costOf : (e) => tokensOf(e);
  const fmt = mode === "cost" ? (v) => "≈ $" + (v || 0).toFixed(2) : (v) => compact(v);
  const centerFmt = mode === "cost" ? (v) => "$" + (v || 0).toFixed(0) : (v) => compact(v);
  const mk = (title, keyFn, nameFn) => card({ title },
    donutList(A.distribution(items, keyFn, nameFn, valueOf, 6), { fmt, centerFmt, emptyTitle: "No data in range" }));
  return h("div.stack.tight",
    h("div.spread", { style: { padding: "var(--s2) 0" } },
      h("h3.section-title", "Distributions"),
      segmented(DUO, mode, (v) => setUi("dash", { dist: v }))),
    h("div.grid.cols-2",
      mk("By provider", (e) => e.providerId, (e) => e.providerName),
      mk("By model", (e) => e.model || e.modelId, (e) => e.model || e.modelId || "Unknown"),
      mk("By API key", (e) => e.apiKeyId, (e) => e.apiKeyName || e.apiKeyMasked || "Key"),
      mk("By proxy token", (e) => e.proxyTokenName || e.proxyTokenId, (e) => e.proxyTokenName || "Direct")));
}

/* --------------------------- Connection status --------------------------- */
function connectionCard(s) {
  const rows = [
    ...s.providers.map((p) => ({ id: p.id, name: p.name, baseUrl: p.baseUrl, status: p.status, latencyMs: p.latencyMs, lastCheckedAt: p.lastCheckedAt, local: p.isLocal, kind: "provider" })),
    ...s.localServices.map((l) => ({ id: l.id, name: l.name, baseUrl: l.baseUrl, status: l.status, latencyMs: l.latencyMs, lastCheckedAt: l.lastCheckedAt, local: true, kind: "local" })),
  ];
  return card({ title: "API connection status", actions: s.cloudflared?.publicUrl && badge("tunnel: " + new URL(s.cloudflared.publicUrl).host, "info") },
    h("div.stack.tight", rows.length ? rows.map((r) => connRow(r)) : h("p.muted", { style: { fontSize: "var(--fz-sm)" } }, "No providers or local services yet.")));
}

function connRow(r) {
  const stClass = r.status === "available" ? "ok" : r.status === "unknown" || r.status == null ? "idle" : "err";
  const btn = h("button.btn.xs", { onClick: () => testRow(btn, r) }, icon("activity", 12), "Test");
  return h("div.spread", { style: { padding: "8px 10px", border: "1px solid var(--border)", borderRadius: "var(--r1)", background: "var(--surface)" } },
    h("div.row", { style: { gap: "10px", minWidth: 0 } },
      dot(stClass),
      h("div", { style: { minWidth: 0 } },
        h("div.row", { style: { gap: "6px" } }, h("strong", { style: { fontSize: "var(--fz-base)" } }, r.name), r.local && badge("local", null, {})),
        h("div.mono.truncate.muted", { style: { fontSize: "var(--fz-xs)", maxWidth: "260px" } }, r.baseUrl))),
    h("div.row", { style: { gap: "12px" } },
      r.latencyMs ? h("span", { class: latencyClass(r.latencyMs), style: { fontSize: "var(--fz-sm)", fontWeight: 600 } }, ms(r.latencyMs)) : null,
      h("span.muted", { style: { fontSize: "var(--fz-xs)" } }, relTime(r.lastCheckedAt)),
      btn));
}

async function testRow(btn, r) {
  await withBusy(btn, async () => {
    const res = r.kind === "local" ? await api.testLocalService(r.id) : await api.testUrl({ baseUrl: r.baseUrl, providerId: r.id });
    // optimistic: reflect the fresh result on the row immediately (don't wait for the 5s poll)
    const s = store.state;
    const target = r.kind === "local" ? s.localServices.find((x) => x.id === r.id) : s.providers.find((x) => x.id === r.id);
    if (target) {
      target.latencyMs = res.ok ? res.latencyMs : 0;
      target.status = res.ok ? "available" : "unavailable";
      target.lastCheckedAt = res.checkedAt || new Date().toISOString();
    }
    toast(`${r.name}: ${res.ok ? "OK · " + ms(res.latencyMs) : "unreachable"}`, res.ok ? "ok" : "err");
    set({});
  });
}
