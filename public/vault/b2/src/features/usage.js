// features/usage.js — call log: filters, summary, pagination, detail drawer.
import { h, icon } from "../dom.js";
import { ui, setUi } from "../store.js";
import { compact, int, money, ms, dateTime, gatewayLabel, tokensOf, latencyClass } from "../format.js";
import { estimateEventCost, catalogIndex } from "../pricing.js";
import { card, stat, badge, field, searchBox, copyBtn, table, openModal, closeOverlay, empty } from "../ui.js";

const PAGE_SIZE = 100;

export function renderUsage(s) {
  const st = ui("usage", { provider: "", key: "", q: "", page: 0 });
  const q = st.q.toLowerCase();
  const keyOptions = st.provider ? (s.providers.find((p) => p.id === st.provider)?.apiKeys || []) : s.providers.flatMap((p) => p.apiKeys);

  let events = s.usageEvents.filter((e) =>
    (!st.provider || e.providerId === st.provider) &&
    (!st.key || e.apiKeyId === st.key) &&
    (!q || [e.model, gatewayLabel(e), e.baseUrl, String(e.status), e.error, e.apiKeyName].some((f) => (f || "").toLowerCase().includes(q))));

  const idx = catalogIndex(s.modelCatalog);
  const estOf = (e) => estimateEventCost(e, idx.get(e.model) || idx.get(e.modelId))?.cost ?? null;
  const failed = events.filter((e) => !e.ok).length;
  const totalEst = events.reduce((a, e) => a + (estOf(e) || 0), 0);
  const pricedCount = events.filter((e) => estOf(e) != null).length;
  const pages = Math.max(1, Math.ceil(events.length / PAGE_SIZE));
  const page = Math.min(st.page, pages - 1);
  const slice = events.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);

  return h("div.stack",
    h("div.page-head",
      h("div.titles", h("h1", "Usage"), h("div.sub", "Every request routed through the gateway")),
      h("div.actions",
        selectFilter(s.providers.map((p) => ({ value: p.id, label: p.name })), st.provider, "All providers", (v) => setUi("usage", { provider: v, key: "", page: 0 })),
        selectFilter(keyOptions.map((k) => ({ value: k.id, label: k.name })), st.key, "All keys", (v) => setUi("usage", { key: v, page: 0 })),
        searchBox(st.q, "Model, gateway, status, error…", (v) => setUi("usage", { q: v, page: 0 }), "usage-q"))),
    h("div.grid.cols-3",
      stat("Requests (filtered)", int(events.length), null, { sm: true }),
      stat("Failed", int(failed), failed ? "needs attention" : "all clear", { sm: true }),
      stat("Est. cost (filtered)", "≈ " + money(totalEst), `${int(pricedCount)} priced · from pricing table`, { sm: true })),
    card({ flush: true, title: h("span", `${events.length} events`), actions: pager(page, pages, (p) => setUi("usage", { page: p })) },
      slice.length ? logTable(s, slice, estOf) : h("div.card-body", empty("No matching requests", "Loosen the filters above."))));
}

function selectFilter(options, value, allLabel, onChange) {
  return h("select", { style: { minWidth: "140px" }, onchange: (e) => onChange(e.target.value) },
    [h("option", { value: "", selected: !value }, allLabel), ...options.map((o) => h("option", { value: o.value, selected: o.value === value }, o.label))]);
}

function pager(page, pages, onGo) {
  return h("div.row", { style: { gap: "6px", alignItems: "center" } },
    h("button.btn.xs", { disabled: page <= 0, onClick: () => onGo(page - 1) }, icon("chevron", 12, { class: "" })),
    h("span.muted", { style: { fontSize: "var(--fz-xs)" } }, `${page + 1} / ${pages}`),
    h("button.btn.xs", { disabled: page >= pages - 1, onClick: () => onGo(page + 1) }, icon("chevron", 12)));
}

function logTable(s, events, estOf) {
  return table(
    [{ label: "Time" }, { label: "Provider" }, { label: "Gateway" }, { label: "Key" }, { label: "Model" }, { label: "Status" }, { label: "In", num: true }, { label: "Out", num: true }, { label: "Est. $", num: true }, { label: "Latency", num: true }],
    events,
    (e) => h("tr.clickable", { onClick: () => openDetail(s, e, estOf(e)) },
      h("td", { style: { whiteSpace: "nowrap" } }, h("span.muted", dateTime(e.startedAt))),
      h("td", e.providerName),
      h("td", h("span.muted", { style: { fontSize: "var(--fz-xs)" } }, gatewayLabel(e))),
      h("td", h("code.cell-mono", e.apiKeyName || "—")),
      h("td", h("code.cell-mono", e.model || "—")),
      h("td", badge(String(e.status), e.ok ? "ok" : "err")),
      h("td.num", e.inputTokens != null ? compact(e.inputTokens) : "—"),
      h("td.num", e.outputTokens != null ? compact(e.outputTokens) : "—"),
      h("td.num", estOf(e) != null ? "≈ " + money(estOf(e)) : h("span.muted", "—")),
      h("td.num", { class: latencyClass(e.latencyMs) }, ms(e.latencyMs))),
    { emptyText: "No requests" });
}

function openDetail(s, e, est) {
  const body = h("div.stack",
    h("div.spread", h("div.row", { style: { gap: "8px" } }, badge(String(e.status), e.ok ? "ok" : "err", { dot: true }), h("code", e.model || "no model")), h("span.muted", dateTime(e.startedAt))),
    e.error && h("div.action-item.err", h("div.ai-icon", icon("alert", 16)), h("div.ai-text", h("div.ai-title", "Error"), h("div.ai-desc", { style: { wordBreak: "break-word" } }, e.error))),
    card({ title: "Routing" }, kvList([
      ["Provider", e.providerName],
      ["Base URL", e.baseUrl ? h("code.cell-mono", e.baseUrl) : "—"],
      ["Gateway", gatewayLabel(e)],
      ["Gateway URL", e.gatewayBaseUrl ? h("code.cell-mono", e.gatewayBaseUrl) : "—"],
      ["Key", e.apiKeyName ? h("span", h("code.cell-mono", e.apiKeyName), " ", h("span.muted", e.apiKeyMasked || "")) : "—"],
      ["Proxy token", e.proxyTokenName || "—"],
      ["Endpoint", h("code.cell-mono", e.endpoint || `${e.method} ${e.path}`)]])),
    card({ title: "Tokens & cost" }, h("div.grid.cols-4",
      mini("Total", e.totalTokens != null ? int(tokensOf(e)) : "—"),
      mini("Input", e.inputTokens != null ? int(e.inputTokens) : "—"),
      mini("Output", e.outputTokens != null ? int(e.outputTokens) : "—"),
      mini("Cached", e.cachedInputTokens != null ? int(e.cachedInputTokens) : "—")),
      h("div.divider"),
      h("div.grid.cols-3",
        mini("Est. cost", est != null ? "≈ " + money(est) : "—"),
        mini("Real cost", e.realCost != null ? money(e.realCost, e.currency) : "—"),
        mini("Latency", ms(e.latencyMs)))));
  openModal({ title: "Request detail", drawer: true, body, footer: [h("button.btn", { onClick: closeOverlay }, "Close")] });
}

function kvList(pairs) { return h("dl.kv", pairs.flatMap(([k, v]) => [h("dt", k), h("dd", v ?? "—")])); }
const mini = (l, v) => h("div", h("div.muted", { style: { fontSize: "10px", textTransform: "uppercase" } }, l), h("div", { style: { fontSize: "var(--fz-md)", fontWeight: 600, fontVariantNumeric: "tabular-nums" } }, v));
