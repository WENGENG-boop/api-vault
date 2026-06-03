// features/models.js — model catalog with switchable grouping (family / provider / model).
import { h, icon } from "../dom.js";
import { ui, setUi, applyState } from "../store.js";
import { api } from "../api.js";
import { compact, int, money, pct, relTime } from "../format.js";
import { modelStats } from "../analytics.js";
import { card, stat, badge, capTag, field, chips, segmented, searchBox, empty, openModal, closeOverlay, confirmDialog, toast, withBusy } from "../ui.js";

const CAPS = [
  { value: "text", label: "Text" }, { value: "vision", label: "Vision" }, { value: "tool", label: "Tools" },
  { value: "long-context", label: "Long Context" }, { value: "reasoning", label: "Reasoning" },
];
const capLabel = (c) => CAPS.find((x) => x.value === c)?.label || c;

const GROUP_MODES = [{ value: "family", label: "By family" }, { value: "provider", label: "By provider" }, { value: "model", label: "By model" }];

// Brand / family detection from model id + display name.
const FAMILIES = [
  { key: "gpt",      label: "OpenAI · GPT",      color: "#10a37f", re: /(^|[^a-z])(gpt|chatgpt|o1|o3|o4|davinci|babbage|text-embedding|dall-e|whisper|tts)/i },
  { key: "claude",   label: "Anthropic · Claude", color: "#d97757", re: /claude/i },
  { key: "gemini",   label: "Google · Gemini",    color: "#4285f4", re: /(gemini|palm|bison|gecko|gemma)/i },
  { key: "deepseek", label: "DeepSeek",           color: "#4d6bfe", re: /deepseek/i },
  { key: "llama",    label: "Meta · Llama",       color: "#0866ff", re: /llama/i },
  { key: "mistral",  label: "Mistral",            color: "#fa5210", re: /(mistral|mixtral|codestral|ministral)/i },
  { key: "qwen",     label: "Alibaba · Qwen",     color: "#7b2ff7", re: /qwen/i },
  { key: "grok",     label: "xAI · Grok",         color: "#52525b", re: /grok/i },
  { key: "command",  label: "Cohere · Command",   color: "#39594c", re: /(cohere|command-?r|command$)/i },
  { key: "glm",      label: "Zhipu · GLM",        color: "#1f6feb", re: /(glm|chatglm)/i },
  { key: "kimi",     label: "Moonshot · Kimi",    color: "#16a34a", re: /(kimi|moonshot)/i },
  { key: "yi",       label: "01.AI · Yi",         color: "#db2777", re: /(^|[^a-z])yi[-_]/i },
  { key: "phi",      label: "Microsoft · Phi",    color: "#0078d4", re: /(^|[^a-z])phi[-_0-9]/i },
];
const OTHER_FAMILY = { key: "other", label: "Other models", color: "#9b9ea6", re: null };

function modelFamily(m) {
  const hay = `${m.modelId || ""} ${m.displayName || ""} ${(m.aliases || []).join(" ")}`;
  return FAMILIES.find((f) => f.re.test(hay)) || OTHER_FAMILY;
}
const canonical = (m) => m.canonicalModelId || m.displayName || m.modelId;

export function renderModels(s) {
  const st = ui("mdl", { q: "", provider: "", cap: "", group: "family", expanded: null });
  const q = st.q.toLowerCase();
  const filtered = s.modelCatalog.filter((m) =>
    (!q || m.modelId.toLowerCase().includes(q) || (m.displayName || "").toLowerCase().includes(q) || (m.aliases || []).some((a) => a.toLowerCase().includes(q))) &&
    (!st.provider || m.providerId === st.provider) &&
    (!st.cap || (m.capabilities || []).includes(st.cap)));

  const groups = buildGroups(filtered, st.group);
  const stats = modelStats(s.usageEvents);

  return h("div.stack",
    h("div.page-head",
      h("div.titles", h("h1", "Models"), h("div.sub", "Catalog of available models, grouped by family, provider or model")),
      h("div.actions",
        searchBox(st.q, "Search models / aliases…", (v) => setUi("mdl", { q: v }), "mdl-q"),
        syncBtn(s),
        h("button.btn.primary", { onClick: () => openModelForm(s) }, icon("plus", 14), "Add model"))),

    h("div.grid.cols-4",
      stat("Total models", int(s.modelCatalog.length)),
      stat("Families", int(new Set(s.modelCatalog.map((m) => modelFamily(m).key)).size)),
      stat("Providers", int(new Set(s.modelCatalog.map((m) => m.providerId)).size)),
      stat("Manual entries", int(s.modelCatalog.filter((m) => m.source === "manual").length))),

    h("div.spread.wrap", { style: { gap: "12px" } },
      h("div.row", { style: { gap: "10px" } }, h("span.muted", { style: { fontSize: "var(--fz-sm)" } }, "Group"), segmented(GROUP_MODES, st.group, (v) => setUi("mdl", { group: v, expanded: null }))),
      h("div.row.wrap", { style: { gap: "8px" } },
        chips([{ value: "", label: "All providers" }, ...s.providers.map((p) => ({ value: p.id, label: p.name }))], st.provider, (v) => setUi("mdl", { provider: v })),
        chips([{ value: "", label: "Any capability" }, ...CAPS], st.cap, (v) => setUi("mdl", { cap: v })))),

    groups.length ? h("div", groups.map((g) => groupRow(s, g, stats, st))) : empty("No models match", "Adjust filters or sync a provider's catalog."));
}

