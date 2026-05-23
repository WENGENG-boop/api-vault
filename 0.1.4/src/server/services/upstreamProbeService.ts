import type { ApiProtocol, LocalServiceProtocol } from "../../shared/types";
import { extractModelNamesFromJson } from "../../main/modelList";
import type { VaultStore } from "../../main/store";

export async function testUpstreamUrl(
  store: VaultStore,
  body: { baseUrl?: string; protocol?: string; providerId?: string; isLocal?: boolean; type?: LocalServiceProtocol; apiKey?: string }
): Promise<{ ok: boolean; status?: number; latencyMs: number; error?: string; checkedAt: string; modelNames?: string[] }> {
  const baseUrl = (body.baseUrl ?? "").trim().replace(/\/+$/, "");
  if (!baseUrl) {
    return { ok: false, latencyMs: 0, error: "Base URL is empty", checkedAt: new Date().toISOString() };
  }
  const protocol = normalizeProbeProtocol(body.protocol);
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

  const timeoutMs = body.isLocal ? 5000 : 10000;
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
            // Response was not a model-list JSON shape.
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

function normalizeProbeProtocol(protocol: string | undefined): ApiProtocol {
  if (protocol === "anthropic-compatible") return "anthropic-compatible";
  if (protocol === "openai-anthropic-compatible") return "openai-anthropic-compatible";
  return "openai-compatible";
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
