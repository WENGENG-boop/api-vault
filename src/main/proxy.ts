import { createServer, type IncomingHttpHeaders, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { Readable } from "node:stream";
import { randomUUID } from "node:crypto";
import type { ApiProtocol, GatewayType, UsageEvent } from "../shared/types";
import { buildProviderProxyBaseUrl, type ProviderForProxy, type VaultStore } from "./store";
import { extractRequestModel, extractResponseModel, extractUsageFromResponse, extractUsageFromSSE, formatUpstreamErrorBody } from "./usage";
import { badRequest, toAppError } from "./errors";
import {
  DEFAULT_BODY_LIMIT_BYTES,
  isTimeoutError,
  isHopByHopHeader,
  proxyTimeoutMessage,
  proxyTimeoutMs,
  readRequestBody,
  shouldSendBody,
  toArrayBuffer,
  toResponseHeaders
} from "./httpUtils";
import { convertProxyResponse, prepareMultimodalProxyRequest, singleProtocolForProvider } from "./multimodal";
import { parseProxyRoute } from "./proxyRoutes";

export class ProxyServer {
  private server?: Server;
  private port?: number;
  private readonly rateLimiter = new ProxyRateLimiter();

  constructor(private readonly store: VaultStore) {}

  async start(): Promise<number> {
    if (this.server && this.port) return this.port;
    this.server = createServer((req, res) => {
      this.handleRequest(req, res).catch((error) => {
        if (!res.headersSent) {
          res.writeHead(500, { "content-type": "application/json" });
        }
        res.end(JSON.stringify({ error: String(error?.message ?? error) }));
      });
    });
    await new Promise<void>((resolve) => {
      this.server?.listen(0, "127.0.0.1", resolve);
    });
    const address = this.server.address();
    if (!address || typeof address === "string") throw new Error("Proxy failed to bind");
    this.port = address.port;
    return this.port;
  }

  stop(): void {
    this.server?.close();
    this.server = undefined;
    this.port = undefined;
  }

  getPort(): number | undefined {
    return this.port;
  }

  async handleRequest(req: IncomingMessage, res: ServerResponse, publicPort?: number): Promise<void> {
    const gatewayPort = publicPort ?? this.port;
    const incomingUrl = new URL(req.url ?? "/", "http://127.0.0.1");
    const route = parseProxyRoute(incomingUrl.pathname);
    if (route?.kind === "public") {
      await this.handlePublicProxy(req, res, incomingUrl, route.suffixPath, undefined, gatewayPort);
      return;
    }
    if (!route) {
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "Unknown proxy route" }));
      return;
    }
    if (route.kind === "provider" && extractProxyToken(req.headers)?.startsWith("proxy_")) {
      await this.handlePublicProxy(req, res, incomingUrl, route.suffixPath, route.providerId, gatewayPort);
      return;
    }

    let provider: ProviderForProxy;
    let suffixPath: string;
    let gatewayType: GatewayType = "provider";
    let gatewayBaseUrl: string | undefined;
    let effectiveProtocol: ApiProtocol;
    try {
      if (route.kind === "global") {
        const { gatewayName } = route;
        const requestedSuffixPath = route.suffixPath;
        const protocol = gatewayName === "auto"
          ? inferProtocolFromRequest(req.headers, requestedSuffixPath)
          : protocolForGateway(gatewayName);
        if (!protocol) {
          writeJson(res, 400, {
            error: "Could not infer whether this request is OpenAI-compatible or Anthropic-compatible. Use /proxy/openai/v1 or /proxy/anthropic instead.",
            code: "gateway_protocol_ambiguous"
          });
          return;
        }
        const incomingKey = extractIncomingApiKey(req.headers);
        if (!incomingKey) {
          writeJson(res, 401, { error: "Missing Authorization Bearer token or x-api-key", code: "missing_api_key" });
          return;
        }
        provider = this.store.getProviderForIncomingApiKey(incomingKey, protocol);
        suffixPath = requestedSuffixPath;
        gatewayType = gatewayName;
        gatewayBaseUrl = buildProtocolGatewayBaseUrl(gatewayPort, gatewayName);
        effectiveProtocol = protocol;
      } else if (route.kind === "by-key") {
        const incomingKey = extractIncomingApiKey(req.headers);
        if (!incomingKey) {
          writeJson(res, 401, { error: "Missing Authorization Bearer token or x-api-key", code: "missing_api_key" });
          return;
        }
        provider = this.store.getProviderForIncomingApiKey(incomingKey);
        suffixPath = route.suffixPath;
        gatewayType = "provider";
        gatewayBaseUrl = buildProviderGatewayBaseUrl(gatewayPort, provider);
        effectiveProtocol = effectiveProtocolForProvider(provider.protocol, req.headers, suffixPath);
      } else {
        const { providerId } = route;
        const providerSuffix = route.suffixPath;
        const incomingKey = extractIncomingApiKey(req.headers);
        const legacyRoute = parseLegacyKeyRoute(providerSuffix);

        if (legacyRoute) {
          try {
            provider = this.store.getProviderForProxy(providerId, legacyRoute.keyId);
            suffixPath = legacyRoute.suffixPath;
            gatewayType = "legacy-key";
            gatewayBaseUrl = buildLegacyGatewayBaseUrl(gatewayPort, provider);
            effectiveProtocol = effectiveProtocolForProvider(provider.protocol, req.headers, suffixPath);
          } catch (error) {
            const appError = toAppError(error);
            if (appError.code !== "api_key_not_found") throw error;
            provider = this.store.getProviderForProviderProxy(providerId, incomingKey);
            suffixPath = providerSuffix;
            gatewayType = "provider";
            gatewayBaseUrl = buildProviderGatewayBaseUrl(gatewayPort, provider);
            effectiveProtocol = effectiveProtocolForProvider(provider.protocol, req.headers, suffixPath);
          }
        } else {
          provider = this.store.getProviderForProviderProxy(providerId, incomingKey);
          suffixPath = providerSuffix;
          gatewayType = "provider";
          gatewayBaseUrl = buildProviderGatewayBaseUrl(gatewayPort, provider);
          effectiveProtocol = effectiveProtocolForProvider(provider.protocol, req.headers, suffixPath);
        }
      }
    } catch (error) {
      const appError = toAppError(error);
      writeJson(res, appError.statusCode, {
        error: appError.message,
        code: appError.code
      });
      return;
    }

    const body = await readRequestBody(req);
    const parsedBody = parseJsonObject(body);
    const isStreamRequest = parsedBody?.stream === true;
    let prepared = await prepareMultimodalProxyRequest({
      body,
      suffixPath,
      requestedProtocol: concreteProtocol(effectiveProtocol),
      targetProtocol: concreteProtocol(effectiveProtocol)
    });
    if (isStreamRequest && prepared.targetProtocol === "openai-compatible") {
      prepared = { ...prepared, body: injectStreamOptions(prepared.body, parsedBody) };
    }
    const finalBody = prepared.body;
    const normalizedSuffixPath = normalizeProxySuffixPath(provider.baseUrl, prepared.suffixPath);
    const upstreamUrl = buildUpstreamUrl(provider.baseUrl, normalizedSuffixPath, incomingUrl.search);
    const headers = buildUpstreamHeaders(req.headers, effectiveProtocol, provider.apiKey);
    const started = Date.now();
    const startedAt = new Date(started).toISOString();
    this.store.markApiKeyUsed(provider.id, provider.keyId, startedAt);

    const requestModel = extractRequestModel(finalBody);

    try {
      const upstream = await fetch(upstreamUrl, {
        method: req.method,
        headers,
        body: shouldSendBody(req.method) ? toArrayBuffer(finalBody) : undefined,
        signal: AbortSignal.timeout(proxyTimeoutMs())
      });

      const responseHeaders = toResponseHeaders(upstream.headers);
      const contentType = upstream.headers.get("content-type") ?? "";
      const isEventStream = contentType.includes("text/event-stream") || isStreamRequest;

      if (isEventStream && upstream.body) {
        res.writeHead(upstream.status, responseHeaders);
        const sseChunks: Buffer[] = [];
        const stream = Readable.fromWeb(upstream.body as never);
        stream.on("data", (chunk: Buffer) => {
          const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          sseChunks.push(buf);
          res.write(buf);
        });
        stream.on("end", () => {
          res.end();
          try {
            const sseBuffer = Buffer.concat(sseChunks);
            const usage = extractUsageFromSSE(
              effectiveProtocol,
              finalBody,
              sseBuffer,
              provider.balanceConfig.responseCostPath
            );
            const upstreamError = upstream.ok ? undefined : formatUpstreamErrorBody(sseBuffer);
            safeAppendUsage(this.store, {
              ...baseUsageEvent({
                provider,
                gatewayType,
                gatewayBaseUrl,
                req,
                path: normalizedSuffixPath,
                status: upstream.status,
                startedAt,
                started,
                protocol: effectiveProtocol,
                model: usage.model ?? extractResponseModel(sseBuffer) ?? requestModel
              }),
              inputTokens: usage.inputTokens,
              outputTokens: usage.outputTokens,
              cachedInputTokens: usage.cachedInputTokens,
              totalTokens: usage.totalTokens,
              realCost: usage.realCost,
              currency: usage.currency,
              error: upstreamError,
              errorMessage: upstreamError
            });
          } catch (error) {
            console.error("Failed to record streaming usage", error);
            safeAppendUsage(this.store, {
              ...baseUsageEvent({
                provider,
                gatewayType,
                gatewayBaseUrl,
                req,
                path: normalizedSuffixPath,
                status: upstream.status,
                startedAt,
                started,
                protocol: effectiveProtocol,
                model: requestModel
              }),
              error: String((error as Error).message ?? error)
            });
          }
        });
        stream.on("error", (error) => {
          res.end();
          console.error("Upstream stream failed", error);
          safeAppendUsage(this.store, {
            ...baseUsageEvent({
              provider,
              gatewayType,
              gatewayBaseUrl,
              req,
              path: normalizedSuffixPath,
              status: 502,
              startedAt,
              started,
              protocol: effectiveProtocol,
              model: requestModel
            }),
            error: String((error as Error).message ?? error)
          });
        });
        return;
      }

      const arrayBuffer = await upstream.arrayBuffer();
      const responseBody = Buffer.from(arrayBuffer);
      responseHeaders["content-length"] = String(responseBody.length);
      res.writeHead(upstream.status, responseHeaders);
      res.end(responseBody);

      const usage = extractUsageFromResponse(
        effectiveProtocol,
        finalBody,
        responseBody,
        provider.balanceConfig.responseCostPath
      );
      const upstreamError = upstream.ok ? undefined : formatUpstreamErrorBody(responseBody);
      safeAppendUsage(this.store, {
        ...baseUsageEvent({
          provider,
          gatewayType,
          gatewayBaseUrl,
          req,
          path: normalizedSuffixPath,
          status: upstream.status,
          startedAt,
          started,
          protocol: effectiveProtocol,
          model: usage.model ?? extractResponseModel(responseBody) ?? requestModel
        }),
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        cachedInputTokens: usage.cachedInputTokens,
        totalTokens: usage.totalTokens,
        realCost: usage.realCost,
        currency: usage.currency,
        error: upstreamError,
        errorMessage: upstreamError
      });
    } catch (error) {
      const timedOut = isTimeoutError(error);
      const message = timedOut ? proxyTimeoutMessage() : String((error as Error).message ?? error);
      const status = timedOut ? 504 : 502;
      const code = timedOut ? "proxy_timeout" : "upstream_error";
      if (!res.headersSent) {
        writeJson(res, status, { error: message, code });
      } else {
        res.end();
      }
      safeAppendUsage(this.store, {
        ...baseUsageEvent({
          provider,
          gatewayType,
          gatewayBaseUrl,
          req,
          path: normalizedSuffixPath,
          status,
          startedAt,
          started,
          protocol: effectiveProtocol,
          model: requestModel
        }),
        error: message,
        errorMessage: message
      });
    }
  }

  private async handlePublicProxy(req: IncomingMessage, res: ServerResponse, incomingUrl: URL, suffixPath: string, scopedProviderId?: string, publicPort?: number): Promise<void> {
    const started = Date.now();
    const startedAt = new Date(started).toISOString();
    const endpoint = scopedProviderId ? `/proxy/${scopedProviderId}${suffixPath}` : `/proxy/v1${suffixPath}`;
    const proxyTokenSecret = extractProxyToken(req.headers);
    const isModelsPath = suffixPath === "/models" || suffixPath === "/models/" || suffixPath === "/v1/models" || suffixPath === "/v1/models/";
    if (!proxyTokenSecret?.startsWith("proxy_") && isModelsPath) {
      const state = this.store.getState();
      const models = state.proxyTokens
        .filter((token) => token.enabled)
        .flatMap((token) => token.allowedModels.map((rule) => rule.publicModel))
        .filter((model, index, list) => model && list.indexOf(model) === index);
      writeJson(res, 200, {
        object: "list",
        data: models.map((id) => ({ id, object: "model", owned_by: "api-vault" }))
      });
      return;
    }
    if (!proxyTokenSecret?.startsWith("proxy_")) {
      writeJson(res, 401, { error: "Missing proxy token. Send Authorization: Bearer proxy_xxx", code: "proxy_token_required" });
      return;
    }

    let body: Buffer<ArrayBufferLike> = Buffer.alloc(0);
    let provider: ProviderForProxy | undefined;
    let proxyTokenId: string | undefined;
    let proxyTokenName: string | undefined;
    let requestModel: string | undefined;
    let upstreamModel: string | undefined;
    try {
      body = await readRequestBody(req, maxProxyBodyBytes());
      const parsedBody = parseJsonObject(body);
      requestModel = extractRequestModel(body);
      const isStreamRequest = parsedBody?.stream === true;
      const explicitProviderId = scopedProviderId ?? firstHeader(req.headers["x-provider-id"])?.trim();
      if (isModelsPath) {
        const token = this.store.getProxyTokenForSecret(proxyTokenSecret);
        proxyTokenId = token.id;
        proxyTokenName = token.name;
        if (!token.enabled) {
          writeJson(res, 403, { error: "Proxy token is disabled", code: "proxy_token_disabled" });
          return;
        }
        if (token.expiresAt && new Date(token.expiresAt).getTime() <= Date.now()) {
          writeJson(res, 403, { error: "Proxy token is expired", code: "proxy_token_expired" });
          return;
        }
        const rateResult = this.rateLimiter.consume(token.id, token.requestsPerMinute, token.requestsPerDay);
        if (!rateResult.ok) {
          writeJson(res, 429, { error: rateResult.message, code: "rate_limited" });
          return;
        }
        this.store.markProxyTokenUsed(token.id, startedAt);
        const models = token.allowedModels
          .filter((rule) => !explicitProviderId || rule.providerId === explicitProviderId)
          .map((rule) => rule.publicModel)
          .filter((model, index, list) => model && list.indexOf(model) === index);
        writeJson(res, 200, {
          object: "list",
          data: models.map((id) => ({ id, object: "model", owned_by: "api-vault" }))
        });
        return;
      }
      const resolution = this.store.resolvePublicProxy(proxyTokenSecret, requestModel, explicitProviderId, isStreamRequest);
      provider = resolution.provider;
      proxyTokenId = resolution.token.id;
      proxyTokenName = resolution.token.name;

      const rateResult = this.rateLimiter.consume(resolution.token.id, resolution.token.requestsPerMinute, resolution.token.requestsPerDay);
      if (!rateResult.ok) {
        writeJson(res, 429, { error: rateResult.message, code: "rate_limited" });
        return;
      }

      upstreamModel = resolution.upstreamModel ?? requestModel;
      const requestedProtocol = concreteProtocol(inferProtocolFromRequest(req.headers, suffixPath));
      const targetProtocol = singleProtocolForProvider(provider.protocol, requestedProtocol);
      if (isStreamRequest && requestedProtocol !== targetProtocol) {
        throw badRequest("Streaming protocol conversion is not supported yet. Disable stream for cross OpenAI/Anthropic proxy requests.", "stream_protocol_conversion_not_supported");
      }
      let prepared = await prepareMultimodalProxyRequest({
        body,
        suffixPath,
        requestedProtocol,
        targetProtocol,
        upstreamModel
      });
      if (isStreamRequest && prepared.targetProtocol === "openai-compatible") {
        prepared = { ...prepared, body: injectStreamOptions(prepared.body) };
      }
      const finalBody = prepared.body;
      const normalizedSuffixPath = normalizeProxySuffixPath(provider.baseUrl, prepared.suffixPath);
      const upstreamUrl = buildUpstreamUrl(provider.baseUrl, normalizedSuffixPath, incomingUrl.search);
      const protocol = prepared.targetProtocol;
      const headers = buildUpstreamHeaders(req.headers, protocol, provider.apiKey);
      this.store.markApiKeyUsed(provider.id, provider.keyId, startedAt);
      this.store.markProxyTokenUsed(resolution.token.id, startedAt);

      const upstream = await fetch(upstreamUrl, {
        method: req.method,
        headers,
        body: shouldSendBody(req.method) ? toArrayBuffer(finalBody) : undefined,
        signal: AbortSignal.timeout(proxyTimeoutMs())
      });

      const responseHeaders = toResponseHeaders(upstream.headers);
      const contentType = upstream.headers.get("content-type") ?? "";
      const isEventStream = contentType.includes("text/event-stream") || isStreamRequest;
      if (isEventStream && upstream.body) {
        res.writeHead(upstream.status, responseHeaders);
        const sseChunks: Buffer[] = [];
        const stream = Readable.fromWeb(upstream.body as never);
        stream.on("data", (chunk: Buffer) => {
          const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          sseChunks.push(buf);
          res.write(buf);
        });
        stream.on("end", () => {
          res.end();
          try {
            const sseBuffer = Buffer.concat(sseChunks);
            const usage = extractUsageFromSSE(protocol, finalBody, sseBuffer, provider!.balanceConfig.responseCostPath);
            const upstreamError = upstream.ok ? undefined : formatUpstreamErrorBody(sseBuffer);
            safeAppendUsage(this.store, {
              ...baseUsageEvent({ provider: provider!, gatewayType: "public-proxy", gatewayBaseUrl: publicProxyBaseUrl(publicPort ?? this.port), req, path: normalizedSuffixPath, status: upstream.status, startedAt, started, protocol, model: usage.model ?? extractResponseModel(sseBuffer) ?? upstreamModel ?? requestModel }),
              proxyTokenId,
              proxyTokenName,
              modelId: upstreamModel,
              endpoint,
              inputTokens: usage.inputTokens,
              outputTokens: usage.outputTokens,
              cachedInputTokens: usage.cachedInputTokens,
              totalTokens: usage.totalTokens,
              realCost: usage.realCost,
              estimatedCost: usage.realCost,
              currency: usage.currency,
              error: upstreamError,
              errorMessage: upstreamError
            });
          } catch (error) {
            recordPublicProxyError(this.store, provider!, req, startedAt, started, protocol, normalizedSuffixPath, upstream.status, endpoint, proxyTokenId, proxyTokenName, upstreamModel ?? requestModel, error);
          }
        });
        stream.on("error", (error) => {
          res.end();
          recordPublicProxyError(this.store, provider!, req, startedAt, started, protocol, normalizedSuffixPath, 502, endpoint, proxyTokenId, proxyTokenName, upstreamModel ?? requestModel, error);
        });
        return;
      }

      const rawResponseBody = Buffer.from(await upstream.arrayBuffer());
      const responseBody = upstream.ok
        ? convertProxyResponse(rawResponseBody, prepared.targetProtocol, prepared.responseProtocol)
        : rawResponseBody;
      responseHeaders["content-length"] = String(responseBody.length);
      res.writeHead(upstream.status, responseHeaders);
      res.end(responseBody);
      const usage = extractUsageFromResponse(protocol, finalBody, rawResponseBody, provider.balanceConfig.responseCostPath);
      const upstreamError = upstream.ok ? undefined : formatUpstreamErrorBody(rawResponseBody);
      safeAppendUsage(this.store, {
        ...baseUsageEvent({ provider, gatewayType: "public-proxy", gatewayBaseUrl: publicProxyBaseUrl(publicPort ?? this.port), req, path: normalizedSuffixPath, status: upstream.status, startedAt, started, protocol, model: usage.model ?? extractResponseModel(rawResponseBody) ?? upstreamModel ?? requestModel }),
        proxyTokenId,
        proxyTokenName,
        modelId: upstreamModel,
        endpoint,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        cachedInputTokens: usage.cachedInputTokens,
        totalTokens: usage.totalTokens,
        realCost: usage.realCost,
        estimatedCost: usage.realCost,
        currency: usage.currency,
        error: upstreamError,
        errorMessage: upstreamError
      });
    } catch (error) {
      const appError = sanitizeProxyError(error);
      if (!res.headersSent) writeJson(res, appError.status, { error: appError.message, code: appError.code });
      else res.end();
      if (provider) {
        recordPublicProxyError(this.store, provider, req, startedAt, started, provider.protocol === "anthropic-compatible" ? "anthropic-compatible" : "openai-compatible", suffixPath, appError.status, endpoint, proxyTokenId, proxyTokenName, upstreamModel ?? requestModel, appError.message);
      }
    }
  }
}

