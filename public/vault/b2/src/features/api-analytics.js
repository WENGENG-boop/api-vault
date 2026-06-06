// features/api-analytics.js — Gateway/proxy API-traffic analytics, sharing the
// Vibe-style layout of Local Tools but sourced ONLY from requests routed through
// the proxy (s.usageEvents) — never merged with local-tool logs. Layout (top→
// bottom): a filter strip (Date / Provider / Model / Proxy token), four summary
// stat cards (Est. cost / Input+Output tokens / Cached tokens / Requests), a
// daily-or-hourly bar-trend chart with Token / Cost / Requests modes and a
// floating hover tooltip, and three donut distributions (Provider / Model /
// Proxy token) each with a per-card Token / Cost toggle.
//
// Cost is estimated from the model catalog pricing table. Styling reuses the
// `.lt-vibe` / `.vu-*` scope from components.css so it follows the console theme.
import { h, icon } from "../dom.js";
import { ui, setUi } from "../store.js";
import { rangeStart } from "../analytics.js";
import { estimateEventCost, catalogIndex } from "../pricing.js";

const RANGES = [
  { value: "today", label: "Today" },
  { value: "24h", label: "24H" },
  { value: "7d", label: "7D" },
  { value: "30d", label: "30D" },
  { value: "all", label: "All" },
  { value: "custom", label: "Custom" },
];
const CHART_MODES = [
  { value: "token", label: "Token" },
  { value: "cost", label: "Cost" },
  { value: "requests", label: "Requests" },
];
const DONUT_MODES = [
  { value: "token", label: "Token" },
  { value: "cost", label: "Cost" },
];
const SLICE_COLORS = ["#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#ed4d99"];
const OTHER_COLOR = "#7c7c85";

// Model families (mirrors Local Tools / ModelFamilies.swift); "Other" group last.
const MODEL_FAMILIES = [
  { key: "claude", label: "Claude", match: (s) => s.startsWith("claude") },
  { key: "gpt", label: "GPT", match: (s) => s.startsWith("gpt") || s.startsWith("codex") },
  { key: "o", label: "o-series", match: (s) => /^o\d/.test(s) },
  { key: "gemini", label: "Gemini", match: (s) => s.startsWith("gemini") },
  { key: "deepseek", label: "DeepSeek", match: (s) => s.startsWith("deepseek") },
  { key: "qwen", label: "Qwen", match: (s) => s.startsWith("qwen") },
  { key: "glm", label: "GLM", match: (s) => s.startsWith("glm") },
  { key: "kimi", label: "Kimi", match: (s) => s.startsWith("kimi") || s.startsWith("moonshot") },
  { key: "minimax", label: "MiniMax", match: (s) => s.startsWith("minimax") },
  { key: "doubao", label: "Doubao", match: (s) => s.startsWith("doubao") },
];

const HOUR = 3600e3;
const DAY = 86400e3;
const uniq = (arr) => [...new Set(arr)].sort();
const disp = (v) => (v == null || v === "" || v === "unknown" ? "Unknown" : v);
const isHourly = (range, st) => {
  if (range === "today" || range === "24h") return true;
  if (range !== "custom") return false;
  const bounds = rangeBounds(st);
  return Number.isFinite(bounds.start) && Number.isFinite(bounds.end) && bounds.end - bounds.start <= 48 * HOUR;
};
const tokenKey = (e) => e.proxyTokenId || e.proxyTokenName || "__direct";
const tokenName = (e) => e.proxyTokenName || "Direct";

// --- formatters (parity with Local Tools / Formatters.swift) ---
function vNum(n) {
  n = Math.round(n || 0);
  if (n >= 1e6) return (n / 1e6).toFixed(1) + "M";
  if (n >= 1e4) return (n / 1e3).toFixed(1) + "K";
  return new Intl.NumberFormat("en-US").format(n);
}
function vCost(c) {
  c = c || 0;
  if (c === 0) return "$0.00";
  if (c < 0.01) return "$" + c.toFixed(4);
  return "$" + c.toFixed(2);
}
function vCenterTok(total) {
  const t = Math.round(total || 0);
  if (t >= 1e9) return (t / 1e9).toFixed(1) + "B";
  if (t >= 1e6) return (t / 1e6).toFixed(1) + "M";
  if (t >= 1e3) return (t / 1e3).toFixed(1) + "K";
  return String(t);
}
function pctText(value, total) {
  if (!total) return "0%";
  const p = (value / total) * 100;
  if (p < 0.1) return "<0.1%";
  return p.toFixed(1) + "%";
}

