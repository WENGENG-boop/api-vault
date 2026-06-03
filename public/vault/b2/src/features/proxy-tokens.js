// features/proxy-tokens.js — proxy tokens, model mapping, limits, config export.
import { h, icon } from "../dom.js";
import { ui, setUi, applyState, store } from "../store.js";
import { api } from "../api.js";
import { relTime } from "../format.js";
import { card, badge, dot, field, toggle, copyBtn, chips, empty, openModal, closeOverlay, confirmDialog, toast, withBusy } from "../ui.js";

export function renderProxyTokens(s) {
  const st = ui("tok", { expanded: null });
  return h("div.stack",
    h("div.page-head",
      h("div.titles", h("h1", "Proxy Tokens"), h("div.sub", "Issue scoped tokens that map public model names to your upstream providers")),
      h("div.actions", h("button.btn.primary", { onClick: () => openTokenForm(s) }, icon("plus", 14), "New proxy token"))),
    usageCard(s),
    s.proxyTokens.length ? h("div", s.proxyTokens.map((t) => tokenRow(s, t, st)))
      : empty("No proxy tokens", "Create a token to expose your providers behind a single safe endpoint.", h("button.btn.primary", { onClick: () => openTokenForm(s) }, icon("plus", 14), "New proxy token")));
}

function usageCard(s) {
  const url = `http://127.0.0.1:${s.proxyPort || 3210}/proxy/v1/chat/completions`;
  const snippet = `curl ${url} \\\n  -H "Authorization: Bearer proxy_xxx" \\\n  -H "Content-Type: application/json" \\\n  -d '{"model":"gpt-4o","messages":[{"role":"user","content":"hi"}]}'`;
  return card({ title: "How to use", actions: copyBtn(snippet, "Copy curl") },
    h("div.codeblock", snippet));
}

function tokenRow(s, t, st) {
  const open = st.expanded === t.id;
  const ready = (t.allowedModels || []).filter((r) => r.providerId && r.upstreamModel).length;
  const missing = (t.allowedModels || []).length - ready;
  const head = h("div.lrow-head", { onClick: () => setUi("tok", { expanded: open ? null : t.id }) },
    icon("chevron", 14, { class: "chev" }),
    h("div.lrow-title", dot(t.enabled ? "ok" : "idle"), t.name, badge(t.enabled ? "enabled" : "disabled", t.enabled ? "ok" : null), h("code.cell-mono", t.tokenMasked)),
    h("div.lrow-metrics",
      metric("Rules", (t.allowedModels || []).length),
      missing ? h("span", badge(missing + " missing", "warn")) : metric("Ready", ready),
      metric("Streaming", t.allowStreaming ? "on" : "off"),
      metric("Rate", `${t.requestsPerMinute}/min`)));
  return h("div.lrow" + (open ? ".open" : ""), head, open && tokenBody(s, t));
}

const metric = (label, value) => h("div.lrow-metric", h("span.m-label", label), h("span.m-value", value));

function tokenBody(s, t) {
  return h("div.lrow-body",
    h("div.grid.cols-2",
      card({ title: "Limits & scope" }, h("dl.kv",
        h("dt", "Per minute"), h("dd", t.requestsPerMinute),
        h("dt", "Per day"), h("dd", t.requestsPerDay),
        h("dt", "Streaming"), h("dd", t.allowStreaming ? badge("allowed", "ok") : badge("blocked", null)),
        h("dt", "Expires"), h("dd", t.expiresAt ? relTime(t.expiresAt) : "never"),
        h("dt", "Providers"), h("dd", (t.allowedProviderIds || []).map((id) => s.providers.find((p) => p.id === id)?.name || id).join(", ") || "all"),
        h("dt", "Last used"), h("dd", relTime(t.lastUsedAt)))),
      card({ title: `Model mapping (${(t.allowedModels || []).length})` },
        (t.allowedModels || []).length ? h("div.stack.tight", t.allowedModels.map((r) => mappingRow(s, r))) : h("p.muted", { style: { fontSize: "var(--fz-sm)" } }, "No rules — edit to add model mappings."))),
    h("div.row.wrap.mt4", { style: { gap: "8px" } },
      h("button.btn.sm", { onClick: () => openTokenForm(s, t) }, icon("edit", 13), "Edit mapping"),
      h("button.btn.sm", { onClick: () => exportConfig(s, t) }, icon("copy", 13), "Export config"),
      revealBtn(t),
      h("button.btn.sm", { onClick: () => toggleEnabled(s, t) }, icon(t.enabled ? "stop" : "play", 13), t.enabled ? "Disable" : "Enable"),
      regenBtn(t),
      h("button.btn.sm.danger", { onClick: () => confirmDialog(`Delete token "${t.name}"?`, async () => { applyState(await api.deleteProxyToken(t.id)); toast("Token deleted", "ok"); }, { danger: true }) }, icon("trash", 13), "Delete")));
}

