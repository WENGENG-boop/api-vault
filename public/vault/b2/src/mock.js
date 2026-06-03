// mock.js — rich, stable demo AppState so the UI renders fully without a backend.
import { defaultBalance } from "./api.js";

// seeded RNG for stable-but-natural data
let _seed = 1337;
const rnd = () => { _seed = (_seed * 1103515245 + 12345) & 0x7fffffff; return _seed / 0x7fffffff; };
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
const between = (a, b) => a + rnd() * (b - a);
const iso = (d) => new Date(d).toISOString();
const HOUR = 3600e3, DAY = 86400e3;

function latencyHourly(base, jitter, days = 7) {
  const out = []; const start = Date.now() - days * DAY;
  for (let i = 0; i < days * 24; i++) {
    const hour = Math.floor((start + i * HOUR) / HOUR) * HOUR;
    const total = Math.floor(between(2, 22));
    const ok = total - (rnd() < 0.08 ? Math.floor(between(1, 3)) : 0);
    const avg = base + between(-jitter, jitter) + (i % 24 > 17 ? 120 : 0);
    out.push({ hour, count: total, sum: Math.round(avg * total), min: Math.round(avg * 0.6), max: Math.round(avg * 1.8), ok: Math.max(ok, 0), total });
  }
  return out;
}