class ProxyRateLimiter {
  private readonly minute = new Map<string, { window: number; count: number }>();
  private readonly day = new Map<string, { day: string; count: number }>();

  consume(id: string, perMinute: number, perDay: number): { ok: true } | { ok: false; message: string } {
    const now = Date.now();
    const minuteWindow = Math.floor(now / 60_000);
    this.cleanup(minuteWindow, new Date(now).toISOString().slice(0, 10));
    const minute = this.minute.get(id);
    const nextMinute = minute?.window === minuteWindow ? { window: minuteWindow, count: minute.count + 1 } : { window: minuteWindow, count: 1 };
    if (nextMinute.count > perMinute) return { ok: false, message: "Proxy token minute limit exceeded" };
    const dayKey = new Date(now).toISOString().slice(0, 10);
    const day = this.day.get(id);
    const nextDay = day?.day === dayKey ? { day: dayKey, count: day.count + 1 } : { day: dayKey, count: 1 };
    if (nextDay.count > perDay) return { ok: false, message: "Proxy token daily limit exceeded" };
    this.minute.set(id, nextMinute);
    this.day.set(id, nextDay);
    return { ok: true };
  }

  private cleanup(currentMinuteWindow: number, currentDay: string): void {
    for (const [id, value] of this.minute) {
      if (value.window < currentMinuteWindow - 1) this.minute.delete(id);
    }
    for (const [id, value] of this.day) {
      if (value.day !== currentDay) this.day.delete(id);
    }
  }
}