export function renderApiAnalytics(s) {
  const st = ui("apa", {
    range: "7d", chart: "token",
    dProvider: "token", dModel: "token", dToken: "token",
    fProviders: [], fModels: [], fTokens: [], expanded: [], customStart: "", customEnd: "",
  });
  const idx = catalogIndex(s.modelCatalog);
  const costOf = (e) => estimateEventCost(e, idx.get(e.model) || idx.get(e.modelId))?.cost ?? 0;

  const head = h("div.page-head",
    h("div.titles",
      h("h1", "API Analytics"),
      h("div.sub", "Token usage and spend for traffic routed through the gateway/proxy — API calls only, kept separate from Local Tools. Costs are estimated from the pricing table.")));

  const all = s.usageEvents || [];
  if (!all.length) {
    return h("div.stack.lt-vibe", head, emptyBox(
      "No gateway traffic yet",
      "No requests have been routed through your proxy. Send a call through your proxy URL and these analytics fill in."));
  }

  // Facets come from the full dataset so toggles stay stable as the range narrows.
  const providers = dedupe(all, (e) => e.providerId, (e) => e.providerName || e.providerId);
  const models = uniq(all.map((e) => e.model).filter(Boolean));
  const tokens = dedupe(all, tokenKey, tokenName);

  const fe = filterEvents(all, st);
  const metrics = summarize(fe, costOf);
  const series = chartSeries(fe, st, costOf);

  return h("div.stack.lt-vibe",
    head,
    filtersSection(st, providers, models, tokens),
    summaryCards(metrics),
    barChartCard(series, st),
    distributions(fe, st, costOf));
}

/* --------------------------- filtering --------------------------- */
function filterEvents(events, st) {
  const { start, end } = rangeBounds(st);
  return events.filter((e) => {
    const t = new Date(e.startedAt).getTime();
    if (!Number.isFinite(t)) return false;
    if (start && t < start) return false;
    if (Number.isFinite(end) && t > end) return false;
    if (st.fProviders.length && !st.fProviders.includes(e.providerId)) return false;
    if (st.fModels.length && !st.fModels.includes(e.model)) return false;
    if (st.fTokens.length && !st.fTokens.includes(tokenKey(e))) return false;
    return true;
  });
}

function summarize(events, costOf) {
  let cost = 0, input = 0, output = 0, cached = 0;
  for (const e of events) {
    cost += costOf(e);
    input += e.inputTokens || 0;
    output += e.outputTokens || 0;
    cached += e.cachedInputTokens || 0;
  }
  return { cost, inout: input + output, cached, count: events.length };
}

/* --------------------------- filters UI --------------------------- */
function toggleFilter(key, value) {
  const cur = ui("apa")[key] || [];
  setUi("apa", { [key]: cur.includes(value) ? cur.filter((v) => v !== value) : [...cur, value] });
}

function filtersSection(st, providers, models, tokens) {
  const rows = [
    facetRow(icon("clock", 12), "Date",
      [
        ...RANGES.map((r) => pill(r.label, st.range === r.value, () => setUi("apa", { range: r.value }))),
        st.range === "custom" ? customRangeControls("apa", st) : null,
      ]),
  ];
  if (providers.length) {
    rows.push(facetRow(icon("providers", 12), "Provider",
      providers.map((p) => pill(disp(p.name), st.fProviders.includes(p.key), () => toggleFilter("fProviders", p.key)))));
  }
  if (models.length) rows.push(modelRow(st, models));
  if (tokens.length) {
    rows.push(facetRow(icon("tokens", 12), "Proxy token",
      tokens.map((t) => pill(disp(t.name), st.fTokens.includes(t.key), () => toggleFilter("fTokens", t.key)))));
  }
  if (st.fProviders.length || st.fModels.length || st.fTokens.length) {
    rows.push(h("button.vu-clear", { onClick: () => setUi("apa", { fProviders: [], fModels: [], fTokens: [] }) }, "Clear filters"));
  }
  return h("div.vu-card.vu-filters", rows);
}

const pill = (label, active, onClick, cls = "") =>
  h("button.vu-pill" + (active ? ".active" : "") + cls, { onClick }, label);

const facetRow = (iconNode, label, tags) =>
  h("div.vu-frow",
    h("div.vu-flabel", iconNode, h("span", label)),
    h("div.vu-ftags", tags));

function groupModels(models) {
  const map = new Map(MODEL_FAMILIES.map((f) => [f.key, []]));
  const others = [];
  for (const model of models) {
    const lower = String(model).toLowerCase();
    const base = lower.includes("/") ? lower.slice(lower.indexOf("/") + 1) : lower;
    const fam = MODEL_FAMILIES.find((f) => f.match(base));
    if (fam) map.get(fam.key).push(model); else others.push(model);
  }
  const groups = [];
  for (const f of MODEL_FAMILIES) { const m = map.get(f.key); if (m.length) groups.push({ family: f, models: m }); }
  if (others.length) groups.push({ family: null, models: others });
  return groups;
}

