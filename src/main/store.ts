import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import type {
  AddKeyInput,
  AccountPool,
  AccountPoolInput,
  AccountPoolKind,
  AccountPoolStatus,
  AccountPoolImportResult,
  AccountPoolTestResult,
  ApiKeyInput,
  ApiKeySafe,
  ApiProtocol,
  AppState,
  BalanceConfig,
  BalanceSnapshot,
  CloudflaredStatus,
  CloudflaredConfig,
  DashboardTotals,
  LocalService,
  LocalServiceProtocol,
  LocalServiceStatus,
  ModelCapability,
  ProviderInput,
  ProviderModel,
  ProviderModelInput,
  ProviderModelSource,
  ProviderSafe,
  ProxyModelRule,
  ProxyTokenInput,
  ProxyTokenSafe,
  UsageEvent,
  UsageRollup,
  UsageRollupPeriod
} from "../shared/types";
import { defaultBalanceConfig } from "../shared/balanceConfig";
import { cpaProviderBaseUrl } from "./cpaConnector";
import {
  createVaultHeader,
  decryptString,
  encryptString,
  unlockVaultHeader,
  type EncryptedText,
  type VaultHeader
} from "./crypto";
import { badRequest, conflict, locked, notFound } from "./errors";
import { generateProxyTokenSecret, hashApiKey, hashProxyToken, maskKey, maskProxyToken } from "./storeSecrets";

interface ApiKeyRecord {
  id: string;
  name: string;
  apiKey: EncryptedText;
  queryKey?: EncryptedText;
  keyHash?: string;
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
  isLocal?: boolean;
  status?: LocalServiceStatus;
  latencyMs?: number;
  lastCheckedAt?: string;
}

interface ProxyTokenRecord {
  id: string;
  name: string;
  tokenHash: string;
  tokenSecret?: EncryptedText;
  tokenMasked: string;
  enabled: boolean;
  allowedProviderIds: string[];
  allowedModels: ProxyModelRule[];
  allowStreaming: boolean;
  requestsPerMinute: number;
  requestsPerDay: number;
  expiresAt?: string;
  createdAt: string;
  updatedAt: string;
  lastUsedAt?: string;
}

interface AccountPoolRecord {
  id: string;
  name: string;
  kind: AccountPoolKind;
  baseUrl: string;
  managementUrl?: string;
  authsDirectory?: string;
  providerId?: string;
  status: AccountPoolStatus;
  latencyMs?: number;
  lastCheckedAt?: string;
  modelNames: string[];
  lastError?: string;
  rootStatus?: number;
  modelsStatus?: number;
  notes?: string;
  apiKey?: EncryptedText;
  apiKeyMasked?: string;
  managementSecret?: EncryptedText;
  managementSecretMasked?: string;
  createdAt: string;
  updatedAt: string;
}

interface ProviderModelRecord {
  id: string;
  providerId: string;
  modelId: string;
  displayName?: string;
  aliases: string[];
  canonicalModelId?: string;
  capabilities: ModelCapability[];
  inputPrice?: number;
  outputPrice?: number;
  contextWindow?: number;
  source: ProviderModelSource;
  lastSeenAt?: string;
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

export interface ProxyTokenForUse extends ProxyTokenSafe {
  tokenHash: string;
}

export interface PublicProxyResolution {
  token: ProxyTokenForUse;
  provider: ProviderForProxy;
  publicModel?: string;
  upstreamModel?: string;
}

export interface AccountPoolForConnector {
  id: string;
  name: string;
  kind: AccountPoolKind;
  baseUrl: string;
  managementUrl?: string;
  authsDirectory?: string;
  apiKey?: string;
  managementSecret?: string;
}

interface PersistedData {
  version: number;
  storageVersion?: number;
  vault?: VaultHeader;
  providers: ProviderRecord[];
  proxyTokens: ProxyTokenRecord[];
  accountPools: AccountPoolRecord[];
  modelCatalog: ProviderModelRecord[];
  usageEvents: UsageEvent[];
  usageRollups: UsageRollup[];
  balanceSnapshots: BalanceSnapshot[];
  localServices: LocalServiceRecord[];
  cloudflaredPublicUrl?: string;
  cloudflaredConfig?: CloudflaredConfig;
}

interface RawPersistedData extends Partial<PersistedData> {
  providers?: any[];
  proxyTokens?: any[];
  accountPools?: any[];
  modelCatalog?: any[];
  localServices?: any[];
}

interface LocalServiceRecord extends LocalService {
  apiKey?: EncryptedText;
}

interface StorageAdapter {
  read(): RawPersistedData | undefined;
  write(data: PersistedData): void;
}

class JsonFileStorageAdapter implements StorageAdapter {
  constructor(private readonly filePath: string) {}

  read(): RawPersistedData | undefined {
    if (!existsSync(this.filePath)) return undefined;
    return JSON.parse(readFileSync(this.filePath, "utf8")) as RawPersistedData;
  }

  write(data: PersistedData): void {
    mkdirSync(dirname(this.filePath), { recursive: true });
    const tempPath = `${this.filePath}.${process.pid}.${randomUUID()}.tmp`;
    writeFileSync(tempPath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
    renameSync(tempPath, this.filePath);
  }
}

const RECENT_USAGE_LIMIT = 1000;
const BALANCE_SNAPSHOT_LIMIT = 1000;
const USAGE_FLUSH_INTERVAL_MS = 5000;
const USAGE_FLUSH_BATCH_SIZE = 50;

export class VaultStore {
  private readonly filePath: string;
  private readonly storage: StorageAdapter;
  private data: PersistedData;
  private masterKey?: Buffer;
  private pendingUsageEvents: UsageEvent[] = [];
  private pendingApiKeyUsed = new Map<string, string>();
  private pendingProxyTokenUsed = new Map<string, string>();
  private flushTimer?: NodeJS.Timeout;

  constructor(filePath = join(process.cwd(), ".api-vault", "vault.json")) {
    this.filePath = filePath;
    this.storage = new JsonFileStorageAdapter(filePath);
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
    this.backfillApiKeyHashes();
  }

  lock(): void {
    this.masterKey = undefined;
  }

