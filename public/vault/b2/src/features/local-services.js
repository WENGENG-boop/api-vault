// features/local-services.js — local services + Cloudflared tunnel control.
import { h, icon } from "../dom.js";
import { ui, setUi, applyState, store } from "../store.js";
import { api } from "../api.js";
import { ms, relTime, protoLabel } from "../format.js";
import { card, badge, dot, field, toggle, copyBtn, table, empty, openModal, closeOverlay, confirmDialog, toast, withBusy } from "../ui.js";

const TYPES = [{ value: "unknown", label: "Unknown" }, { value: "openai-compatible", label: "OpenAI" }, { value: "anthropic-compatible", label: "Anthropic" }, { value: "custom", label: "Custom" }];

export function renderLocalServices(s) {
  return h("div.stack",
    h("div.page-head",
      h("div.titles", h("h1", "Local Services"), h("div.sub", "Local model servers exposed through the Cloudflared tunnel")),
      h("div.actions", h("button.btn.primary", { onClick: () => openServiceForm(s) }, icon("plus", 14), "Add local service"))),
    tunnelCard(s),
    s.localServices.length ? servicesCard(s) : empty("No local services", "Register a local server (Ollama, LM Studio…) to proxy it.", h("button.btn.primary", { onClick: () => openServiceForm(s) }, icon("plus", 14), "Add local service")));
}

function tunnelCard(s) {
  const cf = s.cloudflared || {};
  const running = cf.running;
  const stClass = cf.missingBinary ? "err" : running ? "ok" : cf.phase === "error" ? "err" : "idle";
  const stLabel = cf.missingBinary ? "Not installed" : running ? "Running" : cf.phase === "error" ? "Error" : "Not running";
  const startBtn = h("button.btn." + (running ? "" : "primary"), { onClick: () => toggleTunnel(startBtn, running ? "stop" : "start") },
    icon(running ? "stop" : "play", 14), running ? "Stop tunnel" : "Start tunnel");

  return card({ title: h("span", { style: { display: "flex", gap: "8px", alignItems: "center" } }, icon("globe", 15), "Cloudflared tunnel"), actions: h("div.row", { style: { gap: "8px" } }, badge(stLabel, stClass === "ok" ? "ok" : stClass === "err" ? "err" : null, { dot: true }), startBtn) },
    h("div.grid.cols-2",
      h("div.stack.tight",
        running && cf.publicUrl ? h("div.spread", { style: { padding: "8px 10px", background: "var(--surface-2)", borderRadius: "var(--r1)" } },
          h("div", { style: { minWidth: 0 } }, h("div.muted", { style: { fontSize: "10px", textTransform: "uppercase" } }, "Public URL"), h("code.truncate", { style: { maxWidth: "280px", display: "inline-block" } }, cf.publicUrl)), copyBtn(cf.publicUrl)) : null,
        running ? h("div.muted", { style: { fontSize: "var(--fz-sm)" } }, "Local service URL pattern: ", h("code", "<public>/api/proxy/local/:serviceId/v1")) : h("p.muted", { style: { fontSize: "var(--fz-sm)" } }, cf.missingBinary ? "cloudflared binary not found. Install it, then start the tunnel." : "Tunnel is off. Start it to expose local services publicly."),
        cf.error && h("div", { style: { color: "var(--err)", fontSize: "var(--fz-sm)" } }, cf.error),
        cf.startedAt && running && h("div.muted", { style: { fontSize: "var(--fz-xs)" } }, "Started ", relTime(cf.startedAt))),
      tunnelConfig(s)));
}

function tunnelConfig(s) {
  const c = ui("cf", { targetPort: s.proxyPort || 3210, protocol: "http", hostname: "", noAutoUpdate: true });
  return h("div.stack.tight",
    h("div.section-title", "Tunnel configuration"),
    h("div.grid.cols-2",
      field("Target port", h("input", { type: "number", value: c.targetPort, oninput: (e) => (c.targetPort = +e.target.value) })),
      field("Protocol", h("select", { onchange: (e) => (c.protocol = e.target.value) }, ["http", "https"].map((p) => h("option", { value: p, selected: p === c.protocol }, p))))),
    field("Hostname (optional)", h("input", { type: "text", value: c.hostname, placeholder: "auto (trycloudflare)", oninput: (e) => (c.hostname = e.target.value) })),
    h("label.checkbox-row", toggle(c.noAutoUpdate, (v) => (c.noAutoUpdate = v)), "No auto-update"),
    h("button.btn.sm.mt2", { onClick: () => viewLogs() }, icon("activity", 13), "View logs"));
}

