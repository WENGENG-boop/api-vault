// app.js — bootstrap, render loop, auth gating, polling, routing.
import { h } from "./dom.js";
import { store, subscribe, set, applyState } from "./store.js";
import { api } from "./api.js";
import { makeMockState } from "./mock.js";
import { renderShell, catOf } from "./shell.js";
import { renderAuth } from "./auth.js";

import { renderDashboard } from "./features/dashboard.js";
import { renderProviders } from "./features/providers.js";
import { renderAccountPools } from "./features/account-pools.js";
import { renderLocalServices } from "./features/local-services.js";
import { renderProxyTokens } from "./features/proxy-tokens.js";
import { renderModels } from "./features/models.js";
import { renderStatus } from "./features/status.js";
import { renderUsage } from "./features/usage.js";
import { renderEstimates } from "./features/estimates.js";
import { renderBilling } from "./features/billing.js";

const PAGES = {
  dashboard: renderDashboard, providers: renderProviders, "account-pools": renderAccountPools,
  "local-services": renderLocalServices, "proxy-tokens": renderProxyTokens, models: renderModels,
  status: renderStatus, usage: renderUsage, estimates: renderEstimates, billing: renderBilling,
};

const root = document.getElementById("root");
const REFRESH_MS = 5000;
let polling = null;

function buildView() {
  const s = store.state;
  if (store.booting || !s) return h("div.boot", h("div.spinner"));
  if (!s.initialized || !s.unlocked) return renderAuth();
  const page = PAGES[store.tab] || renderDashboard;
  let content;
  try { content = page(s); }
  catch (e) { console.error(e); content = h("div.empty", h("h4", "Render error"), h("p", String(e?.message || e))); }
  return renderShell(content);
}

function render() {
  // preserve focus + caret across full re-render
  const active = document.activeElement;
  const fk = active?.dataset?.focusKey;
  const caret = active && "selectionStart" in active ? active.selectionStart : null;

  root.replaceChildren(buildView());
  root.setAttribute("aria-busy", store.booting ? "true" : "false");

  if (fk) {
    const el = root.querySelector(`[data-focus-key="${fk}"]`);
    if (el) { el.focus(); if (caret != null) { try { el.setSelectionRange(caret, caret); } catch {} } }
  }
}

subscribe(render);

async function poll() {
  if (!store.state?.unlocked) return;
  try { const next = await api.getState(); if (next) applyState(next); }
  catch { /* keep last state; surfaced elsewhere */ }
}

function startPolling() {
  if (polling) return;
  polling = setInterval(poll, REFRESH_MS);
}

async function boot() {
  document.documentElement.setAttribute("data-theme", store.theme);
  const params = new URLSearchParams(location.search);
  const forceDemo = params.has("demo");
  const liveUrl = params.get("live"); // optional: connect directly to an absolute backend URL

  if (forceDemo) {
    store.mode = "demo"; store.baseUrl = ""; applyState(makeMockState());
  } else {
    // Live-first: try the real backend (same-origin proxy, or ?live=URL). Fall back to demo.
    store.mode = "live";
    store.baseUrl = liveUrl || "";
    try {
      const s = await api.getState();
      applyState(s);
      store.liveConnected = true;
    } catch {
      store.mode = "demo"; store.baseUrl = ""; store.liveConnected = false;
      applyState(makeMockState());
    }
  }

  const tab = params.get("tab");
  if (tab && PAGES[tab]) { store.tab = tab; store.category = catOf(tab); }

  set({ booting: false });
  startPolling();
}

boot();