  getState(proxyPort?: number, cloudflaredStatus?: CloudflaredStatus): AppState {
    this.reloadFromDisk();
    const providers = this.data.providers.map((provider) => this.safeProvider(provider, proxyPort));
    return {
      ...this.status,
      proxyPort,
      providers,
      proxyTokens: this.data.proxyTokens.map((token) => this.safeProxyToken(token)),
      accountPools: this.data.accountPools.map((pool) => this.safeAccountPool(pool)),
      modelCatalog: this.data.modelCatalog.map((model) => this.safeProviderModel(model, providers)),
      usageEvents: [...this.data.usageEvents].sort((a, b) => b.startedAt.localeCompare(a.startedAt)),
      usageRollups: [...this.data.usageRollups].sort((a, b) =>
        b.bucketStart.localeCompare(a.bucketStart) || a.period.localeCompare(b.period)
      ),
      balanceSnapshots: [...this.data.balanceSnapshots].sort((a, b) => b.checkedAt.localeCompare(a.checkedAt)),
      totals: this.totals(),
      localServices: this.data.localServices.map((service) => this.safeLocalService(service)),
      cloudflared: cloudflaredStatus ?? { running: false }
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
      updatedAt: now,
      isLocal: input.isLocal ?? existing?.isLocal ?? false,
      status: existing?.status ?? "unknown",
      latencyMs: existing?.latencyMs,
      lastCheckedAt: existing?.lastCheckedAt
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

  getProviderFirstApiKeyPlaintext(providerId: string): string | undefined {
    try {
      const masterKey = this.requireKey();
      this.reloadFromDisk();
      const provider = this.data.providers.find((p) => p.id === providerId);
      if (!provider || provider.apiKeys.length === 0) return undefined;
      return decryptString(masterKey, provider.apiKeys[0].apiKey);
    } catch {
      return undefined;
    }
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

  getProviderForProviderProxy(providerId: string, incomingApiKey?: string): ProviderForProxy {
    const masterKey = this.requireKey();
    this.reloadFromDisk();
    const provider = this.data.providers.find((p) => p.id === providerId);
    if (!provider) throw notFound("Provider not found", "provider_not_found");
    if (provider.apiKeys.length === 0) throw notFound("Provider has no API keys", "api_key_not_found");

    const incoming = stringValue(incomingApiKey).trim();
    let record: ApiKeyRecord | undefined;
    let plaintext = "";

    if (incoming) {
      const incomingHash = hashApiKey(masterKey, incoming);
      const candidates = provider.apiKeys.filter((candidate) => candidate.keyHash === incomingHash || !candidate.keyHash);
      for (const candidate of candidates) {
        const decrypted = decryptString(masterKey, candidate.apiKey);
        if (decrypted !== incoming) continue;
        record = candidate;
        plaintext = decrypted;
        break;
      }
    }
    if (!record) {
      if (!allowProviderProxyWithoutIncomingKey()) {
        throw badRequest("Missing Authorization Bearer token or x-api-key", "missing_api_key");
      }
      record = provider.apiKeys[0];
      plaintext = decryptString(masterKey, record.apiKey);
    }

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
  getProviderForIncomingApiKey(apiKey: string, protocol?: ApiProtocol): ProviderForProxy {
    const masterKey = this.requireKey();
    this.reloadFromDisk();
    const incoming = apiKey.trim();
    if (!incoming) throw badRequest("API key is required", "api_key_required");
    const incomingHash = hashApiKey(masterKey, incoming);

    const matches: ProviderForProxy[] = [];
    for (const provider of this.data.providers) {
      if (protocol && !protocolCanServe(provider.protocol, protocol)) continue;
      for (const record of provider.apiKeys) {
        if (record.keyHash && record.keyHash !== incomingHash) continue;
        const plaintext = decryptString(masterKey, record.apiKey);
        if (plaintext !== incoming) continue;
        matches.push({
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
        });
      }
    }

    if (matches.length === 0) {
      throw notFound("API key is not registered in API Vault", "api_key_not_found");
    }
    if (matches.length > 1) {
      const scope = protocol ? protocol : "all protocols";
      throw conflict(`The same API key is registered multiple times under ${scope}. Delete the duplicate key before using the global API Vault Base URL.`, "duplicate_api_key");
    }
    return matches[0];
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

  createProxyToken(input: ProxyTokenInput): { token: ProxyTokenSafe; secret: string } {
    const key = this.requireKey();
    this.reloadFromDisk();
    const now = new Date().toISOString();
    const secret = generateProxyTokenSecret();
    const record: ProxyTokenRecord = {
      id: randomUUID(),
      name: normalizeProxyTokenName(input.name),
      tokenHash: hashProxyToken(secret),
      tokenSecret: encryptString(key, secret),
      tokenMasked: maskProxyToken(secret),
      enabled: input.enabled ?? true,
      allowedProviderIds: [...new Set(input.allowedProviderIds ?? [])],
      allowedModels: normalizeModelRules(input.allowedModels ?? []),
      allowStreaming: Boolean(input.allowStreaming),
      requestsPerMinute: clampLimit(input.requestsPerMinute, 1, 10_000, 60),
      requestsPerDay: clampLimit(input.requestsPerDay, 1, 1_000_000, 10_000),
      expiresAt: validOptionalDate(input.expiresAt),
      createdAt: now,
      updatedAt: now
    };
    this.data.proxyTokens.push(record);
    this.save();
    return { token: this.safeProxyToken(record), secret };
  }

  updateProxyToken(id: string, input: ProxyTokenInput): ProxyTokenSafe {
    this.requireKey();
    this.reloadFromDisk();
    const record = this.data.proxyTokens.find((token) => token.id === id);
    if (!record) throw notFound("Proxy token not found", "proxy_token_not_found");
    record.name = normalizeProxyTokenName(input.name);
    record.enabled = input.enabled ?? record.enabled;
    record.allowedProviderIds = [...new Set(input.allowedProviderIds ?? [])];
    record.allowedModels = normalizeModelRules(input.allowedModels ?? []);
    record.allowStreaming = Boolean(input.allowStreaming);
    record.requestsPerMinute = clampLimit(input.requestsPerMinute, 1, 10_000, 60);
    record.requestsPerDay = clampLimit(input.requestsPerDay, 1, 1_000_000, 10_000);
    record.expiresAt = validOptionalDate(input.expiresAt);
    record.updatedAt = new Date().toISOString();
    this.save();
    return this.safeProxyToken(record);
  }

  deleteProxyToken(id: string): void {
    this.requireKey();
    this.reloadFromDisk();
    this.data.proxyTokens = this.data.proxyTokens.filter((token) => token.id !== id);
    this.save();
  }

  regenerateProxyToken(id: string): { token: ProxyTokenSafe; secret: string } {
    const key = this.requireKey();
    this.reloadFromDisk();
    const record = this.data.proxyTokens.find((token) => token.id === id);
    if (!record) throw notFound("Proxy token not found", "proxy_token_not_found");
    const secret = generateProxyTokenSecret();
    record.tokenHash = hashProxyToken(secret);
    record.tokenSecret = encryptString(key, secret);
    record.tokenMasked = maskProxyToken(secret);
    record.updatedAt = new Date().toISOString();
    this.save();
    return { token: this.safeProxyToken(record), secret };
  }

  getProxyTokenPlaintext(id: string): string {
    const key = this.requireKey();
    this.reloadFromDisk();
    const record = this.data.proxyTokens.find((token) => token.id === id);
    if (!record) throw notFound("Proxy token not found", "proxy_token_not_found");
    if (!record.tokenSecret) {
      throw notFound("This proxy token was created before encrypted reveal support. Regenerate it once to enable Show Key.", "proxy_token_secret_not_stored");
    }
    return decryptString(key, record.tokenSecret);
  }

  setProxyTokenPlaintext(id: string, secret: string): ProxyTokenSafe {
    const key = this.requireKey();
    this.reloadFromDisk();
    const record = this.data.proxyTokens.find((token) => token.id === id);
    if (!record) throw notFound("Proxy token not found", "proxy_token_not_found");
    const trimmed = secret.trim();
    if (!trimmed.startsWith("proxy_")) throw badRequest("Proxy token must start with proxy_", "invalid_proxy_token");
    record.tokenHash = hashProxyToken(trimmed);
    record.tokenSecret = encryptString(key, trimmed);
    record.tokenMasked = maskProxyToken(trimmed);
    record.updatedAt = new Date().toISOString();
    this.save();
    return this.safeProxyToken(record);
  }

  getProxyTokenForSecret(secret: string): ProxyTokenForUse {
    this.reloadFromDisk();
    const hash = hashProxyToken(secret.trim());
    const record = this.data.proxyTokens.find((token) => token.tokenHash === hash);
    if (!record) throw notFound("Proxy token not found", "proxy_token_not_found");
    const safe = this.safeProxyToken(record);
    return { ...safe, tokenHash: record.tokenHash };
  }

  markProxyTokenUsed(id: string, when: string): void {
    this.applyProxyTokenUsed(this.data, id, when);
    this.rememberLatest(this.pendingProxyTokenUsed, id, when);
    this.scheduleUsageFlush();
  }

  resolvePublicProxy(secret: string, model: string | undefined, explicitProviderId: string | undefined, stream: boolean): PublicProxyResolution {
    const token = this.getProxyTokenForSecret(secret);
    if (!token.enabled) throw badRequest("Proxy token is disabled", "proxy_token_disabled");
    if (token.expiresAt && new Date(token.expiresAt).getTime() <= Date.now()) {
      throw badRequest("Proxy token is expired", "proxy_token_expired");
    }
    if (stream && !token.allowStreaming) throw badRequest("This proxy token does not allow streaming requests", "stream_not_allowed");

    const providerIds = token.allowedProviderIds.length > 0 ? token.allowedProviderIds : this.data.providers.map((p) => p.id);
    const matchingRules = token.allowedModels.filter((rule) => {
      if (model && rule.publicModel !== model) return false;
      if (explicitProviderId && rule.providerId !== explicitProviderId) return false;
      return providerIds.includes(rule.providerId);
    });

    if (matchingRules.length > 1) {
      throw conflict("Model maps to multiple providers. Send X-Provider-Id to choose one.", "model_mapping_ambiguous");
    }

    if (matchingRules.length === 1) {
      const rule = matchingRules[0];
      return {
        token,
        provider: this.getProviderForPublicProxy(rule.providerId, rule.apiKeyId),
        publicModel: rule.publicModel,
        upstreamModel: rule.upstreamModel
      };
    }

    if (!explicitProviderId) {
      throw notFound("No proxy model mapping matched this request. Add a model rule or send X-Provider-Id.", "model_mapping_not_found");
    }
    if (!providerIds.includes(explicitProviderId)) throw badRequest("Provider is not allowed for this proxy token", "provider_not_allowed");
    if (token.allowedModels.length > 0 && model && !token.allowedModels.some((rule) => rule.providerId === explicitProviderId && rule.publicModel === model)) {
      throw badRequest("Model is not allowed for this proxy token", "model_not_allowed");
    }
    return {
      token,
      provider: this.getProviderForPublicProxy(explicitProviderId),
      publicModel: model,
      upstreamModel: model
    };
  }

  markApiKeyUsed(providerId: string, keyId: string, when: string): void {
    const pendingKey = `${providerId}:${keyId}`;
    this.applyApiKeyUsed(this.data, providerId, keyId, when);
    this.rememberLatest(this.pendingApiKeyUsed, pendingKey, when);
    this.scheduleUsageFlush();
  }

  findProviderByHostAndProtocol(host: string, protocol: ApiProtocol): ProviderRecord | undefined {
    const normalizedHost = host.toLowerCase();
    return this.data.providers.find((p) => {
      if (!protocolsOverlap(p.protocol, protocol)) return false;
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
          updatedAt: now,
          isLocal: input.isLocal ?? false,
          status: "unknown"
        };
        this.data.providers.push(providerRecord);
      } else {
        if (providerRecord.protocol !== protocol && protocolsOverlap(providerRecord.protocol, protocol)) {
          providerRecord.protocol = mergeProtocols(providerRecord.protocol, protocol);
          providerRecord.updatedAt = new Date().toISOString();
        }
        if (input.isLocal !== undefined && providerRecord.isLocal !== input.isLocal) {
          providerRecord.isLocal = input.isLocal;
          providerRecord.updatedAt = new Date().toISOString();
        }
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
    if (this.data.usageEvents.some((item) => item.id === event.id)) return;
    if (this.pendingUsageEvents.some((item) => item.id === event.id)) return;
    this.pendingUsageEvents.push(event);
    this.data.usageEvents.unshift(event);
    this.compactUsage();
    if (this.pendingUsageEvents.length >= USAGE_FLUSH_BATCH_SIZE) {
      this.flushPendingWrites();
      return;
    }
    this.scheduleUsageFlush();
  }

  appendBalance(snapshot: BalanceSnapshot): void {
    this.reloadFromDisk();
    if (this.data.balanceSnapshots.some((item) => item.id === snapshot.id)) return;
    this.data.balanceSnapshots.unshift(snapshot);
    this.data.balanceSnapshots = this.data.balanceSnapshots.slice(0, BALANCE_SNAPSHOT_LIMIT);
    this.save();
  }

  getAccountPools(): AccountPool[] {
    this.reloadFromDisk();
    return this.data.accountPools.map((pool) => this.safeAccountPool(pool));
  }

  getAccountPoolForConnector(id: string): AccountPoolForConnector {
    const key = this.requireKey();
    this.reloadFromDisk();
    const pool = this.data.accountPools.find((item) => item.id === id);
    if (!pool) throw notFound("Account pool not found", "account_pool_not_found");
    return {
      id: pool.id,
      name: pool.name,
      kind: pool.kind,
      baseUrl: pool.baseUrl,
      managementUrl: pool.managementUrl,
      authsDirectory: pool.authsDirectory,
      apiKey: pool.apiKey ? decryptString(key, pool.apiKey) : undefined,
      managementSecret: pool.managementSecret ? decryptString(key, pool.managementSecret) : undefined
    };
  }

  upsertAccountPool(input: AccountPoolInput): AccountPool {
    const key = this.requireKey();
    this.reloadFromDisk();
    const now = new Date().toISOString();
    const existing = input.id ? this.data.accountPools.find((pool) => pool.id === input.id) : undefined;
    const apiKeyInput = typeof input.apiKey === "string" ? input.apiKey.trim() : undefined;
    const managementSecretInput = typeof input.managementSecret === "string" ? input.managementSecret.trim() : undefined;
    const record: AccountPoolRecord = {
      id: existing?.id ?? randomUUID(),
      name: stringValue(input.name).trim(),
      kind: normalizeAccountPoolKind(input.kind),
      baseUrl: normalizeBaseUrl(input.baseUrl),
      managementUrl: normalizeOptionalUrl(input.managementUrl) ?? existing?.managementUrl,
      authsDirectory: normalizeOptionalText(input.authsDirectory) ?? existing?.authsDirectory,
      providerId: normalizeOptionalText(input.providerId) ?? existing?.providerId,
      status: existing?.status ?? "unknown",
      latencyMs: existing?.latencyMs,
      lastCheckedAt: existing?.lastCheckedAt,
      modelNames: existing?.modelNames ?? [],
      lastError: existing?.lastError,
      rootStatus: existing?.rootStatus,
      modelsStatus: existing?.modelsStatus,
      notes: normalizeOptionalText(input.notes) ?? existing?.notes,
      apiKey: apiKeyInput ? encryptString(key, apiKeyInput) : existing?.apiKey,
      apiKeyMasked: apiKeyInput ? maskKey(apiKeyInput) : existing?.apiKeyMasked,
      managementSecret: managementSecretInput ? encryptString(key, managementSecretInput) : existing?.managementSecret,
      managementSecretMasked: managementSecretInput ? maskKey(managementSecretInput) : existing?.managementSecretMasked,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now
    };
    if (!record.name) throw badRequest("Account pool name is required", "account_pool_name_required");

    if (existing) {
      this.data.accountPools = this.data.accountPools.map((pool) => pool.id === record.id ? record : pool);
    } else {
      this.data.accountPools.push(record);
    }
    this.save();
    return this.safeAccountPool(record);
  }

  deleteAccountPool(id: string): void {
    this.requireKey();
    this.reloadFromDisk();
    this.data.accountPools = this.data.accountPools.filter((pool) => pool.id !== id);
    this.save();
  }

  ensureAccountPoolProvider(id: string): { pool: AccountPool; provider: ProviderSafe } {
    const key = this.requireKey();
    this.reloadFromDisk();
    const pool = this.data.accountPools.find((item) => item.id === id);
    if (!pool) throw notFound("Account pool not found", "account_pool_not_found");
    if (!pool.apiKey) throw badRequest("Account pool proxy API key is required before creating a provider", "account_pool_api_key_required");

    const now = new Date().toISOString();
    const providerBaseUrl = accountPoolProviderBaseUrl(pool.kind, pool.baseUrl);
    const proxyApiKey = decryptString(key, pool.apiKey);
    const poolLabel = accountPoolKindLabel(pool.kind);
    let provider = pool.providerId ? this.data.providers.find((item) => item.id === pool.providerId) : undefined;

    if (!provider) {
      provider = {
        id: randomUUID(),
        name: `${pool.name} Provider`,
        protocol: "openai-compatible",
        baseUrl: providerBaseUrl,
        currency: "USD",
        balanceConfig: { ...defaultBalanceConfig },
        apiKeys: [],
        createdAt: now,
        updatedAt: now,
        isLocal: true,
        status: pool.status
      };
      this.data.providers.push(provider);
      pool.providerId = provider.id;
    }

    provider.name = provider.name || `${pool.name} Provider`;
    provider.protocol = "openai-compatible";
    provider.baseUrl = providerBaseUrl;
    provider.currency = provider.currency || "USD";
    provider.balanceConfig = provider.balanceConfig ?? { ...defaultBalanceConfig };
    provider.isLocal = true;
    provider.status = pool.status;
    provider.latencyMs = pool.latencyMs;
    provider.lastCheckedAt = pool.lastCheckedAt;
    provider.updatedAt = now;

    const firstKey = provider.apiKeys[0];
    const keyHash = hashApiKey(key, proxyApiKey);
    if (!firstKey) {
      provider.apiKeys.push({
        id: randomUUID(),
        name: `${poolLabel} proxy`,
        apiKey: encryptString(key, proxyApiKey),
        keyHash,
        keyMasked: maskKey(proxyApiKey),
        createdAt: now
      });
    } else if (firstKey.keyHash !== keyHash) {
      firstKey.name = firstKey.name || `${poolLabel} proxy`;
      firstKey.apiKey = encryptString(key, proxyApiKey);
      firstKey.keyHash = keyHash;
      firstKey.keyMasked = maskKey(proxyApiKey);
    }

    pool.updatedAt = now;
    this.save();
    return { pool: this.safeAccountPool(pool), provider: this.safeProvider(provider) };
  }

  updateAccountPoolSyncResult(id: string, result: AccountPoolTestResult): AccountPool {
    this.requireKey();
    this.reloadFromDisk();
    const pool = this.data.accountPools.find((item) => item.id === id);
    if (!pool) throw notFound("Account pool not found", "account_pool_not_found");
    pool.status = result.ok ? "available" : "unavailable";
    pool.latencyMs = result.latencyMs;
    pool.lastCheckedAt = result.checkedAt;
    pool.modelNames = normalizeModelNames(result.modelNames);
    pool.lastError = result.error;
    pool.rootStatus = result.rootStatus;
    pool.modelsStatus = result.modelsStatus;
    pool.updatedAt = new Date().toISOString();

    if (pool.providerId) {
      const provider = this.data.providers.find((item) => item.id === pool.providerId);
      if (provider) {
        provider.status = pool.status;
        provider.latencyMs = pool.latencyMs;
        provider.lastCheckedAt = pool.lastCheckedAt;
        provider.updatedAt = pool.updatedAt;
      }
    }

    this.save();
    return this.safeAccountPool(pool);
  }

  importAccountPoolModelsToProxyToken(
    poolId: string,
    input: { proxyTokenId: string; modelNames?: string[] }
  ): AccountPoolImportResult {
    this.requireKey();
    this.reloadFromDisk();
    const pool = this.data.accountPools.find((item) => item.id === poolId);
    if (!pool) throw notFound("Account pool not found", "account_pool_not_found");
    if (!pool.providerId) throw badRequest("Create or bind a provider before importing models", "account_pool_provider_required");
    const provider = this.data.providers.find((item) => item.id === pool.providerId);
    if (!provider) throw notFound("Linked provider not found", "provider_not_found");
    if (provider.apiKeys.length === 0) throw notFound("Linked provider has no API keys", "api_key_not_found");

    const token = this.data.proxyTokens.find((item) => item.id === input.proxyTokenId);
    if (!token) throw notFound("Proxy token not found", "proxy_token_not_found");

    const syncedModels = normalizeModelNames(pool.modelNames);
    const requestedModels = input.modelNames && input.modelNames.length > 0
      ? normalizeModelNames(input.modelNames)
      : syncedModels;
    if (requestedModels.length === 0) throw badRequest("No synced account pool models to import", "account_pool_models_required");

    const syncedModelSet = new Set(syncedModels);
    const unknownModel = requestedModels.find((model) => !syncedModelSet.has(model));
    if (unknownModel) {
      throw badRequest(`Model not found in account pool model list: ${unknownModel}`, "account_pool_model_not_found");
    }

    const requestedSet = new Set(requestedModels);
    const before = token.allowedModels;
    const kept = before.filter((rule) => !requestedSet.has(rule.publicModel));
    const replacedCount = before.length - kept.length;
    const apiKeyId = provider.apiKeys[0].id;
    const newRules = requestedModels.map((model) => ({
      publicModel: model,
      providerId: provider.id,
      apiKeyId,
      upstreamModel: model
    }));
    token.allowedModels = normalizeModelRules([...kept, ...newRules]);
    token.allowedProviderIds = [...new Set([...token.allowedProviderIds, provider.id])];
    token.updatedAt = new Date().toISOString();
    this.save();

    return {
      importedCount: newRules.length,
      replacedCount,
      skippedCount: 0,
      modelNames: requestedModels,
      token: this.safeProxyToken(token)
    };
  }

  getModelCatalog(): ProviderModel[] {
    this.reloadFromDisk();
    return this.data.modelCatalog.map((model) => this.safeProviderModel(model));
  }

  getKnownProviderModelIds(providerId: string): string[] {
    this.reloadFromDisk();
    const models = [
      ...this.data.modelCatalog
        .filter((model) => model.providerId === providerId)
        .map((model) => model.modelId),
      ...this.data.proxyTokens.flatMap((token) =>
        token.allowedModels
          .filter((rule) => rule.providerId === providerId)
          .map((rule) => rule.upstreamModel)
      ),
      ...this.data.usageEvents
        .filter((event) => event.providerId === providerId && event.model)
        .map((event) => event.model!)
    ];
    return normalizeModelNames(models);
  }

  upsertProviderModel(input: ProviderModelInput): ProviderModel {
    this.requireKey();
    this.reloadFromDisk();
    const provider = this.data.providers.find((item) => item.id === input.providerId);
    if (!provider) throw notFound("Provider not found", "provider_not_found");
    const modelId = stringValue(input.modelId).trim();
    if (!modelId) throw badRequest("Model ID is required", "model_id_required");
    const now = new Date().toISOString();
    const existing = input.id
      ? this.data.modelCatalog.find((model) => model.id === input.id)
      : this.data.modelCatalog.find((model) => model.providerId === provider.id && model.modelId === modelId);
    const record: ProviderModelRecord = {
      id: existing?.id ?? randomUUID(),
      providerId: provider.id,
      modelId,
      displayName: normalizeOptionalText(input.displayName) ?? existing?.displayName,
      aliases: normalizeStringList(input.aliases ?? existing?.aliases ?? []),
      canonicalModelId: normalizeOptionalText(input.canonicalModelId) ?? existing?.canonicalModelId,
      capabilities: normalizeModelCapabilities(input.capabilities ?? existing?.capabilities ?? []),
      inputPrice: normalizeOptionalNumber(input.inputPrice ?? existing?.inputPrice),
      outputPrice: normalizeOptionalNumber(input.outputPrice ?? existing?.outputPrice),
      contextWindow: normalizeOptionalInteger(input.contextWindow ?? existing?.contextWindow),
      source: normalizeProviderModelSource(input.source ?? existing?.source ?? "manual"),
      lastSeenAt: existing?.lastSeenAt,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now
    };

    if (existing) {
      this.data.modelCatalog = this.data.modelCatalog.map((model) => model.id === record.id ? record : model);
    } else {
      this.data.modelCatalog.push(record);
    }
    this.save();
    return this.safeProviderModel(record);
  }

  upsertSyncedProviderModels(providerId: string, modelIds: string[], checkedAt: string): ProviderModel[] {
    this.requireKey();
    this.reloadFromDisk();
    const provider = this.data.providers.find((item) => item.id === providerId);
    if (!provider) throw notFound("Provider not found", "provider_not_found");
    const normalizedIds = normalizeModelNames(modelIds);
    const synced: ProviderModelRecord[] = [];
    for (const modelId of normalizedIds) {
      const existing = this.data.modelCatalog.find((model) => model.providerId === providerId && model.modelId === modelId);
      if (existing) {
        existing.source = existing.source === "manual" ? "manual" : "auto";
        existing.lastSeenAt = checkedAt;
        existing.updatedAt = checkedAt;
        synced.push(existing);
        continue;
      }
      const record: ProviderModelRecord = {
        id: randomUUID(),
        providerId,
        modelId,
        aliases: [],
        capabilities: inferModelCapabilities(modelId),
        source: "auto",
        lastSeenAt: checkedAt,
        createdAt: checkedAt,
        updatedAt: checkedAt
      };
      this.data.modelCatalog.push(record);
      synced.push(record);
    }
    this.save();
    return synced.map((model) => this.safeProviderModel(model));
  }

  deleteProviderModel(id: string): void {
    this.requireKey();
    this.reloadFromDisk();
    this.data.modelCatalog = this.data.modelCatalog.filter((model) => model.id !== id);
    this.save();
  }

  getLocalServices(): LocalService[] {
    this.reloadFromDisk();
    return this.data.localServices.map((service) => this.safeLocalService(service));
  }

  getLocalService(id: string): LocalServiceRecord | undefined {
    this.reloadFromDisk();
    return this.data.localServices.find((s) => s.id === id);
  }

  upsertLocalService(input: Partial<LocalService> & { name: string; baseUrl: string; apiKey?: string }): LocalService {
    const key = this.requireKey();
    this.reloadFromDisk();
    const now = new Date().toISOString();
    const existing = input.id ? this.data.localServices.find((s) => s.id === input.id) : undefined;
    const apiKeyInput = typeof input.apiKey === "string" ? input.apiKey.trim() : undefined;
    const record: LocalServiceRecord = {
      id: existing?.id ?? randomUUID(),
      name: input.name.trim(),
      baseUrl: normalizeBaseUrl(input.baseUrl),
      type: input.type === undefined ? existing?.type ?? "unknown" : normalizeLocalServiceProtocol(input.type),
      status: input.status === undefined ? existing?.status ?? "unknown" : normalizeConnectionStatus(input.status),
      latencyMs: input.latencyMs ?? existing?.latencyMs,
      lastCheckedAt: input.lastCheckedAt ?? existing?.lastCheckedAt,
      publicAccessUrl: input.publicAccessUrl ?? existing?.publicAccessUrl,
      notes: input.notes ?? existing?.notes,
      hasApiKey: apiKeyInput !== undefined ? Boolean(apiKeyInput) : (existing?.hasApiKey ?? Boolean(existing?.apiKey)),
      keyMasked: apiKeyInput ? maskKey(apiKeyInput) : existing?.keyMasked,
      apiKey: apiKeyInput ? encryptString(key, apiKeyInput) : existing?.apiKey,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now
    };
    if (!record.name) throw badRequest("Local service name is required", "local_service_name_required");
    if (!record.baseUrl) throw badRequest("Base URL is required", "base_url_required");

    if (existing) {
      this.data.localServices = this.data.localServices.map((s) => s.id === record.id ? record : s);
    } else {
      this.data.localServices.push(record);
    }
    this.save();
    return this.safeLocalService(record);
  }

  deleteLocalService(id: string): void {
    this.reloadFromDisk();
    this.data.localServices = this.data.localServices.filter((s) => s.id !== id);
    this.save();
  }

  updateLocalServiceStatus(id: string, status: LocalServiceStatus, latencyMs?: number, checkedAt?: string): void {
    this.reloadFromDisk();
    const service = this.data.localServices.find((s) => s.id === id);
    if (!service) return;
    service.status = status;
    if (latencyMs !== undefined) service.latencyMs = latencyMs;
    if (checkedAt) service.lastCheckedAt = checkedAt;
    service.updatedAt = new Date().toISOString();
    this.save();
  }

  getLocalServiceApiKey(id: string): string | undefined {
    const service = this.getLocalService(id);
    if (!service?.apiKey) return undefined;
    const key = this.requireKey();
    return decryptString(key, service.apiKey);
  }

  updateProviderConnectionStatus(id: string, status: LocalServiceStatus, latencyMs?: number, checkedAt?: string): void {
    this.reloadFromDisk();
    const provider = this.data.providers.find((p) => p.id === id);
    if (!provider) return;
    provider.status = status;
    if (latencyMs !== undefined) provider.latencyMs = latencyMs;
    if (checkedAt) provider.lastCheckedAt = checkedAt;
    provider.updatedAt = new Date().toISOString();
    this.save();
  }

  getCloudflaredPublicUrl(): string | undefined {
    return this.data.cloudflaredPublicUrl;
  }

  getCloudflaredConfig(): CloudflaredConfig | undefined {
    return this.data.cloudflaredConfig;
  }

  setCloudflaredConfig(config: CloudflaredConfig): void {
    this.reloadFromDisk();
    this.data.cloudflaredConfig = config;
    this.save();
  }

  setCloudflaredPublicUrl(url: string | undefined): void {
    this.reloadFromDisk();
    this.data.cloudflaredPublicUrl = url;
    this.save();
  }

  private load(): PersistedData {
    const raw = this.storage.read();
    if (!raw) {
      return {
        version: 1,
        storageVersion: 1,
        providers: [],
        proxyTokens: [],
        accountPools: [],
        modelCatalog: [],
        usageEvents: [],
        usageRollups: [],
        balanceSnapshots: [],
        localServices: []
      };
    }
    return normalizeData(raw);
  }

  private reloadFromDisk(): void {
    this.flushPendingWrites();
    this.data = this.load();
  }

  private save(): void {
    this.storage.write(this.data);
  }

  private scheduleUsageFlush(): void {
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = undefined;
      this.flushPendingWrites();
    }, USAGE_FLUSH_INTERVAL_MS);
    this.flushTimer.unref?.();
  }

  private flushPendingWrites(): void {
    if (!this.hasPendingWrites()) return;
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = undefined;
    }
    const pendingUsage = this.pendingUsageEvents;
    const pendingApiKeyUsed = new Map(this.pendingApiKeyUsed);
    const pendingProxyTokenUsed = new Map(this.pendingProxyTokenUsed);
    this.pendingUsageEvents = [];
    this.pendingApiKeyUsed.clear();
    this.pendingProxyTokenUsed.clear();

    this.data = this.load();
    this.applyPendingUsage(this.data, pendingUsage);
    for (const [key, when] of pendingApiKeyUsed) {
      const separator = key.indexOf(":");
      if (separator === -1) continue;
      this.applyApiKeyUsed(this.data, key.slice(0, separator), key.slice(separator + 1), when);
    }
    for (const [id, when] of pendingProxyTokenUsed) {
      this.applyProxyTokenUsed(this.data, id, when);
    }
    this.compactUsage();
    this.save();
  }

  private hasPendingWrites(): boolean {
    return this.pendingUsageEvents.length > 0 ||
      this.pendingApiKeyUsed.size > 0 ||
      this.pendingProxyTokenUsed.size > 0;
  }

  private applyPendingUsage(data: PersistedData, events: UsageEvent[]): void {
    const existingIds = new Set(data.usageEvents.map((event) => event.id));
    for (const event of events) {
      if (existingIds.has(event.id)) continue;
      data.usageEvents.unshift(event);
      existingIds.add(event.id);
    }
  }

  private applyApiKeyUsed(data: PersistedData, providerId: string, keyId: string, when: string): void {
    const provider = data.providers.find((p) => p.id === providerId);
    const record = provider?.apiKeys.find((k) => k.id === keyId);
    if (!record) return;
    if (!record.lastUsedAt || record.lastUsedAt < when) record.lastUsedAt = when;
  }

  private applyProxyTokenUsed(data: PersistedData, id: string, when: string): void {
    const record = data.proxyTokens.find((token) => token.id === id);
    if (!record) return;
    if (!record.lastUsedAt || record.lastUsedAt < when) record.lastUsedAt = when;
  }

  private rememberLatest(target: Map<string, string>, key: string, when: string): void {
    const current = target.get(key);
    if (!current || current < when) target.set(key, when);
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
      keyHash: hashApiKey(key, plaintext),
      keyMasked: maskKey(plaintext),
      createdAt: now
    };
    provider.apiKeys.push(record);
    provider.updatedAt = now;
    return record;
  }

  private backfillApiKeyHashes(): void {
    const masterKey = this.requireKey();
    let changed = false;
    for (const provider of this.data.providers) {
      for (const record of provider.apiKeys) {
        if (record.keyHash) continue;
        record.keyHash = hashApiKey(masterKey, decryptString(masterKey, record.apiKey));
        changed = true;
      }
    }
    if (changed) this.save();
  }

  private safeProvider(provider: ProviderRecord, proxyPort?: number): ProviderSafe {
    return {
      id: provider.id,
      name: provider.name,
      protocol: provider.protocol,
      baseUrl: provider.baseUrl,
      proxyBaseUrl: proxyPort
        ? buildProviderProxyBaseUrl(proxyPort, provider.id, provider.baseUrl, provider.protocol)
        : undefined,
      currency: provider.currency,
      balanceConfig: provider.balanceConfig,
      apiKeys: provider.apiKeys.map((key) => this.safeApiKey(provider, key, proxyPort)),
      createdAt: provider.createdAt,
      updatedAt: provider.updatedAt,
      isLocal: provider.isLocal ?? false,
      status: provider.status ?? "unknown",
      latencyMs: provider.latencyMs,
      lastCheckedAt: provider.lastCheckedAt
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

  private safeLocalService(service: LocalServiceRecord): LocalService {
    return {
      id: service.id,
      name: service.name,
      baseUrl: service.baseUrl,
      type: service.type,
      status: service.status,
      latencyMs: service.latencyMs,
      lastCheckedAt: service.lastCheckedAt,
      publicAccessUrl: service.publicAccessUrl,
      notes: service.notes,
      hasApiKey: service.hasApiKey ?? Boolean(service.apiKey),
      keyMasked: service.keyMasked,
      createdAt: service.createdAt,
      updatedAt: service.updatedAt
    };
  }

  private safeAccountPool(pool: AccountPoolRecord): AccountPool {
    return {
      id: pool.id,
      name: pool.name,
      kind: pool.kind,
      baseUrl: pool.baseUrl,
      managementUrl: pool.managementUrl,
      authsDirectory: pool.authsDirectory,
      providerId: pool.providerId,
      status: pool.status,
      latencyMs: pool.latencyMs,
      lastCheckedAt: pool.lastCheckedAt,
      modelNames: normalizeModelNames(pool.modelNames),
      lastError: pool.lastError,
      rootStatus: pool.rootStatus,
      modelsStatus: pool.modelsStatus,
      notes: pool.notes,
      hasApiKey: Boolean(pool.apiKey),
      apiKeyMasked: pool.apiKey ? pool.apiKeyMasked ?? "configured" : undefined,
      hasManagementSecret: Boolean(pool.managementSecret),
      managementSecretMasked: pool.managementSecret ? pool.managementSecretMasked ?? "****" : undefined,
      createdAt: pool.createdAt,
      updatedAt: pool.updatedAt
    };
  }

  private safeProviderModel(model: ProviderModelRecord, providers?: ProviderSafe[]): ProviderModel {
    const providerName = providers?.find((provider) => provider.id === model.providerId)?.name
      ?? this.data.providers.find((provider) => provider.id === model.providerId)?.name
      ?? "Unknown provider";
    return {
      id: model.id,
      providerId: model.providerId,
      providerName,
      modelId: model.modelId,
      displayName: model.displayName,
      aliases: model.aliases,
      canonicalModelId: model.canonicalModelId,
      capabilities: model.capabilities,
      inputPrice: model.inputPrice,
      outputPrice: model.outputPrice,
      contextWindow: model.contextWindow,
      source: model.source,
      lastSeenAt: model.lastSeenAt,
      createdAt: model.createdAt,
      updatedAt: model.updatedAt
    };
  }

  private safeProxyToken(record: ProxyTokenRecord): ProxyTokenSafe {
    return {
      id: record.id,
      name: record.name,
      tokenMasked: record.tokenMasked,
      enabled: record.enabled,
      allowedProviderIds: record.allowedProviderIds,
      allowedModels: record.allowedModels,
      allowStreaming: record.allowStreaming,
      requestsPerMinute: record.requestsPerMinute,
      requestsPerDay: record.requestsPerDay,
      expiresAt: record.expiresAt,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      lastUsedAt: record.lastUsedAt
    };
  }

  private getProviderForPublicProxy(providerId: string, apiKeyId?: string): ProviderForProxy {
    const masterKey = this.requireKey();
    this.reloadFromDisk();
    const provider = this.data.providers.find((p) => p.id === providerId);
    if (!provider) throw notFound("Provider not found", "provider_not_found");
    if (provider.apiKeys.length === 0) throw notFound("Provider has no API keys", "api_key_not_found");
    const record = apiKeyId
      ? provider.apiKeys.find((key) => key.id === apiKeyId)
      : provider.apiKeys[0];
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

function normalizeData(data: RawPersistedData): PersistedData {
  return {
    version: data.version ?? 1,
    storageVersion: data.storageVersion ?? 1,
    vault: data.vault,
    providers: Array.isArray(data.providers) ? data.providers.map(migrateProvider) : [],
    proxyTokens: Array.isArray(data.proxyTokens) ? data.proxyTokens.map(migrateProxyToken) : [],
    accountPools: Array.isArray(data.accountPools) ? data.accountPools.map(migrateAccountPool) : [],
    modelCatalog: Array.isArray(data.modelCatalog) ? data.modelCatalog.map(migrateProviderModel) : [],
    usageEvents: Array.isArray(data.usageEvents) ? data.usageEvents : [],
    usageRollups: dedupeRollups(Array.isArray(data.usageRollups) ? data.usageRollups : []),
    balanceSnapshots: Array.isArray(data.balanceSnapshots) ? data.balanceSnapshots : [],
    localServices: Array.isArray(data.localServices) ? data.localServices.map(migrateLocalService) : [],
    cloudflaredPublicUrl: data.cloudflaredPublicUrl,
    cloudflaredConfig: data.cloudflaredConfig
  };
}

function migrateProxyToken(raw: any): ProxyTokenRecord {
  const now = new Date().toISOString();
  const tokenSecret = raw.tokenSecret && typeof raw.tokenSecret === "object" && typeof raw.tokenSecret.ciphertext === "string"
    ? raw.tokenSecret as EncryptedText
    : undefined;
  return {
    id: raw.id || randomUUID(),
    name: raw.name || "Proxy token",
    tokenHash: raw.tokenHash || "",
    tokenSecret,
    tokenMasked: raw.tokenMasked || "proxy_****",
    enabled: raw.enabled !== false,
    allowedProviderIds: Array.isArray(raw.allowedProviderIds) ? raw.allowedProviderIds.filter((item: unknown) => typeof item === "string") : [],
    allowedModels: normalizeModelRules(Array.isArray(raw.allowedModels) ? raw.allowedModels : []),
    allowStreaming: Boolean(raw.allowStreaming),
    requestsPerMinute: clampLimit(raw.requestsPerMinute, 1, 10_000, 60),
    requestsPerDay: clampLimit(raw.requestsPerDay, 1, 1_000_000, 10_000),
    expiresAt: validOptionalDate(raw.expiresAt),
    createdAt: raw.createdAt || now,
    updatedAt: raw.updatedAt || raw.createdAt || now,
    lastUsedAt: raw.lastUsedAt
  };
}

function migrateAccountPool(raw: any): AccountPoolRecord {
  const now = new Date().toISOString();
  const apiKey = raw.apiKey && typeof raw.apiKey === "object" && typeof raw.apiKey.ciphertext === "string"
    ? raw.apiKey as EncryptedText
    : undefined;
  const managementSecret = raw.managementSecret && typeof raw.managementSecret === "object" && typeof raw.managementSecret.ciphertext === "string"
    ? raw.managementSecret as EncryptedText
    : undefined;
  return {
    id: raw.id || randomUUID(),
    name: stringValue(raw.name).trim() || "Account pool",
    kind: normalizeAccountPoolKind(raw.kind),
    baseUrl: safeNormalizeBaseUrl(raw.baseUrl, "http://127.0.0.1:8317"),
    managementUrl: safeNormalizeOptionalUrl(raw.managementUrl),
    authsDirectory: normalizeOptionalText(raw.authsDirectory),
    providerId: normalizeOptionalText(raw.providerId),
    status: normalizeConnectionStatus(raw.status),
    latencyMs: typeof raw.latencyMs === "number" ? raw.latencyMs : undefined,
    lastCheckedAt: typeof raw.lastCheckedAt === "string" ? raw.lastCheckedAt : undefined,
    modelNames: normalizeModelNames(Array.isArray(raw.modelNames) ? raw.modelNames : []),
    lastError: typeof raw.lastError === "string" ? raw.lastError : undefined,
    rootStatus: typeof raw.rootStatus === "number" ? raw.rootStatus : undefined,
    modelsStatus: typeof raw.modelsStatus === "number" ? raw.modelsStatus : undefined,
    notes: normalizeOptionalText(raw.notes),
    apiKey,
    apiKeyMasked: typeof raw.apiKeyMasked === "string" ? raw.apiKeyMasked : undefined,
    managementSecret,
    managementSecretMasked: typeof raw.managementSecretMasked === "string" ? raw.managementSecretMasked : undefined,
    createdAt: raw.createdAt || now,
    updatedAt: raw.updatedAt || raw.createdAt || now
  };
}

function migrateProviderModel(raw: any): ProviderModelRecord {
  const now = new Date().toISOString();
  return {
    id: raw.id || randomUUID(),
    providerId: stringValue(raw.providerId).trim(),
    modelId: stringValue(raw.modelId).trim() || "unknown-model",
    displayName: normalizeOptionalText(raw.displayName),
    aliases: normalizeStringList(raw.aliases),
    canonicalModelId: normalizeOptionalText(raw.canonicalModelId),
    capabilities: normalizeModelCapabilities(Array.isArray(raw.capabilities) ? raw.capabilities : []),
    inputPrice: normalizeOptionalNumber(raw.inputPrice),
    outputPrice: normalizeOptionalNumber(raw.outputPrice),
    contextWindow: normalizeOptionalInteger(raw.contextWindow),
    source: normalizeProviderModelSource(raw.source),
    lastSeenAt: typeof raw.lastSeenAt === "string" ? raw.lastSeenAt : undefined,
    createdAt: raw.createdAt || now,
    updatedAt: raw.updatedAt || raw.createdAt || now
  };
}

function migrateProvider(raw: any): ProviderRecord {
  const apiKeys: ApiKeyRecord[] = Array.isArray(raw.apiKeys)
    ? raw.apiKeys.map((k: any) => ({
        id: k.id || randomUUID(),
        name: k.name || "default",
        apiKey: k.apiKey,
        queryKey: k.queryKey,
        keyHash: typeof k.keyHash === "string" ? k.keyHash : undefined,
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
      keyHash: typeof raw.keyHash === "string" ? raw.keyHash : undefined,
      keyMasked: "sk-****",
      createdAt: raw.createdAt || new Date().toISOString()
    });
  }

  return {
    id: raw.id || randomUUID(),
    name: raw.name || "Provider",
    protocol: normalizeStoredProtocol(raw.protocol),
    baseUrl: raw.baseUrl || "https://example.com",
    currency: raw.currency || "USD",
    balanceConfig: normalizeBalanceConfig(raw.balanceConfig),
    apiKeys,
    createdAt: raw.createdAt || new Date().toISOString(),
    updatedAt: raw.updatedAt || raw.createdAt || new Date().toISOString(),
    isLocal: Boolean(raw.isLocal),
    status: normalizeConnectionStatus(raw.status),
    latencyMs: typeof raw.latencyMs === "number" ? raw.latencyMs : undefined,
    lastCheckedAt: typeof raw.lastCheckedAt === "string" ? raw.lastCheckedAt : undefined
  };
}

function migrateLocalService(raw: any): LocalServiceRecord {
  const now = new Date().toISOString();
  const encryptedApiKey = raw.apiKey && typeof raw.apiKey === "object" && typeof raw.apiKey.ciphertext === "string"
    ? raw.apiKey as EncryptedText
    : undefined;
  return {
    id: raw.id || randomUUID(),
    name: stringValue(raw.name).trim() || "Local service",
    baseUrl: normalizeBaseUrl(raw.baseUrl || "http://127.0.0.1"),
    type: normalizeLocalServiceProtocol(raw.type),
    status: normalizeConnectionStatus(raw.status),
    latencyMs: typeof raw.latencyMs === "number" ? raw.latencyMs : undefined,
    lastCheckedAt: typeof raw.lastCheckedAt === "string" ? raw.lastCheckedAt : undefined,
    publicAccessUrl: typeof raw.publicAccessUrl === "string" ? raw.publicAccessUrl : undefined,
    notes: typeof raw.notes === "string" ? raw.notes : undefined,
    hasApiKey: Boolean(raw.hasApiKey || encryptedApiKey),
    keyMasked: typeof raw.keyMasked === "string" ? raw.keyMasked : undefined,
    apiKey: encryptedApiKey,
    createdAt: raw.createdAt || now,
    updatedAt: raw.updatedAt || raw.createdAt || now
  };
}

function legacyDefaultKeyId(providerId: unknown): string {
  const base = typeof providerId === "string" && providerId.trim() ? providerId.trim() : "provider";
  return `${base.replace(/[^a-zA-Z0-9_-]/g, "-")}-default-key`;
}

function allowProviderProxyWithoutIncomingKey(): boolean {
  return process.env.API_VAULT_ALLOW_PROVIDER_PROXY_WITHOUT_KEY === "1";
}

function normalizeProxyTokenName(value: string): string {
  const name = stringValue(value).trim();
  if (!name) throw badRequest("Proxy token name is required", "proxy_token_name_required");
  return name;
}

function normalizeModelRules(rules: ProxyModelRule[]): ProxyModelRule[] {
  return rules
    .map((rule) => ({
      publicModel: stringValue(rule.publicModel).trim(),
      providerId: stringValue(rule.providerId).trim(),
      apiKeyId: stringValue(rule.apiKeyId).trim() || undefined,
      upstreamModel: stringValue(rule.upstreamModel).trim()
    }))
    .filter((rule) => rule.publicModel && rule.providerId && rule.upstreamModel);
}

function clampLimit(value: unknown, min: number, max: number, fallback: number): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(numeric)));
}

function validOptionalDate(value: unknown): string | undefined {
  const text = stringValue(value).trim();
  if (!text) return undefined;
  const date = new Date(text);
  if (!Number.isFinite(date.getTime())) throw badRequest("Invalid expiration date", "invalid_expiration");
  return date.toISOString();
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

export function buildProxyBaseUrl(port: number, providerId: string, _keyId: string, baseUrl: string, protocol?: ApiProtocol): string {
  return buildProviderProxyBaseUrl(port, providerId, baseUrl, protocol);
}

export function buildProviderProxyBaseUrl(port: number, providerId: string, baseUrl: string, protocol?: ApiProtocol): string {
  const base = new URL(normalizeBaseUrl(baseUrl));
  const upstreamPath = base.pathname === "/" ? "" : base.pathname.replace(/\/$/, "");
  const proxyPath = normalizedProxyPath(upstreamPath, protocol);
  return `http://127.0.0.1:${port}/proxy/${providerId}${proxyPath}`;
}

function normalizedProxyPath(upstreamPath: string, protocol?: ApiProtocol): string {
  if (protocol !== "openai-compatible" && protocol !== "openai-anthropic-compatible") return upstreamPath;
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

function safeNormalizeBaseUrl(value: unknown, fallback: string): string {
  try {
    return normalizeBaseUrl(stringValue(value) || fallback);
  } catch {
    return fallback;
  }
}

function normalizeOptionalUrl(value: unknown): string | undefined {
  const text = stringValue(value).trim();
  if (!text) return undefined;
  return normalizeBaseUrl(text);
}

function safeNormalizeOptionalUrl(value: unknown): string | undefined {
  try {
    return normalizeOptionalUrl(value);
  } catch {
    return undefined;
  }
}

function normalizeOptionalText(value: unknown): string | undefined {
  const text = stringValue(value).trim();
  return text || undefined;
}

function normalizeAccountPoolKind(value: unknown): AccountPoolKind {
  if (value === undefined || value === "cpa") return "cpa";
  throw badRequest(`Unsupported account pool kind: ${String(value)}`, "unsupported_account_pool_kind");
}

function accountPoolProviderBaseUrl(kind: AccountPoolKind, baseUrl: string): string {
  return cpaProviderBaseUrl(baseUrl);
}

function accountPoolKindLabel(kind: AccountPoolKind): string {
  return "CPA";
}

function normalizeModelNames(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => stringValue(item).trim()).filter(Boolean))];
}

function normalizeStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => stringValue(item).trim()).filter(Boolean))];
}

