// features/dashboard.js — operational landing page: an at-a-glance view of the
// gateway's CURRENT state (proxy / tunnel / provider health), a short activity
// snapshot and the most recent requests. Deep trend / heatmap / distribution
// analysis lives in the dedicated API Analytics tab, so the dashboard stays a
// fast "what's happening right now" overview rather than a second analytics page.
import { h, icon } from "../dom.js";
import { store, ui, setUi, set, emit } from "../store.js";
import { catOf } from "../shell.js";
import { api } from "../api.js";
import { compact, int, money, ms, relTime, dateTime, latencyClass, tokensOf } from "../format.js";
import { rangeStart } from "../analytics.js";
import { estimateEventCost, catalogIndex } from "../pricing.js";
import { card, badge, kpiCard, dot, segmented, table, withBusy, toast } from "../ui.js";

const nav = (tab) => set({ tab, category: catOf(tab) });
const RANGES = [{ value: "today", label: "Today" }, { value: "24h", label: "24h" }, { value: "7d", label: "7d" }];

const hostOf = (url) => { try { return new URL(url).host; } catch { return url; } };

export function renderDashboard(s) {
  const st = ui("dash", { range: "7d" });
  const idx = catalogIndex(s.modelCatalog);
  const costOf = (e) => estimateEventCost(e, idx.get(e.model) || idx.get(e.modelId))?.cost ?? 0;
  const events = dashboardActivityRows(s, st.range);
  const hasActivity = !!(s.usageEvents?.length || s.usageRollups?.length);

  return h("div.stack",
    h("div.page-head",
      h("div.titles", h("h1", "Dashboard"), h("div.sub", "Live status of your gateway at a glance")),
      h("div.actions",
        h("button.btn.sm", { onClick: () => nav("api-analytics") }, icon("activity", 14), "Open API Analytics"))),
    actionCenter(s),
    liveStatus(s),
    hasActivity ? snapshot(st, events, costOf) : guidanceBanner(s),
    s.usageEvents.length ? recentActivity(s) : null,
    connectionCard(s),
  );
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
    items.push(dismissibleAction("providers", "missing", "err", "providers", "No providers yet", "Add an upstream provider and API key to start routing.", "Add Provider", () => nav("providers")));
  else if (!s.proxyTokens.length)
    items.push(dismissibleAction("tokens", s.providers.map((p) => p.id).join("|") || "providers", "warn", "tokens", "Create a proxy token", "You have providers but no proxy token to expose them safely.", "Create Token", () => nav("proxy-tokens")));
  else if (!s.proxyTokens.some((t) => t.allowedModels?.length))
    items.push(dismissibleAction("models", s.proxyTokens.map((t) => `${t.id}:${t.updatedAt || ""}`).join("|") || "tokens", "warn", "models", "Configure model mapping", "Map public model names to upstream models on a token.", "Configure", () => nav("proxy-tokens")));

  const fail = s.usageEvents.find((e) => !e.ok);
  if (fail) {
    // Dismiss is keyed to the latest failure, so the alert reappears when a NEW request fails.
    const sig = String(fail.id || fail.startedAt || "");
    if (!isDismissed("failed", sig)) {
      const failCount = s.totals?.failedCalls ?? s.usageEvents.filter((e) => !e.ok).length;
      items.push(act("err", "alert", `${failCount} failed request${failCount > 1 ? "s" : ""}`, `Latest: ${fail.status} · ${fail.model || "—"} · ${fail.error || "error"}`, "View Usage", () => nav("usage"), () => dismissAction("failed", sig)));
    }
  }
  if (s.localServices.length && !s.cloudflared?.running) {
    const item = dismissibleAction("tunnel", s.localServices.map((l) => `${l.id}:${l.updatedAt || ""}`).join("|") || "local", "warn", "globe", "Tunnel is off", "You run local services but Cloudflared is not active; they are not reachable publicly.", "Start Tunnel", () => nav("local-services"));
    if (item) items.push(item);
  }
  /*
    items.push(act("warn", "globe", "Tunnel is off", "You run local services but Cloudflared is not active — they aren't reachable publicly.", "Start Tunnel", () => nav("local-services")));

  */
  const visible = items.filter(Boolean);
  if (!visible.length) return null;

  return card({ title: h("span", { style: { display: "flex", gap: "8px", alignItems: "center" } }, icon("zap", 15), "Action Center") },
    h("div.actions-center", visible));
}

