export type ApiProtocol = "openai-compatible" | "anthropic-compatible" | "openai-anthropic-compatible";
export type BalanceMethod = "GET" | "POST";
export type GatewayType = "openai" | "anthropic" | "auto" | "provider" | "legacy-key" | "public-proxy" | "local-service";
export type LocalServiceStatus = "unknown" | "available" | "unavailable";
export type LocalServiceProtocol = "openai-compatible" | "anthropic-compatible" | "custom" | "unknown";

export interface BalanceConfig {
  enabled: boolean;
  url: string;
  method: BalanceMethod;
  headersJson: string;
  bodyTemplate: string;
  balancePath: string;
  spentPath: string;
  currencyPath: string;
  responseCostPath: string;
  autoSyncIntervalMs?: number;
}

export interface ProviderInput {
  id?: string;
  name: string;
  protocol: ApiProtocol;
  baseUrl: string;
  currency: string;
  balanceConfig: BalanceConfig;
  isLocal?: boolean;
}

export interface ApiKeyInput {
  name: string;
  apiKey: string;
  queryKey?: string;
}

export interface AddKeyInput {
  providerId?: string;
  providerName?: string;
  protocol?: ApiProtocol;
  baseUrl?: string;
  currency?: string;
  balanceConfig?: BalanceConfig;
  keyName: string;
  apiKey: string;
  queryKey?: string;
  isLocal?: boolean;
}

export interface ApiKeySafe {
  id: string;
  providerId: string;
  name: string;
  keyMasked: string;
  hasQueryKey: boolean;
  createdAt: string;
  lastUsedAt?: string;
  proxyBaseUrl?: string;
}

export interface ProviderSafe {
  id: string;
  name: string;
  protocol: ApiProtocol;
  baseUrl: string;
  proxyBaseUrl?: string;
  currency: string;
  balanceConfig: BalanceConfig;
  apiKeys: ApiKeySafe[];
  createdAt: string;
  updatedAt: string;
  isLocal?: boolean;
  status?: LocalServiceStatus;
  latencyMs?: number;
  lastCheckedAt?: string;
}

export interface UsageEvent {
  id: string;
  providerId: string;
  providerName: string;
  baseUrl?: string;
  gatewayType?: GatewayType;
  gatewayBaseUrl?: string;
  apiKeyId?: string;
  apiKeyName?: string;
  apiKeyMasked?: string;
  protocol: ApiProtocol;
  path: string;
  method: string;
  model?: string;
  status: number;
  ok: boolean;
  startedAt: string;
  latencyMs: number;
  inputTokens?: number;
  outputTokens?: number;
  cachedInputTokens?: number;
  totalTokens?: number;
  realCost?: number;
  currency?: string;
  error?: string;
  proxyTokenId?: string;
  proxyTokenName?: string;
  modelId?: string;
  endpoint?: string;
  estimatedCost?: number;
  errorMessage?: string;
}

export type UsageRollupPeriod = "week" | "month";

export interface UsageRollup {
  id: string;
  period: UsageRollupPeriod;
  bucketStart: string;
  providerId: string;
  providerName: string;
  apiKeyId?: string;
  apiKeyName?: string;
  protocol: ApiProtocol;
  model?: string;
  calls: number;
  okCalls: number;
  failedCalls: number;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  totalTokens: number;
  realCostTotal: number;
  realCostCount: number;
  currency?: string;
  updatedAt: string;
}

export interface BalanceSnapshot {
  id: string;
  providerId: string;
  providerName: string;
  checkedAt: string;
  ok: boolean;
  balance?: number;
  spent?: number;
  granted?: number;
  currency?: string;
  unlimitedQuota?: boolean;
  tokenName?: string;
  error?: string;
}

export interface DashboardTotals {
  totalCalls: number;
  callsToday: number;
  okCalls: number;
  failedCalls: number;
  realCostTotal: number;
  realCostCount: number;
}

export interface ProxyModelRule {
  publicModel: string;
  providerId: string;
  apiKeyId?: string;
  upstreamModel: string;
}

export interface ProxyTokenInput {
  name: string;
  enabled?: boolean;
  allowedProviderIds: string[];
  allowedModels: ProxyModelRule[];
  allowStreaming: boolean;
  requestsPerMinute: number;
  requestsPerDay: number;
  expiresAt?: string;
}

export interface ProxyTokenSafe {
  id: string;
  name: string;
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

export interface AppState {
  initialized: boolean;
  unlocked: boolean;
  proxyPort?: number;
  providers: ProviderSafe[];
  proxyTokens: ProxyTokenSafe[];
  usageEvents: UsageEvent[];
  usageRollups: UsageRollup[];
  balanceSnapshots: BalanceSnapshot[];
  totals: DashboardTotals;
  localServices: LocalService[];
  cloudflared: CloudflaredStatus;
}

export interface LocalService {
  id: string;
  name: string;
  baseUrl: string;
  type: LocalServiceProtocol;
  status: LocalServiceStatus;
  latencyMs?: number;
  lastCheckedAt?: string;
  publicAccessUrl?: string;
  notes?: string;
  hasApiKey?: boolean;
  keyMasked?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CloudflaredStatus {
  running: boolean;
  publicUrl?: string;
  error?: string;
  missingBinary?: boolean;
  installUrl?: string;
}

export interface BalanceTestResult {
  snapshot: BalanceSnapshot;
  responsePreview?: string;
}

export interface VaultStatus {
  initialized: boolean;
  unlocked: boolean;
}
