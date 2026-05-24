import type { ProviderModel, ProviderSafe, UsageEvent, UsageRollup } from "./types";

export type StatusLevel = "operational" | "degraded" | "outage" | "no-traffic";

export interface StatusMetricSummary {
  calls: number;
  okCalls: number;
  failedCalls: number;
  successRate?: number;
  avgLatencyMs?: number;
  latencySamples: number;
  lastUsedAt?: string;
}

export interface ProviderStatusSummary extends StatusMetricSummary {
  providerId: string;
  providerName: string;
  baseUrl: string;
  providerStatus?: ProviderSafe["status"];
  testLatencyMs?: number;
  lastCheckedAt?: string;
  level: StatusLevel;
}

export interface ModelProviderStatusSummary extends StatusMetricSummary {
  providerId: string;
  providerName: string;
  modelName: string;
  level: StatusLevel;
}

export interface ModelStatusSummary extends StatusMetricSummary {
  modelName: string;
  providers: ModelProviderStatusSummary[];
  level: StatusLevel;
}

interface StatusBucket extends StatusMetricSummary {
  latencyTotalMs: number;
}

const STATUS_WINDOW_DAYS = 7;
const DEGRADED_SUCCESS_RATE = 0.95;
const OUTAGE_SUCCESS_RATE = 0.80;
const HIGH_AVG_LATENCY_MS = 10000;

export function buildProviderStatusSummaries(
  providers: ProviderSafe[],
  events: UsageEvent[],
  rollups: UsageRollup[],
  nowMs = Date.now()
): ProviderStatusSummary[] {
  const cutoffMs = nowMs - STATUS_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  const buckets = new Map<string, StatusBucket>();

  for (const event of recentUsageEvents(events, cutoffMs)) {
    addEventToBucket(bucketFor(buckets, event.providerId), event);
  }

  for (const rollup of recentUsageRollups(rollups, cutoffMs)) {
    addRollupToBucket(bucketFor(buckets, rollup.providerId), rollup);
  }

  return providers.map((provider) => {
    const stats = finalizeBucket(buckets.get(provider.id));
    return {
      providerId: provider.id,
      providerName: provider.name,
      baseUrl: provider.baseUrl,
      providerStatus: provider.status,
      testLatencyMs: provider.latencyMs,
      lastCheckedAt: provider.lastCheckedAt,
      ...stats,
      level: resolveStatusLevel(stats, provider.status)
    };
  }).sort((a, b) => statusSort(a.level) - statusSort(b.level) || b.calls - a.calls || a.providerName.localeCompare(b.providerName));
}

export function buildModelStatusSummaries(
  events: UsageEvent[],
  rollups: UsageRollup[],
  modelCatalog: ProviderModel[] = [],
  nowMs = Date.now()
): ModelStatusSummary[] {
  const cutoffMs = nowMs - STATUS_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  const providerBuckets = new Map<string, StatusBucket>();
  const providerNames = new Map<string, string>();
  const modelNames = new Map<string, string>();

  for (const event of recentUsageEvents(events, cutoffMs)) {
    if (!event.model?.trim()) continue;
    const modelName = modelDisplayName(event.providerId, event.model, modelCatalog);
    const key = modelProviderKey(modelName, event.providerId);
    addEventToBucket(bucketFor(providerBuckets, key), event);
    providerNames.set(event.providerId, event.providerName);
    modelNames.set(modelName, modelName);
  }

  for (const rollup of recentUsageRollups(rollups, cutoffMs)) {
    if (!rollup.model?.trim()) continue;
    const modelName = modelDisplayName(rollup.providerId, rollup.model, modelCatalog);
    const key = modelProviderKey(modelName, rollup.providerId);
    addRollupToBucket(bucketFor(providerBuckets, key), rollup);
    providerNames.set(rollup.providerId, rollup.providerName);
    modelNames.set(modelName, modelName);
  }

  const byModel = new Map<string, ModelProviderStatusSummary[]>();
  for (const [key, bucket] of providerBuckets) {
    const separator = key.lastIndexOf("::");
    const modelName = key.slice(0, separator);
    const providerId = key.slice(separator + 2);
    const stats = finalizeBucket(bucket);
    const providerSummary: ModelProviderStatusSummary = {
      providerId,
      providerName: providerNames.get(providerId) ?? "Unknown provider",
      modelName,
      ...stats,
      level: resolveStatusLevel(stats)
    };
    const list = byModel.get(modelName) ?? [];
    list.push(providerSummary);
    byModel.set(modelName, list);
  }

  return Array.from(modelNames.keys()).map((modelName) => {
    const providers = (byModel.get(modelName) ?? [])
      .sort((a, b) => statusSort(a.level) - statusSort(b.level) || b.calls - a.calls || a.providerName.localeCompare(b.providerName));
    const total = mergeSummaries(providers);
    return {
      modelName,
      providers,
      ...total,
      level: worstLevel(providers.map((provider) => provider.level))
    };
  }).sort((a, b) => statusSort(a.level) - statusSort(b.level) || b.calls - a.calls || a.modelName.localeCompare(b.modelName));
}