function extractIncomingApiKey(headers: IncomingHttpHeaders): string | undefined {
  const auth = firstHeader(headers.authorization);
  if (auth) {
    const match = auth.match(/^Bearer\s+(.+)$/i);
    return (match ? match[1] : auth).trim();
  }
  return (
    firstHeader(headers["x-api-key"]) ??
    firstHeader(headers["api-key"]) ??
    firstHeader(headers["x-provider-api-key"])
  )?.trim();
}

function extractBearerToken(headers: IncomingHttpHeaders): string | undefined {
  const auth = firstHeader(headers.authorization);
  const match = auth?.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim();
}

function extractProxyToken(headers: IncomingHttpHeaders): string | undefined {
  return extractBearerToken(headers) ?? firstHeader(headers["x-api-key"])?.trim();
}

function firstHeader(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function protocolForGateway(gateway: "openai" | "anthropic"): ApiProtocol {
  return gateway === "openai" ? "openai-compatible" : "anthropic-compatible";
}

function buildProtocolGatewayBaseUrl(port: number | undefined, gateway: "openai" | "anthropic" | "auto"): string | undefined {
  if (!port) return undefined;
  const suffix = gateway === "openai" ? "/proxy/openai/v1" : gateway === "anthropic" ? "/proxy/anthropic" : "/proxy/auto/v1";
  return `http://127.0.0.1:${port}${suffix}`;
}

function publicProxyBaseUrl(port: number | undefined): string | undefined {
  return port ? `http://127.0.0.1:${port}/proxy/v1` : undefined;
}

function buildProviderGatewayBaseUrl(port: number | undefined, provider: ProviderForProxy): string | undefined {
  return port ? buildProviderProxyBaseUrl(port, provider.id, provider.baseUrl, provider.protocol) : undefined;
}

function buildLegacyGatewayBaseUrl(port: number | undefined, provider: ProviderForProxy): string | undefined {
  return port ? `http://127.0.0.1:${port}/proxy/${encodeURIComponent(provider.id)}/${encodeURIComponent(provider.keyId)}` : undefined;
}

function effectiveProtocolForProvider(protocol: ApiProtocol, headers: IncomingHttpHeaders, suffixPath: string): ApiProtocol {
  if (protocol !== "openai-anthropic-compatible") return protocol;
  return inferProtocolFromRequest(headers, suffixPath) ?? "openai-compatible";
}

function inferProtocolFromRequest(headers: IncomingHttpHeaders, suffixPath: string): ApiProtocol | undefined {
  const suffix = suffixPath.toLowerCase();
  if (firstHeader(headers["anthropic-version"])) return "anthropic-compatible";
  if (/\/v\d+(?:\.\d+)?\/messages(?:\/|$)|^\/messages(?:\/|$)/i.test(suffix)) return "anthropic-compatible";
  if (/\/(?:chat\/completions|completions|responses|models|embeddings|images|audio|assistants|threads)(?:\/|$)/i.test(suffix)) return "openai-compatible";
  if (firstHeader(headers.authorization)) return "openai-compatible";
  if (firstHeader(headers["x-api-key"]) || firstHeader(headers["api-key"]) || firstHeader(headers["x-provider-api-key"])) return "anthropic-compatible";
  return undefined;
}

function concreteProtocol(protocol: ApiProtocol | undefined): "openai-compatible" | "anthropic-compatible" {
  return protocol === "anthropic-compatible" ? "anthropic-compatible" : "openai-compatible";
}

function parseLegacyKeyRoute(suffixPath: string): { keyId: string; suffixPath: string } | undefined {
  const parts = suffixPath.split("/").filter(Boolean);
  if (parts.length === 0) return undefined;
  return {
    keyId: decodeURIComponent(parts[0]),
    suffixPath: parts.length > 1 ? `/${parts.slice(1).join("/")}` : "/"
  };
}
function writeJson(res: ServerResponse, status: number, data: unknown): void {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body)
  });
  res.end(body);
}

