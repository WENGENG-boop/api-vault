import { createServer, type IncomingHttpHeaders, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { Readable } from "node:stream";
import { randomUUID } from "node:crypto";
import type { ApiProtocol, UsageEvent } from "../shared/types";
import type { ProviderForProxy, VaultStore } from "./store";
import { extractRequestModel, extractUsageFromResponse, extractUsageFromSSE } from "./usage";
import { toAppError } from "./errors";

const HOP_BY_HOP_HEADERS = new Set([
  "connection",
  "content-length",
  "host",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade"
]);

export class ProxyServer {
  private server?: Server;
  private port?: number;

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

  async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const incomingUrl = new URL(req.url ?? "/", "http://127.0.0.1");
    const byKeyMatch = incomingUrl.pathname.match(/^\/proxy\/by-key(\/.*)?$/);
    const match = incomingUrl.pathname.match(/^\/proxy\/([^/]+)\/([^/]+)(\/.*)?$/);
    if (!byKeyMatch && !match) {
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "Unknown proxy route" }));
      return;
    }

    let provider: ProviderForProxy;
    let suffixPath: string;
    try {
      if (byKeyMatch) {
        const incomingKey = extractIncomingApiKey(req.headers);
        if (!incomingKey) {
          writeJson(res, 401, { error: "Missing Authorization Bearer token or x-api-key", code: "missing_api_key" });
          return;
        }
        provider = this.store.getProviderForIncomingApiKey(incomingKey);
        suffixPath = byKeyMatch[1] ?? "/";
      } else {
        const providerId = decodeURIComponent(match![1]);
        const keyId = decodeURIComponent(match![2]);
        provider = this.store.getProviderForProxy(providerId, keyId);
        suffixPath = match![3] ?? "/";
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
    const normalizedSuffixPath = normalizeProxySuffixPath(provider.baseUrl, suffixPath);
    const upstreamUrl = buildUpstreamUrl(provider.baseUrl, normalizedSuffixPath, incomingUrl.search);
    const headers = buildUpstreamHeaders(req.headers, provider.protocol, provider.apiKey);
    const started = Date.now();
    const startedAt = new Date(started).toISOString();
    this.store.markApiKeyUsed(provider.id, provider.keyId, startedAt);

    const isStreamRequest = body.includes(Buffer.from("\"stream\":true")) || body.includes(Buffer.from("\"stream\": true"));
    const finalBody = isStreamRequest && provider.protocol === "openai-compatible"
      ? injectStreamOptions(body)
      : body;
    const requestModel = extractRequestModel(finalBody);

    try {
      const upstream = await fetch(upstreamUrl, {
        method: req.method,
        headers,
        body: shouldSendBody(req.method) ? toArrayBuffer(finalBody) : undefined
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
              provider.protocol,
              body,
              sseBuffer,
              provider.balanceConfig.responseCostPath
            );
            safeAppendUsage(this.store, {
              ...baseUsageEvent({
                provider,
                req,
                path: normalizedSuffixPath,
                status: upstream.status,
                startedAt,
                started,
                model: usage.model ?? requestModel
              }),
              inputTokens: usage.inputTokens,
              outputTokens: usage.outputTokens,
              cachedInputTokens: usage.cachedInputTokens,
              totalTokens: usage.totalTokens,
              realCost: usage.realCost,
              currency: usage.currency
            });
          } catch (error) {
            console.error("Failed to record streaming usage", error);
            safeAppendUsage(this.store, {
              ...baseUsageEvent({
                provider,
                req,
                path: normalizedSuffixPath,
                status: upstream.status,
                startedAt,
                started,
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
              req,
              path: normalizedSuffixPath,
              status: 502,
              startedAt,
              started,
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
        provider.protocol,
        body,
        responseBody,
        provider.balanceConfig.responseCostPath
      );
      safeAppendUsage(this.store, {
        ...baseUsageEvent({
          provider,
          req,
          path: normalizedSuffixPath,
          status: upstream.status,
          startedAt,
          started,
          model: usage.model ?? requestModel
        }),
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        cachedInputTokens: usage.cachedInputTokens,
        totalTokens: usage.totalTokens,
        realCost: usage.realCost,
        currency: usage.currency
      });
    } catch (error) {
      const message = String((error as Error).message ?? error);
      if (!res.headersSent) {
        writeJson(res, 502, { error: message, code: "upstream_error" });
      } else {
        res.end();
      }
      safeAppendUsage(this.store, {
        ...baseUsageEvent({
          provider,
          req,
          path: normalizedSuffixPath,
          status: 502,
          startedAt,
          started,
          model: requestModel
        }),
        error: message
      });
    }
  }
}

function extractIncomingApiKey(headers: IncomingHttpHeaders): string | undefined {
  const auth = firstHeader(headers.authorization);
  if (auth) {
    const match = auth.match(/^Bearer\s+(.+)$/i);
    return (match ? match[1] : auth).trim();
  }
  return firstHeader(headers["x-api-key"])?.trim();
}

function firstHeader(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function writeJson(res: ServerResponse, status: number, data: unknown): void {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body)
  });
  res.end(body);
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
  if (!basePath) return suffixPath;
  const suffix = suffixPath.startsWith("/") ? suffixPath : `/${suffixPath}`;
  const duplicated = `${basePath}${basePath}/`;
  if (suffix.startsWith(duplicated)) {
    return `${basePath}${suffix.slice(duplicated.length - 1)}`;
  }
  if (suffix === `${basePath}${basePath}`) return basePath;
  return suffix;
}

export function buildUpstreamHeaders(
  incoming: IncomingHttpHeaders,
  protocol: ApiProtocol,
  apiKey: string
): Headers {
  const headers = new Headers();
  for (const [name, value] of Object.entries(incoming)) {
    const lower = name.toLowerCase();
    if (HOP_BY_HOP_HEADERS.has(lower)) continue;
    if (lower === "authorization" || lower === "x-api-key") continue;
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
  return headers;
}

function baseUsageEvent(args: {
  provider: ProviderForProxy;
  req: IncomingMessage;
  path: string;
  status: number;
  startedAt: string;
  started: number;
  model?: string;
}): UsageEvent {
  return {
    id: randomUUID(),
    providerId: args.provider.id,
    providerName: args.provider.name,
    baseUrl: args.provider.baseUrl,
    apiKeyId: args.provider.keyId,
    apiKeyName: args.provider.keyName,
    apiKeyMasked: args.provider.keyMasked,
    protocol: args.provider.protocol,
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

function shouldSendBody(method?: string): boolean {
  const upper = method?.toUpperCase();
  return upper !== "GET" && upper !== "HEAD";
}

function toArrayBuffer(buffer: Buffer): ArrayBuffer {
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;
}

async function readRequestBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

function toResponseHeaders(headers: Headers): Record<string, string> {
  const result: Record<string, string> = {};
  headers.forEach((value, name) => {
    if (!HOP_BY_HOP_HEADERS.has(name.toLowerCase())) {
      result[name] = value;
    }
  });
  return result;
}

function injectStreamOptions(body: Buffer): Buffer {
  try {
    const parsed = JSON.parse(body.toString("utf8")) as Record<string, unknown>;
    if (!parsed.stream_options) {
      parsed.stream_options = { include_usage: true };
    }
    return Buffer.from(JSON.stringify(parsed), "utf8");
  } catch {
    return body;
  }
}
