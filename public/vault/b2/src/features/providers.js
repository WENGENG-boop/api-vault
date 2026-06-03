// features/providers.js — providers, keys, balance-sync config, global proxy URLs.
import { h, icon } from "../dom.js";
import { store, ui, setUi, set, applyState } from "../store.js";
import { api, defaultBalance } from "../api.js";
import { compact, int, money, pct, ms, relTime, protoLabel, latencyClass } from "../format.js";
import { providerStats } from "../analytics.js";
import { card, badge, dot, field, toggle, searchBox, copyBtn, table, empty, openModal, closeOverlay, confirmDialog, toast, withBusy } from "../ui.js";

const PROTOCOLS = [
  { value: "openai-compatible", label: "OpenAI compatible" },
  { value: "anthropic-compatible", label: "Anthropic compatible" },
  { value: "openai-anthropic-compatible", label: "Auto (OpenAI + Anthropic)" },
];

function globalUrl(port, gw) {
  if (!port) return "—";
  if (gw === "auto") return `http://127.0.0.1:${port}/proxy/auto/v1`;
  return gw === "openai" ? `http://127.0.0.1:${port}/proxy/openai/v1` : `http://127.0.0.1:${port}/proxy/anthropic`;
}

export function renderProviders(s) {
  const st = ui("prov", { q: "", expanded: null });
  const q = st.q.toLowerCase();
  const list = s.providers.filter((p) => !q || p.name.toLowerCase().includes(q) || p.baseUrl.toLowerCase().includes(q));

  return h("div.stack",
    h("div.page-head",
      h("div.titles", h("h1", "Providers"), h("div.sub", "Upstream API providers, keys and balance-sync configuration")),
      h("div.actions", searchBox(st.q, "Search providers…", (v) => setUi("prov", { q: v }), "prov-q"),
        h("button.btn.primary", { onClick: () => openProviderForm(s) }, icon("plus", 14), "Add provider / key"))),
    globalProxyCard(s),
    list.length ? h("div", list.map((p) => providerRow(s, p, st))) : empty("No providers", "Add your first upstream provider to start routing.", h("button.btn.primary", { onClick: () => openProviderForm(s) }, icon("plus", 14), "Add provider")),
  );
}

function globalProxyCard(s) {
  const row = (label, gw) => {
    const url = globalUrl(s.proxyPort, gw);
    return h("div.spread", { style: { padding: "8px 0" } },
      h("div.row", { style: { gap: "8px" } }, badge(label, "accent"), h("code", { style: { fontSize: "var(--fz-sm)" } }, url)),
      copyBtn(url));
  };
  return card({ title: "Global proxy base URLs", actions: badge("port " + (s.proxyPort || "—"), null, {}) },
    h("div.stack.tight", row("OpenAI", "openai"), row("Anthropic", "anthropic"), row("Auto", "auto")));
}

function providerRow(s, p, st) {
  const open = st.expanded === p.id;
  const stats = providerStats(s.usageEvents, p.id);
  const stClass = p.status === "available" ? "ok" : p.status === "unknown" || p.status == null ? "idle" : "err";
  const head = h("div.lrow-head", { onClick: () => setUi("prov", { expanded: open ? null : p.id }) },
    icon("chevron", 14, { class: "chev" }),
    h("div.lrow-title", dot(stClass), p.name, p.isLocal && badge("local", null, {}), badge(protoLabel(p.protocol), null, {})),
    h("div.lrow-metrics",
      metric("Keys", p.apiKeys.length),
      metric("Calls", int(stats.calls)),
      metric("Tokens", compact(stats.tokens)),
      metric("Cost", money(stats.cost)),
      p.latencyMs ? h("span", { class: latencyClass(p.latencyMs), style: { fontSize: "var(--fz-sm)", fontWeight: 600 } }, ms(p.latencyMs)) : null));
  return h("div.lrow" + (open ? ".open" : ""), head, open && providerBody(s, p, stats));
}

const metric = (label, value) => h("div.lrow-metric", h("span.m-label", label), h("span.m-value", value));

