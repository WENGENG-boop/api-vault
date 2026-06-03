// features/estimates.js — projected spend from the embedded pricing table (estimates only).
import { h, icon } from "../dom.js";
import { ui, setUi } from "../store.js";
import { compact, int, money, pct, tokensOf } from "../format.js";
import { inRange } from "../analytics.js";
import { estimateEventCost, catalogIndex, PRICING_TABLE, PRICING_SOURCE } from "../pricing.js";
import { card, stat, badge, segmented, searchBox, table, shareBars, palette, empty, copyBtn } from "../ui.js";

const copyName = (m) => copyBtn(m, "Copy");

const RANGES = [{ value: "all", label: "All" }, { value: "30d", label: "30d" }, { value: "7d", label: "7d" }, { value: "24h", label: "24h" }, { value: "today", label: "Today" }];

export function renderEstimates(s) {
  const st = ui("est", { view: "provider", range: "all", q: "", refQ: "", showRef: false, period: "month" });
  const idx = catalogIndex(s.modelCatalog);
  const events = inRange(s.usageEvents, st.range);

  const perModel = {}, perProvider = {};
  let total = 0, priced = 0, unpriced = 0, totalTokens = 0;
  const unmatched = new Map();
  for (const e of events) {
    const name = e.model || e.modelId || "?";
    const est = estimateEventCost(e, idx.get(e.model) || idx.get(e.modelId));
    if (!est) { unpriced++; if (name !== "?") unmatched.set(name, (unmatched.get(name) || 0) + 1); continue; }
    priced++; total += est.cost; totalTokens += tokensOf(e);
    const pm = perModel[name] || (perModel[name] = { model: name, providerName: e.providerName, calls: 0, inTok: 0, outTok: 0, est: 0, matched: est.matched, vendor: est.pricing.vendor });
    pm.calls++; pm.inTok += e.inputTokens || 0; pm.outTok += e.outputTokens || 0; pm.est += est.cost;
    const pp = perProvider[e.providerId] || (perProvider[e.providerId] = { id: e.providerId, name: e.providerName, calls: 0, tokens: 0, est: 0 });
    pp.calls++; pp.tokens += tokensOf(e); pp.est += est.cost;
  }
  const models = Object.values(perModel).sort((a, b) => b.est - a.est);
  const providers = Object.values(perProvider).sort((a, b) => b.est - a.est);

  return h("div.stack",
    h("div.page-head",
      h("div.titles", h("h1", "Cost Estimates"),
        h("div.sub", h("span", "Projected spend from the built-in pricing table. "), badge("estimate only · not billed", "warn", {}))),
      h("div.actions",
        segmented(RANGES, st.range, (v) => setUi("est", { range: v })),
        segmented([{ value: "provider", label: "By provider" }, { value: "model", label: "By model" }], st.view, (v) => setUi("est", { view: v })))),

    h("div.grid.cols-4",
      stat("Est. total spend", money(total), `${PRICING_SOURCE}`),
      stat("Priced calls", int(priced), `${compact(totalTokens)} tokens`, { sm: true }),
      stat("Models priced", int(models.length), null, { sm: true }),
      stat("Unpriced calls", int(unpriced), unpriced ? "no table match" : "all matched", { sm: true })),

    periodCard(s, idx, st),

    st.view === "provider" ? providerBlock(providers, total) : modelBlock(models, total, st),

    unpriced ? card({ title: "Unpriced models", actions: badge(unmatched.size + " models", "warn") },
      h("div.stack.tight",
        h("p.muted", { style: { fontSize: "var(--fz-sm)" } }, "These exact model names have no match in the pricing table, so their calls are excluded from the estimate. Copy a name below to add it as a manual alias in src/pricing.js (PRICING_ALIASES)."),
        h("div.table-wrap", h("table.tbl",
          h("thead", h("tr", h("th", "Unmatched model name"), h("th.num", "Calls"), h("th", ""))),
          h("tbody", [...unmatched.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30).map(([m, n]) => h("tr",
            h("td", h("code", m)),
            h("td.num", int(n)),
            h("td", copyName(m))))))))) : null,

    referenceCard(st),
  );
}