function sanitizeProxyError(error: unknown): { status: number; code: string; message: string } {
  if (isTimeoutError(error)) {
    return { status: 504, code: "proxy_timeout", message: proxyTimeoutMessage() };
  }
  const appError = toAppError(error);
  if (appError.statusCode >= 500) {
    return { status: 502, code: "upstream_error", message: "Upstream request failed" };
  }
  return { status: appError.statusCode, code: appError.code, message: appError.message };
}

function recordPublicProxyError(
  store: VaultStore,
  provider: ProviderForProxy,
  req: IncomingMessage,
  startedAt: string,
  started: number,
  protocol: ApiProtocol,
  path: string,
  status: number,
  endpoint: string,
  proxyTokenId: string | undefined,
  proxyTokenName: string | undefined,
  model: string | undefined,
  error: unknown
): void {
  const message = typeof error === "string" ? error : String((error as Error).message ?? error);
  safeAppendUsage(store, {
    ...baseUsageEvent({ provider, gatewayType: "public-proxy", gatewayBaseUrl: undefined, req, path, status, startedAt, started, protocol, model }),
    proxyTokenId,
    proxyTokenName,
    modelId: model,
    endpoint,
    error: message,
    errorMessage: message
  });
}

export function buildUpstreamUrl(baseUrl: string, suffixPath: string, search: string): string {
  const base = new URL(baseUrl);
  const basePath = base.pathname === "/" ? "" : base.pathname.replace(/\/$/, "");
  const suffix = suffixPath.startsWith("/") ? suffixPath : `/${suffixPath}`;
  let finalPath: string;
  if (!basePath) {
    finalPath = suffix;
  } else if (suffix === basePath || suffix.startsWith(`${basePath}/`)) {
    finalPath = suffix;
  } else {
    finalPath = `${basePath}${suffix}`;
  }
  return `${base.origin}${finalPath}${search}`;
}

