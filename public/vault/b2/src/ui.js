// ui.js — shared presentational widgets + overlay/toast system.
import { h, icon, mount } from "./dom.js";
import { api } from "./api.js";

/* ----------------------------- primitives ----------------------------- */
export const card = (opts, ...body) => {
  const { title, actions, flush, pad } = opts || {};
  const head = title != null ? h("div.card-head", h("h3", title), actions && h("div.card-actions", actions)) : null;
  return h("div.card", head, body.length ? h("div.card-body" + (flush ? ".flush" : ""), ...body) : (pad ? h("div.card-body", ...body) : null));
};

export const stat = (label, value, meta, opts = {}) =>
  h("div.stat",
    h("span.label", label),
    h("span.value" + (opts.sm ? ".sm" : ""), value),
    meta != null && h("span.meta", meta),
    opts.bar != null && h("div.accent-bar", { style: { width: Math.max(4, Math.min(100, opts.bar)) + "%", background: opts.barColor || "" } }),
  );

export const badge = (text, kind, opts = {}) =>
  h("span.badge" + (kind ? "." + kind : ""), opts.dot && h("span.dot"), text);

export const dot = (kind) => h("span.status-dot." + (kind || "idle"));

export const capTag = (t) => h("span.cap-tag", t);

export function segmented(options, active, onChange) {
  return h("div.btn-group", options.map((o) =>
    h("button" + (o.value === active ? ".active" : ""), { onClick: () => onChange(o.value) }, o.label)));
}

export function chips(options, active, onChange, multi = false) {
  const set = multi ? new Set(active) : null;
  return h("div.chips", options.map((o) => {
    const on = multi ? set.has(o.value) : o.value === active;
    return h("span.chip" + (on ? ".active" : ""), { onClick: () => onChange(o.value) }, o.label);
  }));
}

export function searchBox(value, placeholder, onInput, focusKey) {
  return h("div.search", icon("search", 15),
    h("input", { type: "text", value: value || "", placeholder: placeholder || "Search…", oninput: (e) => onInput(e.target.value), dataset: focusKey ? { focusKey } : {} }));
}

export function field(label, control, hint) {
  return h("div.field", h("label", label), control, hint && h("span.hint", hint));
}

export function toggle(checked, onChange, label) {
  const sw = h("label.switch", h("input", { type: "checkbox", checked, onchange: (e) => onChange(e.target.checked) }), h("span.track"));
  return label ? h("div.checkbox-row", sw, h("span", label)) : sw;
}

export function copyBtn(text, label) {
  const btn = h("button.copy-btn", icon("copy", 12), label || "Copy");
  btn.addEventListener("click", async (e) => {
    e.stopPropagation();
    const ok = await api.copyText(text);
    mount(btn, icon(ok ? "check" : "x", 12), ok ? "Copied" : "Failed");
    toast(ok ? "Copied to clipboard" : "Copy failed", ok ? "ok" : "err");
    setTimeout(() => mount(btn, icon("copy", 12), label || "Copy"), 1400);
  });
  return btn;
}

export const empty = (title, sub, action) =>
  h("div.empty", h("div.em-icon", "∅"), h("h4", title), sub && h("p", sub), action && h("div.mt3", action));

export const kv = (pairs) =>
  h("dl.kv", pairs.filter(Boolean).flatMap(([k, v]) => [h("dt", k), h("dd", v ?? "—")]));

/* ----------------------------- tables ----------------------------- */
export function table(columns, rows, rowFn, opts = {}) {
  return h("div.table-wrap",
    h("table.tbl",
      h("thead", h("tr", columns.map((c) => h("th" + (c.num ? ".num" : ""), { style: c.width ? { width: c.width } : null }, c.label)))),
      h("tbody", rows.length
        ? rows.map((r, i) => rowFn(r, i))
        : h("tr", h("td", { attrs: { colspan: columns.length } }, h("div.empty", { style: { padding: "32px" } }, opts.emptyText || "No data"))))));
}

/* ----------------------------- charts (SVG/CSS) ----------------------------- */
const PALETTE = ["#6b8bff", "#9b6bff", "#45c463", "#e3a93a", "#f6685e", "#56b0f6", "#33c6c0", "#e06bb0"];
export const palette = (i) => PALETTE[i % PALETTE.length];

export function barChart(values, labels, opts = {}) {
  const max = Math.max(1, ...values);
  const bars = h("div.bars", values.map((v, i) =>
    h("div.bar" + (v === 0 ? ".dim" : ""), { style: { height: Math.max(2, (v / max) * 100) + "%", background: opts.color || "" },
      title: (labels?.[i] ? labels[i] + ": " : "") + Math.round(v) })));
  return h("div", bars, opts.axis && h("div.bar-axis", opts.axis.map((a) => h("span", a))));
}

