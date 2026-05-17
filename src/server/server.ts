import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createReadStream, existsSync, statSync } from "node:fs";
import { join, normalize, resolve } from "node:path";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import type { AddKeyInput, ApiKeyInput, LocalService, LocalServiceProtocol, ProviderInput, ProxyTokenInput, UsageEvent } from "../shared/types";
import { syncBalance } from "../main/balance";
import { CloudflaredManager } from "../main/cloudflared";
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
import { AppError, notFound, serviceUnavailable, toAppError } from "../main/errors";

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
      }).catch(() => {});
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
    const body = await readJsonBody<{ password: string }>(req);
    store.setup(body.password);
    sendJson(res, 200, getState());
    return;
  }

  if (method === "POST" && url.pathname === "/api/vault/unlock") {
    enforceAuthLimiter(req);
    const body = await readJsonBody<{ password: string }>(req);
    store.unlock(body.password);
    sendJson(res, 200, getState());
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
    const result = await testUpstreamUrl(store, body);
    if (body.providerId) {
      store.updateProviderConnectionStatus(body.providerId, result.ok ? "available" : "unavailable", result.latencyMs, result.checkedAt);
    }
    sendJson(res, 200, result);
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
  const key = req.socket.remoteAddress ?? "local";
  if (!authFailures.consume(key)) {
    throw new AppError("Too many authentication attempts. Try again later.", 429, "auth_rate_limited");
  }
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
  const targets = !shouldProbeModels
    ? [baseUrl]
    : protocol === "anthropic-compatible"
    ? [`${rootBaseUrl}/v1/models`, `${baseUrl}/models`, baseUrl]
    : protocol === "openai-anthropic-compatible"
    ? [`${baseUrl}/models`, `${rootBaseUrl}/v1/models`, baseUrl]
    : [`${baseUrl}/models`, `${rootBaseUrl}/v1/models`, baseUrl];

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
  const probeAttempts = targets.flatMap((target) => {
    const attempts: Array<{ target: string; headers: Record<string, string> }> = [{ target, headers }];
    if (protocol === "anthropic-compatible" || protocol === "openai-anthropic-compatible") {
      attempts.push({
        target,
        headers: { accept: "application/json", "anthropic-version": "2023-06-01" }
      });
    }
    return attempts;
  });

  const isLocal = Boolean(body.isLocal);
  const timeoutMs = isLocal ? 5000 : 10000;
  const started = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    let bestStatus: number | undefined;
    let bestLatencyMs = 0;
    let bestError: string | undefined;
    for (const { target, headers: attemptHeaders } of probeAttempts) {
      const response = await fetch(target, { method: "GET", headers: attemptHeaders, signal: controller.signal });
      const latencyMs = Date.now() - started;
      const ok = shouldProbeModels
        ? response.status < 500 && response.status !== 404
        : response.status > 0 && response.status < 500;
      if (ok) {
        clearTimeout(timeout);
        let modelNames: string[] | undefined;
        if (response.status < 400) {
          try {
            const json = await response.clone().json() as { data?: Array<{ id: string }> };
            if (Array.isArray(json.data)) {
              modelNames = json.data.map((m) => m.id).slice(0, 10);
            }
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
    }

    clearTimeout(timeout);
    return {
      ok: false,
      status: bestStatus,
      latencyMs: bestLatencyMs,
      error: bestError ?? "Connection failed",
      checkedAt: new Date().toISOString()
    };
  } catch (error) {
    clearTimeout(timeout);
    const latencyMs = Date.now() - started;
    const message = (error as Error).name === "AbortError" ? `Timeout (${timeoutMs / 1000}s)` : String((error as Error).message ?? error);
    return { ok: false, latencyMs, error: message, checkedAt: new Date().toISOString() };
  }
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
  if (!text) return {} as T;
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
