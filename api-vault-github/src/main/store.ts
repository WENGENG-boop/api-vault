import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import type {
  AddKeyInput,
  ApiKeyInput,
  ApiKeySafe,
  ApiProtocol,
  AppState,
  BalanceConfig,
  BalanceSnapshot,
  DashboardTotals,
  ProviderInput,
  ProviderSafe,
  UsageEvent,
  UsageRollup,
  UsageRollupPeriod
} from "../shared/types";
import {
  createVaultHeader,
  decryptString,
  encryptString,
  unlockVaultHeader,
  type EncryptedText,
  type VaultHeader
} from "./crypto";
import { badRequest, conflict, locked, notFound } from "./errors";

interface ApiKeyRecord {
  id: string;
  name: string;
  apiKey: EncryptedText;
  queryKey?: EncryptedText;
  keyMasked: string;
  createdAt: string;
  lastUsedAt?: string;
}

interface ProviderRecord {
  id: string;
  name: string;
  protocol: ApiProtocol;
  baseUrl: string;
  currency: string;
  balanceConfig: BalanceConfig;
  apiKeys: ApiKeyRecord[];
  createdAt: string;
  updatedAt: string;
}

export interface ApiKeyWithSecret extends ApiKeySafe {
  apiKey: string;
  queryKey?: string;
}

export interface ProviderForProxy {
  id: string;
  name: string;
  protocol: ApiProtocol;
  baseUrl: string;
  currency: string;
  balanceConfig: BalanceConfig;
  apiKey: string;
  queryKey?: string;
  keyId: string;
  keyName: string;
  keyMasked: string;
}

interface PersistedData {
  version: number;
  vault?: VaultHeader;
  providers: ProviderRecord[];
  usageEvents: UsageEvent[];
  usageRollups: UsageRollup[];
  balanceSnapshots: BalanceSnapshot[];
}

const RECENT_USAGE_LIMIT = 100;
const BALANCE_SNAPSHOT_LIMIT = 1000;

const defaultBalanceConfig: BalanceConfig = {
  enabled: false,
  url: "",
  method: "GET",
  headersJson: "{\n  \"Authorization\": \"Bearer {{queryKey}}\"\n}",
  bodyTemplate: "",
  balancePath: "",
  spentPath: "",
  currencyPath: "",
  responseCostPath: ""
};

export class VaultStore {
  private readonly filePath: string;
  private data: PersistedData;
  private masterKey?: Buffer;

  constructor(filePath = join(process.cwd(), ".api-vault", "vault.json")) {
    this.filePath = filePath;
    this.data = this.load();
  }

  get status() {
    return {
      initialized: Boolean(this.data.vault),
      unlocked: Boolean(this.masterKey)
    };
  }

  setup(password: string): void {
    this.reloadFromDisk();
    if (this.data.vault) {
      throw conflict("Vault is already initialized", "vault_initialized");
    }
    const { header, key } = createVaultHeader(password);
    this.data.vault = header;
    this.masterKey = key;
    this.save();
  }

  unlock(password: string): void {
    this.reloadFromDisk();
    if (!this.data.vault) {
      throw badRequest("Vault is not initialized", "vault_not_initialized");
    }
    this.masterKey = unlockVaultHeader(password, this.data.vault);
  }

  lock(): void {
    this.masterKey = undefined;
  }

  getState(proxyPort?: number): AppState {
    this.reloadFromDisk();
    const providers = this.data.providers.map((provider) => this.safeProvider(provider, proxyPort));
    return {
      ...this.status,
      proxyPort,
      providers,
      usageEvents: [...this.data.usageEvents].sort((a, b) => b.startedAt.localeCompare(a.startedAt)),
      usageRollups: [...this.data.usageRollups].sort((a, b) =>
        b.bucketStart.localeCompare(a.bucketStart) || a.period.localeCompare(b.period)
      ),
      balanceSnapshots: [...this.data.balanceSnapshots].sort((a, b) => b.checkedAt.localeCompare(a.checkedAt)),
      totals: this.totals()
    };
  }