function providerBody(s, p, stats) {
  return h("div.lrow-body",
    h("div.grid.cols-2",
      card({ title: "Endpoints" }, h("dl.kv",
        h("dt", "Base URL"), h("dd", h("div.row", { style: { gap: "6px" } }, h("code.truncate", { style: { maxWidth: "300px" } }, p.baseUrl), copyBtn(p.baseUrl))),
        h("dt", "Provider proxy"), h("dd", h("div.row", { style: { gap: "6px" } }, h("code.truncate", { style: { maxWidth: "300px" } }, p.proxyBaseUrl || "—"), p.proxyBaseUrl && copyBtn(p.proxyBaseUrl))),
        h("dt", "Currency"), h("dd", p.currency || "USD"),
        h("dt", "Last used"), h("dd", relTime(stats.lastUsed)))),
      card({ title: "Balance sync" }, balanceSummary(p))),
    h("div.mt4", card({ title: h("span", "API keys"), actions: h("button.btn.xs", { onClick: () => openProviderForm(s, { providerId: p.id, providerName: p.name }) }, icon("plus", 12), "Add key") },
      keysTable(s, p))),
    h("div.row.mt4", { style: { justifyContent: "space-between" } },
      h("button.btn.sm", { onClick: () => openProviderForm(s, null, p) }, icon("edit", 13), "Edit metadata"),
      h("button.btn.sm.danger", { onClick: () => confirmDialog(`Delete provider "${p.name}" and its ${p.apiKeys.length} key(s)?`, () => doDelete(p.id), { danger: true, confirmLabel: "Delete provider" }) }, icon("trash", 13), "Delete provider")),
  );
}

function balanceSummary(p) {
  const b = p.balanceConfig || {};
  if (!b.enabled) return h("div.muted", { style: { fontSize: "var(--fz-sm)" } }, "Balance sync disabled — configure it when editing the provider.");
  return h("dl.kv",
    h("dt", "Status"), h("dd", badge("enabled", "ok")),
    h("dt", "URL"), h("dd", h("code.truncate", { style: { maxWidth: "260px", display: "inline-block" } }, b.url || "—")),
    h("dt", "Method"), h("dd", b.method || "GET"),
    h("dt", "Balance path"), h("dd", h("code", b.balancePath || "—")),
    h("dt", "Auto-sync"), h("dd", b.autoSyncIntervalMs ? Math.round(b.autoSyncIntervalMs / 60000) + " min" : "manual"));
}

function keysTable(s, p) {
  return table(
    [{ label: "Name" }, { label: "Masked key" }, { label: "Query" }, { label: "Calls", num: true }, { label: "Tokens", num: true }, { label: "Last used" }, { label: "" }],
    p.apiKeys,
    (k) => {
      const ks = providerStats(s.usageEvents.filter((e) => e.apiKeyId === k.id), p.id);
      return h("tr",
        h("td", h("strong", k.name)),
        h("td", h("code.cell-mono", k.keyMasked)),
        h("td", k.hasQueryKey ? badge("yes", "info") : h("span.muted", "—")),
        h("td.num", int(ks.calls)),
        h("td.num", compact(ks.tokens)),
        h("td", h("span.muted", relTime(k.lastUsedAt))),
        h("td", h("div.row", { style: { gap: "4px", justifyContent: "flex-end" } },
          h("button.btn.xs", { onClick: (e) => revealKey(e.currentTarget, p.id, k.id) }, icon("key", 12), "Reveal"),
          h("button.btn.xs.danger", { onClick: () => confirmDialog(`Delete key "${k.name}"?`, () => doDeleteKey(p.id, k.id), { danger: true }) }, icon("trash", 12)))));
    },
    { emptyText: "No keys yet" });
}

/* --------------------------- actions --------------------------- */
async function doDelete(id) { try { applyState(await api.deleteProvider(id)); toast("Provider deleted", "ok"); } catch (e) { toast(e.message, "err"); } }
async function doDeleteKey(pid, kid) { try { applyState(await api.deleteKey(pid, kid)); toast("Key deleted", "ok"); } catch (e) { toast(e.message, "err"); } }
async function revealKey(btn, pid, kid) {
  await withBusy(btn, async () => { const { secret } = await api.revealSecret(pid, kid); await api.copyText(secret); toast("Secret copied to clipboard", "ok"); });
}