function modelRow(st, models) {
  const sel = new Set(st.fModels);
  const expanded = new Set(st.expanded);
  const tags = [];
  for (const g of groupModels(models)) {
    const key = g.family?.key ?? "other";
    const label = g.family?.label ?? "Other";
    const famModels = g.models;
    const inFam = famModels.filter((m) => sel.has(m)).length;
    const allSel = inFam === famModels.length && famModels.length > 0;
    const some = inFam > 0 && !allSel;
    const isOpen = expanded.has(key);

    tags.push(pill(label, allSel, () => {
      const cur = new Set(ui("apa").fModels);
      if (allSel) famModels.forEach((m) => cur.delete(m)); else famModels.forEach((m) => cur.add(m));
      setUi("apa", { fModels: [...cur] });
    }, some ? ".some" : ""));

    tags.push(h("button.vu-chev" + (isOpen ? ".open" : ""),
      { title: isOpen ? "Collapse" : "Expand", onClick: () => {
        const cur = new Set(ui("apa").expanded);
        if (isOpen) cur.delete(key); else cur.add(key);
        setUi("apa", { expanded: [...cur] });
      } }, icon("chevron", 9)));

    if (isOpen) for (const m of famModels) tags.push(pill(disp(m), sel.has(m), () => toggleFilter("fModels", m)));
  }
  return facetRow(icon("cpu", 12), "Model", tags);
}

/* --------------------------- summary cards --------------------------- */
function summaryCards(m) {
  const stat = (label, value, cls) =>
    h("div.vu-stat", h("span.vu-stat-label", label), h("span.vu-stat-value" + (cls ? "." + cls : ""), value));
  return h("div.vu-summary",
    stat("Est. cost", vCost(m.cost), "ok"),
    stat("Input + Output tokens", vNum(m.inout)),
    stat("Cached tokens", vNum(m.cached)),
    stat("Requests", vNum(m.count), "info"));
}