  upsertProvider(input: ProviderInput): ProviderSafe {
    this.requireKey();
    this.reloadFromDisk();
    const now = new Date().toISOString();
    const existing = input.id ? this.data.providers.find((provider) => provider.id === input.id) : undefined;

    const record: ProviderRecord = {
      id: existing?.id ?? randomUUID(),
      name: stringValue(input.name).trim(),
      protocol: normalizeProtocol(input.protocol),
      baseUrl: normalizeBaseUrl(input.baseUrl),
      currency: stringValue(input.currency).trim().toUpperCase() || "USD",
      balanceConfig: normalizeBalanceConfig(input.balanceConfig),
      apiKeys: existing?.apiKeys ?? [],
      createdAt: existing?.createdAt ?? now,
      updatedAt: now
    };

    if (!record.name) throw badRequest("Provider name is required", "provider_name_required");

    if (existing) {
      this.data.providers = this.data.providers.map((provider) =>
        provider.id === record.id ? record : provider
      );
    } else {
      this.data.providers.push(record);
    }
    this.save();
    return this.safeProvider(record);
  }

  deleteProvider(id: string): void {
    this.requireKey();
    this.reloadFromDisk();
    this.data.providers = this.data.providers.filter((provider) => provider.id !== id);
    this.save();
  }

  addApiKey(providerId: string, input: ApiKeyInput): ApiKeySafe {
    const key = this.requireKey();
    this.reloadFromDisk();
    const provider = this.data.providers.find((p) => p.id === providerId);
    if (!provider) throw notFound("Provider not found", "provider_not_found");
    const record = this.addApiKeyRecord(provider, input, key);
    this.save();
    return this.safeApiKey(provider, record);
  }

  deleteApiKey(providerId: string, keyId: string): void {
    this.requireKey();
    this.reloadFromDisk();
    const provider = this.data.providers.find((p) => p.id === providerId);
    if (!provider) throw notFound("Provider not found", "provider_not_found");
    provider.apiKeys = provider.apiKeys.filter((k) => k.id !== keyId);
    provider.updatedAt = new Date().toISOString();
    this.save();
  }

  getApiKeyPlaintext(providerId: string, keyId: string, kind: "api" | "query" = "api"): string {
    const masterKey = this.requireKey();
    this.reloadFromDisk();
    const provider = this.data.providers.find((p) => p.id === providerId);
    if (!provider) throw notFound("Provider not found", "provider_not_found");
    const record = provider.apiKeys.find((k) => k.id === keyId);
    if (!record) throw notFound("API key not found", "api_key_not_found");
    const target = kind === "query" ? record.queryKey : record.apiKey;
    if (!target) throw notFound("Secret is not configured", "secret_not_configured");
    return decryptString(masterKey, target);
  }

  getProviderForProxy(providerId: string, keyId: string): ProviderForProxy {
    const masterKey = this.requireKey();
    this.reloadFromDisk();
    const provider = this.data.providers.find((p) => p.id === providerId);
    if (!provider) throw notFound("Provider not found", "provider_not_found");
    const record = provider.apiKeys.find((k) => k.id === keyId);
    if (!record) throw notFound("API key not found", "api_key_not_found");
    return {
      id: provider.id,
      name: provider.name,
      protocol: provider.protocol,
      baseUrl: provider.baseUrl,
      currency: provider.currency,
      balanceConfig: provider.balanceConfig,
      apiKey: decryptString(masterKey, record.apiKey),
      queryKey: record.queryKey ? decryptString(masterKey, record.queryKey) : undefined,
      keyId: record.id,
      keyName: record.name,
      keyMasked: record.keyMasked
    };
  }

