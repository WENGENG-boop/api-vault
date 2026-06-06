// features/local-tools.js — Local AI-tool token usage, restyled to mirror the
// Vibe Usage macOS app as closely as the console's data allows. Layout (top→
// bottom): a filter strip (Date / Tools / Models / Projects), four summary stat
// cards (Est. cost / Input+Output tokens / Cached tokens / Active time), a
// daily-or-hourly bar-trend chart with Token / Cost / Active modes and a floating
// hover tooltip, and three donut distributions (Tools / Models / Projects) each
// with a per-card Token / Cost toggle.
//
// Data comes from API Vault's bundled local parsers (GET /api/local-usage); cost
// is estimated from the built-in pricing table. Number / cost / duration / percent
// formatting and the date-range, chart-mode and model-family-grouping logic are
// ported 1:1 from Vibe Usage (Formatters.swift, AppState.swift, ModelFamilies.swift)
// so values read identically. All visual styling is scoped under `.lt-vibe` (see
// styles/components.css) and uses the console theme variables so it follows
// light/dark without leaking into other pages.
//
// Differences from Vibe Usage are data-driven only: local usage is single-machine
// (buckets carry no hostname → no terminal filter / terminal-distribution donut)
// and there is no subscription-quota API (→ no rate-limit cards). Sessions carry
// no model, so the model filter applies to token buckets.
import { h, icon } from "../dom.js";
import { ui, setUi } from "../store.js";
import { api } from "../api.js";
import { rangeStart } from "../analytics.js";
import { estimateEventCost } from "../pricing.js";

// TimeRange (AppState.swift) — exactly 4 cases, default = oneDay/24H.
const RANGES = [
  { value: "today", label: "Today" },
  { value: "24h", label: "24H" },
  { value: "7d", label: "7D" },
  { value: "30d", label: "30D" },
  { value: "custom", label: "Custom" },
];
// ChartMode raw values (AppState.swift): Token / Cost / Active.
const CHART_MODES = [
  { value: "token", label: "Token" },
  { value: "cost", label: "Cost" },
  { value: "active", label: "Active" },
];
const DONUT_MODES = [
  { value: "token", label: "Token" },
  { value: "cost", label: "Cost" },
];
// Donut palette mirrors Vibe Usage's DistributionChartsView (theme-independent).
const SLICE_COLORS = ["#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#ed4d99"];
const OTHER_COLOR = "#7c7c85";

// Model families (ModelFamilies.swift), order-preserving; "Other" group last.
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
const costOf = (e) => estimateEventCost(e)?.cost ?? 0;
const uniq = (arr) => [...new Set(arr)].sort();
const disp = (v) => (v == null || v === "" || v === "unknown" ? "Unknown" : v);
const isHourly = (range, st) => {
  if (range === "today" || range === "24h") return true;
  if (range !== "custom") return false;
  const bounds = rangeBounds(st);
  return Number.isFinite(bounds.start) && Number.isFinite(bounds.end) && bounds.end - bounds.start <= 48 * HOUR;
};

// --- Vibe Usage formatters (Utils/Formatters.swift), replicated for parity ---
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
function vDur(seconds) {
  seconds = Math.floor(seconds || 0);
  if (seconds <= 0) return "0m";
  const d = Math.floor(seconds / 86400), h = Math.floor((seconds % 86400) / 3600), m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return h > 0 ? `${d}d ${h}h` : `${d}d`;
  if (h > 0) return m > 0 ? `${h}h ${m}m` : `${h}h`;
  return `${Math.max(m, 1)}m`;
}
// Donut center uses a B/M/K formatter distinct from vNum (DonutShape.centerLabel).
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

// Icons missing from dom.js (folder / eye / eye-off) drawn inline, feather-style.
function svgIcon(paths, size = 12) {
  const NS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("width", size); svg.setAttribute("height", size);
  svg.setAttribute("viewBox", "0 0 24 24"); svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor"); svg.setAttribute("stroke-width", "1.9");
  svg.setAttribute("stroke-linecap", "round"); svg.setAttribute("stroke-linejoin", "round");
  for (const d of paths) { const p = document.createElementNS(NS, "path"); p.setAttribute("d", d); svg.appendChild(p); }
  return svg;
}
const ICON_FOLDER = ["M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"];
const ICON_EYE = ["M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z", "M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0z"];
const ICON_EYE_OFF = ["M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24", "M1 1l22 22"];

