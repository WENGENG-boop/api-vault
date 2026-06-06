// store.js — minimal reactive store for AppState + UI state.

const listeners = new Set();

export const store = {
  // server-derived
  state: null,            // AppState | null
  // connection
  mode: "demo",           // "demo" | "live"
  baseUrl: "",            // "" = same-origin (proxied by server.mjs to the real backend)
  // ui
  booting: true,
  tab: "dashboard",
  category: "gateway",
  theme: localStorage.getItem("av-theme-v2") || "light",
  sidebarCollapsed: localStorage.getItem("av-collapsed") === "true",
  // transient per-page UI memory (filters, view toggles, expanded rows…)
  ui: {},
};

export function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }

export function emit() { for (const fn of listeners) fn(); }

/** Patch top-level store fields and notify. */
export function set(patch) {
  Object.assign(store, patch);
  emit();
}

/** Read/init a namespaced UI bucket (survives re-renders). */
export function ui(key, defaults = {}) {
  if (!store.ui[key]) store.ui[key] = { ...defaults };
  return store.ui[key];
}

/** Patch a UI bucket and re-render. */
export function setUi(key, patch) {
  store.ui[key] = { ...ui(key), ...patch };
  emit();
}

export function clearUi(key) {
  delete store.ui[key];
  emit();
}

export function setTheme(theme) {
  store.theme = theme;
  localStorage.setItem("av-theme-v2", theme);
  document.documentElement.setAttribute("data-theme", theme);
  emit();
}

export function applyState(next) {
  store.state = next;
  emit();
}