  getProviderForIncomingApiKey(apiKey: string): ProviderForProxy {
    const masterKey = this.requireKey();
    this.reloadFromDisk();
    const incoming = apiKey.trim();
    if (!incoming) throw badRequest("API key is required", "api_key_required");
    for (const provider of this.data.providers) {
      for (const record of provider.apiKeys) {
        const plaintext = decryptString(masterKey, record.apiKey);
        if (plaintext !== incoming) continue;
        return {
          id: provider.id,
          name: provider.name,
          protocol: provider.protocol,
          baseUrl: provider.baseUrl,
          currency: provider.currency,
          balanceConfig: provider.balanceConfig,
          apiKey: plaintext,
          queryKey: record.queryKey ? decryptString(masterKey, record.queryKey) : undefined,
          keyId: record.id,
          keyName: record.name,
          keyMasked: record.keyMasked
        };
      }
    }
    throw notFound("API key is not registered in API Vault", "api_key_not_found");
  }

  getBalanceProvider(providerId: string): ProviderForProxy {
    const masterKey = this.requireKey();
    this.reloadFromDisk();
    const provider = this.data.providers.find((p) => p.id === providerId);
    if (!provider) throw notFound("Provider not found", "provider_not_found");
    const record = provider.apiKeys[0];
    if (!record) throw notFound("Provider has no API keys", "api_key_not_found");
    return {
      id: provider.id,
      name: provider.name,
      protocol: provider.protocol,
      baseUrl: provider.baseUrl,
      currency: provider.currency,
      balanceConfig: provider.balanceConfig,
      apiKey: decryptString(masterKey, record.apiKey),
      queryKey: record.queryKey ? decryptString(masterKey, record.queryKey) : undefined,
      keyId: record.id,
      keyName: record.name,
      keyMasked: record.keyMasked
    };
  }

  markApiKeyUsed(providerId: string, keyId: string, when: string): void {
    this.reloadFromDisk();
    const provider = this.data.providers.find((p) => p.id === providerId);
    if (!provider) return;
    const record = provider.apiKeys.find((k) => k.id === keyId);
    if (!record) return;
    record.lastUsedAt = when;
    this.save();
  }

  findProviderByHostAndProtocol(host: string, protocol: ApiProtocol): ProviderRecord | undefined {
    const normalizedHost = host.toLowerCase();
    return this.data.providers.find((p) => {
      if (p.protocol !== protocol) return false;
      try {
        return new URL(p.baseUrl).hostname.toLowerCase() === normalizedHost;
      } catch {
        return false;
      }
    });
  }

  addKeyWithAutoMerge(input: AddKeyInput): { provider: ProviderSafe; apiKey: ApiKeySafe } {
    this.requireKey();
    this.reloadFromDisk();

    let providerRecord: ProviderRecord | undefined;

    if (input.providerId) {
      providerRecord = this.data.providers.find((p) => p.id === input.providerId);
      if (!providerRecord) throw notFound("Provider not found", "provider_not_found");
    } else {
      const baseUrl = stringValue(input.baseUrl).trim();
      if (!baseUrl) throw badRequest("Base URL is required", "base_url_required");
      const protocol = normalizeProtocol(input.protocol ?? "openai-compatible");
      const normalizedUrl = normalizeBaseUrl(baseUrl);
      const host = new URL(normalizedUrl).hostname;
      providerRecord = this.findProviderByHostAndProtocol(host, protocol);

      if (!providerRecord) {
        const name = stringValue(input.providerName).trim() || autoNameFromHost(host);
        const now = new Date().toISOString();
        providerRecord = {
          id: randomUUID(),
          name,
          protocol,
          baseUrl: normalizedUrl,
          currency: stringValue(input.currency).trim().toUpperCase() || "USD",
          balanceConfig: normalizeBalanceConfig(input.balanceConfig),
          apiKeys: [],
          createdAt: now,
          updatedAt: now
        };
        this.data.providers.push(providerRecord);
      }
    }

    const apiKeyRecord = this.addApiKeyRecord(providerRecord, {
      name: input.keyName,
      apiKey: input.apiKey,
      queryKey: input.queryKey
    }, this.masterKey!);
    this.save();

    const updatedProvider = this.data.providers.find((p) => p.id === providerRecord!.id)!;
    return {
      provider: this.safeProvider(updatedProvider),
      apiKey: this.safeApiKey(updatedProvider, apiKeyRecord)
    };
  }