function dismissibleAction(key, sig, kind, ic, title, desc, btnLabel, onClick) {
  if (isDismissed(key, sig)) return null;
  return act(kind, ic, title, desc, btnLabel, onClick, () => dismissAction(key, sig));
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

// Disabled-state guidance: when there is no usage yet, point at the next step.
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

/* --------------------------- Live status tiles --------------------------- */
// The "current state" row: is the proxy up, is the tunnel exposing it, are the
// upstreams healthy, and how much traffic has been recorded.
function liveStatus(s) {
  const provs = s.providers || [];
  const avail = provs.filter((p) => p.status === "available").length;
  const down = provs.filter((p) => p.status && p.status !== "available" && p.status !== "unknown").length;
  const provKind = !provs.length ? "idle" : down === 0 ? "ok" : avail === 0 ? "err" : "warn";
  const cf = s.cloudflared || {};
  const totalCalls = s.totals?.totalCalls ?? s.usageEvents.length;
  const failed = s.totals?.failedCalls ?? s.usageEvents.filter((e) => !e.ok).length;

  return h("div.status-grid",
    tile(s.proxyPort ? "ok" : "idle", "Proxy gateway",
      s.proxyPort ? `127.0.0.1:${s.proxyPort}` : "Not running",
      s.proxyPort ? "Local endpoint live" : "Proxy not started"),
    tile(cf.running ? "ok" : "idle", "Public tunnel",
      cf.running && cf.publicUrl ? hostOf(cf.publicUrl) : "Off",
      cf.running ? "Cloudflared active" : "Not exposed publicly"),
    tile(provKind, "Providers",
      provs.length ? `${avail}/${provs.length} healthy` : "None",
      down ? `${down} unreachable` : provs.length ? "All upstreams reachable" : "Add a provider to begin"),
    tile("idle", "Recorded requests",
      int(totalCalls),
      failed ? `${int(failed)} failed` : "No failures recorded"));
}

function tile(kind, label, value, sub) {
  return h("div.status-tile",
    h("div.st-top", dot(kind), h("span.st-label", label)),
    h("div.st-value", { attrs: { title: String(value) } }, value),
    h("div.st-sub", sub));
}

/* --------------------------- Activity snapshot --------------------------- */
function snapshot(st, events, costOf) {
  const rows = events.filter(Boolean);
  const reqs = rows.reduce((a, e) => a + (e.calls || 1), 0);
  const ok = rows.reduce((a, e) => a + (e.okCalls ?? (e.ok ? 1 : 0)), 0);
  const success = reqs ? (ok / reqs) * 100 : null;
  const spend = rows.reduce((a, e) => a + costOf(e), 0);
  const toks = rows.reduce((a, e) => a + tokensOf(e), 0);
  const lat = rows.filter((e) => e.latencyMs).map((e) => e.latencyMs);
  const avgLat = lat.length ? lat.reduce((a, b) => a + b, 0) / lat.length : null;
  const top = topProviderRow(rows);
  const favoriteModel = favoriteModelRow(rows);
  const ov = { favoriteModel };

  return h("div.stack.tight",
    h("div.spread", { style: { padding: "var(--s2) 0" } },
      h("h3.section-title", "Activity snapshot"),
      segmented(RANGES, st.range, (range) => setUi("dash", { range }))),
    h("div.grid.cols-4",
      kpiCard({ label: "Requests", value: int(reqs) }),
      kpiCard({ label: "Success rate", value: success == null ? "—" : success.toFixed(1) + "%" }),
      kpiCard({ label: "Est. spend", value: "≈ " + money(spend), info: "Projected from the built-in pricing table — estimate only, not billed." }),
      kpiCard({ label: "Tokens", value: compact(toks) })),
    h("div.grid.cols-3",
      kpiCard({ label: "Avg latency", value: avgLat == null ? "—" : ms(avgLat) }),
      kpiCard({ label: "Top provider", value: top?.name || "—" }),
      kpiCard({ label: "Most-used model", value: ov.favoriteModel || "—" })));
}

function dashboardActivityRows(s, range) {
  const start = rangeStart(range);
  const live = (s.usageEvents || [])
    .filter((e) => !start || new Date(e.startedAt).getTime() >= start)
    .map((e) => ({ ...e, calls: 1, okCalls: e.ok ? 1 : 0, failedCalls: e.ok ? 0 : 1 }));
  const period = range === "7d" ? "week" : "month";
  const rollups = (s.usageRollups || []).filter((rollup) => {
    if (rollup.period !== period) return false;
    const t = new Date(rollup.bucketStart).getTime();
    return Number.isFinite(t) && (!start || t >= start);
  }).map((rollup) => ({
    ...rollup,
    startedAt: rollup.bucketStart,
    ok: rollup.failedCalls === 0,
    status: rollup.failedCalls ? 500 : 200,
  }));
  return [...live, ...rollups];
}

function topProviderRow(rows) {
  const map = new Map();
  for (const row of rows) {
    const key = row.providerId || row.providerName || "unknown";
    const cur = map.get(key) || { name: row.providerName || key, total: 0, calls: 0 };
    cur.total += tokensOf(row);
    cur.calls += row.calls || 1;
    map.set(key, cur);
  }
  return [...map.values()].sort((a, b) => b.total - a.total || b.calls - a.calls)[0] || null;
}

function favoriteModelRow(rows) {
  const map = new Map();
  for (const row of rows) {
    const model = row.model;
    if (!model) continue;
    map.set(model, (map.get(model) || 0) + (row.calls || 1));
  }
  return [...map.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || "";
}

/* --------------------------- Recent requests --------------------------- */
function recentActivity(s) {
  const events = [...s.usageEvents]
    .sort((a, b) => new Date(b.startedAt) - new Date(a.startedAt))
    .slice(0, 8);
  return card({
    title: "Recent requests",
    actions: h("button.btn.xs", { onClick: () => nav("usage") }, "View all", icon("chevron", 12)),
    flush: true,
  },
    table(
      [{ label: "Time" }, { label: "Provider" }, { label: "Model" }, { label: "Status" }, { label: "Tokens", num: true }, { label: "Latency", num: true }],
      events,
      (e) => h("tr.clickable", { onClick: () => nav("usage") },
        h("td", { style: { whiteSpace: "nowrap" } }, h("span.muted", dateTime(e.startedAt))),
        h("td", e.providerName || "—"),
        h("td", h("code.cell-mono", e.model || "—")),
        h("td", badge(String(e.status), e.ok ? "ok" : "err")),
        h("td.num", tokensOf(e) ? compact(tokensOf(e)) : "—"),
        h("td.num", { class: latencyClass(e.latencyMs) }, ms(e.latencyMs))),
      { emptyText: "No requests yet" }));
}

/* --------------------------- Connection status --------------------------- */
function connectionCard(s) {
  const rows = [
    ...s.providers.map((p) => ({ id: p.id, name: p.name, baseUrl: p.baseUrl, status: p.status, latencyMs: p.latencyMs, lastCheckedAt: p.lastCheckedAt, local: p.isLocal, kind: "provider" })),
    ...s.localServices.map((l) => ({ id: l.id, name: l.name, baseUrl: l.baseUrl, status: l.status, latencyMs: l.latencyMs, lastCheckedAt: l.lastCheckedAt, local: true, kind: "local" })),
  ];
  return card({ title: "API connection status", actions: s.cloudflared?.publicUrl && badge("tunnel: " + hostOf(s.cloudflared.publicUrl), "info") },
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