function mappingRow(s, r) {
  const prov = s.providers.find((p) => p.id === r.providerId);
  const okRule = prov && r.upstreamModel;
  return h("div.spread", { style: { padding: "6px 8px", border: "1px solid var(--border)", borderRadius: "var(--r1)", background: "var(--surface)" } },
    h("div.row", { style: { gap: "8px", minWidth: 0 } }, dot(okRule ? "ok" : "warn"), h("code", r.publicModel), icon("chevron", 12, { class: "muted" }), h("span.muted", { style: { fontSize: "var(--fz-sm)" } }, `${prov?.name || "?"} / ${r.upstreamModel || "—"}`)),
    okRule ? badge("ready", "ok") : badge("missing", "warn"));
}

function revealBtn(t) { const b = h("button.btn.sm", { onClick: () => withBusy(b, async () => { const { secret } = await api.revealProxyToken(t.id); await api.copyText(secret); toast("Token copied to clipboard", "ok"); }) }, icon("key", 13), "Reveal key"); return b; }
function regenBtn(t) { const b = h("button.btn.sm", { onClick: () => confirmDialog(`Regenerate "${t.name}"? The old token stops working.`, () => withBusy(b, async () => { const r = await api.regenerateProxyToken(t.id); if (r.state) applyState(r.state); showSecret(r.secret, "Token regenerated"); }), { confirmLabel: "Regenerate" }) }, icon("refresh", 13), "Regenerate"); return b; }

async function toggleEnabled(s, t) {
  try { applyState(await api.updateProxyToken(t.id, { ...t, enabled: !t.enabled })); toast(t.enabled ? "Token disabled" : "Token enabled", "ok"); } catch (e) { toast(e.message, "err"); }
}

function exportConfig(s, t) {
  const baseUrl = `http://127.0.0.1:${s.proxyPort || 3210}/proxy/v1`;
  const cfg = { baseURL: baseUrl, apiKey: "proxy_… (reveal to insert)", models: (t.allowedModels || []).map((r) => r.publicModel) };
  const json = JSON.stringify(cfg, null, 2);
  openModal({ title: `Config for "${t.name}"`, body: h("div.stack", h("p.muted", { style: { fontSize: "var(--fz-sm)" } }, "Paste into your OpenAI-compatible client. Reveal the token to fill in the key."), h("div.codeblock", json)), footer: [h("button.btn", { onClick: closeOverlay }, "Close"), copyBtn(json, "Copy JSON")] });
}

function showSecret(secret, title) {
  openModal({ title: title || "Token created", body: h("div.stack",
    h("div.action-item.warn", h("div.ai-icon", icon("alert", 16)), h("div.ai-text", h("div.ai-title", "Copy it now"), h("div.ai-desc", "This secret is shown only once and cannot be retrieved later."))),
    h("div.codeblock", { style: { userSelect: "all" } }, secret)),
    footer: [h("button.btn", { onClick: closeOverlay }, "Done"), copyBtn(secret, "Copy token")] });
}