export function makeMockState() {
  _seed = 1337;
  const providers = [
    {
      id: "prov_openai", name: "OpenAI", protocol: "openai-compatible", baseUrl: "https://api.openai.com/v1",
      proxyBaseUrl: "http://127.0.0.1:3210/proxy/provider/prov_openai/v1", currency: "USD",
      balanceConfig: { ...defaultBalance(), enabled: true, url: "https://api.openai.com/dashboard/billing/credit_grants", autoSyncIntervalMs: 3600e3 },
      apiKeys: [
        { id: "key_oa1", providerId: "prov_openai", name: "prod-main", keyMasked: "sk-…a93F", hasQueryKey: false, createdAt: iso(Date.now() - 28 * DAY), lastUsedAt: iso(Date.now() - 2 * HOUR) },
        { id: "key_oa2", providerId: "prov_openai", name: "batch-jobs", keyMasked: "sk-…7bQ2", hasQueryKey: false, createdAt: iso(Date.now() - 14 * DAY), lastUsedAt: iso(Date.now() - 1 * DAY) },
      ],
      createdAt: iso(Date.now() - 28 * DAY), updatedAt: iso(Date.now() - HOUR), status: "available", latencyMs: 210, lastCheckedAt: iso(Date.now() - 40e3), latencyHourly: latencyHourly(220, 70),
    },
    {
      id: "prov_anthropic", name: "Anthropic", protocol: "anthropic-compatible", baseUrl: "https://api.anthropic.com",
      proxyBaseUrl: "http://127.0.0.1:3210/proxy/provider/prov_anthropic", currency: "USD",
      balanceConfig: { ...defaultBalance(), enabled: true, url: "https://api.anthropic.com/v1/organizations/usage" },
      apiKeys: [{ id: "key_an1", providerId: "prov_anthropic", name: "claude-prod", keyMasked: "sk-ant-…X4d", hasQueryKey: false, createdAt: iso(Date.now() - 21 * DAY), lastUsedAt: iso(Date.now() - 30 * 60e3) }],
      createdAt: iso(Date.now() - 21 * DAY), updatedAt: iso(Date.now() - 2 * HOUR), status: "available", latencyMs: 340, lastCheckedAt: iso(Date.now() - 35e3), latencyHourly: latencyHourly(360, 90),
    },
    {
      id: "prov_deepseek", name: "DeepSeek", protocol: "openai-compatible", baseUrl: "https://api.deepseek.com/v1",
      proxyBaseUrl: "http://127.0.0.1:3210/proxy/provider/prov_deepseek/v1", currency: "USD", balanceConfig: { ...defaultBalance(), enabled: true, url: "https://api.deepseek.com/user/balance" },
      apiKeys: [{ id: "key_ds1", providerId: "prov_deepseek", name: "ds-key", keyMasked: "sk-…D33p", hasQueryKey: false, createdAt: iso(Date.now() - 9 * DAY), lastUsedAt: iso(Date.now() - 5 * HOUR) }],
      createdAt: iso(Date.now() - 9 * DAY), updatedAt: iso(Date.now() - 5 * HOUR), status: "available", latencyMs: 520, lastCheckedAt: iso(Date.now() - 60e3), latencyHourly: latencyHourly(540, 160),
    },
    {
      id: "prov_ollama", name: "Local Ollama", protocol: "openai-compatible", baseUrl: "http://127.0.0.1:11434/v1",
      proxyBaseUrl: "http://127.0.0.1:3210/proxy/provider/prov_ollama/v1", currency: "USD", balanceConfig: defaultBalance(), isLocal: true,
      apiKeys: [{ id: "key_ol1", providerId: "prov_ollama", name: "local", keyMasked: "••••", hasQueryKey: false, createdAt: iso(Date.now() - 6 * DAY) }],
      createdAt: iso(Date.now() - 6 * DAY), updatedAt: iso(Date.now() - 6 * DAY), status: "available", latencyMs: 48, lastCheckedAt: iso(Date.now() - 20e3), latencyHourly: latencyHourly(55, 25),
    },
  ];

  const modelCatalog = [
    m("prov_openai", "OpenAI", "gpt-4o", "GPT-4o", ["gpt-4o-2024-11"], ["text", "vision", "tool", "long-context"], 2.5, 10, 128000, "auto"),
    m("prov_openai", "OpenAI", "gpt-4o-mini", "GPT-4o mini", [], ["text", "vision", "tool"], 0.15, 0.6, 128000, "auto"),
    m("prov_openai", "OpenAI", "o1", "o1", [], ["text", "reasoning", "long-context"], 15, 60, 200000, "auto"),
    m("prov_anthropic", "Anthropic", "claude-3-5-sonnet", "Claude 3.5 Sonnet", ["claude-3.5-sonnet"], ["text", "vision", "tool", "long-context"], 3, 15, 200000, "auto"),
    m("prov_anthropic", "Anthropic", "claude-3-5-haiku", "Claude 3.5 Haiku", [], ["text", "tool"], 0.8, 4, 200000, "auto"),
    m("prov_deepseek", "DeepSeek", "deepseek-chat", "DeepSeek Chat", [], ["text", "tool", "long-context"], 0.27, 1.1, 64000, "auto"),
    m("prov_deepseek", "DeepSeek", "deepseek-reasoner", "DeepSeek R1", [], ["text", "reasoning"], 0.55, 2.19, 64000, "manual"),
    m("prov_ollama", "Local Ollama", "llama3.1:8b", "Llama 3.1 8B", [], ["text", "tool"], 0, 0, 128000, "manual"),
  ];

  const usageEvents = makeUsage(providers, modelCatalog);
  const totals = computeTotals(usageEvents);

  const proxyTokens = [
    {
      id: "tok_app", name: "mobile-app", tokenMasked: "proxy_…f3A9c2", enabled: true,
      allowedProviderIds: ["prov_openai", "prov_anthropic"], allowStreaming: true, requestsPerMinute: 60, requestsPerDay: 5000,
      allowedModels: [
        { publicModel: "gpt-4o", providerId: "prov_openai", apiKeyId: "key_oa1", upstreamModel: "gpt-4o" },
        { publicModel: "fast", providerId: "prov_openai", apiKeyId: "key_oa1", upstreamModel: "gpt-4o-mini" },
        { publicModel: "claude", providerId: "prov_anthropic", apiKeyId: "key_an1", upstreamModel: "claude-3-5-sonnet" },
      ],
      createdAt: iso(Date.now() - 20 * DAY), updatedAt: iso(Date.now() - 3 * HOUR), lastUsedAt: iso(Date.now() - 12 * 60e3),
    },
    {
      id: "tok_cli", name: "internal-cli", tokenMasked: "proxy_…b71Ke0", enabled: false,
      allowedProviderIds: ["prov_deepseek"], allowStreaming: false, requestsPerMinute: 20, requestsPerDay: 1000,
      allowedModels: [{ publicModel: "reasoner", providerId: "prov_deepseek", upstreamModel: "deepseek-reasoner" }],
      createdAt: iso(Date.now() - 7 * DAY), updatedAt: iso(Date.now() - 7 * DAY),
    },
  ];

  const accountPools = [{
    id: "pool_cpa", name: "CPA Gemini Pool", kind: "cpa", baseUrl: "http://127.0.0.1:8317",
    managementUrl: "http://127.0.0.1:8317/admin", authsDirectory: "C:/cpa/auths", providerId: "prov_deepseek",
    status: "available", latencyMs: 130, lastCheckedAt: iso(Date.now() - 90e3), rootStatus: 200, modelsStatus: 200,
    modelNames: ["gemini-2.0-flash", "gemini-1.5-pro", "gemini-1.5-flash"], hasApiKey: true, apiKeyMasked: "sk-…cpa1",
    hasManagementSecret: true, managementSecretMasked: "•••mgmt", notes: "Pooled Gemini accounts via CLIProxyAPI",
    createdAt: iso(Date.now() - 11 * DAY), updatedAt: iso(Date.now() - HOUR),
  }];

  const localServices = [
    { id: "svc_ollama", name: "Ollama", baseUrl: "http://127.0.0.1:11434", type: "openai-compatible", status: "available", latencyMs: 42, lastCheckedAt: iso(Date.now() - 25e3), publicAccessUrl: "https://demo-vault.trycloudflare.com/api/proxy/local/svc_ollama/v1", hasApiKey: false, createdAt: iso(Date.now() - 6 * DAY), updatedAt: iso(Date.now() - 6 * DAY) },
    { id: "svc_lmstudio", name: "LM Studio", baseUrl: "http://127.0.0.1:1234", type: "openai-compatible", status: "unavailable", latencyMs: 0, lastCheckedAt: iso(Date.now() - 5 * 60e3), hasApiKey: false, createdAt: iso(Date.now() - 4 * DAY), updatedAt: iso(Date.now() - 4 * DAY) },
  ];

  const balanceSnapshots = [
    bal("prov_openai", "OpenAI", 64.21, 35.79, 100, "USD", "prod-main", 0),
    bal("prov_openai", "OpenAI", 71.40, 28.60, 100, "USD", "prod-main", 1 * DAY),
    bal("prov_anthropic", "Anthropic", undefined, 18.44, undefined, "USD", "claude-prod", 0, true),
    bal("prov_deepseek", "DeepSeek", 7.83, 12.17, 20, "USD", "ds-key", 0),
    bal("prov_deepseek", "DeepSeek", 9.10, 10.90, 20, "USD", "ds-key", 2 * DAY),
  ];

  return {
    initialized: true, unlocked: true, proxyPort: 3210,
    providers, proxyTokens, accountPools, modelCatalog,
    usageEvents, usageRollups: [], balanceSnapshots, totals, localServices,
    cloudflared: { running: true, phase: "running", publicUrl: "https://demo-vault.trycloudflare.com", startedAt: iso(Date.now() - 3 * HOUR) },
  };
}

