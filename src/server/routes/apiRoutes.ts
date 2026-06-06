import type { IncomingMessage, ServerResponse } from "node:http";
import type { AccountPoolInput, AddKeyInput, ApiKeyInput, AppState, CloudflaredApiResponse, CloudflaredConfig, LocalService, LocalServiceProtocol, ProviderInput, ProviderModelInput, ProxyTokenInput } from "../../shared/types";
import { syncBalance } from "../../main/balance";
import { CloudflaredManager } from "../../main/cloudflared";
import type { AccountPoolForConnector } from "../../main/store";
import { testCpaConnection } from "../../main/cpaConnector";
import { notFound, serviceUnavailable } from "../../main/errors";
import type { VaultStore } from "../../main/store";
import { DEFAULT_PORT } from "../config/serverConfig";
import { enforceAuthLimiter, recordAuthFailure } from "../middlewares/authLimiter";
import { AdminSessionManager, extractAdminToken, requireAdminSession } from "../middlewares/adminSession";
import { readJsonBody } from "../utils/requestBody";
import { sendJson } from "../utils/responses";
import { writeAccountPoolAuthFile } from "../services/accountPoolAuthService";
import { syncProviderModelCatalog } from "../services/modelCatalogService";
import { testUpstreamUrl } from "../services/upstreamProbeService";
import { getLocalToolUsage } from "../../main/localUsage/index.js";
import { publicLockedAppState } from "../../shared/appState";

export interface ApiRouteContext {
  store: VaultStore;
  cloudflared?: CloudflaredManager;
  adminSessions?: AdminSessionManager;
}

const API_ROUTES = {
  proxyToken: /^\/api\/proxy-tokens\/([^/]+)$/,
  proxyTokenSecret: /^\/api\/proxy-tokens\/([^/]+)\/secret$/,
  proxyTokenRegenerate: /^\/api\/proxy-tokens\/([^/]+)\/regenerate$/,
  providerKeys: /^\/api\/providers\/([^/]+)\/keys$/,
  providerKey: /^\/api\/providers\/([^/]+)\/keys\/([^/]+)$/,
  providerKeySecret: /^\/api\/providers\/([^/]+)\/keys\/([^/]+)\/secret$/,
  providerKeyProxyUrl: /^\/api\/providers\/([^/]+)\/keys\/([^/]+)\/proxy-url$/,
  provider: /^\/api\/providers\/([^/]+)$/,
  providerSecret: /^\/api\/providers\/([^/]+)\/secret$/,
  providerProxyUrl: /^\/api\/providers\/([^/]+)\/proxy-url$/,
  providerTestBalance: /^\/api\/providers\/([^/]+)\/test-balance$/,
  modelCatalogSyncProvider: /^\/api\/model-catalog\/sync-provider\/([^/]+)$/,
  modelCatalogItem: /^\/api\/model-catalog\/([^/]+)$/,
  accountPool: /^\/api\/account-pools\/([^/]+)$/,
  accountPoolCreateProvider: /^\/api\/account-pools\/([^/]+)\/create-provider$/,
  accountPoolTest: /^\/api\/account-pools\/([^/]+)\/test$/,
  accountPoolSyncModels: /^\/api\/account-pools\/([^/]+)\/sync-models$/,
  accountPoolImportModels: /^\/api\/account-pools\/([^/]+)\/import-models-to-proxy-token$/,
  accountPoolUploadAuth: /^\/api\/account-pools\/([^/]+)\/upload-auth$/,
  localService: /^\/api\/local-services\/([^/]+)$/,
  localServiceTest: /^\/api\/local-services\/([^/]+)\/test$/
};