function providerBlock(providers, total) {
  if (!providers.length) return empty("No priced usage yet", "Estimates appear once requests match the pricing table.");
  const items = providers.map((p, i) => ({ name: p.name, value: p.est, color: palette(i) }));
  return h("div.grid.cols-2",
    card({ title: "Spend share by provider" }, providers.length ? shareBars(items) : h("p.muted", "—")),
    card({ title: "Provider breakdown", flush: true },
      table([{ label: "Provider" }, { label: "Calls", num: true }, { label: "Tokens", num: true }, { label: "Est. cost", num: true }, { label: "Share", num: true }],
        providers, (p) => h("tr",
          h("td", h("strong", p.name)),
          h("td.num", int(p.calls)),
          h("td.num", compact(p.tokens)),
          h("td.num", h("strong", money(p.est))),
          h("td.num", pct(total ? (p.est / total) * 100 : 0, 1))), { emptyText: "No data" })));
}

function modelBlock(models, total, st) {
  const q = st.q.toLowerCase();
  const rows = models.filter((m) => !q || m.model.toLowerCase().includes(q) || (m.vendor || "").toLowerCase().includes(q));
  const max = Math.max(1, ...models.map((m) => m.est));
  return card({ title: h("span", "Estimated spend by model"), actions: searchBox(st.q, "Filter models…", (v) => setUi("est", { q: v }), "est-q"), flush: true },
    table(
      [{ label: "Model" }, { label: "Vendor" }, { label: "Calls", num: true }, { label: "Input", num: true }, { label: "Output", num: true }, { label: "Est. cost", num: true }, { label: "", width: "140px" }],
      rows, (m) => h("tr",
        h("td", h("code", m.model)),
        h("td", h("span.muted", { style: { fontSize: "var(--fz-sm)" } }, m.vendor || "—")),
        h("td.num", int(m.calls)),
        h("td.num", compact(m.inTok)),
        h("td.num", compact(m.outTok)),
        h("td.num", h("strong", money(m.est))),
        h("td", h("div.share-bar", { style: { height: "6px" } }, h("i", { style: { width: ((m.est / max) * 100).toFixed(1) + "%", background: "var(--accent)" } })))),
      { emptyText: "No priced models" }));
}

const pad2 = (n) => String(n).padStart(2, "0");

