// features/account-pools.js — CPA / CLIProxyAPI account pools.
import { h, icon } from "../dom.js";
import { ui, setUi, applyState } from "../store.js";
import { api } from "../api.js";
import { int, ms, relTime } from "../format.js";
import { card, badge, dot, field, toggle, copyBtn, empty, openModal, closeOverlay, confirmDialog, toast, withBusy } from "../ui.js";

export function renderAccountPools(s) {
  const st = ui("pools", { expanded: null });
  return h("div.stack",
    h("div.page-head",
      h("div.titles", h("h1", "Account Pools"), h("div.sub", "Pooled accounts via CPA / CLIProxyAPI backends")),
      h("div.actions", h("button.btn.primary", { onClick: () => openPoolForm(s) }, icon("plus", 14), "Add account pool"))),
    s.accountPools.length
      ? h("div", s.accountPools.map((p) => poolRow(s, p, st)))
      : empty("No account pools", "Connect a CLIProxyAPI backend to pool multiple upstream accounts.", h("button.btn.primary", { onClick: () => openPoolForm(s) }, icon("plus", 14), "Add account pool")));
}

function poolRow(s, p, st) {
  const open = st.expanded === p.id;
  const stClass = p.status === "available" ? "ok" : p.status === "unknown" ? "idle" : "err";
  const linked = p.providerId && s.providers.find((x) => x.id === p.providerId);
  const head = h("div.lrow-head", { onClick: () => setUi("pools", { expanded: open ? null : p.id }) },
    icon("chevron", 14, { class: "chev" }),
    h("div.lrow-title", dot(stClass), p.name, badge(p.kind.toUpperCase(), null, {}), linked && badge("→ " + linked.name, "accent")),
    h("div.lrow-metrics",
      metric("Models", p.modelNames.length),
      metric("/v1/models", httpBadge(p.modelsStatus)),
      metric("Root", httpBadge(p.rootStatus)),
      p.latencyMs ? h("span", { style: { fontSize: "var(--fz-sm)", fontWeight: 600 } }, ms(p.latencyMs)) : null));
  return h("div.lrow" + (open ? ".open" : ""), head, open && poolBody(s, p));
}

const metric = (label, value) => h("div.lrow-metric", h("span.m-label", label), h("span.m-value", value));
const httpBadge = (status) => status == null ? h("span.muted", "—") : badge(String(status), status >= 200 && status < 300 ? "ok" : "err");

function poolBody(s, p) {
  return h("div.lrow-body",
    h("div.grid.cols-2",
      card({ title: "Connection" }, h("dl.kv",
        h("dt", "Base URL"), h("dd", h("div.row", { style: { gap: "6px" } }, h("code.truncate", { style: { maxWidth: "280px" } }, p.baseUrl), copyBtn(p.baseUrl))),
        h("dt", "Management"), h("dd", p.managementUrl ? h("code.truncate", { style: { maxWidth: "280px", display: "inline-block" } }, p.managementUrl) : "—"),
        h("dt", "Proxy API key"), h("dd", p.hasApiKey ? h("code.cell-mono", p.apiKeyMasked) : h("span.muted", "none")),
        h("dt", "Mgmt secret"), h("dd", p.hasManagementSecret ? h("code.cell-mono", p.managementSecretMasked) : h("span.muted", "none")),
        h("dt", "Auths dir"), h("dd", h("code.truncate", { style: { maxWidth: "280px", display: "inline-block" } }, p.authsDirectory || "—")),
        h("dt", "Last checked"), h("dd", relTime(p.lastCheckedAt)),
        p.lastError && [h("dt", "Error"), h("dd", { style: { color: "var(--err)" } }, p.lastError)],
        p.notes && [h("dt", "Notes"), h("dd", p.notes)])),
      card({ title: `Synced models (${p.modelNames.length})` },
        p.modelNames.length ? h("div.tag-list", p.modelNames.map((m) => h("span.cap-tag", m))) : h("p.muted", { style: { fontSize: "var(--fz-sm)" } }, "No models synced yet — run sync below."))),
    h("div.row.wrap.mt4", { style: { gap: "8px" } },
      actionBtn("activity", "Test connection", (b) => run(b, () => api.testAccountPool(p.id), "Connection tested")),
      actionBtn("refresh", "Sync models", (b) => run(b, () => api.syncAccountPoolModels(p.id), "Models synced")),
      actionBtn("upload", "Upload auth JSON", (b) => uploadAuth(p)),
      actionBtn("layers", "Import to token", (b) => importToToken(s, p)),
      !p.providerId && actionBtn("providers", "Create provider", (b) => run(b, () => api.createAccountPoolProvider(p.id).then((st) => ({ state: st })), "Provider created")),
      h("button.btn.sm", { onClick: () => openPoolForm(s, p) }, icon("edit", 13), "Edit"),
      h("button.btn.sm.danger", { onClick: () => confirmDialog(`Delete pool "${p.name}"?`, async () => { applyState(await api.deleteAccountPool(p.id)); toast("Pool deleted", "ok"); }, { danger: true }) }, icon("trash", 13), "Delete")));
}