/* --------------------------- bar trend --------------------------- */
function slotKey(ts, hourly) {
  const d = new Date(ts);
  if (hourly) d.setMinutes(0, 0, 0); else d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function parseCustomDateTime(value) {
  const t = value ? new Date(value).getTime() : NaN;
  return Number.isFinite(t) ? t : null;
}

function rangeBounds(st) {
  if (st.range !== "custom") return { start: rangeStart(st.range), end: Infinity };
  return {
    start: parseCustomDateTime(st.customStart) ?? 0,
    end: parseCustomDateTime(st.customEnd) ?? Infinity,
  };
}

function customRangeControls(ns, st) {
  return h("div.vu-custom-range",
    h("input", {
      type: "datetime-local",
      value: st.customStart || "",
      dataset: { focusKey: `${ns}-custom-start` },
      oninput: (e) => setUi(ns, { customStart: e.target.value, range: "custom" }),
      attrs: { "aria-label": "Custom start date and time" },
    }),
    h("span", "to"),
    h("input", {
      type: "datetime-local",
      value: st.customEnd || "",
      dataset: { focusKey: `${ns}-custom-end` },
      oninput: (e) => setUi(ns, { customEnd: e.target.value, range: "custom" }),
      attrs: { "aria-label": "Custom end date and time" },
    }));
}

function buildSlots(st) {
  const pad = (n) => String(n).padStart(2, "0");
  if (isHourly(st.range, st)) {
    const cur = new Date(); cur.setMinutes(0, 0, 0);
    const bounds = rangeBounds(st);
    let start;
    let end = Number.isFinite(bounds.end) ? bounds.end : cur.getTime();
    if (st.range === "today") { const s = new Date(); s.setHours(0, 0, 0, 0); start = s.getTime(); }
    else if (st.range === "custom") start = bounds.start || end - 23 * HOUR;
    else start = cur.getTime() - 23 * HOUR;
    end = Math.min(end, cur.getTime());
    const slots = [];
    for (let t = start; t <= end; t += HOUR) {
      slots.push({ key: t, label: pad(new Date(t).getHours()) + ":00", input: 0, output: 0, cost: 0, count: 0 });
    }
    return slots;
  }
  if (st.range === "custom") {
    const bounds = rangeBounds(st);
    const end = new Date(Number.isFinite(bounds.end) ? bounds.end : Date.now());
    end.setHours(0, 0, 0, 0);
    const start = new Date(bounds.start || end.getTime() - 29 * DAY);
    start.setHours(0, 0, 0, 0);
    const n = Math.min(90, Math.max(1, Math.floor((end.getTime() - start.getTime()) / DAY) + 1));
    return Array.from({ length: n }, (_, i) => {
      const dt = new Date(end.getTime() - (n - 1 - i) * DAY);
      return { key: dt.getTime(), label: `${dt.getMonth() + 1}/${dt.getDate()}`, input: 0, output: 0, cost: 0, count: 0 };
    });
  }
  const n = st.range === "7d" ? 7 : 30;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const slots = [];
  for (let i = n - 1; i >= 0; i--) {
    const dt = new Date(today.getTime() - i * DAY);
    slots.push({ key: dt.getTime(), label: `${dt.getMonth() + 1}/${dt.getDate()}`, input: 0, output: 0, cost: 0, count: 0 });
  }
  return slots;
}

function chartSeries(events, st, costOf) {
  const hourly = isHourly(st.range, st);
  const slots = buildSlots(st);
  const idx = new Map(slots.map((s) => [s.key, s]));
  for (const e of events) {
    const s = idx.get(slotKey(e.startedAt, hourly));
    if (!s) continue;
    s.input += e.inputTokens || 0; s.output += e.outputTokens || 0; s.cost += costOf(e); s.count += 1;
  }
  return slots;
}

function labelInterval(count, hourly) {
  if (hourly) return count <= 12 ? 2 : 4;
  if (count <= 3) return 1;
  if (count <= 7) return 2;
  if (count <= 15) return 3;
  return 7;
}

function barTooltip(s, mode) {
  const lines = [h("div.vu-tip-title", s.label)];
  if (mode === "cost") {
    lines.push(h("div.vu-tip-cost", "Cost: " + vCost(s.cost)));
  } else if (mode === "requests") {
    lines.push(h("div.vu-tip-active", "Requests: " + vNum(s.count)));
  } else {
    lines.push(h("div.vu-tip-total", "Total tokens: " + vNum(s.input + s.output)));
    lines.push(h("div.vu-tip-row", h("span", "Input: " + vNum(s.input)), h("span", "Output: " + vNum(s.output))));
    lines.push(h("div.vu-tip-cost", "Cost: " + vCost(s.cost)));
  }
  return h("div.vu-bar-tip", lines);
}

function barChartCard(series, st) {
  const mode = st.chart;
  const hourly = isHourly(st.range, st);
  const valOf = mode === "cost" ? (s) => s.cost : mode === "requests" ? (s) => s.count : (s) => s.input + s.output;
  const max = Math.max(mode === "cost" ? 0.001 : mode === "requests" ? 1 : 1, ...series.map(valOf));
  const yTop = mode === "cost" ? vCost(max) : vNum(max);
  const hpct = (v) => (v > 0 ? Math.max(1.2, (v / max) * 100) : 0);

  const cols = series.map((s) => {
    let segs;
    if (mode === "cost") segs = [h("i.vu-bar-seg.cost", { style: { height: hpct(s.cost) + "%" } })];
    else if (mode === "requests") segs = [h("i.vu-bar-seg.active", { style: { height: hpct(s.count) + "%" } })];
    else segs = [
      h("i.vu-bar-seg.output", { style: { height: hpct(s.output) + "%" } }),
      h("i.vu-bar-seg.input", { style: { height: hpct(s.input) + "%" } }),
    ];
    return h("div.vu-bar-col" + (valOf(s) <= 0 ? ".empty" : ""), segs, barTooltip(s, mode));
  });

  const interval = labelInterval(series.length, hourly);
  const xaxis = series.map((s, i) => h("span", i % interval === 0 ? s.label : ""));

  return h("div.vu-card.vu-chart",
    h("div.vu-card-head",
      h("span.vu-card-title", hourly ? "Hourly trend" : "Daily trend"),
      modeToggle(CHART_MODES, mode, (v) => setUi("apa", { chart: v }))),
    h("div.vu-chart-body",
      h("div.vu-yaxis", h("span", yTop), h("span", "0")),
      h("div.vu-plot",
        h("div.vu-bars", cols),
        h("div.vu-xaxis", xaxis))));
}

/* --------------------------- distributions --------------------------- */
function aggregate(events, keyOf, nameOf, costOf) {
  const map = new Map();
  for (const e of events) {
    const k = keyOf(e) || "unknown";
    let c = map.get(k);
    if (!c) { c = { name: disp(nameOf(e)), token: 0, cost: 0 }; map.set(k, c); }
    c.token += (e.inputTokens || 0) + (e.outputTokens || 0);
    c.cost += costOf(e);
  }
  return [...map.values()];
}

function distributions(events, st, costOf) {
  return h("div.vu-dist",
    donutCard(icon("providers", 12), "Provider distribution", aggregate(events, (e) => e.providerId, (e) => e.providerName || e.providerId, costOf), st.dProvider, (v) => setUi("apa", { dProvider: v })),
    donutCard(icon("cpu", 12), "Model distribution", aggregate(events, (e) => e.model, (e) => e.model, costOf), st.dModel, (v) => setUi("apa", { dModel: v })),
    donutCard(icon("tokens", 12), "Proxy-token distribution", aggregate(events, tokenKey, tokenName, costOf), st.dToken, (v) => setUi("apa", { dToken: v })));
}

function donutCard(iconNode, title, rows, mode, onMode) {
  const valOf = mode === "cost" ? (r) => r.cost : (r) => r.token;
  const sorted = rows.filter((r) => valOf(r) > 0).sort((a, b) => valOf(b) - valOf(a));
  const slices = sorted.slice(0, 6).map((r, i) => ({ name: r.name, value: valOf(r), color: SLICE_COLORS[i % SLICE_COLORS.length] }));
  const rest = sorted.slice(6);
  if (rest.length) {
    const ov = rest.reduce((a, r) => a + valOf(r), 0);
    if (ov > 0) slices.push({ name: "Other", value: ov, color: OTHER_COLOR });
  }
  const total = slices.reduce((a, s) => a + s.value, 0);
  const fmt = mode === "cost" ? vCost : vNum;

  const body = (!slices.length || total <= 0)
    ? h("div.vu-dist-empty", "No data")
    : h("div.vu-dist-body",
        donutSvg(slices, total, mode === "cost" ? "Est." : "Tokens", mode === "cost" ? vCost(total) : vCenterTok(total)),
        h("div.vu-legend", slices.map((s) => h("div.vu-leg-row",
          h("span.vu-dot", { style: { background: s.color } }),
          h("span.vu-leg-name", s.name),
          h("span.vu-leg-val", fmt(s.value)),
          h("span.vu-leg-pct", pctText(s.value, total))))));

  return h("div.vu-card.vu-dist-card",
    h("div.vu-card-head",
      h("span.vu-card-title", iconNode, title),
      modeToggle(DONUT_MODES, mode, onMode)),
    body);
}

function donutSvg(slices, total, centerCap, centerVal) {
  const size = 90, lw = 11, r = size / 2 - lw / 2, c = 2 * Math.PI * r, cx = size / 2;
  const svg = h("svg.vu-donut", { attrs: { width: size, height: size, viewBox: `0 0 ${size} ${size}` } });
  svg.appendChild(h("circle", { attrs: { cx, cy: cx, r, fill: "none", stroke: "var(--track)", "stroke-width": lw } }));
  let off = 0;
  for (const s of slices) {
    const len = (s.value / total) * c;
    svg.appendChild(h("circle", { attrs: { cx, cy: cx, r, fill: "none", stroke: s.color, "stroke-width": lw, "stroke-dasharray": `${len} ${c - len}`, "stroke-dashoffset": -off, transform: `rotate(-90 ${cx} ${cx})`, "stroke-linecap": "butt" } }));
    off += len;
  }
  svg.appendChild(h("text", { class: "vu-donut-cap", attrs: { x: cx, y: cx - 7, "text-anchor": "middle", "dominant-baseline": "central" } }, centerCap));
  svg.appendChild(h("text", { class: "vu-donut-num", attrs: { x: cx, y: cx + 7, "text-anchor": "middle", "dominant-baseline": "central" } }, centerVal));
  return svg;
}

/* --------------------------- shared bits --------------------------- */
const modeToggle = (options, active, onChange) =>
  h("div.vu-seg", options.map((o) =>
    h("button.vu-seg-btn" + (o.value === active ? ".active" : ""), { onClick: () => onChange(o.value) }, o.label)));

const emptyBox = (title, sub) =>
  h("div.vu-card.vu-empty", h("div.vu-empty-icon", "∅"), h("h4", title), sub && h("p", sub));

// Distinct key→display pairs, sorted by display name. Used for provider / token facets.
function dedupe(events, keyOf, nameOf) {
  const map = new Map();
  for (const e of events) {
    const k = keyOf(e);
    if (k == null || k === "") continue;
    if (!map.has(k)) map.set(k, nameOf(e) || String(k));
  }
  return [...map.entries()].map(([key, name]) => ({ key, name })).sort((a, b) => String(a.name).localeCompare(String(b.name)));
}