export function normalizeProxySuffixPath(baseUrl: string, suffixPath: string): string {
  const base = new URL(baseUrl);
  const basePath = base.pathname === "/" ? "" : base.pathname.replace(/\/$/, "");
  const suffix = suffixPath.startsWith("/") ? suffixPath : `/${suffixPath}`;
  const normalizedSuffix = collapseDuplicateLeadingVersion(suffix);
  if (!basePath) return normalizedSuffix;
  const baseVersion = basePath.match(/\/(v\d+(?:\.\d+)?)$/i)?.[1];
  if (
    baseVersion &&
    basePath.toLowerCase() !== `/${baseVersion.toLowerCase()}` &&
    normalizedSuffix.toLowerCase().startsWith(`/${baseVersion.toLowerCase()}/`)
  ) {
    return normalizedSuffix.slice(baseVersion.length + 1) || "/";
  }
  const duplicated = `${basePath}${basePath}/`;
  if (normalizedSuffix.startsWith(duplicated)) {
    return `${basePath}${normalizedSuffix.slice(duplicated.length - 1)}`;
  }
  if (normalizedSuffix === `${basePath}${basePath}`) return basePath;
  return normalizedSuffix;
}

function collapseDuplicateLeadingVersion(path: string): string {
  return path.replace(/^\/(v\d+(?:\.\d+)?)\/\1(?=\/|$)/i, "/$1");
}

