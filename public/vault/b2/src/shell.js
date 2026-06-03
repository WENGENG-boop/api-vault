// shell.js — single left sidebar (grouped nav) + airy content host. No top bar.
import { h, icon } from "./dom.js";
import { store, set, setTheme, applyState } from "./store.js";
import { api } from "./api.js";
import { makeMockState } from "./mock.js";
import { toast } from "./ui.js";

export const CATEGORIES = [
  { id: "gateway", label: "Gateway", tabs: ["dashboard", "providers", "account-pools", "local-services"] },
  { id: "access", label: "Access Control", tabs: ["proxy-tokens", "models"] },
  { id: "analytics", label: "Analytics & Billing", tabs: ["status", "usage", "estimates", "billing"] },
];

const TAB_META = {
  dashboard: { label: "Dashboard", icon: "dashboard" },
  providers: { label: "Providers", icon: "providers" },
  "account-pools": { label: "Account Pools", icon: "pools" },
  "local-services": { label: "Local Services", icon: "local" },
  "proxy-tokens": { label: "Proxy Tokens", icon: "tokens" },
  models: { label: "Models", icon: "models" },
  status: { label: "Status", icon: "status" },
  usage: { label: "Usage", icon: "usage" },
  estimates: { label: "Estimates", icon: "pie" },
  billing: { label: "Billing", icon: "billing" },
};

export function tabCount(tab, s) {
  switch (tab) {
    case "providers": return s.providers.length;
    case "account-pools": return s.accountPools.length;
    case "local-services": return s.localServices.length;
    case "proxy-tokens": return s.proxyTokens.length;
    case "models": return s.modelCatalog.length;
    default: return null;
  }
}

export function catOf(tab) { return CATEGORIES.find((c) => c.tabs.includes(tab))?.id || "gateway"; }
function goTab(tab) { set({ tab, category: catOf(tab) }); }

export function renderShell(contentNode) {
  const s = store.state;
  const cf = s.cloudflared || {};

  const sidebar = h("aside.sidebar",
    h("div.sb-brand", { onClick: () => goTab("dashboard"), attrs: { role: "img", "aria-label": "API Vault" } },
      h("span.sb-wordmark")),

    h("nav.sb-nav", CATEGORIES.flatMap((c) => [
      h("div.sb-group", c.label),
      ...c.tabs.map((t) => {
        const meta = TAB_META[t]; const count = tabCount(t, s);
        return h("button.sb-item" + (store.tab === t ? ".active" : ""), { onClick: () => goTab(t) },
          h("span.ico", icon(meta.icon, 16)), h("span", meta.label), count != null && h("span.count", count));
      }),
    ])),

    h("div.sb-foot",
      s.proxyPort && h("div.sb-stat", h("span.sb-dot.on"), h("span.lbl", "Proxy"), h("code.val", "127.0.0.1:" + s.proxyPort)),
      h("div.sb-stat", h("span.sb-dot" + (cf.running ? ".on" : ".off")), h("span.lbl", "Tunnel"), h("span.val", cf.running ? "active" : "off")),
      h("div.sb-stat", { onClick: () => goTab("usage"), style: { cursor: "pointer" } }, icon("activity", 13, { class: "" }), h("span.lbl", "Recorded"), h("span.val", (s.totals?.totalCalls ?? 0).toLocaleString())),
      h("div.sb-actions",
        h("button.mini", { title: "Toggle theme", onClick: () => setTheme(store.theme === "dark" ? "light" : "dark") }, icon(store.theme === "dark" ? "sun" : "moon", 14)),
        h("button.mini", { title: store.mode === "demo" ? "Demo data — click to connect a live backend" : "Connected live", onClick: toggleMode }, h("span.sb-dot" + (store.mode === "demo" ? "" : ".on")), store.mode === "demo" ? "Demo" : "Live")),
      h("button.mini.lock", { style: { marginTop: "6px" }, onClick: lock }, icon("lock", 14), "Lock vault")));

  return h("div.app", sidebar, h("main.content", h("div.content-inner", contentNode)));
}

async function toggleMode() {
  if (store.mode === "live") {
    store.mode = "demo"; store.baseUrl = ""; store.liveConnected = false;
    applyState(makeMockState());
    toast("Switched to demo mode", "info");
    return;
  }
  // demo → live: reconnect to the real backend through the same-origin proxy
  store.mode = "live"; store.baseUrl = "";
  try {
    applyState(await api.getState());
    store.liveConnected = true;
    toast("Connected to live backend", "ok");
  } catch (e) {
    store.mode = "demo"; store.liveConnected = false;
    applyState(makeMockState());
    toast("Backend not reachable — staying in demo. " + e.message, "err");
  }
}

async function lock() {
  try { applyState(await api.lockVault()); toast("Vault locked", "ok"); }
  catch (e) { toast(e.message, "err"); }
}
