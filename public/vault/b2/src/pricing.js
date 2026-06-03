// pricing.js — estimate request cost from the embedded pricing table.
// Estimates only — projected from the pricing CSV, NOT billed amounts.
import { PRICING_TABLE, PRICING_SOURCE } from "./pricing-data.js";

export { PRICING_TABLE, PRICING_SOURCE };

const norm = (s) => (s || "").toLowerCase().replace(/[^a-z0-9]+/g, "");

// Manual overrides — map any non-standard / reseller model name to a table model id.
// Add lines here when a provider records a model under a custom name, e.g.:
//   "jmr-gpt5.5": "gpt-5.5",
//   "gpt-5.5-高速": "gpt-5.5",
export const PRICING_ALIASES = {
};

// exact normalized index
const byNorm = new Map();
for (const row of PRICING_TABLE) byNorm.set(norm(row.model), row);

// alias index (normalized custom name → table row)
const aliasByNorm = new Map();
for (const [k, v] of Object.entries(PRICING_ALIASES)) {
  const row = byNorm.get(norm(v));
  if (row) aliasByNorm.set(norm(k), row);
}

// Expand one candidate into namespace/prefix-stripped variants.
// "jmr/gpt-5.5" → {jmr/gpt-5.5, gpt-5.5, 5.5}; "jmr-gpt-5.5" → {jmr-gpt-5.5, gpt-5.5, 5.5}
function variantsOf(s) {
  const out = new Set();
  if (!s || !String(s).trim()) return out;
  s = String(s).trim();
  out.add(s);
  // strip provider namespace: take the part after the last separator
  const ns = s.split(/[/:|,→>]/).map((x) => x.trim()).filter(Boolean);
  const tail = ns.length ? ns[ns.length - 1] : s;
  out.add(tail);
  // progressively drop leading dash/underscore/space tokens (handles "jmr-gpt-5.5")
  const toks = tail.split(/[-_\s]+/).filter(Boolean);
  for (let i = 1; i < toks.length; i++) out.add(toks.slice(i).join("-"));
  return out;
}

/**
 * Resolve a pricing row for a model id, trying catalog aliases and namespace-stripped
 * variants. Robust to "provider/model", "provider-model" and dated/suffixed names.
 */
export function lookupPricing(model, catalogEntry) {
  if (!model && !catalogEntry) return null;
  const raw = [];
  if (model) raw.push(model);
  if (catalogEntry) {
    if (catalogEntry.modelId) raw.push(catalogEntry.modelId);
    if (catalogEntry.canonicalModelId) raw.push(catalogEntry.canonicalModelId);
    if (catalogEntry.displayName) raw.push(catalogEntry.displayName);
    for (const a of catalogEntry.aliases || []) raw.push(a);
  }

  // candidate set = raw + namespace/prefix-stripped variants
  const cands = new Set();
  for (const t of raw) for (const v of variantsOf(t)) cands.add(v);

  // 0) manual alias overrides win first
  for (const t of cands) { const hit = aliasByNorm.get(norm(t)); if (hit) return hit; }

  // 1) exact normalized match (longest candidate first → most specific wins)
  const sorted = [...cands].sort((a, b) => norm(b).length - norm(a).length);
  for (const t of sorted) { const hit = byNorm.get(norm(t)); if (hit) return hit; }

  // 2) loose: a table model that is a prefix/suffix/substring of the candidate (longest wins)
  let best = null, bestLen = 0;
  for (const t of cands) {
    const nt = norm(t); if (nt.length < 4) continue;
    for (const row of PRICING_TABLE) {
      const rn = norm(row.model);
      if (rn.length < 4 || rn.length <= bestLen) continue;
      if (nt === rn || nt.startsWith(rn) || rn.startsWith(nt) || nt.includes(rn)) { best = row; bestLen = rn.length; }
    }
  }
  return best;
}

/**
 * Estimate the cost of one usage event from token counts × table prices.
 * Cached input tokens are billed at the cheaper cached rate; the rest at input rate.
 * Returns { cost, pricing, matched } or null if no price found.
 */
export function estimateEventCost(ev, catalogEntry) {
  // real backends may record the name under `model` OR `modelId` (public alias vs upstream)
  const p = lookupPricing(ev.model, catalogEntry)
    || (ev.modelId && ev.modelId !== ev.model ? lookupPricing(ev.modelId, catalogEntry) : null);
  if (!p) return null;
  const inTok = ev.inputTokens || 0;
  const outTok = ev.outputTokens || 0;
  const cached = Math.min(ev.cachedInputTokens || 0, inTok);
  const fresh = Math.max(0, inTok - cached);
  const cachedRate = p.cached != null ? p.cached : p.input || 0;
  const cost = (fresh * (p.input || 0) + cached * cachedRate + outTok * (p.output || 0)) / 1e6;
  return { cost, pricing: p, matched: p.model };
}

/** Build a Map(modelId → catalog entry) for fast lookups in pages. */
export function catalogIndex(modelCatalog = []) {
  const map = new Map();
  for (const m of modelCatalog) {
    if (m.modelId) map.set(m.modelId, m);
    if (m.displayName) map.set(m.displayName, m);
    for (const a of m.aliases || []) map.set(a, m);
  }
  return map;
}