function buildGroups(models, mode) {
  const map = {};
  for (const m of models) {
    let key, label, color = null, sub = null;
    if (mode === "provider") { key = m.providerId; label = m.providerName; }
    else if (mode === "model") { key = canonical(m); label = key; }
    else { const f = modelFamily(m); key = f.key; label = f.label; color = f.color; }
    const g = map[key] || (map[key] = { key, label, color, variants: [] });
    g.variants.push(m);
  }
  const groups = Object.values(map);
  for (const g of groups) {
    g.providers = new Set(g.variants.map((v) => v.providerId)).size;
    g.caps = new Set(g.variants.flatMap((v) => v.capabilities || []));
  }
  // keep "Other" family last; otherwise sort by size then name
  return groups.sort((a, b) => (a.key === "other") - (b.key === "other") || b.variants.length - a.variants.length || a.label.localeCompare(b.label));
}

function groupRow(s, g, stats, st) {
  const id = st.group + ":" + g.key;
  const open = st.expanded === id;
  const agg = g.variants.reduce((acc, v) => { const ms = stats.find((x) => x.model === v.modelId); if (ms) { acc.calls += ms.calls; acc.ok += ms.ok; } return acc; }, { calls: 0, ok: 0 });

  const marker = g.color
    ? h("span", { style: { width: "10px", height: "10px", borderRadius: "3px", background: g.color, flex: "none", boxShadow: "0 0 0 3px " + g.color + "1f" } })
    : icon(st.group === "provider" ? "providers" : "models", 15, { class: "muted" });

  const head = h("div.lrow-head", { onClick: () => setUi("mdl", { expanded: open ? null : id }) },
    icon("chevron", 14, { class: "chev" }),
    h("div.lrow-title", marker, g.label,
      st.group === "family" && g.providers > 0 && badge(g.providers + (g.providers > 1 ? " providers" : " provider"), null, {}),
      h("div.row", { style: { gap: "4px" } }, [...g.caps].slice(0, 4).map((c) => capTag(capLabel(c))))),
    h("div.lrow-metrics",
      metric("Models", g.variants.length),
      metric("Calls", int(agg.calls)),
      metric("Success", agg.calls ? pct((agg.ok / agg.calls) * 100, 0) : "—")));

  return h("div.lrow" + (open ? ".open" : ""), head, open && h("div.lrow-body", h("div.stack.tight", g.variants.map((v) => variantCard(s, v, stats)))));
}

const metric = (label, value) => h("div.lrow-metric", h("span.m-label", label), h("span.m-value", value));

function variantCard(s, v, stats) {
  const ms = stats.find((x) => x.model === v.modelId);
  return h("div", { style: { padding: "12px 14px", border: "1px solid var(--border)", borderRadius: "var(--r2)", background: "var(--surface)" } },
    h("div.spread",
      h("div.row", { style: { gap: "8px", minWidth: 0 } }, badge(v.providerName, "accent"), h("code", v.modelId), badge(v.source, v.source === "manual" ? "info" : null, {})),
      h("div.row", { style: { gap: "4px" } },
        h("button.btn.xs", { onClick: () => openModelForm(s, v) }, icon("edit", 12)),
        h("button.btn.xs.danger", { onClick: () => confirmDialog(`Delete model "${v.modelId}"?`, async () => { applyState(await api.deleteModel(v.id)); toast("Model deleted", "ok"); }, { danger: true }) }, icon("trash", 12)))),
    h("dl.kv.mt3", { style: { gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))" } },
      kvi("Context", v.contextWindow ? compact(v.contextWindow) : "—"),
      kvi("Input $/M", v.inputPrice != null ? money(v.inputPrice) : "—"),
      kvi("Output $/M", v.outputPrice != null ? money(v.outputPrice) : "—"),
      kvi("Calls", ms ? int(ms.calls) : "0"),
      kvi("Last seen", relTime(v.lastSeenAt))),
    (v.aliases || []).length ? h("div.row.mt2", { style: { gap: "6px" } }, h("span.muted", { style: { fontSize: "var(--fz-xs)" } }, "Aliases:"), h("div.tag-list", v.aliases.map((a) => capTag(a)))) : null);
}