export function sparkline(values, opts = {}) {
  const w = opts.w || 120, ht = opts.h || 28, pad = 2;
  if (!values.length) return h("svg.spark", { attrs: { width: w, height: ht } });
  const max = Math.max(...values), min = Math.min(...values), span = max - min || 1;
  const step = (w - pad * 2) / Math.max(1, values.length - 1);
  const pts = values.map((v, i) => `${(pad + i * step).toFixed(1)},${(ht - pad - ((v - min) / span) * (ht - pad * 2)).toFixed(1)}`).join(" ");
  const svg = h("svg.spark", { attrs: { width: w, height: ht, viewBox: `0 0 ${w} ${ht}`, preserveAspectRatio: "none" } });
  svg.appendChild(h("polyline", { attrs: { points: pts, fill: "none", stroke: opts.color || "var(--accent)", "stroke-width": 1.6, "stroke-linecap": "round", "stroke-linejoin": "round" } }));
  return svg;
}

export function shareBars(items) {
  // items: [{name, value, color?}]
  const total = items.reduce((a, b) => a + b.value, 0) || 1;
  return h("div.stack.tight", items.map((it, i) => {
    const p = (it.value / total) * 100;
    return h("div.share-row",
      h("span.sw", { style: { background: it.color || palette(i) } }),
      h("span.name.truncate", it.name),
      h("div.share-bar", h("i", { style: { width: p.toFixed(1) + "%", background: it.color || palette(i) } })),
      h("span.pct", p.toFixed(1) + "%"));
  }));
}

export function donut(items, opts = {}) {
  const size = opts.size || 120, r = size / 2 - 8, c = 2 * Math.PI * r, cx = size / 2;
  const total = items.reduce((a, b) => a + b.value, 0) || 1;
  let offset = 0;
  const svg = h("svg", { attrs: { width: size, height: size, viewBox: `0 0 ${size} ${size}` } });
  svg.appendChild(h("circle", { attrs: { cx, cy: cx, r, fill: "none", stroke: "var(--surface-3)", "stroke-width": 12 } }));
  items.forEach((it, i) => {
    const frac = it.value / total, len = frac * c;
    const circle = h("circle", { attrs: { cx, cy: cx, r, fill: "none", stroke: it.color || palette(i), "stroke-width": 12, "stroke-dasharray": `${len} ${c - len}`, "stroke-dashoffset": -offset, transform: `rotate(-90 ${cx} ${cx})`, "stroke-linecap": "butt" } });
    svg.appendChild(circle); offset += len;
  });
  if (opts.center) svg.appendChild(h("text", { attrs: { x: cx, y: cx + 5, "text-anchor": "middle", fill: "var(--text)", "font-size": 16, "font-weight": 700 } }, opts.center));
  return svg;
}

// KPI card: label (+ optional info hint) top-left, period-over-period delta top-right,
// large highlighted value below. delta = null | { pct } | { isNew }.
export function kpiCard({ label, value, info, delta }) {
  let badgeEl = null;
  if (delta) {
    if (delta.isNew) badgeEl = h("span.kpi-delta.up", "NEW");
    else if (delta.pct != null && Number.isFinite(delta.pct)) {
      const up = delta.pct >= 0;
      badgeEl = h("span.kpi-delta." + (up ? "up" : "down"), (up ? "▲ " : "▼ ") + Math.abs(delta.pct).toFixed(0) + "%");
    }
  }
  return h("div.kpi",
    h("div.kpi-head",
      h("span.kpi-label", label, info && h("span.kpi-info", { attrs: { title: info, tabindex: "0", "aria-label": info } }, icon("info", 12))),
      badgeEl),
    h("div.kpi-value", value));
}

// Vertical stacked bar chart. rows: [{ label, segs: [{ value, color }] }] (segs stack bottom→top).
export function stackedBars(rows, opts = {}) {
  const totals = rows.map((r) => r.segs.reduce((a, s) => a + s.value, 0));
  const max = Math.max(1, ...totals);
  const fmt = opts.fmt || ((v) => Math.round(v));
  const cols = h("div.sbars-cols", rows.map((r, i) => {
    const segs = r.segs.filter((s) => s.value > 0).map((s) =>
      h("div.sbar-seg", { style: { height: (s.value / max * 100) + "%", background: s.color } }));
    return h("div.sbar-col" + (totals[i] === 0 ? ".empty" : ""), { attrs: { title: `${r.label}: ${fmt(totals[i])}` } }, segs);
  }));
  return h("div.sbars",
    h("div.sbars-main",
      h("div.sbars-yaxis", [1, 0.5, 0].map((f) => h("span", fmt(max * f)))),
      h("div.sbars-right",
        h("div.sbars-plot", cols),
        opts.axis && h("div.sbars-xaxis", opts.axis.map((a) => h("span", a || ""))))));
}

