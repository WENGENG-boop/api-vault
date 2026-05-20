import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createReadStream, existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { basename, join, normalize, resolve, sep } from "node:path";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import type { AccountPoolInput, AddKeyInput, ApiKeyInput, ApiProtocol, LocalService, LocalServiceProtocol, ProviderInput, ProviderModelInput, ProviderModelSyncResult, ProxyTokenInput, UsageEvent } from "../shared/types";
import { syncBalance } from "../main/balance";
import { CloudflaredManager } from "../main/cloudflared";
import { testCpaConnection } from "../main/cpaConnector";
import { extractModelNamesFromJson } from "../main/modelList";
import {
  JSON_BODY_LIMIT_BYTES,
  readRequestBody,
  shouldSendBody,
  toArrayBuffer,
  toResponseHeaders
} from "../main/httpUtils";
import { buildUpstreamUrl, normalizeProxySuffixPath, ProxyServer } from "../main/proxy";
import { VaultStore } from "../main/store";
import { extractRequestModel, extractUsageFromResponse } from "../main/usage";
import { AppError, badRequest, notFound, serviceUnavailable, toAppError } from "../main/errors";

const DEFAULT_PORT = Number(process.env.PORT || 3210);
const LISTEN_HOST = process.env.BIND_HOST || process.env.HOST || (process.env.API_VAULT_DOCKER === "1" ? "0.0.0.0" : "127.0.0.1");
const DIST_DIR = resolve(process.cwd(), "dist");
const DATA_PATH = resolve(process.cwd(), ".api-vault", "vault.json");

const lastSyncTimes = new Map<string, number>();
let authFailures: SimpleLimiter;

function startAutoSync(store: VaultStore) {
  setInterval(() => {
    if (!store.status.unlocked) return;
    const state = store.getState();
    for (const provider of state.providers) {
      const interval = provider.balanceConfig.autoSyncIntervalMs;
      if (!provider.balanceConfig.enabled || !interval || interval <= 0) continue;
      const lastSync = lastSyncTimes.get(provider.id) ?? 0;
      if (Date.now() - lastSync < interval) continue;
      lastSyncTimes.set(provider.id, Date.now());
      const full = store.getBalanceProvider(provider.id);
      syncBalance(full).then((result) => {
        store.appendBalance(result.snapshot);
      }).catch((error) => {
        console.warn(`Auto-sync balance failed for ${provider.name} (${provider.id}):`, (error as Error).message ?? error);
      });
    }
  }, 60_000);
}

export interface LocalServerContext {
  store: VaultStore;
  proxy: ProxyServer;
  cloudflared?: CloudflaredManager;
}

export function createApiServer(context: LocalServerContext) {
  return createServer((req, res) => {
    handleRequest(req, res, context).catch((error) => {
      sendError(res, error);
    });
  });
}