export async function handleApi(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  { store, cloudflared, adminSessions }: ApiRouteContext
) {
  const method = req.method?.toUpperCase() ?? "GET";
  const proxyPort = Number(url.port || DEFAULT_PORT);
  const getState = () => store.getState(proxyPort, cloudflared?.getStatus());

  if (method === "GET" && url.pathname === "/api/state") {
    if (adminSessions?.validate(extractAdminToken(req))) {
      sendJson(res, 200, getState());
      return;
    }
    sendJson(res, 200, getPublicState(store, proxyPort));
    return;
  }

  if (method === "GET" && url.pathname === "/api/local-usage") {
    if (!adminSessions?.validate(extractAdminToken(req))) {
      sendJson(res, 401, { error: "unauthorized" });
      return;
    }
    const days = Math.min(365, Math.max(1, Number(url.searchParams.get("days")) || 7));
    const { buckets, sessions, warnings } = await getLocalToolUsage({ days });
    const tools = [...new Set([...buckets.map((b) => b.tool), ...sessions.map((s) => s.tool)])].sort();
    sendJson(res, 200, { buckets, sessions, tools, warnings, generatedAt: new Date().toISOString() });
    return;
  }

  if (method === "POST" && url.pathname === "/api/vault/setup") {
    enforceAuthLimiter(req);
    try {
      const body = await readJsonBody<{ password: string }>(req);
      store.setup(body.password);
      sendJson(res, 200, withAdminToken(getState(), adminSessions));
    } catch (error) {
      recordAuthFailure(req);
      throw error;
    }
    return;
  }

  if (method === "POST" && url.pathname === "/api/vault/unlock") {
    enforceAuthLimiter(req);
    try {
      const body = await readJsonBody<{ password: string }>(req);
      store.unlock(body.password);
      sendJson(res, 200, withAdminToken(getState(), adminSessions));
    } catch (error) {
      recordAuthFailure(req);
      throw error;
    }
    return;
  }

  const adminToken = requireAdminSession(req, adminSessions);

  if (method === "POST" && url.pathname === "/api/vault/lock") {
    store.lock();
    adminSessions?.revoke(adminToken);
    sendJson(res, 200, getState());
    return;
  }

  if (method === "POST" && url.pathname === "/api/proxy-tokens") {
    const body = await readJsonBody<ProxyTokenInput>(req);
    const result = store.createProxyToken(body);
    sendJson(res, 200, { secret: result.secret, token: result.token, state: getState() });
    return;
  }

  const proxyTokenMatch = url.pathname.match(API_ROUTES.proxyToken);
  if (proxyTokenMatch && method === "POST") {
    const body = await readJsonBody<ProxyTokenInput>(req);
    store.updateProxyToken(decodeURIComponent(proxyTokenMatch[1]), body);
    sendJson(res, 200, getState());
    return;
  }

  if (proxyTokenMatch && method === "DELETE") {
    store.deleteProxyToken(decodeURIComponent(proxyTokenMatch[1]));
    sendJson(res, 200, getState());
    return;
  }

  const proxyTokenSecretMatch = url.pathname.match(API_ROUTES.proxyTokenSecret);
  if (proxyTokenSecretMatch && method === "GET") {
    const secret = store.getProxyTokenPlaintext(decodeURIComponent(proxyTokenSecretMatch[1]));
    sendJson(res, 200, { secret });
    return;
  }

  if (proxyTokenSecretMatch && method === "POST") {
    const body = await readJsonBody<{ secret: string }>(req);
    store.setProxyTokenPlaintext(decodeURIComponent(proxyTokenSecretMatch[1]), body.secret);
    sendJson(res, 200, getState());
    return;
  }

  const proxyTokenRegen = url.pathname.match(API_ROUTES.proxyTokenRegenerate);
  if (proxyTokenRegen && method === "POST") {
    const result = store.regenerateProxyToken(decodeURIComponent(proxyTokenRegen[1]));
    sendJson(res, 200, { secret: result.secret, token: result.token, state: getState() });
    return;
  }

  if (method === "POST" && url.pathname === "/api/providers") {
    const body = await readJsonBody<ProviderInput & { apiKey?: string; queryKey?: string; keyName?: string }>(req);
    if (body.apiKey?.trim()) {
      store.addKeyWithAutoMerge({
        providerId: body.id,
        providerName: body.name,
        protocol: body.protocol,
        baseUrl: body.baseUrl,
        currency: body.currency,
        balanceConfig: body.balanceConfig,
        keyName: body.keyName || "default",
        apiKey: body.apiKey,
        queryKey: body.queryKey
      });
    } else {
      store.upsertProvider(body);
    }
    sendJson(res, 200, getState());
    return;
  }

  if (method === "POST" && url.pathname === "/api/providers/add-key") {
    const body = await readJsonBody<AddKeyInput>(req);
    store.addKeyWithAutoMerge(body);
    sendJson(res, 200, getState());
    return;
  }

  const keyAddMatch = url.pathname.match(API_ROUTES.providerKeys);
  if (method === "POST" && keyAddMatch) {
    const body = await readJsonBody<ApiKeyInput>(req);
    store.addApiKey(decodeURIComponent(keyAddMatch[1]), body);
    sendJson(res, 200, getState());
    return;
  }

  const keyDeleteMatch = url.pathname.match(API_ROUTES.providerKey);
  if (method === "DELETE" && keyDeleteMatch) {
    store.deleteApiKey(decodeURIComponent(keyDeleteMatch[1]), decodeURIComponent(keyDeleteMatch[2]));
    sendJson(res, 200, getState());
    return;
  }

  const keySecretMatch = url.pathname.match(API_ROUTES.providerKeySecret);
  if (method === "GET" && keySecretMatch) {
    const kind = url.searchParams.get("kind") === "query" ? "query" : "api";
    const secret = store.getApiKeyPlaintext(
      decodeURIComponent(keySecretMatch[1]),
      decodeURIComponent(keySecretMatch[2]),
      kind
    );
    sendJson(res, 200, { secret });
    return;
  }

  const keyProxyUrlMatch = url.pathname.match(API_ROUTES.providerKeyProxyUrl);
  if (method === "GET" && keyProxyUrlMatch) {
    if (!proxyPort) throw serviceUnavailable("Proxy is not running", "proxy_offline");
    const providerId = decodeURIComponent(keyProxyUrlMatch[1]);
    const keyId = decodeURIComponent(keyProxyUrlMatch[2]);
    const state = getState();
    const provider = state.providers.find((item) => item.id === providerId);
    const apiKey = provider?.apiKeys.find((item) => item.id === keyId);
    if (!provider || !apiKey || !provider.proxyBaseUrl) throw notFound("API key not found", "api_key_not_found");
    sendJson(res, 200, { url: provider.proxyBaseUrl });
    return;
  }

  const providerDelete = url.pathname.match(API_ROUTES.provider);
  if (method === "DELETE" && providerDelete) {
    store.deleteProvider(decodeURIComponent(providerDelete[1]));
    sendJson(res, 200, getState());
    return;
  }

  const secretMatch = url.pathname.match(API_ROUTES.providerSecret);
  if (method === "GET" && secretMatch) {
    const state = getState();
    const providerSafe = state.providers.find((item) => item.id === decodeURIComponent(secretMatch[1]));
    const firstKey = providerSafe?.apiKeys[0];
    if (!firstKey) throw notFound("API key not found", "api_key_not_found");
    const kind = url.searchParams.get("kind") === "query" ? "query" : "api";
    const secret = store.getApiKeyPlaintext(providerSafe!.id, firstKey.id, kind);
    sendJson(res, 200, { secret });
    return;
  }

  const proxyUrlMatch = url.pathname.match(API_ROUTES.providerProxyUrl);
  if (method === "GET" && proxyUrlMatch) {
    if (!proxyPort) throw serviceUnavailable("Proxy is not running", "proxy_offline");
    const state = getState();
    const provider = state.providers.find((item) => item.id === decodeURIComponent(proxyUrlMatch[1]));
    if (!provider?.proxyBaseUrl) throw notFound("Provider not found", "provider_not_found");
    sendJson(res, 200, { url: provider.proxyBaseUrl });
    return;
  }

  const balanceMatch = url.pathname.match(API_ROUTES.providerTestBalance);
  if (method === "POST" && balanceMatch) {
    const provider = store.getBalanceProvider(decodeURIComponent(balanceMatch[1]));
    const result = await syncBalance(provider);
    store.appendBalance(result.snapshot);
    sendJson(res, 200, { result, state: getState() });
    return;
  }

  if (method === "POST" && url.pathname === "/api/test-url") {
    const body = await readJsonBody<{ baseUrl?: string; protocol?: string; providerId?: string; isLocal?: boolean; type?: LocalServiceProtocol; apiKey?: string }>(req);
    if (body.providerId && !body.apiKey) {
      body.apiKey = store.getProviderFirstApiKeyPlaintext(body.providerId);
    }
    const result = await testUpstreamUrl(store, body);
    if (body.providerId) {
      store.updateProviderConnectionStatus(body.providerId, result.ok ? "available" : "unavailable", result.latencyMs, result.checkedAt);
    }
    sendJson(res, 200, result);
    return;
  }

  // Model Catalog
  if (method === "GET" && url.pathname === "/api/model-catalog") {
    sendJson(res, 200, store.getModelCatalog());
    return;
  }

  if (method === "POST" && url.pathname === "/api/model-catalog/manual") {
    const body = await readJsonBody<ProviderModelInput>(req);
    const model = store.upsertProviderModel({ ...body, source: body.source ?? "manual" });
    sendJson(res, 200, { model, state: getState() });
    return;
  }

  const modelCatalogSync = url.pathname.match(API_ROUTES.modelCatalogSyncProvider);
  if (method === "POST" && modelCatalogSync) {
    const providerId = decodeURIComponent(modelCatalogSync[1]);
    const result = await syncProviderModelCatalog(store, providerId);
    sendJson(res, 200, { result, state: getState() });
    return;
  }

  const modelCatalogItem = url.pathname.match(API_ROUTES.modelCatalogItem);
  if (modelCatalogItem && method === "POST") {
    const body = await readJsonBody<ProviderModelInput>(req);
    const model = store.upsertProviderModel({ ...body, id: decodeURIComponent(modelCatalogItem[1]) });
    sendJson(res, 200, { model, state: getState() });
    return;
  }

  if (modelCatalogItem && method === "DELETE") {
    store.deleteProviderModel(decodeURIComponent(modelCatalogItem[1]));
    sendJson(res, 200, getState());
    return;
  }

  // Account Pools
  if (method === "GET" && url.pathname === "/api/account-pools") {
    sendJson(res, 200, store.getAccountPools());
    return;
  }

  if (method === "POST" && url.pathname === "/api/account-pools") {
    const body = await readJsonBody<AccountPoolInput & { createProvider?: boolean }>(req);
    const pool = store.upsertAccountPool(body);
    if (body.createProvider) {
      store.ensureAccountPoolProvider(pool.id);
    }
    sendJson(res, 200, { pool: store.getAccountPools().find((item) => item.id === pool.id), state: getState() });
    return;
  }

  const accountPoolDelete = url.pathname.match(API_ROUTES.accountPool);
  if (method === "DELETE" && accountPoolDelete) {
    store.deleteAccountPool(decodeURIComponent(accountPoolDelete[1]));
    sendJson(res, 200, getState());
    return;
  }

  const accountPoolCreateProvider = url.pathname.match(API_ROUTES.accountPoolCreateProvider);
  if (method === "POST" && accountPoolCreateProvider) {
    const result = store.ensureAccountPoolProvider(decodeURIComponent(accountPoolCreateProvider[1]));
    sendJson(res, 200, { ...result, state: getState() });
    return;
  }

  const accountPoolTest = url.pathname.match(API_ROUTES.accountPoolTest);
  if (method === "POST" && accountPoolTest) {
    const poolId = decodeURIComponent(accountPoolTest[1]);
    const pool = store.getAccountPoolForConnector(poolId);
    const result = await testAccountPoolConnection(pool);
    store.updateAccountPoolSyncResult(poolId, result);
    sendJson(res, 200, { result, state: getState() });
    return;
  }

  const accountPoolSync = url.pathname.match(API_ROUTES.accountPoolSyncModels);
  if (method === "POST" && accountPoolSync) {
    const poolId = decodeURIComponent(accountPoolSync[1]);
    const pool = store.getAccountPoolForConnector(poolId);
    const result = await testAccountPoolConnection(pool);
    store.updateAccountPoolSyncResult(poolId, result);
    sendJson(res, 200, { result, state: getState() });
    return;
  }

  const accountPoolImport = url.pathname.match(API_ROUTES.accountPoolImportModels);
  if (method === "POST" && accountPoolImport) {
    const body = await readJsonBody<{ proxyTokenId: string; modelNames?: string[] }>(req);
    const result = store.importAccountPoolModelsToProxyToken(decodeURIComponent(accountPoolImport[1]), body);
    sendJson(res, 200, { result, state: getState() });
    return;
  }

  const accountPoolUploadAuth = url.pathname.match(API_ROUTES.accountPoolUploadAuth);
  if (method === "POST" && accountPoolUploadAuth) {
    const pool = store.getAccountPoolForConnector(decodeURIComponent(accountPoolUploadAuth[1]));
    const body = await readJsonBody<{ fileName: string; content: string }>(req);
    const result = writeAccountPoolAuthFile(pool.authsDirectory, body.fileName, body.content);
    sendJson(res, 200, { result, state: getState() });
    return;
  }

  // ─── Local Services ───
  if (method === "GET" && url.pathname === "/api/local-services") {
    sendJson(res, 200, store.getLocalServices());
    return;
  }

  if (method === "POST" && url.pathname === "/api/local-services") {
    const body = await readJsonBody<Partial<LocalService> & { name: string; baseUrl: string; apiKey?: string }>(req);
    const service = store.upsertLocalService(body);
    sendJson(res, 200, { service, state: getState() });
    return;
  }

  const localServiceDelete = url.pathname.match(API_ROUTES.localService);
  if (method === "DELETE" && localServiceDelete) {
    store.deleteLocalService(decodeURIComponent(localServiceDelete[1]));
    sendJson(res, 200, getState());
    return;
  }

  const localServiceTest = url.pathname.match(API_ROUTES.localServiceTest);
  if (method === "POST" && localServiceTest) {
    const serviceId = decodeURIComponent(localServiceTest[1]);
    const service = store.getLocalService(serviceId);
    if (!service) throw notFound("Local service not found", "local_service_not_found");
    const result = await testUpstreamUrl(store, {
      baseUrl: service.baseUrl,
      protocol: service.type === "anthropic-compatible" ? "anthropic-compatible" : "openai-compatible",
      isLocal: true,
      type: service.type,
      apiKey: store.getLocalServiceApiKey(serviceId)
    });
    const serviceStatus: "available" | "unavailable" = result.ok ? "available" : "unavailable";
    store.updateLocalServiceStatus(serviceId, serviceStatus, result.latencyMs, result.checkedAt);
    sendJson(res, 200, { ...result, serviceStatus });
    return;
  }

  // ─── Cloudflared ───
  if (method === "GET" && url.pathname === "/api/cloudflared/status") {
    const status = cloudflared?.getStatus() ?? { running: false, phase: "idle" };
    sendJson(res, 200, { ok: true, code: "OK", status, config: store.getCloudflaredConfig() } satisfies CloudflaredApiResponse);
    return;
  }

  if (method === "POST" && url.pathname === "/api/cloudflared/start") {
    if (!cloudflared) {
      sendJson(res, 200, { ok: false, code: "MANAGER_UNAVAILABLE", message: "Cloudflared manager not available", status: { running: false, phase: "idle" } } satisfies CloudflaredApiResponse);
      return;
    }
    const body = await readJsonBody<{ config?: CloudflaredConfig }>(req).catch(() => ({ config: undefined as CloudflaredConfig | undefined }));
    const result = await cloudflared.start(proxyPort, body.config);
    if (result.ok && result.status.publicUrl) {
      store.setCloudflaredPublicUrl(result.status.publicUrl);
    }
    if (body.config) store.setCloudflaredConfig(body.config);
    sendJson(res, 200, { ...result, config: body.config ?? store.getCloudflaredConfig() });
    return;
  }

  if (method === "GET" && url.pathname === "/api/cloudflared/logs") {
    const limit = Number(url.searchParams.get("limit") || "200");
    const logs = cloudflared?.getLogs(limit) ?? [];
    sendJson(res, 200, { ok: true, code: "OK", status: cloudflared?.getStatus() ?? { running: false, phase: "idle" }, config: store.getCloudflaredConfig(), logs } satisfies CloudflaredApiResponse);
    return;
  }

  if (method === "POST" && url.pathname === "/api/cloudflared/stop") {
    const result = cloudflared ? await cloudflared.stop() : { ok: false, code: "MANAGER_UNAVAILABLE", message: "Cloudflared manager not available", status: { running: false, phase: "idle" } };
    store.setCloudflaredPublicUrl(undefined);
    sendJson(res, 200, result);
    return;
  }

  throw notFound("API route not found", "api_route_not_found");
}

async function testAccountPoolConnection(pool: AccountPoolForConnector) {
  return testCpaConnection({ baseUrl: pool.baseUrl, apiKey: pool.apiKey });
}

function withAdminToken(state: AppState, sessions?: AdminSessionManager): AppState & { adminToken?: string } {
  return {
    ...state,
    adminToken: sessions?.create()
  };
}

function getPublicState(store: VaultStore, proxyPort?: number): AppState {
  return publicLockedAppState(store.status.initialized, proxyPort);
}