function normalizeModelCapabilities(value: unknown): ModelCapability[] {
  if (!Array.isArray(value)) return [];
  const allowed = new Set<ModelCapability>(["text", "vision", "tool", "long-context", "reasoning"]);
  return [...new Set(value.filter((item): item is ModelCapability => allowed.has(item as ModelCapability)))];
}

function normalizeProviderModelSource(value: unknown): ProviderModelSource {
  return value === "auto" ? "auto" : "manual";
}

function normalizeOptionalNumber(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric >= 0 ? numeric : undefined;
}

function normalizeOptionalInteger(value: unknown): number | undefined {
  const numeric = normalizeOptionalNumber(value);
  return numeric === undefined ? undefined : Math.floor(numeric);
}

function inferModelCapabilities(modelId: string): ModelCapability[] {
  const lower = modelId.toLowerCase();
  const capabilities = new Set<ModelCapability>(["text"]);
  if (/vision|image|vl|omni|gpt-4o|gemini|claude-3|claude-4/.test(lower)) capabilities.add("vision");
  if (/tool|function|gpt|claude|gemini|mistral|qwen/.test(lower)) capabilities.add("tool");
  if (/reason|thinking|o\d|r1|deepseek|opus|sonnet/.test(lower)) capabilities.add("reasoning");
  if (/1m|200k|128k|1000k|long|context|gemini-1\.5|gemini-2/.test(lower)) capabilities.add("long-context");
  return Array.from(capabilities);
}