async function handleRequest(req: IncomingMessage, res: ServerResponse, context: LocalServerContext) {
  const origin = req.headers.origin;
  if (origin && isAllowedOrigin(origin, req.headers.host)) {
    res.setHeader("access-control-allow-origin", origin);
    res.setHeader("access-control-allow-methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
    res.setHeader("access-control-allow-headers", "content-type, x-api-vault-admin, authorization");
  }

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "127.0.0.1"}`);

  const apiLocalProxyMatch = url.pathname.match(/^\/api\/proxy\/local\/([^/]+)(\/.*)?$/);
  if (apiLocalProxyMatch) {
    const serviceId = decodeURIComponent(apiLocalProxyMatch[1]);
    const suffixPath = apiLocalProxyMatch[2] ?? "/";
    await handleLocalServiceProxy(context.store, req, res, serviceId, suffixPath, url.search);
    return;
  }

  if (url.pathname.startsWith("/api/")) {
    await handleApi(req, res, url, context);
    return;
  }

  if (url.pathname.startsWith("/proxy/")) {
    const localProxyMatch = url.pathname.match(/^\/proxy\/local\/([^/]+)(\/.*)?$/);
    if (localProxyMatch) {
      const serviceId = decodeURIComponent(localProxyMatch[1]);
      const suffixPath = localProxyMatch[2] ?? "/";
      await handleLocalServiceProxy(context.store, req, res, serviceId, suffixPath, url.search);
      return;
    }
    await context.proxy.handleRequest(req, res);
    return;
  }

  serveStatic(url.pathname, res);
}

async function handleApi(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  { store, cloudflared }: LocalServerContext
) {
  const method = req.method?.toUpperCase() ?? "GET";
  const proxyPort = Number(url.port || DEFAULT_PORT);
  const getState = () => store.getState(proxyPort, cloudflared?.getStatus());

  if (method === "GET" && url.pathname === "/api/state") {
    sendJson(res, 200, getState());
    return;
  }

  if (method === "POST" && url.pathname === "/api/vault/setup") {
    enforceAuthLimiter(req);
    try {
      const body = await readJsonBody<{ password: string }>(req);
      store.setup(body.password);
      sendJson(res, 200, getState());
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
      sendJson(res, 200, getState());
    } catch (error) {
      recordAuthFailure(req);
      throw error;
    }
    return;
  }

  if (method === "POST" && url.pathname === "/api/vault/lock") {
    store.lock();
    sendJson(res, 200, getState());
    return;
  }

  if (method === "POST" && url.pathname === "/api/proxy-tokens") {
    const body = await readJsonBody<ProxyTokenInput>(req);
    const result = store.createProxyToken(body);
    sendJson(res, 200, { secret: result.secret, token: result.token, state: getState() });
    return;
  }

  const proxyTokenMatch = url.pathname.match(/^\/api\/proxy-tokens\/([^/]+)$/);
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

  const proxyTokenSecretMatch = url.pathname.match(/^\/api\/proxy-tokens\/([^/]+)\/secret$/);
  if (proxyTokenSecretMatch && method === "GET") {
    const secret = store.getProxyTokenPlaintext(decodeURIComponent(proxyTokenSecretMatch[1]));
    sendJson(res, 200, { secret });
    return;
  }

  const proxyTokenSecretSetMatch = url.pathname.match(/^\/api\/proxy-tokens\/([^/]+)\/secret$/);
  if (proxyTokenSecretSetMatch && method === "POST") {
    const body = await readJsonBody<{ secret: string }>(req);
    store.setProxyTokenPlaintext(decodeURIComponent(proxyTokenSecretSetMatch[1]), body.secret);
    sendJson(res, 200, getState());
    return;
  }

  const proxyTokenRegen = url.pathname.match(/^\/api\/proxy-tokens\/([^/]+)\/regenerate$/);
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

  const keyAddMatch = url.pathname.match(/^\/api\/providers\/([^/]+)\/keys$/);
  if (method === "POST" && keyAddMatch) {
    const body = await readJsonBody<ApiKeyInput>(req);
    store.addApiKey(decodeURIComponent(keyAddMatch[1]), body);
    sendJson(res, 200, getState());
    return;
  }

  const keyDeleteMatch = url.pathname.match(/^\/api\/providers\/([^/]+)\/keys\/([^/]+)$/);
  if (method === "DELETE" && keyDeleteMatch) {
    store.deleteApiKey(decodeURIComponent(keyDeleteMatch[1]), decodeURIComponent(keyDeleteMatch[2]));
    sendJson(res, 200, getState());
    return;
  }

  const keySecretMatch = url.pathname.match(/^\/api\/providers\/([^/]+)\/keys\/([^/]+)\/secret$/);
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

  const keyProxyUrlMatch = url.pathname.match(/^\/api\/providers\/([^/]+)\/keys\/([^/]+)\/proxy-url$/);
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

  const providerDelete = url.pathname.match(/^\/api\/providers\/([^/]+)$/);
  if (method === "DELETE" && providerDelete) {
    store.deleteProvider(decodeURIComponent(providerDelete[1]));
    sendJson(res, 200, getState());
    return;
  }

  const secretMatch = url.pathname.match(/^\/api\/providers\/([^/]+)\/secret$/);
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

  const proxyUrlMatch = url.pathname.match(/^\/api\/providers\/([^/]+)\/proxy-url$/);
  if (method === "GET" && proxyUrlMatch) {
    if (!proxyPort) throw serviceUnavailable("Proxy is not running", "proxy_offline");
    const state = getState();
    const provider = state.providers.find((item) => item.id === decodeURIComponent(proxyUrlMatch[1]));
    if (!provider?.proxyBaseUrl) throw notFound("Provider not found", "provider_not_found");
    sendJson(res, 200, { url: provider.proxyBaseUrl });
    return;
  }

  const balanceMatch = url.pathname.match(/^\/api\/providers\/([^/]+)\/test-balance$/);
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

  const modelCatalogSync = url.pathname.match(/^\/api\/model-catalog\/sync-provider\/([^/]+)$/);
  if (method === "POST" && modelCatalogSync) {
    const providerId = decodeURIComponent(modelCatalogSync[1]);
    const result = await syncProviderModelCatalog(store, providerId);
    sendJson(res, 200, { result, state: getState() });
    return;
  }

  const modelCatalogItem = url.pathname.match(/^\/api\/model-catalog\/([^/]+)$/);
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

  const accountPoolDelete = url.pathname.match(/^\/api\/account-pools\/([^/]+)$/);
  if (method === "DELETE" && accountPoolDelete) {
    store.deleteAccountPool(decodeURIComponent(accountPoolDelete[1]));
    sendJson(res, 200, getState());
    return;
  }

  const accountPoolCreateProvider = url.pathname.match(/^\/api\/account-pools\/([^/]+)\/create-provider$/);
  if (method === "POST" && accountPoolCreateProvider) {
    const result = store.ensureAccountPoolProvider(decodeURIComponent(accountPoolCreateProvider[1]));
    sendJson(res, 200, { ...result, state: getState() });
    return;
  }

  const accountPoolTest = url.pathname.match(/^\/api\/account-pools\/([^/]+)\/test$/);
  if (method === "POST" && accountPoolTest) {
    const poolId = decodeURIComponent(accountPoolTest[1]);
    const pool = store.getAccountPoolForConnector(poolId);
    const result = await testCpaConnection({ baseUrl: pool.baseUrl, apiKey: pool.apiKey });
    store.updateAccountPoolSyncResult(poolId, result);
    sendJson(res, 200, { result, state: getState() });
    return;
  }

  const accountPoolSync = url.pathname.match(/^\/api\/account-pools\/([^/]+)\/sync-models$/);
  if (method === "POST" && accountPoolSync) {
    const poolId = decodeURIComponent(accountPoolSync[1]);
    const pool = store.getAccountPoolForConnector(poolId);
    const result = await testCpaConnection({ baseUrl: pool.baseUrl, apiKey: pool.apiKey });
    store.updateAccountPoolSyncResult(poolId, result);
    sendJson(res, 200, { result, state: getState() });
    return;
  }

  const accountPoolImport = url.pathname.match(/^\/api\/account-pools\/([^/]+)\/import-models-to-proxy-token$/);
  if (method === "POST" && accountPoolImport) {
    const body = await readJsonBody<{ proxyTokenId: string; modelNames?: string[] }>(req);
    const result = store.importAccountPoolModelsToProxyToken(decodeURIComponent(accountPoolImport[1]), body);
    sendJson(res, 200, { result, state: getState() });
    return;
  }

  const accountPoolUploadAuth = url.pathname.match(/^\/api\/account-pools\/([^/]+)\/upload-auth$/);
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

  const localServiceDelete = url.pathname.match(/^\/api\/local-services\/([^/]+)$/);
  if (method === "DELETE" && localServiceDelete) {
    store.deleteLocalService(decodeURIComponent(localServiceDelete[1]));
    sendJson(res, 200, getState());
    return;
  }

  const localServiceTest = url.pathname.match(/^\/api\/local-services\/([^/]+)\/test$/);
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
    sendJson(res, 200, cloudflared?.getStatus() ?? { running: false });
    return;
  }

  if (method === "POST" && url.pathname === "/api/cloudflared/start") {
    if (!cloudflared) {
      sendJson(res, 200, { running: false, error: "Cloudflared manager not available" });
      return;
    }
    const status = await cloudflared.start(proxyPort);
    if (status.publicUrl) {
      store.setCloudflaredPublicUrl(status.publicUrl);
    }
    sendJson(res, 200, status);
    return;
  }

  if (method === "POST" && url.pathname === "/api/cloudflared/stop") {
    cloudflared?.stop();
    store.setCloudflaredPublicUrl(undefined);
    sendJson(res, 200, { running: false });
    return;
  }

  throw notFound("API route not found", "api_route_not_found");
}

function writeAccountPoolAuthFile(authsDirectory: string | undefined, fileName: string | undefined, content: string | undefined) {
  const directory = authsDirectory?.trim();
  if (!directory) throw badRequest("Auths directory is not configured for this account pool", "auths_directory_required");
  const rawName = (fileName ?? "").trim();
  if (!rawName) throw badRequest("Auth file name is required", "auth_file_name_required");
  const safeName = basename(rawName).replace(/[^\w.-]/g, "_");
  if (!safeName.toLowerCase().endsWith(".json")) throw badRequest("Auth file must use a .json extension", "auth_file_extension_required");
  const text = typeof content === "string" ? content : "";
  if (!text.trim()) throw badRequest("Auth file content is required", "auth_file_content_required");

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw badRequest("Auth file content is not valid JSON", "auth_file_invalid_json");
  }

  const dir = resolve(directory);
  const target = resolve(dir, safeName);
  if (target !== dir && !target.startsWith(`${dir}${sep}`)) {
    throw badRequest("Auth file path is outside the configured auths directory", "auth_file_path_invalid");
  }

  try {
    mkdirSync(dir, { recursive: true });
    const normalized = `${JSON.stringify(parsed, null, 2)}\n`;
    writeFileSync(target, normalized, { encoding: "utf8" });
    return {
      fileName: safeName,
      sizeBytes: Buffer.byteLength(normalized),
      written: true
    };
  } catch (error) {
    throw new AppError(`Unable to write auth file: ${(error as Error).message}`, 500, "auth_file_write_failed");
  }
}

async function syncProviderModelCatalog(store: VaultStore, providerId: string): Promise<ProviderModelSyncResult> {
  const checkedAt = new Date().toISOString();
  const provider = store.getBalanceProvider(providerId);
  const attempts = modelCatalogProbeAttempts(provider.baseUrl, provider.protocol, provider.apiKey);
  let bestStatus: number | undefined;
  let bestError: string | undefined;

  for (const attempt of attempts) {
    try {
      const response = await fetch(attempt.url, {
        method: "GET",
        headers: attempt.headers,
        signal: AbortSignal.timeout(10_000)
      });
      if (!response.ok) {
        bestStatus = response.status;
        bestError = `HTTP ${response.status}`;
        continue;
      }
      const json = await response.json();
      const modelIds = extractModelNamesFromJson(json);
      if (modelIds.length === 0) {
        bestStatus = response.status;
        bestError = "Model list is empty";
        continue;
      }
      store.upsertSyncedProviderModels(provider.id, modelIds, checkedAt);
      return {
        providerId: provider.id,
        providerName: provider.name,
        ok: true,
        status: response.status,
        syncedCount: modelIds.length,
        modelIds,
        checkedAt
      };
    } catch (error) {
      bestError = (error as Error).name === "AbortError" || (error as Error).name === "TimeoutError"
        ? "Timeout (10s)"
        : String((error as Error).message ?? error);
    }
  }

  const knownModelIds = store.getKnownProviderModelIds(provider.id);
  if (knownModelIds.length > 0) {
    store.upsertSyncedProviderModels(provider.id, knownModelIds, checkedAt);
    return {
      providerId: provider.id,
      providerName: provider.name,
      ok: true,
      status: bestStatus,
      syncedCount: knownModelIds.length,
      modelIds: knownModelIds,
      checkedAt
    };
  }

  return {
    providerId: provider.id,
    providerName: provider.name,
    ok: false,
    status: bestStatus,
    syncedCount: 0,
    modelIds: [],
    error: bestError ?? "Unable to fetch model list",
    checkedAt
  };
}

function modelCatalogProbeAttempts(baseUrl: string, protocol: ApiProtocol, apiKey: string): Array<{ url: string; headers: Record<string, string> }> {
  const normalized = baseUrl.replace(/\/+$/, "");
  const rootBaseUrl = normalized.replace(/\/v1(?:beta)?$/i, "");
  const headers = modelCatalogHeaders(normalized, protocol, apiKey);
  const targets = protocol === "anthropic-compatible"
    ? [`${rootBaseUrl}/v1/models`, `${normalized}/models`]
    : [
        `${normalized}/models`,
        `${rootBaseUrl}/v1/models`,
        `${rootBaseUrl}/v1beta/models`
      ];
  return uniqueStrings(targets).map((target) => ({ url: target, headers }));
}

function modelCatalogHeaders(baseUrl: string, protocol: ApiProtocol, apiKey: string): Record<string, string> {
  const headers: Record<string, string> = { accept: "application/json" };
  const host = safeHost(baseUrl);
  if (protocol === "anthropic-compatible") {
    headers["x-api-key"] = apiKey;
    headers["anthropic-version"] = "2023-06-01";
    return headers;
  }
  if (host.endsWith("googleapis.com")) {
    headers["x-goog-api-key"] = apiKey;
  }
  headers.authorization = `Bearer ${apiKey}`;
  return headers;
}

function safeHost(value: string): string {
  try {
    return new URL(value).hostname.toLowerCase();
  } catch {
    return "";
  }
}

function serveStatic(pathname: string, res: ServerResponse) {
  const requestedPath = pathname === "/" ? "/index.html" : pathname;
  const absolute = normalize(resolve(DIST_DIR, `.${decodeURIComponent(requestedPath)}`));
  const filePath = absolute.startsWith(DIST_DIR) && existsSync(absolute) && statSync(absolute).isFile()
    ? absolute
    : join(DIST_DIR, "index.html");

  if (!existsSync(filePath)) {
    sendText(res, 503, "The frontend is not built yet. Run npm run build first.");
    return;
  }

  res.writeHead(200, { "content-type": contentType(filePath) });
  createReadStream(filePath).pipe(res);
}

class SimpleLimiter {
  private readonly attempts = new Map<string, { window: number; count: number }>();
  constructor(private readonly limit: number, private readonly windowMs: number) {}

  allow(key: string): boolean {
    const window = Math.floor(Date.now() / this.windowMs);
    const current = this.attempts.get(key);
    return !current || current.window !== window || current.count < this.limit;
  }

  consume(key: string): boolean {
    const window = Math.floor(Date.now() / this.windowMs);
    const current = this.attempts.get(key);
    const next = current?.window === window ? { window, count: current.count + 1 } : { window, count: 1 };
    this.attempts.set(key, next);
    return next.count <= this.limit;
  }
}

authFailures = new SimpleLimiter(12, 60_000);

function enforceAuthLimiter(req: IncomingMessage): void {
  const key = authLimiterKey(req);
  if (!authFailures.allow(key)) {
    throw new AppError("Too many authentication attempts. Try again later.", 429, "auth_rate_limited");
  }
}

function recordAuthFailure(req: IncomingMessage): void {
  authFailures.consume(authLimiterKey(req));
}

function authLimiterKey(req: IncomingMessage): string {
  return `${req.socket.remoteAddress ?? "local"}:${req.headers.host ?? ""}`;
}

async function testUpstreamUrl(
  store: VaultStore,
  body: { baseUrl?: string; protocol?: string; providerId?: string; isLocal?: boolean; type?: LocalServiceProtocol; apiKey?: string }
): Promise<{ ok: boolean; status?: number; latencyMs: number; error?: string; checkedAt: string; modelNames?: string[] }> {
  const baseUrl = (body.baseUrl ?? "").trim().replace(/\/+$/, "");
  if (!baseUrl) {
    return { ok: false, latencyMs: 0, error: "Base URL is empty", checkedAt: new Date().toISOString() };
  }
  const protocol = body.protocol === "anthropic-compatible"
    ? "anthropic-compatible"
    : body.protocol === "openai-anthropic-compatible"
    ? "openai-anthropic-compatible"
    : "openai-compatible";
  const serviceType = body.type ?? "openai-compatible";
  const shouldProbeModels = serviceType !== "custom";
  const rootBaseUrl = baseUrl.replace(/\/v1$/, "");
  const headers: Record<string, string> = { accept: "application/json" };
  const localApiKey = typeof body.apiKey === "string" ? body.apiKey.trim() : "";
  if (localApiKey) {
    if (protocol === "anthropic-compatible" || protocol === "openai-anthropic-compatible") {
      headers["x-api-key"] = localApiKey;
      headers["anthropic-version"] = "2023-06-01";
    } else {
      headers.authorization = `Bearer ${localApiKey}`;
    }
  }

  const modelTargets = protocol === "anthropic-compatible"
    ? [`${rootBaseUrl}/v1/models`, `${baseUrl}/models`]
    : protocol === "openai-anthropic-compatible"
    ? [`${baseUrl}/models`, `${rootBaseUrl}/v1/models`, baseUrl]
    : [`${baseUrl}/models`, `${rootBaseUrl}/v1/models`, baseUrl];
  const baseAttempts: ProbeAttempt[] = shouldProbeModels
    ? uniqueStrings(modelTargets).map((target) => ({ target, method: "GET", headers }))
    : [{ target: baseUrl, method: "GET", headers }];

  if (protocol === "anthropic-compatible" && shouldProbeModels) {
    for (const target of anthropicMessagesProbeTargets(baseUrl)) {
      baseAttempts.push({
        target,
        method: "POST",
        headers: { ...headers, "content-type": "application/json" },
        body: "{}"
      });
    }
  }

  const probeAttempts = baseAttempts.flatMap((attempt) => {
    const attempts: ProbeAttempt[] = [attempt];
    if (protocol === "anthropic-compatible" || protocol === "openai-anthropic-compatible") {
      attempts.push({
        ...attempt,
        headers: {
          accept: "application/json",
          "anthropic-version": "2023-06-01",
          ...(attempt.method === "POST" ? { "content-type": "application/json" } : {})
        }
      });
    }
    return attempts;
  });

  const isLocal = Boolean(body.isLocal);
  const timeoutMs = isLocal ? 5000 : 10000;
  let bestStatus: number | undefined;
  let bestLatencyMs = 0;
  let bestError: string | undefined;
  for (const { target, method, headers: attemptHeaders, body } of probeAttempts) {
    const attemptStarted = Date.now();
    try {
      const response = await fetch(target, {
        method,
        headers: attemptHeaders,
        body,
        signal: AbortSignal.timeout(timeoutMs)
      });
      const latencyMs = Date.now() - attemptStarted;
      const ok = shouldProbeModels
        ? response.status < 500 && response.status !== 404
        : response.status > 0 && response.status < 500;
      if (ok) {
        let modelNames: string[] | undefined;
        if (response.status < 400) {
          try {
            modelNames = extractModelNamesFromJson(await response.clone().json()).slice(0, 10);
          } catch {
            // Response wasn't JSON or didn't have data array
          }
        }
        return {
          ok: true,
          status: response.status,
          latencyMs,
          checkedAt: new Date().toISOString(),
          modelNames
        };
      }
      if (bestStatus === undefined || response.status > bestStatus) {
        bestStatus = response.status;
        bestLatencyMs = latencyMs;
        bestError = `HTTP ${response.status}`;
      }
    } catch (error) {
      const latencyMs = Date.now() - attemptStarted;
      const message = (error as Error).name === "AbortError" || (error as Error).name === "TimeoutError"
        ? `Timeout (${timeoutMs / 1000}s)`
        : String((error as Error).message ?? error);
      if (!bestError) {
        bestLatencyMs = latencyMs;
        bestError = message;
      }
    }
  }
  return {
    ok: false,
    status: bestStatus,
    latencyMs: bestLatencyMs,
    error: bestError ?? "Connection failed",
    checkedAt: new Date().toISOString()
  };
}

interface ProbeAttempt {
  target: string;
  method: "GET" | "POST";
  headers: Record<string, string>;
  body?: string;
}

function anthropicMessagesProbeTargets(baseUrl: string): string[] {
  const normalized = baseUrl.replace(/\/+$/, "");
  const rootBaseUrl = normalized.replace(/\/v1$/i, "");
  return uniqueStrings([
    `${rootBaseUrl}/v1/messages`,
    `${normalized}/messages`
  ]);
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}

async function handleLocalServiceProxy(
  store: VaultStore,
  req: IncomingMessage,
  res: ServerResponse,
  serviceId: string,
  suffixPath: string,
  search: string
): Promise<void> {
  const service = store.getLocalService(serviceId);
  if (!service) {
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "Local service not found" }));
    return;
  }
  const normalizedSuffixPath = normalizeProxySuffixPath(service.baseUrl, suffixPath);
  const upstreamUrl = buildUpstreamUrl(service.baseUrl, normalizedSuffixPath, search);
  const upstreamHeaders: Record<string, string> = {};
  for (const [name, value] of Object.entries(req.headers)) {
    const lower = name.toLowerCase();
    if (["connection", "host", "transfer-encoding", "content-length"].includes(lower)) continue;
    if (typeof value === "string") upstreamHeaders[name] = value;
    else if (Array.isArray(value)) upstreamHeaders[name] = value[0];
  }
  const localApiKey = store.getLocalServiceApiKey(serviceId);
  if (localApiKey && !upstreamHeaders.authorization && !upstreamHeaders["x-api-key"]) {
    if (service.type === "anthropic-compatible") {
      upstreamHeaders["x-api-key"] = localApiKey;
      if (!upstreamHeaders["anthropic-version"]) upstreamHeaders["anthropic-version"] = "2023-06-01";
    } else {
      upstreamHeaders.authorization = `Bearer ${localApiKey}`;
    }
  }

  const startedAt = new Date().toISOString();
  const startMs = Date.now();

  try {
    const body = await readRequestBody(req);
    const requestModel = extractRequestModel(body);
    const upstreamRes = await fetch(upstreamUrl, {
      method: req.method ?? "GET",
      headers: upstreamHeaders,
      body: shouldSendBody(req.method) && body.length > 0 ? toArrayBuffer(body) : undefined,
      signal: AbortSignal.timeout(30000)
    });

    const latencyMs = Date.now() - startMs;
    const responseBody = Buffer.from(await upstreamRes.arrayBuffer());
    const responseHeaders = toResponseHeaders(upstreamRes.headers);
    responseHeaders["content-length"] = String(responseBody.length);
    res.writeHead(upstreamRes.status, responseHeaders);
    res.end(responseBody);
    const protocol = service.type === "anthropic-compatible" ? "anthropic-compatible" : "openai-compatible";
    const usage = extractUsageFromResponse(protocol, body, responseBody);

    const event: UsageEvent = {
      id: randomUUID(),
      providerId: serviceId,
      providerName: service.name,
      baseUrl: service.baseUrl,
      protocol,
      gatewayType: "local-service",
      path: normalizedSuffixPath,
      endpoint: `/api/proxy/local/${serviceId}${normalizedSuffixPath}`,
      method: req.method ?? "GET",
      model: usage.model ?? requestModel,
      status: upstreamRes.status,
      ok: upstreamRes.status >= 200 && upstreamRes.status < 400,
      startedAt,
      latencyMs,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      cachedInputTokens: usage.cachedInputTokens,
      totalTokens: usage.totalTokens,
      realCost: usage.realCost,
      estimatedCost: usage.realCost,
      currency: usage.currency
    };
    store.appendUsage(event);
  } catch (error) {
    const latencyMs = Date.now() - startMs;
    const event: UsageEvent = {
      id: randomUUID(),
      providerId: serviceId,
      providerName: service.name,
      baseUrl: service.baseUrl,
      protocol: service.type === "anthropic-compatible" ? "anthropic-compatible" : "openai-compatible",
      gatewayType: "local-service",
      path: normalizedSuffixPath,
      endpoint: `/api/proxy/local/${serviceId}${normalizedSuffixPath}`,
      method: req.method ?? "GET",
      status: 0,
      ok: false,
      startedAt,
      latencyMs,
      error: (error as Error).message,
      errorMessage: (error as Error).message
    };
    store.appendUsage(event);
    if (!res.headersSent) {
      res.writeHead(502, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: `Local service proxy error: ${(error as Error).message}` }));
    }
  }
}

function isAllowedOrigin(origin: string, hostHeader?: string): boolean {
  const configured = (process.env.API_VAULT_CORS_ORIGINS || "").split(",").map((item) => item.trim()).filter(Boolean);
  if (configured.length > 0) return configured.includes(origin);
  const host = hostHeader ?? `127.0.0.1:${DEFAULT_PORT}`;
  return origin === `http://${host}` || origin === `http://127.0.0.1:${DEFAULT_PORT}` || origin === `http://localhost:${DEFAULT_PORT}`;
}

