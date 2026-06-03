// api.js — unified client. Live mode = real backend fetch; demo mode = in-memory mock mutations.
import { store } from "./store.js";

const ADMIN_KEY = "api-vault-admin-token";
const tokenStore = {
  get: () => { try { return sessionStorage.getItem(ADMIN_KEY) || undefined; } catch { return undefined; } },
  set: (t) => { try { t && sessionStorage.setItem(ADMIN_KEY, t); } catch {} },
  clear: () => { try { sessionStorage.removeItem(ADMIN_KEY); } catch {} },
};

export function genId(prefix = "id") { return `${prefix}_${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`; }
function mask(s, keep = 4) { if (!s) return "••••"; return s.length <= keep ? "•".repeat(s.length) : "sk-…" + s.slice(-keep); }
const now = () => new Date().toISOString();
const clone = (o) => JSON.parse(JSON.stringify(o));
const delay = (ms = 260) => new Promise((r) => setTimeout(r, ms));

/* ----------------------------- live fetch ----------------------------- */
async function request(path, { method = "GET", body } = {}) {
  const headers = {};
  const t = tokenStore.get();
  if (t) headers["x-api-vault-admin"] = t;
  if (body !== undefined) headers["content-type"] = "application/json";
  const res = await fetch(store.baseUrl.replace(/\/$/, "") + path, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : undefined;
  if (!res.ok) {
    if (res.status === 401 && !path.includes("/vault/")) tokenStore.clear();
    throw new Error(data?.error || `Request failed (${res.status})`);
  }
  if (data?.adminToken) tokenStore.set(data.adminToken);
  return data;
}

/* ----------------------------- demo helpers ----------------------------- */
const S = () => store.state; // current in-memory demo state
function fakeTest(baseUrl, models = []) {
  const ok = !/fail|down|broken/i.test(baseUrl || "");
  return { ok, status: ok ? 200 : 503, latencyMs: ok ? 60 + Math.round(Math.random() * 380) : 0, checkedAt: now(), error: ok ? undefined : "Connection refused", modelNames: ok ? models : [] };
}

/* ----------------------------- public api ----------------------------- */
export const api = {
  isDemo: () => store.mode === "demo",

  async getState() { return store.mode === "live" ? request("/api/state") : clone(S()); },

  async setupVault(password) {
    if (store.mode === "live") return request("/api/vault/setup", { method: "POST", body: { password } });
    await delay(); S().initialized = true; S().unlocked = true; S().adminToken = genId("admin"); tokenStore.set(S().adminToken); return clone(S());
  },
  async unlockVault(password) {
    if (store.mode === "live") return request("/api/vault/unlock", { method: "POST", body: { password } });
    await delay(); if (password !== "demo" && S().initialized && password.length < 1) throw new Error("Wrong password");
    S().unlocked = true; S().adminToken = genId("admin"); tokenStore.set(S().adminToken); return clone(S());
  },
  async lockVault() {
    if (store.mode === "live") { const s = await request("/api/vault/lock", { method: "POST" }); tokenStore.clear(); return s; }
    await delay(120); S().unlocked = false; tokenStore.clear(); return clone(S());
  },

  /* providers */
  async addKey(payload) {
    if (store.mode === "live") return request("/api/providers/add-key", { method: "POST", body: payload });
    await delay();
    let p = S().providers.find((x) => (payload.providerId && x.id === payload.providerId) || x.name === payload.providerName);
    if (!p) {
      p = { id: genId("prov"), name: payload.providerName, protocol: payload.protocol || "openai-compatible", baseUrl: payload.baseUrl || "", proxyBaseUrl: "", currency: payload.currency || "USD", balanceConfig: payload.balanceConfig || defaultBalance(), apiKeys: [], createdAt: now(), updatedAt: now(), isLocal: payload.isLocal };
      S().providers.push(p);
    }
    p.apiKeys.push({ id: genId("key"), providerId: p.id, name: payload.keyName, keyMasked: mask(payload.apiKey), hasQueryKey: !!payload.queryKey, createdAt: now() });
    p.updatedAt = now();
    return clone(S());
  },
  async saveProvider(input) {
    if (store.mode === "live") return request("/api/providers", { method: "POST", body: input });
    await delay();
    if (input.id) { const p = S().providers.find((x) => x.id === input.id); if (p) Object.assign(p, input, { updatedAt: now() }); }
    else S().providers.push({ ...input, id: genId("prov"), apiKeys: [], createdAt: now(), updatedAt: now() });
    return clone(S());
  },
  async deleteProvider(id) {
    if (store.mode === "live") return request(`/api/providers/${encodeURIComponent(id)}`, { method: "DELETE" });
    await delay(); S().providers = S().providers.filter((p) => p.id !== id); return clone(S());
  },
  async deleteKey(providerId, keyId) {
    if (store.mode === "live") return request(`/api/providers/${encodeURIComponent(providerId)}/keys/${encodeURIComponent(keyId)}`, { method: "DELETE" });
    await delay(); const p = S().providers.find((x) => x.id === providerId); if (p) p.apiKeys = p.apiKeys.filter((k) => k.id !== keyId); return clone(S());
  },
  async revealSecret(providerId, keyId, kind = "api") {
    if (store.mode === "live") return request(`/api/providers/${encodeURIComponent(providerId)}/keys/${encodeURIComponent(keyId)}/secret?kind=${kind}`);
    await delay(140); return { secret: "sk-demo-" + keyId.slice(-8) + "-XXXXXXXXXXXX" };
  },
  async testBalance(id) {
    if (store.mode === "live") return request(`/api/providers/${encodeURIComponent(id)}/test-balance`, { method: "POST" });
    await delay(420);
    const p = S().providers.find((x) => x.id === id);
    const snap = { id: genId("bal"), providerId: id, providerName: p?.name || "?", checkedAt: now(), ok: true, balance: +(Math.random() * 90 + 5).toFixed(2), spent: +(Math.random() * 40).toFixed(2), granted: 100, currency: p?.currency || "USD", tokenName: p?.apiKeys[0]?.name };
    S().balanceSnapshots.unshift(snap);
    return { result: { snapshot: snap }, state: clone(S()) };
  },

  /* test url */
  async testUrl(input) {
    if (store.mode === "live") return request("/api/test-url", { method: "POST", body: input });
    await delay(360); return fakeTest(input.baseUrl, ["gpt-4o", "gpt-4o-mini", "claude-3.5-sonnet"]);
  },

  /* proxy tokens */
  async createProxyToken(input) {
    if (store.mode === "live") return request("/api/proxy-tokens", { method: "POST", body: input });
    await delay(); const secret = "proxy_" + genId("").slice(3);
    S().proxyTokens.push({ ...input, id: genId("tok"), tokenMasked: "proxy_…" + secret.slice(-6), enabled: input.enabled ?? true, createdAt: now(), updatedAt: now() });
    return { secret, state: clone(S()) };
  },
  async updateProxyToken(id, input) {
    if (store.mode === "live") return request(`/api/proxy-tokens/${encodeURIComponent(id)}`, { method: "POST", body: input });
    await delay(); const t = S().proxyTokens.find((x) => x.id === id); if (t) Object.assign(t, input, { updatedAt: now() }); return clone(S());
  },
  async deleteProxyToken(id) {
    if (store.mode === "live") return request(`/api/proxy-tokens/${encodeURIComponent(id)}`, { method: "DELETE" });
    await delay(); S().proxyTokens = S().proxyTokens.filter((t) => t.id !== id); return clone(S());
  },
  async revealProxyToken(id) {
    if (store.mode === "live") return request(`/api/proxy-tokens/${encodeURIComponent(id)}/secret`);
    await delay(140); return { secret: "proxy_demo_" + id.slice(-10) + "XXXX" };
  },
  async regenerateProxyToken(id) {
    if (store.mode === "live") return request(`/api/proxy-tokens/${encodeURIComponent(id)}/regenerate`, { method: "POST" });
    await delay(); const secret = "proxy_" + genId("").slice(3); const t = S().proxyTokens.find((x) => x.id === id);
    if (t) { t.tokenMasked = "proxy_…" + secret.slice(-6); t.updatedAt = now(); } return { secret, state: clone(S()) };
  },

  /* model catalog */
  async syncProviderModels(providerId) {
    if (store.mode === "live") return request(`/api/model-catalog/sync-provider/${encodeURIComponent(providerId)}`, { method: "POST" });
    await delay(620); const p = S().providers.find((x) => x.id === providerId);
    return { result: { providerId, providerName: p?.name, ok: true, syncedCount: 3, modelIds: ["gpt-4o", "gpt-4o-mini", "o1"], checkedAt: now() }, state: clone(S()) };
  },
  async saveModel(input) {
    if (store.mode === "live") return request(input.id ? `/api/model-catalog/${encodeURIComponent(input.id)}` : "/api/model-catalog/manual", { method: "POST", body: input });
    await delay(); const p = S().providers.find((x) => x.id === input.providerId);
    if (input.id) { const m = S().modelCatalog.find((x) => x.id === input.id); if (m) Object.assign(m, input, { updatedAt: now() }); }
    else S().modelCatalog.push({ ...input, id: genId("mdl"), providerName: p?.name || "?", aliases: input.aliases || [], capabilities: input.capabilities || ["text"], source: "manual", createdAt: now(), updatedAt: now(), lastSeenAt: now() });
    return clone(S());
  },
  async deleteModel(id) {
    if (store.mode === "live") return request(`/api/model-catalog/${encodeURIComponent(id)}`, { method: "DELETE" });
    await delay(); S().modelCatalog = S().modelCatalog.filter((m) => m.id !== id); return clone(S());
  },

  /* account pools */
  async saveAccountPool(input) {
    if (store.mode === "live") { const { state } = await request("/api/account-pools", { method: "POST", body: input }); return state; }
    await delay();
    if (input.id) { const a = S().accountPools.find((x) => x.id === input.id); if (a) Object.assign(a, input, { updatedAt: now() }); }
    else S().accountPools.push({ ...input, id: genId("pool"), kind: "cpa", status: "unknown", modelNames: [], hasApiKey: !!input.apiKey, apiKeyMasked: input.apiKey ? mask(input.apiKey) : undefined, hasManagementSecret: !!input.managementSecret, createdAt: now(), updatedAt: now() });
    return clone(S());
  },
  async deleteAccountPool(id) {
    if (store.mode === "live") return request(`/api/account-pools/${encodeURIComponent(id)}`, { method: "DELETE" });
    await delay(); S().accountPools = S().accountPools.filter((a) => a.id !== id); return clone(S());
  },
  async testAccountPool(id) {
    if (store.mode === "live") return request(`/api/account-pools/${encodeURIComponent(id)}/test`, { method: "POST" });
    await delay(480); const a = S().accountPools.find((x) => x.id === id);
    const r = { ok: true, status: 200, rootStatus: 200, modelsStatus: 200, latencyMs: 90 + Math.round(Math.random() * 200), checkedAt: now(), modelNames: a?.modelNames || [] };
    if (a) Object.assign(a, { status: "available", latencyMs: r.latencyMs, lastCheckedAt: r.checkedAt, rootStatus: 200, modelsStatus: 200 });
    return { result: r, state: clone(S()) };
  },
  async syncAccountPoolModels(id) {
    if (store.mode === "live") return request(`/api/account-pools/${encodeURIComponent(id)}/sync-models`, { method: "POST" });
    await delay(560); const a = S().accountPools.find((x) => x.id === id);
    const models = ["gemini-2.0-flash", "gemini-1.5-pro", "claude-3.5-sonnet", "gpt-4o"];
    if (a) { a.modelNames = models; a.lastCheckedAt = now(); a.modelsStatus = 200; }
    return { result: { ok: true, modelNames: models, latencyMs: 120, checkedAt: now() }, state: clone(S()) };
  },
  async createAccountPoolProvider(id) {
    if (store.mode === "live") { const { state } = await request(`/api/account-pools/${encodeURIComponent(id)}/create-provider`, { method: "POST" }); return state; }
    await delay(); const a = S().accountPools.find((x) => x.id === id);
    if (a && !a.providerId) { const pid = genId("prov"); a.providerId = pid; S().providers.push({ id: pid, name: a.name, protocol: "openai-compatible", baseUrl: a.baseUrl, currency: "USD", balanceConfig: defaultBalance(), apiKeys: [], createdAt: now(), updatedAt: now() }); }
    return clone(S());
  },

  /* local services + cloudflared */
  async saveLocalService(input) {
    if (store.mode === "live") { const { state } = await request("/api/local-services", { method: "POST", body: input }); return state; }
    await delay();
    if (input.id) { const l = S().localServices.find((x) => x.id === input.id); if (l) Object.assign(l, input, { updatedAt: now() }); }
    else S().localServices.push({ ...input, id: genId("svc"), type: input.type || "unknown", status: "unknown", hasApiKey: !!input.apiKey, keyMasked: input.apiKey ? mask(input.apiKey) : undefined, createdAt: now(), updatedAt: now() });
    return clone(S());
  },
  async deleteLocalService(id) {
    if (store.mode === "live") return request(`/api/local-services/${encodeURIComponent(id)}`, { method: "DELETE" });
    await delay(); S().localServices = S().localServices.filter((l) => l.id !== id); return clone(S());
  },
  async testLocalService(id) {
    if (store.mode === "live") return request(`/api/local-services/${encodeURIComponent(id)}/test`, { method: "POST" });
    await delay(360); const l = S().localServices.find((x) => x.id === id); const r = fakeTest(l?.baseUrl);
    if (l) { l.status = r.ok ? "available" : "unavailable"; l.latencyMs = r.latencyMs; l.lastCheckedAt = r.checkedAt; }
    return { ...r, serviceStatus: r.ok ? "available" : "unavailable" };
  },
  async cloudflared(action, config) {
    if (store.mode === "live") {
      if (action === "status") return (await request("/api/cloudflared/status")).status;
      if (action === "logs") return request("/api/cloudflared/logs?limit=200");
      return request(`/api/cloudflared/${action}`, { method: "POST", body: { config } });
    }
    await delay(action === "start" ? 900 : 300);
    const cf = S().cloudflared;
    if (action === "start") { cf.running = true; cf.phase = "running"; cf.publicUrl = "https://demo-vault.trycloudflare.com"; cf.startedAt = now(); cf.error = undefined; }
    if (action === "stop") { cf.running = false; cf.phase = "idle"; cf.publicUrl = undefined; cf.lastExitAt = now(); cf.lastExitCode = 0; }
    return { ok: true, code: "OK", status: clone(cf) };
  },

  async copyText(text) {
    try { await navigator.clipboard.writeText(text); return true; } catch {}
    try { const ta = document.createElement("textarea"); ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0"; document.body.appendChild(ta); ta.select(); const ok = document.execCommand("copy"); ta.remove(); return ok; } catch { return false; }
  },
};

export function defaultBalance() {
  return { enabled: false, url: "", method: "GET", headersJson: "{}", bodyTemplate: "", balancePath: "data.balance", spentPath: "data.total_usage", currencyPath: "", responseCostPath: "" };
}