// Bucket keys mirror the backend (store.ts) so live events and archived rollups
// land in the same week / month buckets (UTC).
function monthBucketStart(value) {
  const d = new Date(value);
  if (!Number.isFinite(d.getTime())) return "?";
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-01`;
}

function weekBucketStart(value) {
  const d = new Date(value);
  if (!Number.isFinite(d.getTime())) return "?";
  const day = d.getUTCDay() || 7;
  const start = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  start.setUTCDate(start.getUTCDate() - day + 1);
  return start.toISOString().slice(0, 10);
}

// Cumulative requests / tokens / estimated cost per ISO week or calendar month.
// Combines the live event log with archived rollups (overflow beyond the retained
// window) so the totals persist after the request log is trimmed. Events and
// rollups are disjoint, so there is no double counting.
function periodTotals(s, idx, period) {
  const map = new Map();
  const add = (key, calls, tokens, cost) => {
    if (key === "?") return;
    let r = map.get(key);
    if (!r) { r = { key, calls: 0, tokens: 0, est: 0 }; map.set(key, r); }
    r.calls += calls; r.tokens += tokens; r.est += cost;
  };
  const bucket = period === "week" ? weekBucketStart : monthBucketStart;
  for (const e of s.usageEvents || []) {
    const est = estimateEventCost(e, idx.get(e.model) || idx.get(e.modelId));
    add(bucket(e.startedAt), 1, tokensOf(e), est ? est.cost : 0);
  }
  for (const r of s.usageRollups || []) {
    if (r.period !== period) continue;
    const est = estimateEventCost(r, idx.get(r.model));
    const tok = r.totalTokens != null ? r.totalTokens : (r.inputTokens || 0) + (r.outputTokens || 0);
    add(r.bucketStart, r.calls || 0, tok, est ? est.cost : 0);
  }
  return [...map.values()].sort((a, b) => b.key.localeCompare(a.key));
}

function periodCard(s, idx, st) {
  const period = st.period === "week" ? "week" : "month";
  const rows = periodTotals(s, idx, period);
  const totals = rows.reduce((a, r) => ({ calls: a.calls + r.calls, tokens: a.tokens + r.tokens, est: a.est + r.est }), { calls: 0, tokens: 0, est: 0 });
  return card({
    title: h("span", "Usage by period"),
    actions: segmented([{ value: "month", label: "Monthly" }, { value: "week", label: "Weekly" }], period, (v) => setUi("est", { period: v }))
  },
    h("div.stack.tight",
      h("p.muted", { style: { fontSize: "var(--fz-sm)", margin: "0" } },
        `Cumulative requests, tokens and estimated cost per ${period === "week" ? "ISO week" : "month"}. Includes archived rollups, so totals persist after the request log is trimmed. Cost is estimated from the pricing table.`),
      table(
        [{ label: period === "week" ? "Week of" : "Month" }, { label: "Requests", num: true }, { label: "Tokens", num: true }, { label: "Est. cost", num: true }],
        rows,
        (r) => h("tr",
          h("td", h("strong", period === "week" ? r.key : r.key.slice(0, 7))),
          h("td.num", int(r.calls)),
          h("td.num", compact(r.tokens)),
          h("td.num", h("strong", "≈ " + money(r.est)))),
        { emptyText: "No usage recorded yet" }),
      rows.length > 1 ? h("div.row", { style: { justifyContent: "flex-end", gap: "16px", padding: "6px 8px 0", fontSize: "var(--fz-sm)" } },
        h("span.muted", `${int(totals.calls)} requests`),
        h("span.muted", `${compact(totals.tokens)} tokens`),
        h("strong", `≈ ${money(totals.est)}`)) : null));
}

function referenceCard(st) {
  const q = st.refQ.toLowerCase();
  const rows = q ? PRICING_TABLE.filter((r) => r.model.toLowerCase().includes(q) || r.vendor.toLowerCase().includes(q)) : PRICING_TABLE;
  return h("details", { attrs: st.showRef ? { open: "" } : {}, style: { border: "1px solid var(--border)", borderRadius: "var(--r3)", background: "var(--surface)", overflow: "hidden" } },
    h("summary", { style: { cursor: "pointer", padding: "var(--s4) var(--s5)", display: "flex", alignItems: "center", gap: "8px", fontWeight: 600, fontSize: "var(--fz-md)" }, onClick: () => setTimeout(() => setUi("est", { showRef: true }), 0) },
      icon("billing", 15, { class: "muted" }), `Pricing reference (${PRICING_TABLE.length} models)`,
      h("span.muted", { style: { fontWeight: 400, fontSize: "var(--fz-sm)", marginLeft: "8px" } }, "$ per 1M tokens")),
    h("div", { style: { borderTop: "1px solid var(--border)", padding: "var(--s4) var(--s5)" } },
      h("div", { style: { marginBottom: "var(--s3)", maxWidth: "300px" } }, searchBox(st.refQ, "Search pricing…", (v) => setUi("est", { refQ: v, showRef: true }), "ref-q")),
      h("div.table-wrap", { style: { maxHeight: "420px", overflowY: "auto" } },
        table([{ label: "Model" }, { label: "Vendor" }, { label: "Input", num: true }, { label: "Output", num: true }, { label: "Cached", num: true }],
          rows, (r) => h("tr",
            h("td", h("code", r.model)),
            h("td", h("span.muted", { style: { fontSize: "var(--fz-sm)" } }, r.vendor)),
            h("td.num", r.input != null ? "$" + r.input : "—"),
            h("td.num", r.output != null ? "$" + r.output : "—"),
            h("td.num", r.cached != null ? "$" + r.cached : "—")), { emptyText: "No match" }))));
}