// Module-level guard so the periodic re-renders don't spawn duplicate fetches.
let inflight = false;

export function renderLocalTools() {
  const st = ui("lt", {
    range: "24h", chart: "token",
    dTool: "token", dModel: "token", dProject: "token",
    showProjects: false, fTools: [], fModels: [], fProjects: [], expanded: [], customStart: "", customEnd: "",
  });
  const data = ui("lt-data", { buckets: null, sessions: [], tools: [], warnings: [], error: "" });

  // Fetch a wide window once; the range selector filters client-side (parsers
  // read full history regardless of the days arg, so 365 is no slower than 7).
  if (!inflight && data.buckets === null) {
    inflight = true;
    api.getLocalUsage(365)
      .then((r) => setUi("lt-data", { buckets: r.buckets || [], sessions: r.sessions || [], tools: r.tools || [], warnings: r.warnings || [], error: "" }))
      .catch((e) => setUi("lt-data", { buckets: [], sessions: [], tools: [], warnings: [], error: e.message || String(e) }))
      .finally(() => { inflight = false; });
  }

  const head = h("div.page-head",
    h("div.titles",
      h("h1", "Local Tools"),
      h("div.sub", "Token usage parsed from this machine's AI coding-tool logs — separate from proxy traffic, never merged. Costs are estimated from the built-in pricing table.")),
    h("div.actions",
      h("button.btn.sm", { title: "Re-read local tool logs", onClick: () => setUi("lt-data", { buckets: null, warnings: [], error: "" }) }, icon("refresh", 13), "Refresh")));

  if (data.error) return h("div.stack.lt-vibe", head, emptyBox("Couldn't load local usage", data.error));
  if (data.buckets === null) return h("div.stack.lt-vibe", head, h("div.boot", h("div.spinner")));

  if (!data.buckets.length && !data.sessions.length) {
    if (data.warnings?.length) return h("div.stack.lt-vibe", head, emptyBox("Couldn't parse local usage", warningSummary(data.warnings)));
    return h("div.stack.lt-vibe", head, emptyBox(
      "No local tool usage found",
      "No AI coding-tool logs were detected in your home directory (e.g. ~/.claude, ~/.codex). Use a supported tool. If you run inside Docker, host logs aren't readable unless your home directory is mounted."));
  }

  // Facet lists come from the full dataset (not range-filtered) so the available
  // toggles stay stable as the user narrows the date window.
  const tools = uniq(data.buckets.map((b) => b.tool));
  const models = uniq(data.buckets.map((b) => b.model));
  const projects = uniq(data.buckets.map((b) => b.project));

  const fb = filterBuckets(data.buckets, st);
  const fs = filterSessions(data.sessions, st);
  const metrics = summarize(fb, fs);
  const series = chartSeries(fb, fs, st);

  return h("div.stack.lt-vibe",
    head,
    data.warnings?.length ? warningNote(data.warnings) : null,
    filtersSection(st, tools, models, projects),
    summaryCards(metrics),
    barChartCard(series, st),
    distributions(fb, st));
}

/* --------------------------- filtering --------------------------- */
function filterBuckets(buckets, st) {
  const { start, end } = rangeBounds(st);
  return buckets.filter((b) => {
    const t = new Date(b.bucketStart).getTime();
    if (!Number.isFinite(t)) return false;
    if (start && t < start) return false;
    if (Number.isFinite(end) && t > end) return false;
    if (st.fTools.length && !st.fTools.includes(b.tool)) return false;
    if (st.fModels.length && !st.fModels.includes(b.model)) return false;
    if (st.fProjects.length && !st.fProjects.includes(b.project)) return false;
    return true;
  });
}

function filterSessions(sessions, st) {
  const { start, end } = rangeBounds(st);
  return sessions.filter((s) => {
    const t = new Date(s.firstMessageAt).getTime();
    if (!Number.isFinite(t)) return false;
    if (start && t < start) return false;
    if (Number.isFinite(end) && t > end) return false;
    if (st.fTools.length && !st.fTools.includes(s.tool)) return false;
    // sessions carry no model → the model filter only applies to token buckets.
    if (st.fProjects.length && !st.fProjects.includes(s.project)) return false;
    return true;
  });
}