function servicesCard(s) {
  return card({ title: "Registered local services" },
    table(
      [{ label: "" }, { label: "Name" }, { label: "Type" }, { label: "Base URL" }, { label: "Latency", num: true }, { label: "Checked" }, { label: "Public proxy" }, { label: "" }],
      s.localServices,
      (l) => h("tr",
        h("td", dot(l.status === "available" ? "ok" : l.status === "unknown" ? "idle" : "err")),
        h("td", h("strong", l.name), l.hasApiKey && h("div", h("span.cap-tag", "key: " + l.keyMasked))),
        h("td", badge(protoLabel(l.type), null, {})),
        h("td", h("code.cell-mono", l.baseUrl)),
        h("td.num", l.latencyMs ? ms(l.latencyMs) : "—"),
        h("td", h("span.muted", relTime(l.lastCheckedAt))),
        h("td", l.publicAccessUrl ? copyBtn(l.publicAccessUrl, "Copy URL") : h("span.muted", "—")),
        h("td", h("div.row", { style: { gap: "4px", justifyContent: "flex-end" } },
          tbtn(l), h("button.btn.xs.danger", { onClick: () => confirmDialog(`Delete "${l.name}"?`, async () => { applyState(await api.deleteLocalService(l.id)); toast("Service deleted", "ok"); }, { danger: true }) }, icon("trash", 12))))),
      { emptyText: "No local services" }));
}

function tbtn(l) { const b = h("button.btn.xs", { onClick: () => withBusy(b, async () => { const r = await api.testLocalService(l.id); toast(`${l.name}: ${r.ok ? "OK " + ms(r.latencyMs) : "unreachable"}`, r.ok ? "ok" : "err"); if (api.isDemo()) setUi("ls", { _t: Date.now() }); }) }, icon("activity", 12), "Test"); return b; }

async function toggleTunnel(btn, action) {
  await withBusy(btn, async () => { const r = await api.cloudflared(action); if (r?.status) { store.state.cloudflared = r.status; applyState(store.state); } toast(action === "start" ? "Tunnel started" : "Tunnel stopped", "ok"); });
}

async function viewLogs() {
  let logs = [];
  try { const r = await api.cloudflared("logs"); logs = r?.logs || []; } catch {}
  if (!logs.length && api.isDemo()) logs = demoLogs();
  openModal({ title: "Cloudflared logs", wide: true, body: h("div.codeblock", logs.length ? logs.map((l) => `[${new Date(l.ts).toLocaleTimeString()}] ${l.level.toUpperCase()} ${l.message}`).join("\n") : "No logs."), footer: [h("button.btn", { onClick: closeOverlay }, "Close")] });
}

function demoLogs() {
  const now = Date.now();
  return [
    { ts: new Date(now - 180000).toISOString(), level: "info", stream: "system", message: "Starting cloudflared tunnel" },
    { ts: new Date(now - 178000).toISOString(), level: "info", stream: "stdout", message: "Requesting new quick Tunnel on trycloudflare.com…" },
    { ts: new Date(now - 176000).toISOString(), level: "info", stream: "stdout", message: "+--------------------------------------+" },
    { ts: new Date(now - 176000).toISOString(), level: "info", stream: "stdout", message: "https://demo-vault.trycloudflare.com" },
    { ts: new Date(now - 175000).toISOString(), level: "info", stream: "stdout", message: "Connection registered connIndex=0 location=SJC" },
  ];
}

function openServiceForm(s, edit) {
  const m = edit ? { ...edit } : { name: "", baseUrl: "", type: "unknown", apiKey: "", notes: "" };
  const inp = (k, opts = {}) => h("input", { type: opts.type || "text", value: m[k] ?? "", placeholder: opts.ph || "", class: opts.mono ? "input-mono" : "", oninput: (e) => (m[k] = e.target.value) });
  const testOut = h("span.muted", { style: { fontSize: "var(--fz-xs)" } });
  const baseInput = inp("baseUrl", { ph: "http://127.0.0.1:11434", mono: true });
  const testBtn = h("button.btn.sm", { onClick: () => withBusy(testBtn, async () => { const r = await api.testUrl({ baseUrl: baseInput.value, isLocal: true }); testOut.textContent = r.ok ? `OK · ${ms(r.latencyMs)}` : `Failed · ${r.error || r.status}`; testOut.style.color = r.ok ? "var(--ok)" : "var(--err)"; }) }, icon("activity", 12), "Test");
  const body = h("div.stack",
    field("Service name", inp("name", { ph: "Ollama" })),
    field("Base URL", h("div.row", { style: { gap: "8px" } }, baseInput, testBtn), testOut),
    h("div.grid.cols-2",
      field("Type", h("select", { onchange: (e) => (m.type = e.target.value) }, TYPES.map((t) => h("option", { value: t.value, selected: t.value === m.type }, t.label)))),
      field("API key (optional)", inp("apiKey", { type: "password", mono: true }))),
    field("Notes", inp("notes")));
  const btn = h("button.btn.primary", { onClick: async () => { try { applyState(await withBusy(btn, () => api.saveLocalService({ ...m, baseUrl: baseInput.value }))); closeOverlay(); toast(edit ? "Service updated" : "Service added", "ok"); } catch {} } }, edit ? "Save" : "Add service");
  openModal({ title: edit ? "Edit local service" : "Add local service", body, footer: [h("button.btn", { onClick: closeOverlay }, "Cancel"), btn] });
}
