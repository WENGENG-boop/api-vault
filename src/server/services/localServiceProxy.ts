import type { IncomingMessage, ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import type { UsageEvent } from "../../shared/types";
import {
  readRequestBody,
  isTimeoutError,
  proxyTimeoutMessage,
  proxyTimeoutMs,
  shouldSendBody,
  toArrayBuffer,
  toResponseHeaders
} from "../../main/httpUtils";
import { buildUpstreamUrl, normalizeProxySuffixPath } from "../../main/proxy";
import type { VaultStore } from "../../main/store";
import { extractRequestModel, extractUsageFromResponse } from "../../main/usage";

export async function handleLocalServiceProxy(
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
      signal: AbortSignal.timeout(proxyTimeoutMs())
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
    const timedOut = isTimeoutError(error);
    const message = timedOut ? proxyTimeoutMessage() : (error as Error).message;
    const status = timedOut ? 504 : 502;
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
      status,
      ok: false,
      startedAt,
      latencyMs,
      error: message,
      errorMessage: message
    };
    store.appendUsage(event);
    if (!res.headersSent) {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify({
        error: timedOut ? message : `Local service proxy error: ${message}`,
        code: timedOut ? "proxy_timeout" : "upstream_error"
      }));
    }
  }
}
