import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createReadStream, existsSync, statSync } from "node:fs";
import { join, normalize, resolve } from "node:path";
import { spawn } from "node:child_process";
import type { AddKeyInput, ApiKeyInput, ProviderInput, ProxyTokenInput } from "../shared/types";
import { syncBalance } from "../main/balance";
import { ProxyServer } from "../main/proxy";
import { VaultStore } from "../main/store";
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
  if (origin && isAllowedOrigin(origin)) {
    res.setHeader("access-control-allow-origin", origin);
    res.setHeader("access-control-allow-methods", "GET, POST, DELETE, OPTIONS");
    res.setHeader("access-control-allow-headers", "content-type, x-api-vault-admin, authorization");
  }

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "127.0.0.1"}`);

  if (url.pathname.startsWith("/api/")) {
    await handleApi(req, res, url, context);
    return;
  }

  if (url.pathname.startsWith("/proxy/")) {
    await context.proxy.handleRequest(req, res);
    return;
  }

  serveStatic(url.pathname, res);
}

async function handleApi(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  { store }: LocalServerContext
) {
  const method = req.method?.toUpperCase() ?? "GET";
  const proxyPort = Number(url.port || DEFAULT_PORT);

  if (method === "GET" && url.pathname === "/api/state") {
    sendJson(res, 200, store.getState(proxyPort));
    return;
  }

  if (method === "POST" && url.pathname === "/api/vault/setup") {
    enforceAuthLimiter(req);
    const body = await readJsonBody<{ password: string }>(req);
    store.setup(body.password);
    sendJson(res, 200, store.getState(proxyPort));
    return;
  }

  if (method === "POST" && url.pathname === "/api/vault/unlock") {
    enforceAuthLimiter(req);
    const body = await readJsonBody<{ password: string }>(req);
    store.unlock(body.password);
    sendJson(res, 200, store.getState(proxyPort));
    return;
  }

  if (method === "POST" && url.pathname === "/api/vault/lock") {
    store.lock();
    sendJson(res, 200, store.getState(proxyPort));
    return;
  }

  if (method === "POST" && url.pathname === "/api/proxy-tokens") {
    const body = await readJsonBody<ProxyTokenInput>(req);
    const result = store.createProxyToken(body);
    sendJson(res, 200, { secret: result.secret, token: result.token, state: store.getState(proxyPort) });
    return;
  }

  const proxyTokenMatch = url.pathname.match(/^\/api\/proxy-tokens\/([^/]+)$/);
  if (proxyTokenMatch && method === "POST") {
    const body = await readJsonBody<ProxyTokenInput>(req);
    store.updateProxyToken(decodeURIComponent(proxyTokenMatch[1]), body);
    sendJson(res, 200, store.getState(proxyPort));
    return;
  }

  if (proxyTokenMatch && method === "DELETE") {
    store.deleteProxyToken(decodeURIComponent(proxyTokenMatch[1]));
    sendJson(res, 200, store.getState(proxyPort));
    return;
  }

  const proxyTokenRegen = url.pathname.match(/^\/api\/proxy-tokens\/([^/]+)\/regenerate$/);
  if (proxyTokenRegen && method === "POST") {
    const result = store.regenerateProxyToken(decodeURIComponent(proxyTokenRegen[1]));
    sendJson(res, 200, { secret: result.secret, token: result.token, state: store.getState(proxyPort) });
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
    sendJson(res, 200, store.getState(proxyPort));
    return;
  }

  if (method === "POST" && url.pathname === "/api/providers/add-key") {
    const body = await readJsonBody<AddKeyInput>(req);
    store.addKeyWithAutoMerge(body);
    sendJson(res, 200, store.getState(proxyPort));
    return;
  }

  const keyAddMatch = url.pathname.match(/^\/api\/providers\/([^/]+)\/keys$/);
  if (method === "POST" && keyAddMatch) {
    const body = await readJsonBody<ApiKeyInput>(req);
    store.addApiKey(decodeURIComponent(keyAddMatch[1]), body);
    sendJson(res, 200, store.getState(proxyPort));
    return;
  }

  const keyDeleteMatch = url.pathname.match(/^\/api\/providers\/([^/]+)\/keys\/([^/]+)$/);
  if (method === "DELETE" && keyDeleteMatch) {
    store.deleteApiKey(decodeURIComponent(keyDeleteMatch[1]), decodeURIComponent(keyDeleteMatch[2]));
    sendJson(res, 200, store.getState(proxyPort));
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
    const state = store.getState(proxyPort);
    const provider = state.providers.find((item) => item.id === providerId);
    const apiKey = provider?.apiKeys.find((item) => item.id === keyId);
    if (!provider || !apiKey || !provider.proxyBaseUrl) throw notFound("API key not found", "api_key_not_found");
    sendJson(res, 200, { url: provider.proxyBaseUrl });
    return;
  }

  const providerDelete = url.pathname.match(/^\/api\/providers\/([^/]+)$/);
  if (method === "DELETE" && providerDelete) {
    store.deleteProvider(decodeURIComponent(providerDelete[1]));
    sendJson(res, 200, store.getState(proxyPort));
    return;
  }

  const secretMatch = url.pathname.match(/^\/api\/providers\/([^/]+)\/secret$/);
  if (method === "GET" && secretMatch) {
    const state = store.getState(proxyPort);
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
    const state = store.getState(proxyPort);
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
    sendJson(res, 200, { result, state: store.getState(proxyPort) });
    return;
  }

  if (method === "POST" && url.pathname === "/api/test-url") {
    const body = await readJsonBody<{ baseUrl?: string; protocol?: string; providerId?: string; isLocal?: boolean }>(req);
    const result = await testUpstreamUrl(store, body);
    sendJson(res, 200, result);
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
  const key = `${req.socket.remoteAddress ?? "local"}:${req.url ?? ""}`;
  if (!authFailures.consume(key)) {
    throw new AppError("Too many authentication attempts. Try again later.", 429, "auth_rate_limited");
  }
}

async function testUpstreamUrl(
  store: VaultStore,
  body: { baseUrl?: string; protocol?: string; providerId?: string; isLocal?: boolean }
): Promise<{ ok: boolean; status?: number; latencyMs: number; error?: string; checkedAt: string }> {
  const baseUrl = (body.baseUrl ?? "").trim().replace(/\/+$/, "");
  if (!baseUrl) {
    return { ok: false, latencyMs: 0, error: "Base URL is empty", checkedAt: new Date().toISOString() };
  }
  const protocol = body.protocol === "anthropic-compatible" ? "anthropic-compatible" : "openai-compatible";
  const target = protocol === "anthropic-compatible"
    ? `${baseUrl.replace(/\/v1$/, "")}/v1/models`
    : `${baseUrl}/models`;

  const headers: Record<string, string> = { accept: "application/json" };
  if (body.providerId) {
    try {
      const provider = store.getBalanceProvider(body.providerId);
      if (provider.apiKey) {
        if (protocol === "anthropic-compatible") {
          headers["x-api-key"] = provider.apiKey;
          headers["anthropic-version"] = "2023-06-01";
        } else {
          headers.authorization = `Bearer ${provider.apiKey}`;
        }
      }
    } catch {}
  }

  const isLocal = Boolean(body.isLocal);
  const timeoutMs = isLocal ? 3000 : 8000;
  const started = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(target, { method: "GET", headers, signal: controller.signal });
    clearTimeout(timeout);
    const latencyMs = Date.now() - started;
    // Local services may not implement /models; any HTTP response means it's reachable.
    const ok = isLocal ? response.status > 0 : response.status < 500;
    return {
      ok,
      status: response.status,
      latencyMs,
      error: !ok ? `HTTP ${response.status}` : undefined,
      checkedAt: new Date().toISOString()
    };
  } catch (error) {
    clearTimeout(timeout);
    const latencyMs = Date.now() - started;
    const message = (error as Error).name === "AbortError" ? `Timeout (${timeoutMs / 1000}s)` : String((error as Error).message ?? error);
    return { ok: false, latencyMs, error: message, checkedAt: new Date().toISOString() };
  }
}

function isAllowedOrigin(origin: string): boolean {
  const configured = (process.env.API_VAULT_CORS_ORIGINS || "").split(",").map((item) => item.trim()).filter(Boolean);
  if (configured.length > 0) return configured.includes(origin);
  return origin.startsWith("http://127.0.0.1:") || origin.startsWith("http://localhost:");
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
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.length;
    if (total > 2_000_000) throw new AppError("Request body is too large", 413, "payload_too_large");
    chunks.push(buffer);
  }
  const text = Buffer.concat(chunks).toString("utf8");
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
  const server = createApiServer({ store, proxy });

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