const actionBtn = (ic, label, onClick) => { const b = h("button.btn.sm", { onClick: () => onClick(b) }, icon(ic, 13), label); return b; };

async function run(btn, fn, okMsg) {
  try {
    await withBusy(btn, async () => { const r = await fn(); if (r?.state) applyState(r.state); toast(okMsg, "ok"); });
  } catch {}
}

function uploadAuth(p) {
  const input = h("input", { type: "file", accept: ".json", style: { display: "none" } });
  input.addEventListener("change", async () => {
    const file = input.files?.[0]; if (!file) return;
    const content = await file.text();
    try { const { state } = await api.uploadAccountPoolAuth(p.id, { fileName: file.name, content }); if (state) applyState(state); toast(`Uploaded ${file.name}`, "ok"); }
    catch (e) { toast(e.message, "err"); }
  });
  document.body.appendChild(input); input.click(); setTimeout(() => input.remove(), 1000);
}

function importToToken(s, p) {
  if (!s.proxyTokens.length) { toast("Create a proxy token first", "err"); return; }
  if (!p.providerId) { toast("Create or bind a provider before importing models", "err"); return; }
  if (!p.modelNames.length) { toast("Sync account pool models before importing", "err"); return; }
  let tokenId = s.proxyTokens[0].id;
  const body = h("div.stack",
    h("p.muted", `Import ${p.modelNames.length} model(s) from "${p.name}" into a proxy token's mapping.`),
    field("Target proxy token", h("select", { onchange: (e) => (tokenId = e.target.value) }, s.proxyTokens.map((t) => h("option", { value: t.id, selected: t.id === tokenId }, t.name)))));
  const btn = h("button.btn.primary", { onClick: async () => {
    try {
      await withBusy(btn, async () => { const { state } = await api.importAccountPoolModelsToProxyToken(p.id, { proxyTokenId: tokenId, modelNames: p.modelNames }); if (state) applyState(state); });
      closeOverlay(); toast("Models imported to token", "ok");
    } catch {}
  } }, "Import models");
  openModal({ title: "Import models to token", body, footer: [h("button.btn", { onClick: closeOverlay }, "Cancel"), btn] });
}

function openPoolForm(s, edit) {
  const m = edit ? { ...edit } : { name: "", kind: "cpa", baseUrl: "", managementUrl: "", apiKey: "", managementSecret: "", authsDirectory: "", notes: "", createProvider: false };
  const inp = (k, opts = {}) => h("input", { type: opts.type || "text", value: m[k] ?? "", placeholder: opts.ph || "", class: opts.mono ? "input-mono" : "", oninput: (e) => (m[k] = e.target.value) });
  const body = h("div.stack",
    h("div.grid.cols-2",
      field("Backend type", h("select", { onchange: (e) => (m.kind = e.target.value) }, h("option", { value: "cpa", selected: true }, "CPA / CLIProxyAPI"))),
      field("Name", inp("name", { ph: "Gemini Pool" }))),
    field("Base URL", inp("baseUrl", { ph: "http://127.0.0.1:8317", mono: true })),
    h("div.grid.cols-2",
      field("Proxy API key", inp("apiKey", { type: "password", mono: true })),
      field("Management URL", inp("managementUrl", { mono: true }))),
    h("div.grid.cols-2",
      field("Management secret", inp("managementSecret", { type: "password", mono: true })),
      field("Auths directory", inp("authsDirectory", { mono: true, ph: "C:/cpa/auths" }))),
    field("Notes", inp("notes")),
    !edit && h("label.checkbox-row", toggle(m.createProvider, (v) => (m.createProvider = v)), "Also create a linked Provider"));
  const btn = h("button.btn.primary", { onClick: async () => { try { applyState(await withBusy(btn, () => api.saveAccountPool(m))); closeOverlay(); toast(edit ? "Pool updated" : "Pool added", "ok"); } catch {} } }, edit ? "Save changes" : "Add pool");
  openModal({ title: edit ? "Edit account pool" : "Add account pool", wide: true, body, footer: [h("button.btn", { onClick: closeOverlay }, "Cancel"), btn] });
}