// Cost / token totals from buckets (token-authoritative); active time from
// parsed sessions. Cached is shown separately, so "Input+Output tokens" = input+output.
function summarize(buckets, sessions) {
  let cost = 0, input = 0, output = 0, cached = 0, activeSec = 0;
  for (const b of buckets) {
    cost += costOf(b);
    input += b.inputTokens || 0;
    output += b.outputTokens || 0;
    cached += b.cachedInputTokens || 0;
  }
  for (const s of sessions) activeSec += s.activeSeconds || 0;
  return { cost, inout: input + output, cached, activeSec };
}

/* --------------------------- filters UI --------------------------- */
function toggleFilter(key, value) {
  const cur = ui("lt")[key] || [];
  setUi("lt", { [key]: cur.includes(value) ? cur.filter((v) => v !== value) : [...cur, value] });
}

function filtersSection(st, tools, models, projects) {
  const rows = [
    facetRow(icon("clock", 12), "Date",
      [
        ...RANGES.map((r) => pill(r.label, st.range === r.value, () => setUi("lt", { range: r.value }))),
        st.range === "custom" ? customRangeControls("lt", st) : null,
      ]),
  ];
  if (tools.length) {
    rows.push(facetRow(icon("terminal", 12), "Tools",
      tools.map((v) => pill(disp(v), st.fTools.includes(v), () => toggleFilter("fTools", v)))));
  }
  if (models.length) rows.push(modelRow(st, models));
  if (projects.length) rows.push(projectRow(st, projects));
  if (st.fTools.length || st.fModels.length || st.fProjects.length) {
    rows.push(h("button.vu-clear", { onClick: () => setUi("lt", { fTools: [], fModels: [], fProjects: [] }) }, "Clear filters"));
  }
  return h("div.vu-card.vu-filters", rows);
}

const pill = (label, active, onClick, cls = "") =>
  h("button.vu-pill" + (active ? ".active" : "") + cls, { onClick }, label);

const facetRow = (iconNode, label, tags) =>
  h("div.vu-frow",
    h("div.vu-flabel", iconNode, h("span", label)),
    h("div.vu-ftags", tags));

// Models grouped by family (ModelFamilies.swift) — a family pill toggles the whole
// family; a chevron expands the individual members.
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
    const all = inFam === famModels.length && famModels.length > 0;
    const some = inFam > 0 && !all;
    const isOpen = expanded.has(key);

    tags.push(pill(label, all, () => {
      const cur = new Set(ui("lt").fModels);
      if (all) famModels.forEach((m) => cur.delete(m)); else famModels.forEach((m) => cur.add(m));
      setUi("lt", { fModels: [...cur] });
    }, some ? ".some" : ""));

    tags.push(h("button.vu-chev" + (isOpen ? ".open" : ""),
      { title: isOpen ? "Collapse" : "Expand", onClick: () => {
        const cur = new Set(ui("lt").expanded);
        if (isOpen) cur.delete(key); else cur.add(key);
        setUi("lt", { expanded: [...cur] });
      } }, icon("chevron", 9)));

    if (isOpen) for (const m of famModels) tags.push(pill(disp(m), sel.has(m), () => toggleFilter("fModels", m)));
  }
  return facetRow(icon("cpu", 12), "Models", tags);
}

function projectRow(st, projects) {
  const tags = [
    h("button.vu-eye" + (st.showProjects ? ".on" : ""),
      { title: st.showProjects ? "Hide project names" : "Show project names", onClick: () => setUi("lt", { showProjects: !st.showProjects }) },
      svgIcon(st.showProjects ? ICON_EYE : ICON_EYE_OFF, 12)),
    h("button.vu-chev" + (st.showProjects ? ".open" : ""),
      { title: st.showProjects ? "Collapse" : "Expand", onClick: () => setUi("lt", { showProjects: !st.showProjects }) },
      icon("chevron", 9)),
  ];
  if (st.showProjects) for (const v of projects) tags.push(pill(disp(v), st.fProjects.includes(v), () => toggleFilter("fProjects", v)));
  return facetRow(svgIcon(ICON_FOLDER, 12), "Projects", tags);
}