/* --------------------------- add / edit form --------------------------- */
function openProviderForm(s, prefill, editProvider) {
  const isEdit = !!editProvider;
  const model = editProvider
    ? { ...editProvider, balanceConfig: { ...defaultBalance(), ...(editProvider.balanceConfig || {}) } }
    : { providerName: prefill?.providerName || "", protocol: "openai-compatible", baseUrl: "", currency: "USD", keyName: "", apiKey: "", queryKey: "", isLocal: false, providerId: prefill?.providerId, balanceConfig: defaultBalance() };

  const inp = (key, opts = {}) => h("input", { type: opts.type || "text", value: model[key] ?? "", placeholder: opts.ph || "", class: opts.mono ? "input-mono" : "", oninput: (e) => (model[key] = e.target.value) });
  const bInp = (key, opts = {}) => h("input", { type: opts.type || "text", value: model.balanceConfig[key] ?? "", placeholder: opts.ph || "", class: opts.mono ? "input-mono" : "", oninput: (e) => (model.balanceConfig[key] = opts.type === "number" ? +e.target.value : e.target.value) });

  const testResult = h("span.muted", { style: { fontSize: "var(--fz-xs)" } }, "");
  const baseInput = inp("baseUrl", { ph: "https://api.example.com/v1", mono: true });
  const testBtn = h("button.btn.sm", { onClick: () => testUrlInline(testBtn, baseInput.value, testResult) }, icon("activity", 12), "Test");

  const balanceWrap = h("div", { style: { display: model.balanceConfig.enabled ? "block" : "none" } },
    h("div.grid.cols-2.mt3",
      field("Balance URL", bInp("url", { mono: true, ph: "https://…/balance" })),
      field("Method", selectEl(["GET", "POST"], model.balanceConfig.method, (v) => (model.balanceConfig.method = v)))),
    field("Headers JSON", h("textarea", { oninput: (e) => (model.balanceConfig.headersJson = e.target.value) }, model.balanceConfig.headersJson || "{}")),
    h("div.grid.cols-3.mt3",
      field("Balance path", bInp("balancePath", { mono: true })),
      field("Spent path", bInp("spentPath", { mono: true })),
      field("Response cost path", bInp("responseCostPath", { mono: true }))),
    field("Auto-sync interval (ms)", bInp("autoSyncIntervalMs", { type: "number", ph: "3600000" })));

  const body = h("div.stack",
    h("div.section-title", "Provider"),
    field("Provider name", inp("providerName", { ph: "OpenAI" })),
    h("div.grid.cols-2",
      field("Protocol", selectEl(PROTOCOLS.map((p) => p.value), model.protocol, (v) => (model.protocol = v), PROTOCOLS)),
      field("Currency", inp("currency", { ph: "USD" }))),
    field("Base URL", h("div.row", { style: { gap: "8px" } }, baseInput, testBtn), testResult),
    h("label.checkbox-row", { style: { marginTop: "4px" } }, toggle(model.isLocal, (v) => (model.isLocal = v)), "This is a local service"),
    !isEdit && [
      h("div.section-title.mt4", "API key"),
      field("Key name", inp("keyName", { ph: "prod-main" })),
      field("API key", inp("apiKey", { type: "password", ph: "sk-…", mono: true })),
      field("Query key (optional)", inp("queryKey", { type: "password", mono: true })),
    ],
    h("div.section-title.mt4", "Balance sync"),
    h("label.checkbox-row", toggle(model.balanceConfig.enabled, (v) => { model.balanceConfig.enabled = v; balanceWrap.style.display = v ? "block" : "none"; }), "Enable automatic balance sync"),
    balanceWrap);

  const saveBtn = h("button.btn.primary", { onClick: () => save(saveBtn) }, isEdit ? "Save changes" : "Save provider");
  openModal({ title: isEdit ? "Edit provider" : "Add provider / key", wide: true, body, footer: [h("button.btn", { onClick: closeOverlay }, "Cancel"), saveBtn] });

  async function save(btn) {
    try {
      let next;
      if (isEdit) next = await withBusy(btn, () => api.saveProvider({ id: model.id, name: model.providerName, protocol: model.protocol, baseUrl: baseInput.value, currency: model.currency, balanceConfig: model.balanceConfig, isLocal: model.isLocal }));
      else next = await withBusy(btn, () => api.addKey({ providerId: model.providerId, providerName: model.providerName, protocol: model.protocol, baseUrl: baseInput.value, currency: model.currency, balanceConfig: model.balanceConfig, isLocal: model.isLocal, keyName: model.keyName || "default", apiKey: model.apiKey, queryKey: model.queryKey }));
      applyState(next); closeOverlay(); toast(isEdit ? "Provider updated" : "Provider / key saved", "ok");
    } catch {}
  }
}

function selectEl(values, current, onChange, labelled) {
  return h("select", { onchange: (e) => onChange(e.target.value) },
    values.map((v) => h("option", { value: v, selected: v === current }, labelled ? labelled.find((l) => l.value === v)?.label || v : v)));
}

async function testUrlInline(btn, baseUrl, out) {
  if (!baseUrl) { out.textContent = "Enter a base URL first"; return; }
  out.textContent = "Testing…";
  await withBusy(btn, async () => {
    const r = await api.testUrl({ baseUrl });
    out.textContent = r.ok ? `OK · ${ms(r.latencyMs)}${r.modelNames?.length ? ` · ${r.modelNames.length} models` : ""}` : `Failed · ${r.error || r.status}`;
    out.style.color = r.ok ? "var(--ok)" : "var(--err)";
  });
}
