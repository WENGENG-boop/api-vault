import { randomUUID } from "node:crypto";
import type { BalanceSnapshot, BalanceTestResult } from "../shared/types";
import type { ProviderForProxy } from "./store";
import { readBooleanPath, readNumberPath, readStringPath } from "./jsonPath";

export async function syncBalance(provider: ProviderForProxy): Promise<BalanceTestResult> {
  const config = provider.balanceConfig;
  const checkedAt = new Date().toISOString();

  if (!config.enabled || !config.url.trim()) {
    const snapshot = errorSnapshot(provider, checkedAt, "Balance sync is not configured");
    return { snapshot };
  }

  try {
    const headers = buildHeaders(config.headersJson, provider);
    const body = renderTemplate(config.bodyTemplate, provider).trim();
    const response = await fetch(renderTemplate(config.url, provider), {
      method: config.method,
      headers,
      body: config.method === "POST" && body ? body : undefined
    });
    const text = await response.text();
    const parsed = text ? JSON.parse(text) : {};

    if (!response.ok) {
      throw new Error(`Balance endpoint returned ${response.status}`);
    }

    const unlimitedQuota = readBooleanPath(parsed, "data.unlimited_quota");
    const currency = readReturnedUnit(parsed, config.currencyPath);

    const snapshot: BalanceSnapshot = {
      id: randomUUID(),
      providerId: provider.id,
      providerName: provider.name,
      checkedAt,
      ok: true,
      balance: unlimitedQuota ? undefined : readNumberPath(parsed, config.balancePath),
      spent: readNumberPath(parsed, config.spentPath),
      granted: readNumberPath(parsed, "data.total_granted"),
      currency,
      unlimitedQuota,
      tokenName: readStringPath(parsed, "data.name")
    };

    return {
      snapshot,
      responsePreview: safePreview(text)
    };
  } catch (error) {
    const snapshot = errorSnapshot(provider, checkedAt, String((error as Error).message ?? error));
    return { snapshot };
  }
}

function readReturnedUnit(parsed: unknown, configuredPath: string): string | undefined {
  const configured = readStringPath(parsed, configuredPath);
  if (configured) return configured;

  for (const path of [
    "data.currency",
    "data.unit",
    "data.quota_unit",
    "currency",
    "unit",
    "quota_unit"
  ]) {
    const value = readStringPath(parsed, path);
    if (value) return value;
  }
  return undefined;
}

export function renderTemplate(template: string, provider: ProviderForProxy): string {
  const queryKey = provider.queryKey || provider.apiKey;
  return template
    .replaceAll("{{apiKey}}", provider.apiKey)
    .replaceAll("{{key}}", provider.apiKey)
    .replaceAll("{{queryKey}}", queryKey)
    .replaceAll("{{adminKey}}", queryKey)
    .replaceAll("{{baseUrl}}", provider.baseUrl);
}

function buildHeaders(headersJson: string, provider: ProviderForProxy): Headers {
  const headers = new Headers();
  if (!headersJson.trim()) return headers;
  const parsed = JSON.parse(renderTemplate(headersJson, provider)) as Record<string, unknown>;
  for (const [name, value] of Object.entries(parsed)) {
    if (typeof value === "string") headers.set(name, value);
  }
  return headers;
}

function errorSnapshot(provider: ProviderForProxy, checkedAt: string, error: string): BalanceSnapshot {
  return {
    id: randomUUID(),
    providerId: provider.id,
    providerName: provider.name,
    checkedAt,
    ok: false,
    error
  };
}

function safePreview(text: string): string {
  if (!text) return "";
  return text.length > 800 ? `${text.slice(0, 800)}...` : text;
}