/* --------------------------- summary cards --------------------------- */
function summaryCards(m) {
  const stat = (label, value, cls) =>
    h("div.vu-stat", h("span.vu-stat-label", label), h("span.vu-stat-value" + (cls ? "." + cls : ""), value));
  return h("div.vu-summary",
    stat("Est. cost", vCost(m.cost), "ok"),
    stat("Input + Output tokens", vNum(m.inout)),
    stat("Cached tokens", vNum(m.cached)),
    stat("Active time", vDur(m.activeSec), "info"));
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
      slots.push({ key: t, label: pad(new Date(t).getHours()) + ":00", input: 0, output: 0, cost: 0, activeMin: 0 });
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
      return { key: dt.getTime(), label: `${dt.getMonth() + 1}/${dt.getDate()}`, input: 0, output: 0, cost: 0, activeMin: 0 };
    });
  }
  const n = st.range === "7d" ? 7 : 30;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const slots = [];
  for (let i = n - 1; i >= 0; i--) {
    const dt = new Date(today.getTime() - i * DAY);
    slots.push({ key: dt.getTime(), label: `${dt.getMonth() + 1}/${dt.getDate()}`, input: 0, output: 0, cost: 0, activeMin: 0 });
  }
  return slots;
}

function chartSeries(buckets, sessions, st) {
  const hourly = isHourly(st.range, st);
  const slots = buildSlots(st);
  const idx = new Map(slots.map((s) => [s.key, s]));
  for (const b of buckets) {
    const s = idx.get(slotKey(b.bucketStart, hourly));
    if (!s) continue;
    s.input += b.inputTokens || 0; s.output += b.outputTokens || 0; s.cost += costOf(b);
  }
  for (const ss of sessions) {
    const s = idx.get(slotKey(ss.firstMessageAt, hourly));
    if (!s) continue;
    s.activeMin += (ss.activeSeconds || 0) / 60;
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
  } else if (mode === "active") {
    lines.push(h("div.vu-tip-active", "Active time: " + vDur(s.activeMin * 60)));
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
  const valOf = mode === "cost" ? (s) => s.cost : mode === "active" ? (s) => s.activeMin : (s) => s.input + s.output;
  const max = Math.max(mode === "cost" ? 0.001 : mode === "active" ? 0.1 : 1, ...series.map(valOf));
  const yTop = mode === "cost" ? vCost(max) : mode === "active" ? vDur(max * 60) : vNum(max);
  const hpct = (v) => (v > 0 ? Math.max(1.2, (v / max) * 100) : 0);

  const cols = series.map((s) => {
    let segs;
    if (mode === "cost") segs = [h("i.vu-bar-seg.cost", { style: { height: hpct(s.cost) + "%" } })];
    else if (mode === "active") segs = [h("i.vu-bar-seg.active", { style: { height: hpct(s.activeMin) + "%" } })];
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
      modeToggle(CHART_MODES, mode, (v) => setUi("lt", { chart: v }))),
    h("div.vu-chart-body",
      h("div.vu-yaxis", h("span", yTop), h("span", "0")),
      h("div.vu-plot",
        h("div.vu-bars", cols),
        h("div.vu-xaxis", xaxis))));
}

/* --------------------------- distributions --------------------------- */
function aggregate(buckets, keyOf) {
  const map = new Map();
  for (const b of buckets) {
    const k = keyOf(b) || "unknown";
    let c = map.get(k);
    if (!c) { c = { name: disp(k), token: 0, cost: 0 }; map.set(k, c); }
    c.token += (b.inputTokens || 0) + (b.outputTokens || 0);
    c.cost += costOf(b);
  }
  return [...map.values()];
}

function distributions(buckets, st) {
  return h("div.vu-dist",
    donutCard(icon("terminal", 12), "Tool distribution", aggregate(buckets, (b) => b.tool), st.dTool, (v) => setUi("lt", { dTool: v })),
    donutCard(icon("cpu", 12), "Model distribution", aggregate(buckets, (b) => b.model), st.dModel, (v) => setUi("lt", { dModel: v })),
    donutCard(svgIcon(ICON_FOLDER, 12), "Project distribution", aggregate(buckets, (b) => b.project), st.dProject, (v) => setUi("lt", { dProject: v })));
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

const warningNote = (warnings) =>
  h("div.vu-warn", icon("alert", 13), h("span", warningSummary(warnings)));

const warningSummary = (warnings) =>
  warnings.slice(0, 4).map((w) => `${w.tool}: ${w.message}`).join("; ") +
  (warnings.length > 4 ? `; +${warnings.length - 4} more parse warnings` : "");