/* --------------------------- editor --------------------------- */
function openTokenForm(s, edit) {
  const m = edit ? JSON.parse(JSON.stringify(edit)) : { name: "", enabled: true, allowedProviderIds: [], allowedModels: [], allowStreaming: true, requestsPerMinute: 60, requestsPerDay: 5000, expiresAt: "" };
  m.allowedModels = m.allowedModels || [];

  const rulesWrap = h("div.stack.tight");
  const renderRules = () => {
    rulesWrap.replaceChildren(...(m.allowedModels.length ? m.allowedModels.map((r, i) => ruleEditor(s, r, () => { m.allowedModels.splice(i, 1); renderRules(); })) : [h("p.muted", { style: { fontSize: "var(--fz-sm)" } }, "No rules yet.")]));
  };
  renderRules();

  const provChips = chips(s.providers.map((p) => ({ value: p.id, label: p.name })), m.allowedProviderIds, (id) => {
    const set = new Set(m.allowedProviderIds); set.has(id) ? set.delete(id) : set.add(id); m.allowedProviderIds = [...set];
    provBox.replaceChildren(provChips2());
  }, true);
  const provBox = h("div");
  const provChips2 = () => chips(s.providers.map((p) => ({ value: p.id, label: p.name })), m.allowedProviderIds, (id) => { const set = new Set(m.allowedProviderIds); set.has(id) ? set.delete(id) : set.add(id); m.allowedProviderIds = [...set]; provBox.replaceChildren(provChips2()); }, true);
  provBox.appendChild(provChips);

  const inp = (k, opts = {}) => h("input", { type: opts.type || "text", value: m[k] ?? "", placeholder: opts.ph || "", oninput: (e) => (m[k] = opts.type === "number" ? +e.target.value : e.target.value) });

  const body = h("div.stack",
    field("Token name", inp("name", { ph: "mobile-app" })),
    h("div.grid.cols-3",
      field("Requests / min", inp("requestsPerMinute", { type: "number" })),
      field("Requests / day", inp("requestsPerDay", { type: "number" })),
      field("Expires (ISO, optional)", inp("expiresAt", { ph: "2026-12-31" }))),
    h("label.checkbox-row", toggle(m.allowStreaming, (v) => (m.allowStreaming = v)), "Allow streaming responses"),
    h("div.section-title.mt4", "Allowed providers"), provBox,
    h("div.spread.mt4", h("div.section-title", { style: { margin: 0 } }, "Model mapping"),
      h("div.row", { style: { gap: "6px" } },
        h("button.btn.xs", { onClick: () => { importFromCatalog(s, m, renderRules); } }, icon("layers", 12), "Import from catalog"),
        h("button.btn.xs", { onClick: () => { m.allowedModels.push({ publicModel: "", providerId: s.providers[0]?.id || "", upstreamModel: "", apiKeyId: "" }); renderRules(); } }, icon("plus", 12), "Add rule"))),
    rulesWrap);

  const saveBtn = h("button.btn.primary", { onClick: () => save(saveBtn) }, edit ? "Save token" : "Create token");
  openModal({ title: edit ? "Edit proxy token" : "New proxy token", wide: true, body, footer: [h("button.btn", { onClick: closeOverlay }, "Cancel"), saveBtn] });

  async function save(btn) {
    if (!m.name.trim()) { toast("Token name is required", "err"); return; }
    try {
      if (edit) { applyState(await withBusy(btn, () => api.updateProxyToken(edit.id, m))); closeOverlay(); toast("Token saved", "ok"); }
      else { const r = await withBusy(btn, () => api.createProxyToken(m)); if (r.state) applyState(r.state); closeOverlay(); showSecret(r.secret); }
    } catch {}
  }
}

function ruleEditor(s, r, onRemove) {
  const prov = s.providers.find((p) => p.id === r.providerId);
  const keyOpts = prov ? prov.apiKeys : [];
  const sel = (value, opts, onChange, withEmpty) => h("select", { onchange: (e) => onChange(e.target.value) }, [withEmpty && h("option", { value: "" }, withEmpty), ...opts.map((o) => h("option", { value: o.value, selected: o.value === value }, o.label))]);
  return h("div.row", { style: { gap: "6px", alignItems: "center" } },
    h("input", { type: "text", value: r.publicModel, placeholder: "public name", style: { flex: "1" }, oninput: (e) => (r.publicModel = e.target.value) }),
    sel(r.providerId, s.providers.map((p) => ({ value: p.id, label: p.name })), (v) => (r.providerId = v)),
    h("input", { type: "text", value: r.upstreamModel, placeholder: "upstream model", style: { flex: "1" }, oninput: (e) => (r.upstreamModel = e.target.value) }),
    sel(r.apiKeyId || "", keyOpts.map((k) => ({ value: k.id, label: k.name })), (v) => (r.apiKeyId = v), "any key"),
    h("button.btn.xs.danger", { onClick: onRemove }, icon("x", 12)));
}

function importFromCatalog(s, m, rerender) {
  if (!s.modelCatalog.length) { toast("Model catalog is empty — sync models first", "err"); return; }
  const existing = new Set(m.allowedModels.map((r) => r.publicModel));
  let added = 0;
  for (const md of s.modelCatalog) {
    const name = md.displayName || md.modelId;
    if (existing.has(name)) continue;
    m.allowedModels.push({ publicModel: name, providerId: md.providerId, upstreamModel: md.modelId, apiKeyId: "" });
    existing.add(name); added++;
  }
  rerender(); toast(`Imported ${added} model rule(s)`, "ok");
}