function normalizeProtocol(value: unknown): ApiProtocol {
  if (value === "openai-compatible" || value === "anthropic-compatible" || value === "openai-anthropic-compatible") return value;
  throw badRequest(`Unsupported protocol: ${String(value)}`, "unsupported_protocol");
}

function normalizeStoredProtocol(value: unknown): ApiProtocol {
  if (value === "anthropic-compatible" || value === "openai-anthropic-compatible") return value;
  return "openai-compatible";
}

function normalizeLocalServiceProtocol(value: unknown): LocalServiceProtocol {
  if (value === "openai-compatible" || value === "anthropic-compatible" || value === "custom" || value === "unknown") return value;
  return "unknown";
}

function normalizeConnectionStatus(value: unknown): LocalServiceStatus {
  if (value === "available" || value === "unavailable" || value === "unknown") return value;
  return "unknown";
}

function protocolCanServe(stored: ApiProtocol, requested: ApiProtocol): boolean {
  return stored === requested || stored === "openai-anthropic-compatible";
}

function protocolsOverlap(left: ApiProtocol, right: ApiProtocol): boolean {
  return left === right || left === "openai-anthropic-compatible" || right === "openai-anthropic-compatible";
}

function mergeProtocols(left: ApiProtocol, right: ApiProtocol): ApiProtocol {
  return left === right ? left : "openai-anthropic-compatible";
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
    responseCostPath: stringValue(raw.responseCostPath),
    autoSyncIntervalMs: normalizeOptionalInterval(raw.autoSyncIntervalMs)
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

function normalizeOptionalInterval(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return undefined;
  return Math.floor(numeric);
}
