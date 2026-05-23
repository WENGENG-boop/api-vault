import type { ApiProtocol, ProviderModelSyncResult } from "../../shared/types";
import { extractModelNamesFromJson } from "../../main/modelList";
import type { VaultStore } from "../../main/store";

export async function syncProviderModelCatalog(store: VaultStore, providerId: string): Promise<ProviderModelSyncResult> {
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

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}
