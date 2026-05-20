import type { BalanceSnapshot, UsageEvent, UsageRollup } from "../../../shared/types";

export type AnalyticsRange = "1h" | "24h" | "7d" | "all";

export interface AnalyticsRow {
  providerId: string;
  providerName: string;
  apiKeyId?: string;
  apiKeyName?: string;
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
  startedAt: string;
  sessionKey: string;
}


export interface AggregateStats {
  calls: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cost: number;
  costCount: number;
  currency?: string;
  lastUsedAt?: string;
}


export function globalProxyBaseUrl(proxyPort: number | undefined, gateway: "openai" | "anthropic" | "auto"): string | undefined {
  if (!proxyPort) return undefined;
  if (gateway === "auto") return `http://127.0.0.1:${proxyPort}/proxy/auto/v1`;
  return gateway === "openai"
    ? `http://127.0.0.1:${proxyPort}/proxy/openai/v1`
    : `http://127.0.0.1:${proxyPort}/proxy/anthropic`;
}



export function gatewayLabel(event: UsageEvent): string {
  if (event.gatewayType === "openai") return "openai global";
  if (event.gatewayType === "anthropic") return "anthropic global";
  if (event.gatewayType === "auto") return "auto global";
  if (event.gatewayType === "public-proxy") return "public proxy";
  if (event.gatewayType === "local-service") return "local service";
  if (event.gatewayType === "legacy-key") return "legacy key url";
  return "provider url";
}


export function formatMoney(value: number, currency?: string): string {
  const unit = currency?.trim();
  return unit ? `${unit} ${value.toFixed(4)}` : value.toFixed(4);
}



export function formatBalanceValue(value: number, unit?: string): string {
  const label = unit?.trim();
  const isQuota = label?.toLowerCase() === "quota";
  const formatted = value.toLocaleString(undefined, {
    maximumFractionDigits: isQuota ? 0 : 4
  });
  if (!label) return formatted;
  return isQuota ? `${formatted} quota` : `${label} ${formatted}`;
}



export function formatBalanceSummary(snapshot: BalanceSnapshot): string {
  const parts: string[] = [];
  const unit = snapshot.currency;
  if (snapshot.unlimitedQuota) parts.push("Balance: Unlimited quota");
  if (!snapshot.unlimitedQuota && snapshot.balance !== undefined) {
    parts.push(`Bal: ${formatBalanceValue(snapshot.balance, unit)}`);
  }
  if (snapshot.spent !== undefined) parts.push(`Spent: ${formatBalanceValue(snapshot.spent, unit)}`);
  if (snapshot.granted !== undefined) parts.push(`Granted: ${formatBalanceValue(snapshot.granted, unit)}`);
  return parts.join(" | ") || "No numeric balance fields";
}



export function modelLabel(item: Pick<UsageEvent, "model">): string {
  return item.model?.trim() || "No model";
}



export function eventTokens(event: Pick<UsageEvent, "totalTokens" | "inputTokens" | "outputTokens">): number {
  if (event.totalTokens !== undefined) return event.totalTokens;
  const input = event.inputTokens ?? 0;
  const output = event.outputTokens ?? 0;
  return input + output;
}



export function compactNumber(value: number): string {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(Math.round(value));
}



export function formatUsageDateTime(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return value;
  const pad = (item: number) => String(item).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}



export function shortLabel(value: string, max = 18): string {
  return value.length > max ? `${value.slice(0, Math.max(0, max - 3))}...` : value;
}



export function buildAnalyticsRows(events: UsageEvent[], rollups: UsageRollup[], range: AnalyticsRange): AnalyticsRow[] {
  const rows: AnalyticsRow[] = events.map((event) => ({
    providerId: event.providerId,
    providerName: event.providerName,
    apiKeyId: event.apiKeyId,
    apiKeyName: event.apiKeyName,
    model: event.model,
    calls: 1,
    okCalls: event.ok ? 1 : 0,
    failedCalls: event.ok ? 0 : 1,
    inputTokens: event.inputTokens ?? 0,
    outputTokens: event.outputTokens ?? 0,
    cachedInputTokens: event.cachedInputTokens ?? 0,
    totalTokens: eventTokens(event),
    realCostTotal: event.realCost ?? 0,
    realCostCount: event.realCost === undefined ? 0 : 1,
    currency: event.currency,
    startedAt: event.startedAt,
    sessionKey: event.apiKeyId ?? event.providerId
  }));

  if (range === "7d" || range === "all") {
    const period = range === "7d" ? "week" : "month";
    for (const rollup of rollups) {
      if (rollup.period !== period) continue;
      rows.push({
        providerId: rollup.providerId,
        providerName: rollup.providerName,
        apiKeyId: rollup.apiKeyId,
        apiKeyName: rollup.apiKeyName,
        model: rollup.model,
        calls: rollup.calls,
        okCalls: rollup.okCalls,
        failedCalls: rollup.failedCalls,
        inputTokens: rollup.inputTokens,
        outputTokens: rollup.outputTokens,
        cachedInputTokens: rollup.cachedInputTokens,
        totalTokens: rollup.totalTokens,
        realCostTotal: rollup.realCostTotal,
        realCostCount: rollup.realCostCount,
        currency: rollup.currency,
        startedAt: rollup.bucketStart,
        sessionKey: `${rollup.providerId}:${rollup.model ?? "unknown"}`
      });
    }
  }

  return rows;
}



export function buildModelTokenRanking(events: AnalyticsRow[]) {
  const map = new Map<string, { label: string; tokens: number; input: number; output: number; cached: number; calls: number }>();
  for (const event of events) {
    const label = modelLabel(event);
    const row = map.get(label) ?? { label, tokens: 0, input: 0, output: 0, cached: 0, calls: 0 };
    row.tokens += event.totalTokens;
    row.input += event.inputTokens;
    row.output += event.outputTokens;
    row.cached += event.cachedInputTokens;
    row.calls += event.calls;
    map.set(label, row);
  }
  return Array.from(map.values())
    .filter((item) => item.tokens > 0)
    .sort((a, b) => b.tokens - a.tokens || b.calls - a.calls)
    .slice(0, 20);
}



export function aggregateUsage(events: UsageEvent[]): AggregateStats {
  const stats: AggregateStats = { calls: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0, cost: 0, costCount: 0 };
  for (const event of events) {
    stats.calls += 1;
    stats.inputTokens += event.inputTokens ?? 0;
    stats.outputTokens += event.outputTokens ?? 0;
    stats.totalTokens += eventTokens(event);
    if (event.realCost !== undefined) {
      stats.cost += event.realCost;
      stats.costCount += 1;
      stats.currency = event.currency ?? stats.currency;
    }
    if (!stats.lastUsedAt || event.startedAt > stats.lastUsedAt) stats.lastUsedAt = event.startedAt;
  }
  return stats;
}



export function aggregateRows(rows: AnalyticsRow[]): AggregateStats {
  const stats: AggregateStats = { calls: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0, cost: 0, costCount: 0 };
  for (const row of rows) {
    stats.calls += row.calls;
    stats.inputTokens += row.inputTokens;
    stats.outputTokens += row.outputTokens;
    stats.totalTokens += row.totalTokens;
    stats.cost += row.realCostTotal;
    stats.costCount += row.realCostCount;
    if (row.currency) stats.currency = row.currency;
    if (!stats.lastUsedAt || row.startedAt > stats.lastUsedAt) stats.lastUsedAt = row.startedAt;
  }
  return stats;
}



export function statsCost(stats: AggregateStats): string {
  return stats.costCount > 0 ? formatMoney(stats.cost, stats.currency) : "Not returned";
}