const kvi = (k, v) => h("div", h("div.muted", { style: { fontSize: "10px", textTransform: "uppercase", letterSpacing: ".04em" } }, k), h("div", { style: { fontWeight: 600, fontVariantNumeric: "tabular-nums" } }, v));

function syncBtn(s) { return h("button.btn", { onClick: () => openSync(s) }, icon("refresh", 14), "Sync"); }
function openSync(s) {
  const body = h("div.stack.tight", s.providers.length ? s.providers.map((p) => {
    const b = h("button.btn.sm", { style: { width: "100%", justifyContent: "space-between" }, onClick: () => withBusy(b, async () => { const r = await api.syncProviderModels(p.id); if (r.state) applyState(r.state); toast(`${p.name}: synced ${r.result?.syncedCount ?? 0} models`, "ok"); }) }, h("span", { style: { display: "flex", gap: "8px", alignItems: "center" } }, icon("providers", 13), p.name), icon("refresh", 13));
    return b;
  }) : [h("p.muted", "No providers to sync.")]);
  openModal({ title: "Sync models by provider", body, footer: [h("button.btn", { onClick: closeOverlay }, "Close")] });
}

function openModelForm(s, edit) {
  const m = edit ? { ...edit, aliases: [...(edit.aliases || [])], capabilities: [...(edit.capabilities || [])] } : { providerId: s.providers[0]?.id || "", modelId: "", displayName: "", aliases: [], inputPrice: "", outputPrice: "", contextWindow: "", capabilities: ["text"] };
  const inp = (k, opts = {}) => h("input", { type: opts.type || "text", value: m[k] ?? "", placeholder: opts.ph || "", class: opts.mono ? "input-mono" : "", oninput: (e) => (m[k] = opts.type === "number" ? (e.target.value === "" ? "" : +e.target.value) : e.target.value) });
  const capsBox = h("div");
  const renderCaps = () => capsBox.replaceChildren(chips(CAPS, m.capabilities, (v) => { const set = new Set(m.capabilities); set.has(v) ? set.delete(v) : set.add(v); m.capabilities = [...set]; renderCaps(); }, true));
  renderCaps();
  const body = h("div.stack",
    h("div.grid.cols-2",
      field("Provider", h("select", { onchange: (e) => (m.providerId = e.target.value) }, s.providers.map((p) => h("option", { value: p.id, selected: p.id === m.providerId }, p.name)))),
      field("Model ID", inp("modelId", { ph: "gpt-4o", mono: true }))),
    field("Display name", inp("displayName", { ph: "GPT-4o" })),
    field("Aliases (comma-separated)", h("input", { type: "text", value: (m.aliases || []).join(", "), oninput: (e) => (m.aliases = e.target.value.split(",").map((x) => x.trim()).filter(Boolean)) })),
    h("div.grid.cols-3",
      field("Input $/M", inp("inputPrice", { type: "number", ph: "2.5" })),
      field("Output $/M", inp("outputPrice", { type: "number", ph: "10" })),
      field("Context window", inp("contextWindow", { type: "number", ph: "128000" }))),
    field("Capabilities", capsBox));
  const btn = h("button.btn.primary", { onClick: async () => { if (!m.modelId.trim()) { toast("Model ID required", "err"); return; } try { applyState(await withBusy(btn, () => api.saveModel(m))); closeOverlay(); toast(edit ? "Model updated" : "Model added", "ok"); } catch {} } }, edit ? "Save" : "Add model");
  openModal({ title: edit ? "Edit model" : "Add model", wide: true, body, footer: [h("button.btn", { onClick: closeOverlay }, "Cancel"), btn] });
}