function warnIfPublicBindIsRisky(store: VaultStore): void {
  if (LISTEN_HOST !== "0.0.0.0") return;
  const state = store.getState();
  if (state.proxyTokens.length === 0) {
    console.warn("WARNING: BIND_HOST=0.0.0.0 is enabled, but no Proxy Token exists yet. Public /proxy/v1 calls will be rejected until you create one.");
  }
  console.warn("WARNING: Do not expose the management UI directly to the internet. Put HTTPS, access control, or a private tunnel in front of it.");
}

async function readJsonBody<T>(req: IncomingMessage): Promise<T> {
  let buffer: Buffer;
  try {
    buffer = await readRequestBody(req, JSON_BODY_LIMIT_BYTES);
  } catch (error) {
    throw new AppError((error as Error).message, 413, "payload_too_large");
  }
  const text = buffer.toString("utf8");
  if (!text) throw new AppError("Request body is required", 400, "body_required");
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new AppError("Invalid JSON body", 400, "invalid_json");
  }
}

function sendJson(res: ServerResponse, status: number, data: unknown) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body)
  });
  res.end(body);
}

function sendError(res: ServerResponse, error: unknown) {
  const appError = toAppError(error);
  sendJson(res, appError.statusCode, {
    error: appError.message,
    code: appError.code
  });
}