const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
// Week (rows) x hour (cols) density heatmap with a less→more legend.
export function heatmap(matrix, opts = {}) {
  const fmt = opts.fmt || ((v) => Math.round(v));
  let max = 0; for (const row of matrix) for (const v of row) if (v > max) max = v;
  const level = (v) => (v <= 0 || max <= 0 ? 0 : Math.max(1, Math.ceil((v / max) * 4)));
  const grid = h("div.heat-grid",
    matrix.map((row, d) => h("div.heat-row",
      h("span.heat-dow", DOW[d]),
      row.map((v, hr) => h("div.heat-cell.lv" + level(v), { attrs: { title: `${DOW[d]} ${String(hr).padStart(2, "0")}:00 · ${fmt(v)}` } })))),
    h("div.heat-row.heat-haxis",
      h("span.heat-dow", ""),
      Array.from({ length: 24 }, (_, hr) => h("span.heat-htick", hr % 3 === 0 ? String(hr).padStart(2, "0") : ""))));
  const legend = h("div.heat-legend",
    h("span.muted", "less"),
    [0, 1, 2, 3, 4].map((l) => h("span.heat-cell.lv" + l)),
    h("span.muted", "more"));
  return h("div.heatmap", grid, legend);
}

// Donut + sorted category list (color dot · name · value · share%).
export function donutList(dist, opts = {}) {
  const { items, total } = dist;
  if (!items.length) return empty(opts.emptyTitle || "No data", opts.emptySub);
  const fmt = opts.fmt || ((v) => Math.round(v));
  const colored = items.map((it, i) => ({ ...it, color: it.other ? "#9aa0ad" : palette(i) }));
  return h("div.donut-list",
    h("div.donut-side", donut(colored.map((c) => ({ value: c.value, color: c.color })),
      { size: opts.size || 134, center: (opts.centerFmt || fmt)(total) })),
    h("div.donut-rows", colored.map((c) => {
      const pct = total ? (c.value / total) * 100 : 0;
      return h("div.dl-row",
        h("span.dl-dot", { style: { background: c.color } }),
        h("span.dl-name.truncate", c.name),
        h("span.dl-val", fmt(c.value)),
        h("span.dl-pct", pct.toFixed(1) + "%"));
    })));
}

export function uptimeBar(buckets) {
  // buckets: [{ok,total}] -> health bar
  return h("div.uptime", buckets.map((b) => {
    if (!b || b.total === 0) return h("i.none", { title: "no data" });
    const r = b.ok / b.total;
    const cls = r >= 0.99 ? "" : r >= 0.9 ? ".warn" : ".bad";
    return h("i" + cls, { title: `${(r * 100).toFixed(0)}% (${b.ok}/${b.total})` });
  }));
}

/* ----------------------------- overlays ----------------------------- */
let escHandler = null;
export function closeOverlay() {
  const root = document.getElementById("overlay-root");
  root.replaceChildren();
  if (escHandler) { document.removeEventListener("keydown", escHandler); escHandler = null; }
}

export function openModal({ title, body, footer, wide, drawer }) {
  const root = document.getElementById("overlay-root");
  const panel = h((drawer ? "div.drawer" : "div.modal") + (wide ? ".wide" : ""),
    h(drawer ? "div.drawer-head" : "div.modal-head", h("h2", title), h("button.x-btn", { onClick: closeOverlay }, icon("x", 16))),
    h(drawer ? "div.drawer-body" : "div.modal-body", body),
    footer && h(drawer ? "div.drawer-foot" : "div.modal-foot", footer));
  const overlay = h("div.overlay", { onClick: (e) => { if (e.target === overlay) closeOverlay(); } }, panel);
  escHandler = (e) => { if (e.key === "Escape") closeOverlay(); };
  document.addEventListener("keydown", escHandler);
  root.replaceChildren(overlay);
  return panel;
}

export function confirmDialog(message, onConfirm, opts = {}) {
  openModal({
    title: opts.title || "Confirm",
    body: h("p", { style: { color: "var(--text-dim)" } }, message),
    footer: [
      h("button.btn", { onClick: closeOverlay }, "Cancel"),
      h("button.btn." + (opts.danger ? "danger" : "primary"), { onClick: async () => { closeOverlay(); await onConfirm(); } }, opts.confirmLabel || "Confirm"),
    ],
  });
}

/* ----------------------------- toasts ----------------------------- */
export function toast(message, kind = "info", ms = 2600) {
  const root = document.getElementById("toast-root");
  const ic = kind === "ok" ? "check" : kind === "err" ? "alert" : "activity";
  const el = h("div.toast." + kind, h("span.t-icon", icon(ic, 15)), h("span.t-msg", message));
  root.appendChild(el);
  setTimeout(() => { el.style.transition = "opacity .25s, transform .25s"; el.style.opacity = "0"; el.style.transform = "translateX(12px)"; setTimeout(() => el.remove(), 250); }, ms);
}

/** Run an async action with button busy state + toast on error. */
export async function withBusy(btn, fn, okMsg) {
  if (btn) { btn.disabled = true; btn.dataset.label = btn.textContent; }
  try { const r = await fn(); if (okMsg) toast(okMsg, "ok"); return r; }
  catch (e) { toast(e.message || "Action failed", "err"); throw e; }
  finally { if (btn) btn.disabled = false; }
}