  appendUsage(event: UsageEvent): void {
    this.reloadFromDisk();
    if (this.data.usageEvents.some((item) => item.id === event.id)) return;
    this.data.usageEvents.unshift(event);
    this.compactUsage();
    this.save();
  }

  appendBalance(snapshot: BalanceSnapshot): void {
    this.reloadFromDisk();
    if (this.data.balanceSnapshots.some((item) => item.id === snapshot.id)) return;
    this.data.balanceSnapshots.unshift(snapshot);
    this.data.balanceSnapshots = this.data.balanceSnapshots.slice(0, BALANCE_SNAPSHOT_LIMIT);
    this.save();
  }

  private load(): PersistedData {
    if (!existsSync(this.filePath)) {
      return {
        version: 1,
        providers: [],
        usageEvents: [],
        usageRollups: [],
        balanceSnapshots: []
      };
    }
    const raw = readFileSync(this.filePath, "utf8");
    return normalizeData(JSON.parse(raw) as Partial<PersistedData>);
  }

  private reloadFromDisk(): void {
    this.data = this.load();
  }

  private save(): void {
    mkdirSync(dirname(this.filePath), { recursive: true });
    writeFileSync(this.filePath, `${JSON.stringify(this.data, null, 2)}\n`, "utf8");
  }

  private requireKey(): Buffer {
    if (!this.masterKey) {
      throw locked("Vault is locked");
    }
    return this.masterKey;
  }

  private addApiKeyRecord(provider: ProviderRecord, input: ApiKeyInput, key: Buffer): ApiKeyRecord {
    const plaintext = stringValue(input.apiKey).trim();
    if (!plaintext) throw badRequest("API key is required", "api_key_required");
    const keyName = stringValue(input.name).trim() || defaultKeyName(provider.apiKeys.length);
    const now = new Date().toISOString();
    const record: ApiKeyRecord = {
      id: randomUUID(),
      name: keyName,
      apiKey: encryptString(key, plaintext),
      queryKey: input.queryKey?.trim() ? encryptString(key, input.queryKey.trim()) : undefined,
      keyMasked: maskKey(plaintext),
      createdAt: now
    };
    provider.apiKeys.push(record);
    provider.updatedAt = now;
    return record;
  }

  private safeProvider(provider: ProviderRecord, proxyPort?: number): ProviderSafe {
    return {
      id: provider.id,
      name: provider.name,
      protocol: provider.protocol,
      baseUrl: provider.baseUrl,
      currency: provider.currency,
      balanceConfig: provider.balanceConfig,
      apiKeys: provider.apiKeys.map((key) => this.safeApiKey(provider, key, proxyPort)),
      createdAt: provider.createdAt,
      updatedAt: provider.updatedAt
    };
  }

  private safeApiKey(provider: ProviderRecord, key: ApiKeyRecord, proxyPort?: number): ApiKeySafe {
    return {
      id: key.id,
      providerId: provider.id,
      name: key.name,
      keyMasked: key.keyMasked,
      hasQueryKey: Boolean(key.queryKey),
      createdAt: key.createdAt,
      lastUsedAt: key.lastUsedAt,
      proxyBaseUrl: proxyPort
        ? buildProxyBaseUrl(proxyPort, provider.id, key.id, provider.baseUrl, provider.protocol)
        : undefined
    };
  }

  private totals(): DashboardTotals {
    const today = new Date().toISOString().slice(0, 10);
    let realCostTotal = 0;
    let realCostCount = 0;
    let rollupCalls = 0;
    let rollupOkCalls = 0;
    let rollupFailedCalls = 0;
    for (const event of this.data.usageEvents) {
      if (event.realCost !== undefined) {
        realCostTotal += event.realCost;
        realCostCount += 1;
      }
    }
    for (const rollup of this.data.usageRollups) {
      if (rollup.period !== "month") continue;
      rollupCalls += rollup.calls;
      rollupOkCalls += rollup.okCalls;
      rollupFailedCalls += rollup.failedCalls;
      realCostTotal += rollup.realCostTotal;
      realCostCount += rollup.realCostCount;
    }
    return {
      totalCalls: this.data.usageEvents.length + rollupCalls,
      callsToday: this.data.usageEvents.filter((event) => event.startedAt.startsWith(today)).length,
      okCalls: this.data.usageEvents.filter((event) => event.ok).length + rollupOkCalls,
      failedCalls: this.data.usageEvents.filter((event) => !event.ok).length + rollupFailedCalls,
      realCostTotal,
      realCostCount
    };
  }