function sendText(res: ServerResponse, status: number, text: string) {
  res.writeHead(status, {
    "content-type": "text/plain; charset=utf-8",
    "content-length": Buffer.byteLength(text)
  });
  res.end(text);
}

function contentType(filePath: string): string {
  if (filePath.endsWith(".html")) return "text/html; charset=utf-8";
  if (filePath.endsWith(".js")) return "text/javascript; charset=utf-8";
  if (filePath.endsWith(".css")) return "text/css; charset=utf-8";
  if (filePath.endsWith(".json")) return "application/json; charset=utf-8";
  if (filePath.endsWith(".svg")) return "image/svg+xml";
  if (filePath.endsWith(".png")) return "image/png";
  return "application/octet-stream";
}

async function listenFixedPort(server: ReturnType<typeof createApiServer>, port: number): Promise<number> {
  return new Promise<number>((resolveListen, rejectListen) => {
    const onError = (error: NodeJS.ErrnoException) => {
      server.off("listening", onListening);
      rejectListen(error);
    };
    const onListening = () => {
      server.off("error", onError);
      resolveListen(port);
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port, LISTEN_HOST);
  });
}

async function isApiVaultRunning(port: number): Promise<boolean> {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/state`);
    if (!response.ok) return false;
    const data = await response.json() as Record<string, unknown>;
    return "initialized" in data && "unlocked" in data && "providers" in data;
  } catch {
    return false;
  }
}

function openBrowser(url: string) {
  if (process.env.API_VAULT_NO_OPEN === "1") return;
  const options = { detached: true, stdio: "ignore" as const };
  if (process.platform === "win32") {
    spawn("cmd", ["/c", "start", "", url], options).unref();
  } else if (process.platform === "darwin") {
    spawn("open", [url], options).unref();
  } else {
    spawn("xdg-open", [url], options).unref();
  }
}

if (require.main === module) {
  const store = new VaultStore(DATA_PATH);
  const proxy = new ProxyServer(store);
  const cloudflared = new CloudflaredManager();
  const server = createApiServer({ store, proxy, cloudflared });

  startAutoSync(store);
  warnIfPublicBindIsRisky(store);

  proxy.start()
    .then(() => listenFixedPort(server, DEFAULT_PORT))
    .then((port) => {
      const url = `http://127.0.0.1:${port}`;
      console.log(`API Vault is running at ${url}`);
      if (LISTEN_HOST === "0.0.0.0") {
        console.log(`API Vault is listening on all container interfaces (${LISTEN_HOST}:${port})`);
      }
      console.log(`Vault data: ${DATA_PATH}`);
      openBrowser(url);
    })
    .catch(async (error) => {
      if ((error as NodeJS.ErrnoException).code === "EADDRINUSE") {
        const url = `http://127.0.0.1:${DEFAULT_PORT}`;
        if (await isApiVaultRunning(DEFAULT_PORT)) {
          console.log(`API Vault is already running at ${url}`);
          openBrowser(url);
          proxy.stop();
          return;
        }
        console.error(`Port ${DEFAULT_PORT} is already in use by another application.`);
        console.error("Stop that process or set PORT to one shared API Vault port intentionally.");
        proxy.stop();
        process.exit(1);
      }
      console.error(error);
      proxy.stop();
      process.exit(1);
    });
}