export function buildUpstreamHeaders(
  incoming: IncomingHttpHeaders,
  protocol: ApiProtocol,
  apiKey: string
): Headers {
  const headers = new Headers();
  for (const [name, value] of Object.entries(incoming)) {
    const lower = name.toLowerCase();
    if (isHopByHopHeader(lower)) continue;
    if (shouldDropForwardedHeader(lower)) continue;
    if (Array.isArray(value)) {
      for (const item of value) headers.append(name, item);
    } else if (value !== undefined) {
      headers.set(name, value);
    }
  }

    if (protocol === "anthropic-compatible") {
      headers.set("x-api-key", apiKey);
      if (!headers.has("anthropic-version")) {
        headers.set("anthropic-version", "2023-06-01");
      }
  } else {
      headers.set("authorization", `Bearer ${apiKey}`);
    }
    headers.set("accept-encoding", "identity");
    return headers;
  }

function baseUsageEvent(args: {
  provider: ProviderForProxy;
  gatewayType?: GatewayType;
  gatewayBaseUrl?: string;
  req: IncomingMessage;
  path: string;
  status: number;
  startedAt: string;
  started: number;
  protocol: ApiProtocol;
  model?: string;
}): UsageEvent {
  return {
    id: randomUUID(),
    providerId: args.provider.id,
    providerName: args.provider.name,
    baseUrl: args.provider.baseUrl,
    gatewayType: args.gatewayType,
    gatewayBaseUrl: args.gatewayBaseUrl,
    apiKeyId: args.provider.keyId,
    apiKeyName: args.provider.keyName,
    apiKeyMasked: args.provider.keyMasked,
    protocol: args.protocol,
    path: args.path,
    method: args.req.method ?? "GET",
    model: args.model,
    status: args.status,
    ok: args.status >= 200 && args.status < 400,
    startedAt: args.startedAt,
    latencyMs: Date.now() - args.started
  };
}