function m(providerId, providerName, modelId, displayName, aliases, capabilities, inputPrice, outputPrice, contextWindow, source) {
  return { id: "mdl_" + modelId.replace(/[^a-z0-9]/gi, ""), providerId, providerName, modelId, displayName, aliases, canonicalModelId: displayName, capabilities, inputPrice, outputPrice, contextWindow, source, lastSeenAt: iso(Date.now() - between(0, 5) * DAY), createdAt: iso(Date.now() - 20 * DAY), updatedAt: iso(Date.now() - DAY) };
}

function bal(providerId, providerName, balance, spent, granted, currency, tokenName, ago, unlimited) {
  return { id: "bal_" + providerId + ago, providerId, providerName, checkedAt: iso(Date.now() - ago - 60e3), ok: true, balance, spent, granted, currency, tokenName, unlimitedQuota: !!unlimited };
}

function makeUsage(providers, models) {
  const events = []; const N = 260;
  const gateways = ["openai", "anthropic", "auto", "provider", "public-proxy", "local-service"];
  const errs = [null, null, null, null, null, null, null, null, "429 rate_limit_exceeded", "401 invalid_api_key", "upstream timeout", "503 service unavailable"];
  for (let i = 0; i < N; i++) {
    const md = pick(models); const prov = providers.find((p) => p.id === md.providerId);
    const key = pick(prov.apiKeys);
    const err = pick(errs); const ok = !err;
    const inTok = Math.floor(between(120, 4200)); const outTok = Math.floor(between(60, 2600));
    const startedAt = Date.now() - rnd() * 30 * DAY - (rnd() < 0.4 ? 0 : 0);
    const cost = md.inputPrice ? (inTok * md.inputPrice + outTok * md.outputPrice) / 1e6 : 0;
    events.push({
      id: "ev_" + i, providerId: prov.id, providerName: prov.name, baseUrl: prov.baseUrl,
      gatewayType: pick(gateways), gatewayBaseUrl: prov.baseUrl, apiKeyId: key?.id, apiKeyName: key?.name, apiKeyMasked: key?.keyMasked,
      protocol: prov.protocol, path: "/v1/chat/completions", method: "POST", model: md.modelId, modelId: md.modelId,
      status: ok ? 200 : +(err.split(" ")[0]) || 500, ok, startedAt: iso(startedAt), latencyMs: ok ? Math.round(between(prov.latencyMs * 0.5, prov.latencyMs * 2.2)) : Math.round(between(20, 400)),
      inputTokens: ok ? inTok : undefined, outputTokens: ok ? outTok : undefined, cachedInputTokens: ok ? Math.floor(inTok * between(0, 0.4)) : 0, totalTokens: ok ? inTok + outTok : undefined,
      realCost: ok ? +cost.toFixed(6) : undefined, currency: "USD", error: err || undefined, errorMessage: err || undefined,
      proxyTokenId: rnd() < 0.5 ? "tok_app" : undefined, proxyTokenName: rnd() < 0.5 ? "mobile-app" : undefined,
      endpoint: "POST /v1/chat/completions",
    });
  }
  return events.sort((a, b) => new Date(b.startedAt) - new Date(a.startedAt));
}

function computeTotals(events) {
  const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
  let okCalls = 0, failedCalls = 0, callsToday = 0, realCostTotal = 0, realCostCount = 0;
  for (const e of events) {
    e.ok ? okCalls++ : failedCalls++;
    if (new Date(e.startedAt) >= todayStart) callsToday++;
    if (e.realCost != null) { realCostTotal += e.realCost; realCostCount++; }
  }
  return { totalCalls: events.length, callsToday, okCalls, failedCalls, realCostTotal: +realCostTotal.toFixed(4), realCostCount };
}