  private compactUsage(): void {
    const sorted = [...this.data.usageEvents].sort((a, b) => b.startedAt.localeCompare(a.startedAt));
    const recent = sorted.slice(0, RECENT_USAGE_LIMIT);
    const overflow = sorted.slice(RECENT_USAGE_LIMIT);
    for (const event of overflow) {
      this.addUsageRollup(event, "week");
      this.addUsageRollup(event, "month");
    }
    this.data.usageEvents = recent;
    this.data.usageRollups = dedupeRollups(this.data.usageRollups);
  }

  private addUsageRollup(event: UsageEvent, period: UsageRollupPeriod): void {
    const bucketStart = period === "week" ? weekBucketStart(event.startedAt) : monthBucketStart(event.startedAt);
    const id = usageRollupId(period, bucketStart, event.providerId, event.apiKeyId, event.model, event.currency);
    const existing = this.data.usageRollups.find((rollup) => rollup.id === id);
    const updatedAt = new Date().toISOString();
    const target = existing ?? {
      id,
      period,
      bucketStart,
      providerId: event.providerId,
      providerName: event.providerName,
      apiKeyId: event.apiKeyId,
      apiKeyName: event.apiKeyName,
      protocol: event.protocol,
      model: event.model,
      calls: 0,
      okCalls: 0,
      failedCalls: 0,
      inputTokens: 0,
      outputTokens: 0,
      cachedInputTokens: 0,
      totalTokens: 0,
      realCostTotal: 0,
      realCostCount: 0,
      currency: event.currency,
      updatedAt
    };

    target.providerName = event.providerName;
    target.apiKeyName = event.apiKeyName ?? target.apiKeyName;
    target.calls += 1;
    target.okCalls += event.ok ? 1 : 0;
    target.failedCalls += event.ok ? 0 : 1;
    target.inputTokens += event.inputTokens ?? 0;
    target.outputTokens += event.outputTokens ?? 0;
    target.cachedInputTokens += event.cachedInputTokens ?? 0;
    target.totalTokens += event.totalTokens ?? (event.inputTokens ?? 0) + (event.outputTokens ?? 0);
    if (event.realCost !== undefined) {
      target.realCostTotal += event.realCost;
      target.realCostCount += 1;
    }
    target.updatedAt = updatedAt;
    if (!existing) this.data.usageRollups.push(target);
  }
}

export function getDefaultBalanceConfig(): BalanceConfig {
  return { ...defaultBalanceConfig };
}

function normalizeData(data: Partial<PersistedData> & { providers?: any[] }): PersistedData {
  return {
    version: data.version ?? 1,
    vault: data.vault,
    providers: Array.isArray(data.providers) ? data.providers.map(migrateProvider) : [],
    usageEvents: Array.isArray(data.usageEvents) ? data.usageEvents : [],
    usageRollups: dedupeRollups(Array.isArray(data.usageRollups) ? data.usageRollups : []),
    balanceSnapshots: Array.isArray(data.balanceSnapshots) ? data.balanceSnapshots : []
  };
}