export function statusLabel(level: StatusLevel): string {
  if (level === "operational") return "Operational";
  if (level === "degraded") return "Degraded";
  if (level === "outage") return "Outage";
  return "No traffic";
}

function recentUsageEvents(events: UsageEvent[], cutoffMs: number): UsageEvent[] {
  return events.filter((event) => timestampMs(event.startedAt) >= cutoffMs);
}

function recentUsageRollups(rollups: UsageRollup[], cutoffMs: number): UsageRollup[] {
  return rollups.filter((rollup) => timestampMs(rollup.bucketStart) >= cutoffMs);
}

function bucketFor(map: Map<string, StatusBucket>, key: string): StatusBucket {
  const existing = map.get(key);
  if (existing) return existing;
  const next: StatusBucket = {
    calls: 0,
    okCalls: 0,
    failedCalls: 0,
    latencySamples: 0,
    latencyTotalMs: 0
  };
  map.set(key, next);
  return next;
}

function addEventToBucket(bucket: StatusBucket, event: UsageEvent): void {
  bucket.calls += 1;
  bucket.okCalls += event.ok ? 1 : 0;
  bucket.failedCalls += event.ok ? 0 : 1;
  bucket.latencySamples += 1;
  bucket.latencyTotalMs += event.latencyMs;
  if (!bucket.lastUsedAt || event.startedAt > bucket.lastUsedAt) bucket.lastUsedAt = event.startedAt;
}

function addRollupToBucket(bucket: StatusBucket, rollup: UsageRollup): void {
  bucket.calls += rollup.calls;
  bucket.okCalls += rollup.okCalls;
  bucket.failedCalls += rollup.failedCalls;
  if (!bucket.lastUsedAt || rollup.updatedAt > bucket.lastUsedAt) bucket.lastUsedAt = rollup.updatedAt;
}

function finalizeBucket(bucket: StatusBucket | undefined): StatusMetricSummary {
  if (!bucket) return { calls: 0, okCalls: 0, failedCalls: 0, latencySamples: 0 };
  return {
    calls: bucket.calls,
    okCalls: bucket.okCalls,
    failedCalls: bucket.failedCalls,
    successRate: bucket.calls > 0 ? bucket.okCalls / bucket.calls : undefined,
    avgLatencyMs: bucket.latencySamples > 0 ? bucket.latencyTotalMs / bucket.latencySamples : undefined,
    latencySamples: bucket.latencySamples,
    lastUsedAt: bucket.lastUsedAt
  };
}

function mergeSummaries(rows: StatusMetricSummary[]): StatusMetricSummary {
  let calls = 0;
  let okCalls = 0;
  let failedCalls = 0;
  let latencySamples = 0;
  let latencyTotalMs = 0;
  let lastUsedAt: string | undefined;
  for (const row of rows) {
    calls += row.calls;
    okCalls += row.okCalls;
    failedCalls += row.failedCalls;
    if (row.avgLatencyMs !== undefined && row.latencySamples > 0) {
      latencySamples += row.latencySamples;
      latencyTotalMs += row.avgLatencyMs * row.latencySamples;
    }
    if (row.lastUsedAt && (!lastUsedAt || row.lastUsedAt > lastUsedAt)) lastUsedAt = row.lastUsedAt;
  }
  return {
    calls,
    okCalls,
    failedCalls,
    successRate: calls > 0 ? okCalls / calls : undefined,
    avgLatencyMs: latencySamples > 0 ? latencyTotalMs / latencySamples : undefined,
    latencySamples,
    lastUsedAt
  };
}

function resolveStatusLevel(stats: StatusMetricSummary, providerStatus?: ProviderSafe["status"]): StatusLevel {
  if (providerStatus === "unavailable") return "outage";
  if (stats.calls === 0) return "no-traffic";
  if ((stats.successRate ?? 0) < OUTAGE_SUCCESS_RATE) return "outage";
  if ((stats.successRate ?? 0) < DEGRADED_SUCCESS_RATE) return "degraded";
  if ((stats.avgLatencyMs ?? 0) > HIGH_AVG_LATENCY_MS) return "degraded";
  return "operational";
}

function worstLevel(levels: StatusLevel[]): StatusLevel {
  return levels.reduce<StatusLevel>((worst, level) => statusSort(level) < statusSort(worst) ? level : worst, "operational");
}

function statusSort(level: StatusLevel): number {
  if (level === "outage") return 0;
  if (level === "degraded") return 1;
  if (level === "no-traffic") return 2;
  return 3;
}

function modelProviderKey(modelName: string, providerId: string): string {
  return `${modelName}::${providerId}`;
}

function modelDisplayName(providerId: string, value: string, catalog: ProviderModel[]): string {
  const normalized = value.trim();
  const match = catalog.find((model) => {
    if (model.providerId !== providerId) return false;
    return [model.modelId, model.displayName, model.canonicalModelId, ...model.aliases]
      .filter((item): item is string => Boolean(item?.trim()))
      .some((item) => item === normalized);
  });
  return match?.displayName?.trim() || match?.canonicalModelId?.trim() || normalized;
}

function timestampMs(value: string | undefined): number {
  if (!value) return 0;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}