function safeAppendUsage(store: VaultStore, event: UsageEvent): void {
  try {
    store.appendUsage(event);
  } catch (error) {
    console.error("Failed to append usage event", error);
  }
}

function maxProxyBodyBytes(): number {
  const value = Number(process.env.API_VAULT_MAX_BODY_BYTES || DEFAULT_BODY_LIMIT_BYTES);
  return Number.isFinite(value) && value > 0 ? value : DEFAULT_BODY_LIMIT_BYTES;
}

function injectStreamOptions(body: Buffer, parsed?: Record<string, unknown>): Buffer {
  try {
    const object = parsed ?? JSON.parse(body.toString("utf8")) as Record<string, unknown>;
    if (!object.stream_options) {
      object.stream_options = { include_usage: true };
    }
    return Buffer.from(JSON.stringify(object), "utf8");
  } catch {
    return body;
  }
}

function parseJsonObject(body: Buffer): Record<string, unknown> | undefined {
  if (body.length === 0) return undefined;
  try {
    const parsed = JSON.parse(body.toString("utf8"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : undefined;
  } catch {
    return undefined;
  }
}

function shouldDropForwardedHeader(lower: string): boolean {
  const credentialHeaders = new Set([
    "authorization",
    "x-api-key",
    "api-key",
    "x-provider-api-key",
    "cookie",
    "set-cookie"
  ]);
  if (credentialHeaders.has(lower)) return true;
  if (lower.startsWith("proxy-")) return true;
  return false;
}