function migrateProvider(raw: any): ProviderRecord {
  const apiKeys: ApiKeyRecord[] = Array.isArray(raw.apiKeys)
    ? raw.apiKeys.map((k: any) => ({
        id: k.id || randomUUID(),
        name: k.name || "default",
        apiKey: k.apiKey,
        queryKey: k.queryKey,
        keyMasked: k.keyMasked || "sk-****",
        createdAt: k.createdAt || raw.createdAt || new Date().toISOString(),
        lastUsedAt: k.lastUsedAt
      }))
    : [];

  if (apiKeys.length === 0 && raw.apiKey) {
    apiKeys.push({
      id: legacyDefaultKeyId(raw.id),
      name: "default",
      apiKey: raw.apiKey,
      queryKey: raw.queryKey,
      keyMasked: "sk-****",
      createdAt: raw.createdAt || new Date().toISOString()
    });
  }

  return {
    id: raw.id || randomUUID(),
    name: raw.name || "Provider",
    protocol: raw.protocol === "anthropic-compatible" ? "anthropic-compatible" : "openai-compatible",
    baseUrl: raw.baseUrl || "https://example.com",
    currency: raw.currency || "USD",
    balanceConfig: normalizeBalanceConfig(raw.balanceConfig),
    apiKeys,
    createdAt: raw.createdAt || new Date().toISOString(),
    updatedAt: raw.updatedAt || raw.createdAt || new Date().toISOString()
  };
}

function legacyDefaultKeyId(providerId: unknown): string {
  const base = typeof providerId === "string" && providerId.trim() ? providerId.trim() : "provider";
  return `${base.replace(/[^a-zA-Z0-9_-]/g, "-")}-default-key`;
}

function maskKey(key: string): string {
  const trimmed = key.trim();
  if (trimmed.length <= 4) return "****";
  if (/^sk-/i.test(trimmed)) return `sk-****${trimmed.slice(-4)}`;
  if (/^pk-/i.test(trimmed)) return `pk-****${trimmed.slice(-4)}`;
  if (/^bearer\s+/i.test(trimmed)) return `Bearer ****${trimmed.slice(-4)}`;
  return `${trimmed.slice(0, 3)}****${trimmed.slice(-4)}`;
}

function defaultKeyName(existingCount: number): string {
  return `key${existingCount + 1}`;
}

const AUTO_NAME_MAP: Record<string, string> = {
  "api.openai.com": "OpenAI",
  "api.anthropic.com": "Anthropic",
  "openrouter.ai": "OpenRouter",
  "api.siliconflow.cn": "SiliconFlow",
  "api.siliconflow.com": "SiliconFlow",
  "api.deepseek.com": "DeepSeek",
  "api.mistral.ai": "Mistral",
  "api.groq.com": "Groq",
  "generativelanguage.googleapis.com": "Gemini",
  "jmrai.net": "JMRAI"
};

function autoNameFromHost(host: string): string {
  const lower = host.toLowerCase();
  if (AUTO_NAME_MAP[lower]) return AUTO_NAME_MAP[lower];
  for (const [known, name] of Object.entries(AUTO_NAME_MAP)) {
    if (lower.endsWith(known)) return name;
  }
  const parts = lower.split(".");
  const main = parts.length >= 2 ? parts[parts.length - 2] : lower;
  return main.charAt(0).toUpperCase() + main.slice(1);
}

function dedupeRollups(rollups: UsageRollup[]): UsageRollup[] {
  const map = new Map<string, UsageRollup>();
  for (const rollup of rollups) {
    const id = rollup.id || usageRollupId(
      rollup.period,
      rollup.bucketStart,
      rollup.providerId,
      rollup.apiKeyId,
      rollup.model,
      rollup.currency
    );
    const existing = map.get(id);
    const normalized: UsageRollup = {
      id,
      period: rollup.period,
      bucketStart: rollup.bucketStart,
      providerId: rollup.providerId,
      providerName: rollup.providerName,
      apiKeyId: rollup.apiKeyId,
      apiKeyName: rollup.apiKeyName,
      protocol: rollup.protocol,
      model: rollup.model,
      calls: rollup.calls || 0,
      okCalls: rollup.okCalls || 0,
      failedCalls: rollup.failedCalls || 0,
      inputTokens: rollup.inputTokens || 0,
      outputTokens: rollup.outputTokens || 0,
      cachedInputTokens: rollup.cachedInputTokens || 0,
      totalTokens: rollup.totalTokens || 0,
      realCostTotal: rollup.realCostTotal || 0,
      realCostCount: rollup.realCostCount || 0,
      currency: rollup.currency,
      updatedAt: rollup.updatedAt || rollup.bucketStart
    };
    if (!existing) {
      map.set(id, normalized);
      continue;
    }
    existing.calls += normalized.calls;
    existing.okCalls += normalized.okCalls;
    existing.failedCalls += normalized.failedCalls;
    existing.inputTokens += normalized.inputTokens;
    existing.outputTokens += normalized.outputTokens;
    existing.cachedInputTokens += normalized.cachedInputTokens;
    existing.totalTokens += normalized.totalTokens;
    existing.realCostTotal += normalized.realCostTotal;
    existing.realCostCount += normalized.realCostCount;
    existing.updatedAt = existing.updatedAt > normalized.updatedAt ? existing.updatedAt : normalized.updatedAt;
  }
  return Array.from(map.values()).sort((a, b) =>
    b.bucketStart.localeCompare(a.bucketStart) || a.period.localeCompare(b.period)
  );
}

function usageRollupId(
  period: UsageRollupPeriod,
  bucketStart: string,
  providerId: string,
  apiKeyId: string | undefined,
  model: string | undefined,
  currency: string | undefined
): string {
  return [
    period,
    bucketStart,
    providerId,
    apiKeyId || "no-key",
    model || "no-model",
    currency || "no-unit"
  ].join("|");
}

function monthBucketStart(value: string): string {
  const date = validDate(value);
  return `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-01`;
}

function weekBucketStart(value: string): string {
  const date = validDate(value);
  const day = date.getUTCDay() || 7;
  const start = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  start.setUTCDate(start.getUTCDate() - day + 1);
  return start.toISOString().slice(0, 10);
}

function validDate(value: string): Date {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : new Date(0);
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

export function buildProxyBaseUrl(port: number, providerId: string, keyId: string, baseUrl: string, protocol?: ApiProtocol): string {
  const base = new URL(normalizeBaseUrl(baseUrl));
  const upstreamPath = base.pathname === "/" ? "" : base.pathname.replace(/\/$/, "");
  const proxyPath = normalizedProxyPath(upstreamPath, protocol);
  return `http://127.0.0.1:${port}/proxy/${providerId}/${keyId}${proxyPath}`;
}

function normalizedProxyPath(upstreamPath: string, protocol?: ApiProtocol): string {
  if (protocol !== "openai-compatible") return upstreamPath;
  if (!upstreamPath) return "/v1";
  if (/(^|\/)v\d+$/i.test(upstreamPath)) return upstreamPath;
  return `${upstreamPath}/v1`;
}

function normalizeBaseUrl(value: string): string {
  const url = new URL(stringValue(value).trim());
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw badRequest("Invalid URL: baseUrl must use http or https", "invalid_url");
  }
  url.hash = "";
  url.search = "";
  return url.toString().replace(/\/$/, "");
}

function normalizeProtocol(value: unknown): "openai-compatible" | "anthropic-compatible" {
  if (value === "openai-compatible" || value === "anthropic-compatible") return value;
  throw badRequest(`Unsupported protocol: ${String(value)}`, "unsupported_protocol");
}

function normalizeBalanceConfig(value: Partial<BalanceConfig> | undefined): BalanceConfig {
  const raw = { ...defaultBalanceConfig, ...value };
  if (raw.method !== "GET" && raw.method !== "POST") {
    throw badRequest(`Unsupported balance method: ${String(raw.method)}`, "unsupported_balance_method");
  }
  const config: BalanceConfig = {
    enabled: Boolean(raw.enabled),
    url: stringValue(raw.url),
    method: raw.method,
    headersJson: stringValue(raw.headersJson),
    bodyTemplate: stringValue(raw.bodyTemplate),
    balancePath: stringValue(raw.balancePath),
    spentPath: stringValue(raw.spentPath),
    currencyPath: stringValue(raw.currencyPath),
    responseCostPath: stringValue(raw.responseCostPath)
  };
  if (config.enabled && config.url.trim()) {
    const url = new URL(config.url.trim());
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw badRequest("Invalid URL: billing URL must use http or https", "invalid_url");
    }
  }
  return config;
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}
