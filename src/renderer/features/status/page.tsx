import { useMemo, useState } from "react";
import type { AppState, ConnectionSample, ProviderSafe, UsageEvent } from "../../../shared/types";
import {
  buildModelStatusSummaries,
  buildProviderStatusSummaries,
  statusLabel,
  type ModelProviderStatusSummary,
  type ModelStatusSummary,
  type ProviderStatusSummary,
  type StatusLevel,
} from "../../../shared/statusStats";
import { compactNumber, formatUsageDateTime } from "../../shared/utils";

type ViewMode = "providers" | "models" | "latency";
type FilterStatus = "all" | "operational" | "degraded-outage" | "inactive";
type SortBy = "name" | "calls" | "latency" | "success";
type SuccessRateTone = "operational" | "degraded" | "outage";

function successRateTone(rate: number): SuccessRateTone {
  if (rate >= 0.9) return "operational";
  if (rate >= 0.8) return "degraded";
  return "outage";
}

interface BucketData {
  bucketIndex: number;
  startTime: number;
  endTime: number;
  calls: number;
  okCalls: number;
  failedCalls: number;
  successRate: number;
  avgLatencyMs?: number;
}

interface TelemetryStats {
  buckets: BucketData[];
  p50?: number;
  p90?: number;
  p95?: number;
  p99?: number;
  avg?: number;
  min?: number;
  max?: number;
}

interface ProcessedUsageEvent extends UsageEvent {
  timeMs: number;
}

// Highly optimized telemetry calculator without Date parsing overhead in loops
function calculateTelemetry(
  activeEvents: ProcessedUsageEvent[],
  cutoffMs: number,
  nowMs: number
): TelemetryStats {
  const numBuckets = 20;
  const bucketDuration = (7 * 24 * 60 * 60 * 1000) / numBuckets;

  const buckets: BucketData[] = Array.from({ length: numBuckets }, (_, i) => {
    const startTime = cutoffMs + i * bucketDuration;
    return {
      bucketIndex: i,
      startTime,
      endTime: startTime + bucketDuration,
      calls: 0,
      okCalls: 0,
      failedCalls: 0,
      successRate: 0,
      avgLatencyMs: undefined,
    };
  });

  const latencies: number[] = [];
  let totalLatency = 0;
  let latencyCount = 0;

  const bucketLatencyTotals = Array(numBuckets).fill(0);
  const bucketLatencyCounts = Array(numBuckets).fill(0);

  for (const event of activeEvents) {
    const t = event.timeMs;
    const bucketIndex = Math.min(
      numBuckets - 1,
      Math.floor((t - cutoffMs) / bucketDuration)
    );
    if (bucketIndex >= 0 && bucketIndex < numBuckets) {
      const b = buckets[bucketIndex];
      b.calls++;
      if (event.ok) {
        b.okCalls++;
      } else {
        b.failedCalls++;
      }

      if (event.latencyMs !== undefined) {
        bucketLatencyTotals[bucketIndex] += event.latencyMs;
        bucketLatencyCounts[bucketIndex]++;

        latencies.push(event.latencyMs);
        totalLatency += event.latencyMs;
        latencyCount++;
      }
    }
  }

  for (let i = 0; i < numBuckets; i++) {
    const b = buckets[i];
    b.successRate = b.calls > 0 ? b.okCalls / b.calls : 1.0;
    b.avgLatencyMs = bucketLatencyCounts[i] > 0 ? bucketLatencyTotals[i] / bucketLatencyCounts[i] : undefined;
  }

  latencies.sort((a, b) => a - b);
  const getPercentile = (p: number) => {
    if (latencies.length === 0) return undefined;
    const idx = Math.min(latencies.length - 1, Math.floor(latencies.length * p));
    return latencies[idx];
  };

  return {
    buckets,
    p50: getPercentile(0.5),
    p90: getPercentile(0.9),
    p95: getPercentile(0.95),
    p99: getPercentile(0.99),
    avg: latencyCount > 0 ? totalLatency / latencyCount : undefined,
    min: latencies.length > 0 ? latencies[0] : undefined,
    max: latencies.length > 0 ? latencies[latencies.length - 1] : undefined,
  };
}

interface ConnectionMonitor {
  id: string;
  name: string;
  baseUrl: string;
  status?: string;
  checks: number;
  okCount: number;
  failCount: number;
  uptime?: number;
  lastLatencyMs?: number;
  avgLatencyMs?: number;
  minLatencyMs?: number;
  maxLatencyMs?: number;
  lastCheckedAt?: string;
  samples: ConnectionSample[];
}

function buildConnectionMonitor(provider: ProviderSafe): ConnectionMonitor {
  const samples = provider.connectionHistory ?? [];
  const okSamples = samples.filter((s) => s.ok);
  const latencies = okSamples
    .map((s) => s.latencyMs)
    .filter((l): l is number => typeof l === "number");
  const last = samples.length > 0 ? samples[samples.length - 1] : undefined;
  return {
    id: provider.id,
    name: provider.name,
    baseUrl: provider.baseUrl,
    status: provider.status,
    checks: samples.length,
    okCount: okSamples.length,
    failCount: samples.length - okSamples.length,
    uptime: samples.length > 0 ? okSamples.length / samples.length : undefined,
    lastLatencyMs: last?.ok ? last.latencyMs : provider.latencyMs,
    avgLatencyMs: latencies.length > 0 ? latencies.reduce((a, b) => a + b, 0) / latencies.length : undefined,
    minLatencyMs: latencies.length > 0 ? Math.min(...latencies) : undefined,
    maxLatencyMs: latencies.length > 0 ? Math.max(...latencies) : undefined,
    lastCheckedAt: provider.lastCheckedAt ?? last?.at,
    samples
  };
}

export function StatusPage({ state }: { state: AppState }) {
  const [view, setView] = useState<ViewMode>("providers");
  const [expandedId, setExpandedId] = useState<string | undefined>();
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState<FilterStatus>("all");
  const [sortBy, setSortBy] = useState<SortBy>("calls");

  const nowMs = useMemo(() => Date.now(), []);
  const cutoffMs = useMemo(() => nowMs - 7 * 24 * 60 * 60 * 1000, [nowMs]);

  // Pre-process raw events once to parse Dates and filter by range
  const processedEvents = useMemo(() => {
    return state.usageEvents
      .map((e) => ({
        ...e,
        timeMs: new Date(e.startedAt).getTime(),
      }))
      .filter((e) => e.timeMs >= cutoffMs && e.timeMs <= nowMs);
  }, [state.usageEvents, cutoffMs, nowMs]);

  // Pre-group processed events by providerId for fast O(1) lookups
  const eventsByProvider = useMemo(() => {
    const map = new Map<string, ProcessedUsageEvent[]>();
    for (const e of processedEvents) {
      let list = map.get(e.providerId);
      if (!list) {
        list = [];
        map.set(e.providerId, list);
      }
      list.push(e);
    }
    return map;
  }, [processedEvents]);

  // Pre-group processed events by modelName for fast O(1) lookups
  const eventsByModel = useMemo(() => {
    const map = new Map<string, ProcessedUsageEvent[]>();
    for (const e of processedEvents) {
      if (!e.model) continue;
      const modelKey = e.model.trim();
      let list = map.get(modelKey);
      if (!list) {
        list = [];
        map.set(modelKey, list);
      }
      list.push(e);
    }
    return map;
  }, [processedEvents]);

  const providerSummaries = useMemo(
    () => buildProviderStatusSummaries(state.providers, state.usageEvents, state.usageRollups ?? [], nowMs),
    [state.providers, state.usageEvents, state.usageRollups, nowMs]
  );
  const modelSummaries = useMemo(
    () => buildModelStatusSummaries(state.usageEvents, state.usageRollups ?? [], state.modelCatalog ?? [], nowMs),
    [state.usageEvents, state.usageRollups, state.modelCatalog, nowMs]
  );

  // Connection-latency monitors are derived from the background probe history
  // (every 10s per provider), kept separate from model/usage success metrics.
  const connectionMonitors = useMemo(
    () => state.providers.map((p) => buildConnectionMonitor(p)).sort((a, b) => a.name.localeCompare(b.name)),
    [state.providers]
  );
  const filteredMonitors = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return connectionMonitors;
    return connectionMonitors.filter((m) => m.name.toLowerCase().includes(q) || m.baseUrl.toLowerCase().includes(q));
  }, [connectionMonitors, search]);

  const globalLevel = resolveGlobalLevel(providerSummaries);
  const outageCount = providerSummaries.filter((p) => p.level === "outage").length;
  const degradedCount = providerSummaries.filter((p) => p.level === "degraded").length;

  const totalCalls = processedEvents.length;

  const globalStats = useMemo(() => {
    const ok = processedEvents.filter((e) => e.ok).length;
    const latencies = processedEvents.map((e) => e.latencyMs).filter((l) => l !== undefined);
    const avg = latencies.length > 0 ? latencies.reduce((a, b) => a + b, 0) / latencies.length : 0;
    return {
      successRate: processedEvents.length > 0 ? ok / processedEvents.length : 1.0,
      avgLatency: avg,
    };
  }, [processedEvents]);

  const toggle = (id: string) => setExpandedId(expandedId === id ? undefined : id);

  const filteredProviders = useMemo(() => {
    return providerSummaries
      .filter((p) => {
        const matchesSearch =
          p.providerName.toLowerCase().includes(search.toLowerCase()) ||
          p.baseUrl.toLowerCase().includes(search.toLowerCase());
        if (!matchesSearch) return false;

        if (filterStatus === "operational") return p.level === "operational";
        if (filterStatus === "degraded-outage") return p.level === "degraded" || p.level === "outage";
        if (filterStatus === "inactive") return p.level === "no-traffic";
        return true;
      })
      .sort((a, b) => {
        if (sortBy === "name") return a.providerName.localeCompare(b.providerName);
        if (sortBy === "calls") return b.calls - a.calls;
        if (sortBy === "latency") {
          const latA = a.avgLatencyMs ?? 999999;
          const latB = b.avgLatencyMs ?? 999999;
          return latA - latB;
        }
        if (sortBy === "success") {
          const rateA = a.successRate ?? -1;
          const rateB = b.successRate ?? -1;
          return rateB - rateA;
        }
        return 0;
      });
  }, [providerSummaries, search, filterStatus, sortBy]);

  const filteredModels = useMemo(() => {
    return modelSummaries
      .filter((m) => {
        const matchesSearch = m.modelName.toLowerCase().includes(search.toLowerCase());
        if (!matchesSearch) return false;

        if (filterStatus === "operational") return m.level === "operational";
        if (filterStatus === "degraded-outage") return m.level === "degraded" || m.level === "outage";
        if (filterStatus === "inactive") return m.level === "no-traffic";
        return true;
      })
      .sort((a, b) => {
        if (sortBy === "name") return a.modelName.localeCompare(b.modelName);
        if (sortBy === "calls") return b.calls - a.calls;
        if (sortBy === "latency") {
          const latA = a.avgLatencyMs ?? 999999;
          const latB = b.avgLatencyMs ?? 999999;
          return latA - latB;
        }
        if (sortBy === "success") {
          const rateA = a.successRate ?? -1;
          const rateB = b.successRate ?? -1;
          return rateB - rateA;
        }
        return 0;
      });
  }, [modelSummaries, search, filterStatus, sortBy]);

  return (
    <div className="status-page">
      {/* Premium Dashboard Header */}
      <div className="status-header-section">
        <div className={`status-global-hero status-global-hero--${globalLevel}`}>
          <div className="status-hero-glow" />
          <div className="status-hero-content">
            <div className="status-hero-left">
              <div className="status-pulse-badge">
                <span className="pulse-dot" />
                <span className="pulse-ring" />
              </div>
              <div className="status-hero-text">
                <h2>{globalStatusMessage(globalLevel)}</h2>
                <p>{globalStatusSubtext(globalLevel, outageCount, degradedCount)}</p>
              </div>
            </div>
            <GlobalSuccessRing rate={globalStats.successRate} hasTraffic={totalCalls > 0} />
          </div>
        </div>

        {/* Observability KPI Cards */}
        <div className="status-kpi-grid">
          <div className="status-kpi-card">
            <div className="kpi-icon">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
              </svg>
            </div>
            <div className="kpi-info">
              <span className="kpi-label">Avg Latency (7d)</span>
              <strong className="kpi-value">{globalStats.avgLatency > 0 ? `${Math.round(globalStats.avgLatency)}ms` : "N/A"}</strong>
            </div>
          </div>

          <div className="status-kpi-card">
            <div className="kpi-icon">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <polyline points="12 6 12 12 16 14" />
              </svg>
            </div>
            <div className="kpi-info">
              <span className="kpi-label">Total Requests</span>
              <strong className="kpi-value">{compactNumber(totalCalls)}</strong>
            </div>
          </div>

          <div className="status-kpi-card">
            <div className="kpi-icon">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="2" y="2" width="20" height="8" rx="2" ry="2" />
                <rect x="2" y="14" width="20" height="8" rx="2" ry="2" />
                <line x1="6" y1="6" x2="6.01" y2="6" />
                <line x1="6" y1="18" x2="6.01" y2="18" />
              </svg>
            </div>
            <div className="kpi-info">
              <span className="kpi-label">Active Gateways</span>
              <strong className="kpi-value">{state.providers.length}</strong>
            </div>
          </div>

          <div className="status-kpi-card">
            <div className="kpi-icon">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polygon points="12 2 2 7 12 12 22 7 12 2" />
                <polyline points="2 17 12 22 22 17" />
                <polyline points="2 12 12 17 22 12" />
              </svg>
            </div>
            <div className="kpi-info">
              <span className="kpi-label">Models Monitored</span>
              <strong className="kpi-value">{modelSummaries.length}</strong>
            </div>
          </div>
        </div>
      </div>

      {/* Control Panel: Search, Switcher & Filtering */}
      <div className="status-control-panel">
        <div className="control-left">
          <div className="status-view-toggle-pills">
            <button
              className={view === "providers" ? "active" : ""}
              onClick={() => {
                setView("providers");
                setExpandedId(undefined);
              }}
            >
              Providers
            </button>
            <button
              className={view === "models" ? "active" : ""}
              onClick={() => {
                setView("models");
                setExpandedId(undefined);
              }}
            >
              Models
            </button>
            <button
              className={view === "latency" ? "active" : ""}
              onClick={() => {
                setView("latency");
                setExpandedId(undefined);
              }}
            >
              Connection Latency
            </button>
          </div>

          <div className="status-search-box">
            <svg className="search-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              type="text"
              placeholder={view === "models" ? "Search model catalog..." : "Search provider name or endpoint..."}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>

        <div className="control-right" style={view === "latency" ? { display: "none" } : undefined}>
          <div className="filter-group">
            <label>Health:</label>
            <div className="status-filter-pills">
              {(["all", "operational", "degraded-outage", "inactive"] as FilterStatus[]).map((f) => (
                <button
                  key={f}
                  className={filterStatus === f ? "active" : ""}
                  onClick={() => setFilterStatus(f)}
                >
                  {f === "all"
                    ? "All"
                    : f === "operational"
                    ? "Healthy"
                    : f === "degraded-outage"
                    ? "Issues"
                    : "Inactive"}
                </button>
              ))}
            </div>
          </div>

          <div className="sort-group">
            <label>Sort:</label>
            <select value={sortBy} onChange={(e) => setSortBy(e.target.value as SortBy)}>
              <option value="calls">Volume (7d)</option>
              <option value="name">Name (A-Z)</option>
              <option value="latency">Fastest Response</option>
              <option value="success">Success Rate</option>
            </select>
          </div>
        </div>
      </div>

      {/* Main Listings */}
      {view === "providers" ? (
        <div className="status-cards-list">
          {filteredProviders.map((p) => {
            const providerEvents = eventsByProvider.get(p.providerId) ?? [];
            const telemetry = calculateTelemetry(providerEvents, cutoffMs, nowMs);

            return (
              <ProviderStatusCard
                key={p.providerId}
                provider={p}
                telemetry={telemetry}
                events={state.usageEvents}
                expanded={expandedId === p.providerId}
                onToggle={() => toggle(p.providerId)}
              />
            );
          })}
          {filteredProviders.length === 0 && (
            <EmptyStatus message="No providers match the selected criteria." />
          )}
        </div>
      ) : view === "models" ? (
        <div className="status-cards-list">
          {filteredModels.map((m) => {
            const modelEvents = eventsByModel.get(m.modelName) ?? [];
            const telemetry = calculateTelemetry(modelEvents, cutoffMs, nowMs);

            return (
              <ModelStatusCard
                key={m.modelName}
                model={m}
                telemetry={telemetry}
                events={state.usageEvents}
                expanded={expandedId === m.modelName}
                onToggle={() => toggle(m.modelName)}
              />
            );
          })}
          {filteredModels.length === 0 && (
            <EmptyStatus message="No models match the selected criteria." />
          )}
        </div>
      ) : (
        <div className="status-cards-list">
          {filteredMonitors.map((m) => (
            <ConnectionLatencyCard key={m.id} monitor={m} />
          ))}
          {filteredMonitors.length === 0 && (
            <EmptyStatus message="No providers to monitor yet. Connection latency is sampled automatically every 10 seconds." />
          )}
        </div>
      )}

      <div className="status-footer-bar">
        <span>
          {view === "latency"
            ? "Connection latency is probed automatically every 10 seconds per provider. Showing the most recent samples."
            : "Showing telemetry & tests across the last 7 days. Metric collections sync automatically with gateway traffic."}
        </span>
      </div>
    </div>
  );
}

// ----------------------------------------------------
// PROVIDER CARD COMPONENT
// ----------------------------------------------------
interface ProviderCardProps {
  provider: ProviderStatusSummary;
  telemetry: TelemetryStats;
  events: UsageEvent[];
  expanded: boolean;
  onToggle: () => void;
}

function ProviderStatusCard({ provider, telemetry, events, expanded, onToggle }: ProviderCardProps) {
  const recentCalls = useMemo(() => {
    return events.filter((e) => e.providerId === provider.providerId).slice(0, 15);
  }, [events, provider.providerId]);

  return (
    <div className={`status-item-card status-item-card--${provider.level} ${expanded ? "expanded" : ""}`}>
      {/* Card Header (Clickable for expansion) */}
      <div className="status-item-header-wrap" onClick={onToggle}>
        <div className="status-item-left-sec">
          <div className="status-dot-pulse">
            <span className={`dot dot--${provider.level}`} />
            {provider.level !== "no-traffic" && <span className={`ring ring--${provider.level}`} />}
          </div>
          <div className="status-item-identity">
            <div className="identity-top">
              <h3>{provider.providerName}</h3>
              <span className={`status-badge-inline badge--${provider.level}`}>{statusLabel(provider.level)}</span>
            </div>
            <code>{provider.baseUrl}</code>
          </div>
        </div>

        {/* Small collapsed latency visual */}
        <div className="status-item-sparkline-mini">
          {provider.calls > 0 ? (
            <div className="mini-chart-container" title="Latency history trend (last 7 days)">
              <MiniSparklineSvg buckets={telemetry.buckets} id={provider.providerId} />
            </div>
          ) : (
            <span className="no-sparkline-text">No Traffic</span>
          )}
        </div>

        <div className="status-item-right-sec">
          {/* Circular Success Rate Gauge instead of plain text rate */}
          <div className="header-metric ring-metric">
            <span className="m-label">Success Rate</span>
            {provider.successRate !== undefined ? (
              <HeaderSuccessRing rate={provider.successRate} />
            ) : (
              <span className="m-val-na">N/A</span>
            )}
          </div>
          <div className="header-metric">
            <span className="m-label">Latency</span>
            <strong className="m-val">{fmtLatency(provider.avgLatencyMs)}</strong>
          </div>
          <div className="header-metric">
            <span className="m-label">Calls (7d)</span>
            <strong className="m-val">{compactNumber(provider.calls)}</strong>
          </div>
          <button className={`expand-chevron-btn ${expanded ? "open" : ""}`} aria-label="Expand details">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>
        </div>
      </div>

      {/* Expanded details grid */}
      {expanded && (
        <div className="status-item-drawer">
          <div className="status-drawer-grid">
            {/* Left Box: Latency Trend SVG Graph */}
            <div className="status-drawer-box graph-box">
              <LatencySparkline buckets={telemetry.buckets} id={provider.providerId} />
            </div>

            {/* Middle Box: Segmented Timeline Grid (Vercel Style) */}
            <div className="status-drawer-box timeline-box">
              <h4>Uptime & Response History</h4>
              <p className="box-sub">Segments represent 8.4-hour intervals across the last 7 days</p>
              <StatusTimelineGrid buckets={telemetry.buckets} />
              <div className="timeline-legend">
                <span>7 days ago</span>
                <div className="legend-items">
                  <span className="legend-dot dot--operational" /> Operational
                  <span className="legend-dot dot--degraded" /> Degraded
                  <span className="legend-dot dot--outage" /> Outage
                  <span className="legend-dot dot--empty" /> No Traffic
                </div>
                <span>Just now</span>
              </div>
            </div>

            {/* Right Box: Latency Percentiles & Success Ring */}
            <div className="status-drawer-box metrics-box">
              <div className="metrics-box-top">
                <SuccessRing rate={provider.successRate ?? 1.0} />
                <div className="connection-info">
                  <div className="info-row">
                    <span>Gate Link</span>
                    <strong>{fmtConnection(provider.providerStatus)}</strong>
                  </div>
                  <div className="info-row">
                    <span>Ping</span>
                    <strong>{fmtLatency(provider.testLatencyMs)}</strong>
                  </div>
                </div>
              </div>

              <div className="percentiles-grid">
                <div className="pct-cell">
                  <span className="pct-label">p50</span>
                  <strong className="pct-val">{fmtLatency(telemetry.p50)}</strong>
                </div>
                <div className="pct-cell">
                  <span className="pct-label">p95</span>
                  <strong className="pct-val warning">{fmtLatency(telemetry.p95)}</strong>
                </div>
                <div className="pct-cell">
                  <span className="pct-label">p99</span>
                  <strong className="pct-val danger">{fmtLatency(telemetry.p99)}</strong>
                </div>
                <div className="pct-cell">
                  <span className="pct-label">Peak</span>
                  <strong className="pct-val">{fmtLatency(telemetry.max)}</strong>
                </div>
              </div>

              <div className="checked-time">
                Last checked: {provider.lastCheckedAt ? formatUsageDateTime(provider.lastCheckedAt) : "Never"}
              </div>
            </div>
          </div>

          {/* Trace log */}
          {recentCalls.length > 0 ? (
            <RecentCallsTraceTable calls={recentCalls} />
          ) : (
            <div className="no-calls-box">No recent requests recorded on this gateway.</div>
          )}
        </div>
      )}
    </div>
  );
}

// ----------------------------------------------------
// MODEL CARD COMPONENT
// ----------------------------------------------------
interface ModelCardProps {
  model: ModelStatusSummary;
  telemetry: TelemetryStats;
  events: UsageEvent[];
  expanded: boolean;
  onToggle: () => void;
}

function ModelStatusCard({ model, telemetry, events, expanded, onToggle }: ModelCardProps) {
  const modelEvents = useMemo(() => {
    return events.filter((e) => e.model?.trim() === model.modelName).slice(0, 15);
  }, [events, model.modelName]);

  return (
    <div className={`status-item-card status-item-card--${model.level} ${expanded ? "expanded" : ""}`}>
      {/* Card Header (Clickable) */}
      <div className="status-item-header-wrap" onClick={onToggle}>
        <div className="status-item-left-sec">
          <div className="status-dot-pulse">
            <span className={`dot dot--${model.level}`} />
            {model.level !== "no-traffic" && <span className={`ring ring--${model.level}`} />}
          </div>
          <div className="status-item-identity">
            <div className="identity-top">
              <h3>{model.modelName}</h3>
              <span className={`status-badge-inline badge--${model.level}`}>{statusLabel(model.level)}</span>
            </div>
            <code>Routed across {model.providers.length} gateway{model.providers.length === 1 ? "" : "s"}</code>
          </div>
        </div>

        {/* Small collapsed latency visual */}
        <div className="status-item-sparkline-mini">
          {model.calls > 0 ? (
            <div className="mini-chart-container" title="Latency history trend (last 7 days)">
              <MiniSparklineSvg buckets={telemetry.buckets} id={model.modelName} />
            </div>
          ) : (
            <span className="no-sparkline-text">No Traffic</span>
          )}
        </div>

        <div className="status-item-right-sec">
          {/* Circular Success Rate Gauge instead of plain text rate */}
          <div className="header-metric ring-metric">
            <span className="m-label">Success Rate</span>
            {model.successRate !== undefined ? (
              <HeaderSuccessRing rate={model.successRate} />
            ) : (
              <span className="m-val-na">N/A</span>
            )}
          </div>
          <div className="header-metric">
            <span className="m-label">Avg Latency</span>
            <strong className="m-val">{fmtLatency(model.avgLatencyMs)}</strong>
          </div>
          <div className="header-metric">
            <span className="m-label">Calls (7d)</span>
            <strong className="m-val">{compactNumber(model.calls)}</strong>
          </div>
          <button className={`expand-chevron-btn ${expanded ? "open" : ""}`} aria-label="Expand details">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>
        </div>
      </div>

      {/* Expanded details drawer */}
      {expanded && (
        <div className="status-item-drawer">
          <div className="status-drawer-grid">
            {/* Left Box: Sparkline Latency Graph */}
            <div className="status-drawer-box graph-box">
              <LatencySparkline buckets={telemetry.buckets} id={model.modelName} />
            </div>

            {/* Middle Box: Timeline */}
            <div className="status-drawer-box timeline-box">
              <h4>Uptime & Response History</h4>
              <p className="box-sub">Segments represent 8.4-hour intervals across the last 7 days</p>
              <StatusTimelineGrid buckets={telemetry.buckets} />
              <div className="timeline-legend">
                <span>7 days ago</span>
                <div className="legend-items">
                  <span className="legend-dot dot--operational" /> Operational
                  <span className="legend-dot dot--degraded" /> Degraded
                  <span className="legend-dot dot--outage" /> Outage
                  <span className="legend-dot dot--empty" /> No Traffic
                </div>
                <span>Just now</span>
              </div>
            </div>

            {/* Right Box: Metrics & Percentiles */}
            <div className="status-drawer-box metrics-box">
              <div className="metrics-box-top">
                <SuccessRing rate={model.successRate ?? 1.0} />
                <div className="connection-info">
                  <div className="info-row">
                    <span>Gateways</span>
                    <strong>{model.providers.length} Active</strong>
                  </div>
                  <div className="info-row">
                    <span>Total Vol</span>
                    <strong>{compactNumber(model.calls)}</strong>
                  </div>
                </div>
              </div>

              <div className="percentiles-grid">
                <div className="pct-cell">
                  <span className="pct-label">p50</span>
                  <strong className="pct-val">{fmtLatency(telemetry.p50)}</strong>
                </div>
                <div className="pct-cell">
                  <span className="pct-label">p95</span>
                  <strong className="pct-val warning">{fmtLatency(telemetry.p95)}</strong>
                </div>
                <div className="pct-cell">
                  <span className="pct-label">p99</span>
                  <strong className="pct-val danger">{fmtLatency(telemetry.p99)}</strong>
                </div>
                <div className="pct-cell">
                  <span className="pct-label">Peak</span>
                  <strong className="pct-val">{fmtLatency(telemetry.max)}</strong>
                </div>
              </div>

              <div className="checked-time">
                Last used: {model.lastUsedAt ? formatUsageDateTime(model.lastUsedAt) : "Never"}
              </div>
            </div>
          </div>

          {/* Model Gateway Breakdown */}
          <div className="model-gateways-breakdown-section">
            <h4>Gateway Distribution</h4>
            <div className="model-gateways-list">
              {model.providers.map((mp) => (
                <ModelProviderRowItem key={mp.providerId} mp={mp} events={modelEvents} />
              ))}
            </div>
          </div>

          {/* Trace table */}
          {modelEvents.length > 0 ? (
            <RecentCallsTraceTable calls={modelEvents} />
          ) : (
            <div className="no-calls-box">No recent requests recorded for this model.</div>
          )}
        </div>
      )}
    </div>
  );
}

// ----------------------------------------------------
// MODEL PROVIDER ROW (For Model Card Gateway Breakdown)
// ----------------------------------------------------
function ModelProviderRowItem({ mp, events }: { mp: ModelProviderStatusSummary; events: UsageEvent[] }) {
  const providerCalls = useMemo(() => {
    return events.filter((e) => e.providerId === mp.providerId).slice(0, 10);
  }, [events, mp.providerId]);

  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className={`model-provider-row-item model-provider-row-item--${mp.level}`}>
      <div className="row-summary" onClick={() => setIsOpen(!isOpen)}>
        <div className="row-left">
          <span className={`status-indicator-dot dot--${mp.level}`} />
          <strong>{mp.providerName}</strong>
          {mp.calls > 0 && <span className="trace-toggle-btn">{isOpen ? "Hide traces" : "Show traces"}</span>}
        </div>
        <div className="row-metrics">
          <span className="chip success">Success: {fmtSuccess(mp)}</span>
          <span className="chip latency">Latency: {fmtLatency(mp.avgLatencyMs)}</span>
          <span className="chip calls">Calls: {compactNumber(mp.calls)}</span>
        </div>
      </div>
      {isOpen && providerCalls.length > 0 && (
        <div className="row-details">
          <RecentCallsTraceTable calls={providerCalls} hideHeader />
        </div>
      )}
    </div>
  );
}

// ----------------------------------------------------
// SUB-COMPONENTS & TELEMETRY HELPERS
// ----------------------------------------------------
function HeaderSuccessRing({ rate }: { rate: number }) {
  const radius = 18;
  const stroke = 3.5;
  const normalizedRadius = radius - stroke / 2 - 0.5; // 15.75
  const circumference = normalizedRadius * 2 * Math.PI;

  const tone = successRateTone(rate);
  const ringColor = tone === "operational" ? "var(--success)" : tone === "degraded" ? "var(--warn-color)" : "var(--danger)";

  return (
    <div className="header-success-ring-wrap" title={`Success rate is ${(rate * 100).toFixed(1)}%`}>
      <svg height={radius * 2} width={radius * 2}>
        <circle
          className="ring-bg"
          stroke="var(--border-subtle)"
          fill="transparent"
          strokeWidth={stroke}
          r={normalizedRadius}
          cx={radius}
          cy={radius}
        />
        <circle
          className="ring-fill"
          stroke={ringColor}
          fill="transparent"
          strokeWidth={stroke}
          strokeDasharray={`${rate * circumference} ${circumference}`}
          strokeDashoffset={0}
          strokeLinecap="round"
          r={normalizedRadius}
          cx={radius}
          cy={radius}
          transform={`rotate(-90 ${radius} ${radius})`}
        />
      </svg>
      <span className={`ring-text ring-text--${tone}`}>{(rate * 100).toFixed(0)}%</span>
    </div>
  );
}

function GlobalSuccessRing({ rate, hasTraffic }: { rate: number; hasTraffic: boolean }) {
  const radius = 38;
  const stroke = 5.5;
  const normalizedRadius = radius - stroke;
  const circumference = normalizedRadius * 2 * Math.PI;

  const displayRate = hasTraffic ? rate : 0;
  const tone = hasTraffic ? successRateTone(rate) : "empty";
  const ringColor = hasTraffic
    ? (tone === "operational" ? "var(--success)" : tone === "degraded" ? "var(--warn-color)" : "var(--danger)")
    : "var(--inactive)";

  const displayValue = hasTraffic ? `${(rate * 100).toFixed(2)}%` : "N/A";
  const centerValue = hasTraffic ? `${(rate * 100).toFixed(0)}%` : "N/A";
  const title = hasTraffic
    ? `Global success rate (7d) is ${(rate * 100).toFixed(2)}%`
    : "No gateway calls recorded in the last 7 days";

  return (
    <div className="global-success-ring-wrap" title={title}>
      <div className="global-ring-svg-container">
        <svg height={radius * 2} width={radius * 2}>
          <circle
            className="ring-bg"
            stroke="rgba(0, 0, 0, 0.05)"
            fill="transparent"
            strokeWidth={stroke}
            r={normalizedRadius}
            cx={radius}
            cy={radius}
          />
          <circle
            className="ring-fill"
            stroke={ringColor}
            fill="transparent"
            strokeWidth={stroke}
            strokeDasharray={`${displayRate * circumference} ${circumference}`}
            strokeDashoffset={0}
            strokeLinecap="round"
            r={normalizedRadius}
            cx={radius}
            cy={radius}
            transform={`rotate(-90 ${radius} ${radius})`}
          />
        </svg>
        <div className={`global-ring-percentage text--${tone}`}>{centerValue}</div>
      </div>
      <div className="global-ring-info">
        <span className={`global-ring-val text--${tone}`}>{displayValue}</span>
        <span className="global-ring-label">7d Success Rate</span>
      </div>
    </div>
  );
}

function MiniSparklineSvg({ buckets, id }: { buckets: BucketData[]; id: string }) {
  const activePoints = useMemo(() => {
    const values = buckets.map((b) => b.avgLatencyMs).filter((v): v is number => v !== undefined);
    const maxLat = values.length > 0 ? Math.max(...values, 100) : 100;

    const points: { x: number; y: number }[] = [];
    buckets.forEach((b, i) => {
      if (b.avgLatencyMs !== undefined) {
        const x = (i / (buckets.length - 1)) * 100;
        const y = 25 - (b.avgLatencyMs / maxLat) * 20 + 2; // scale in viewbox of 100x30
        points.push({ x, y });
      }
    });
    return points;
  }, [buckets]);

  const gradId = useMemo(() => `mini-spark-grad-${id.replace(/[^a-zA-Z0-9]/g, "-")}`, [id]);

  if (activePoints.length < 2) {
    return (
      <svg viewBox="0 0 100 30" width="80" height="24">
        <line x1="0" y1="15" x2="100" y2="15" stroke="var(--border-subtle)" strokeWidth="1" strokeDasharray="2,2" />
      </svg>
    );
  }

  const strokeD = `M ${activePoints.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" L ")}`;
  const fillD = `${strokeD} L ${activePoints[activePoints.length - 1].x.toFixed(1)},28 L ${activePoints[0].x.toFixed(1)},28 Z`;

  return (
    <svg viewBox="0 0 100 30" width="80" height="24" preserveAspectRatio="none">
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--primary)" stopOpacity="0.15" />
          <stop offset="100%" stopColor="var(--primary)" stopOpacity="0.0" />
        </linearGradient>
      </defs>
      <path d={fillD} fill={`url(#${gradId})`} />
      <path d={strokeD} fill="none" stroke="var(--primary)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function LatencySparkline({ buckets, id }: { buckets: BucketData[]; id: string }) {
  const activePoints = useMemo(() => {
    const values = buckets.map((b) => b.avgLatencyMs).filter((v): v is number => v !== undefined);
    const maxLat = values.length > 0 ? Math.max(...values, 100) : 100;

    const points: { x: number; y: number; lat: number }[] = [];
    buckets.forEach((b, i) => {
      if (b.avgLatencyMs !== undefined) {
        const x = (i / (buckets.length - 1)) * 300;
        const y = 50 - (b.avgLatencyMs / maxLat) * 40 + 5; // fit in range [5, 50] inside height 60
        points.push({ x, y, lat: b.avgLatencyMs });
      }
    });

    return { points, maxLat };
  }, [buckets]);

  const { points, maxLat } = activePoints;

  const gradId = useMemo(() => `sparkline-grad-${id.replace(/[^a-zA-Z0-9]/g, "-")}`, [id]);

  if (points.length === 0) {
    return (
      <div className="sparkline-placeholder">
        <svg viewBox="0 0 300 60" width="100%" height="60">
          <line x1="0" y1="30" x2="300" y2="30" stroke="var(--border-subtle)" strokeWidth="1.5" strokeDasharray="4,4" />
        </svg>
        <span>No latency trend data</span>
      </div>
    );
  }

  const strokeD = `M ${points.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" L ")}`;
  const fillD = `${strokeD} L ${points[points.length - 1].x.toFixed(1)},55 L ${points[0].x.toFixed(1)},55 Z`;

  const minVal = Math.min(...points.map((p) => p.lat));
  const maxVal = Math.max(...points.map((p) => p.lat));
  const latestVal = points[points.length - 1].lat;

  return (
    <div className="latency-sparkline-wrap">
      <div className="sparkline-header">
        <span className="sparkline-title">Latency Trend (7d)</span>
        <div className="sparkline-stats">
          <span>Min: <strong>{Math.round(minVal)}ms</strong></span>
          <span>Max: <strong>{Math.round(maxVal)}ms</strong></span>
          <span>Latest: <strong className="sparkline-latest">{Math.round(latestVal)}ms</strong></span>
        </div>
      </div>
      <div className="sparkline-svg-container">
        <svg viewBox="0 0 300 60" width="100%" height="60" preserveAspectRatio="none">
          <defs>
            <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--primary)" stopOpacity="0.2" />
              <stop offset="100%" stopColor="var(--primary)" stopOpacity="0.0" />
            </linearGradient>
          </defs>
          <path d={fillD} fill={`url(#${gradId})`} />
          <path d={strokeD} fill="none" stroke="var(--primary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          <circle cx={points[points.length - 1].x} cy={points[points.length - 1].y} r="3" fill="var(--primary)" />
        </svg>
      </div>
    </div>
  );
}

function StatusTimelineGrid({ buckets }: { buckets: BucketData[] }) {
  return (
    <div className="status-timeline-grid">
      {buckets.map((b, idx) => {
        let statusClass = "empty";
        if (b.calls > 0) {
          if (b.successRate < 0.8) {
            statusClass = "outage";
          } else if (b.successRate < 0.95 || (b.avgLatencyMs && b.avgLatencyMs > 10000)) {
            statusClass = "degraded";
          } else {
            statusClass = "operational";
          }
        }

        const dateStr = new Date(b.startTime).toLocaleString(undefined, {
          month: "short",
          day: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        });

        const tooltipText =
          b.calls > 0
            ? `${dateStr}: ${b.calls} calls, ${(b.successRate * 100).toFixed(1)}% success, ${
                b.avgLatencyMs ? Math.round(b.avgLatencyMs) + "ms" : "N/A"
              }`
            : `${dateStr}: No traffic`;

        return (
          <div key={idx} className="timeline-segment-wrap">
            <div className={`timeline-segment segment--${statusClass}`} />
            <div className="timeline-tooltip">{tooltipText}</div>
          </div>
        );
      })}
    </div>
  );
}

function SuccessRing({ rate }: { rate: number }) {
  const radius = 32;
  const stroke = 5.5;
  const normalizedRadius = radius - stroke;
  const circumference = normalizedRadius * 2 * Math.PI;

  const tone = successRateTone(rate);
  const ringColor = tone === "operational" ? "var(--success)" : tone === "degraded" ? "var(--warn-color)" : "var(--danger)";

  return (
    <div className="success-ring-wrap">
      <div className="svg-container">
        <svg height={radius * 2} width={radius * 2}>
          <circle
            className="ring-bg"
            stroke="var(--border-subtle)"
            fill="transparent"
            strokeWidth={stroke}
            r={normalizedRadius}
            cx={radius}
            cy={radius}
          />
          <circle
            className="ring-fill"
            stroke={ringColor}
            fill="transparent"
            strokeWidth={stroke}
            strokeDasharray={`${rate * circumference} ${circumference}`}
            strokeDashoffset={0}
            strokeLinecap="round"
            r={normalizedRadius}
            cx={radius}
            cy={radius}
            transform={`rotate(-90 ${radius} ${radius})`}
          />
        </svg>
        <div className={`success-ring-percentage text--${tone}`}>{(rate * 100).toFixed(0)}%</div>
      </div>
      <div className="success-ring-label">Success Rate (7d)</div>
    </div>
  );
}

function RecentCallsTraceTable({ calls, hideHeader = false }: { calls: UsageEvent[]; hideHeader?: boolean }) {
  return (
    <div className="status-trace-section">
      {!hideHeader && <div className="trace-section-header">Recent Telemetry Traces</div>}
      <div className="trace-table-wrap">
        <table className="trace-table">
          <thead>
            <tr>
              <th>Timestamp</th>
              <th>Endpoint / Model</th>
              <th>Status</th>
              <th>Latency</th>
              <th>Volume (Tokens)</th>
              <th>Trace Diagnostics</th>
            </tr>
          </thead>
          <tbody>
            {calls.map((c) => (
              <tr key={c.id} className={c.ok ? "" : "trace-row-failed"}>
                <td className="time-col">{formatUsageDateTime(c.startedAt)}</td>
                <td className="model-col" title={c.model}>
                  <code>{c.model ?? "-"}</code>
                </td>
                <td className="status-col">
                  <span className={`trace-status-badge ${c.ok ? "badge-ok" : "badge-fail"}`}>
                    {c.ok ? "OK" : "FAIL"} {c.status}
                  </span>
                </td>
                <td className="latency-col">{c.latencyMs}ms</td>
                <td className="tokens-col">{(c.totalTokens ?? ((c.inputTokens ?? 0) + (c.outputTokens ?? 0))) || "-"}</td>
                <td className="error-col" title={c.error ?? c.errorMessage}>
                  {c.error ?? c.errorMessage ?? <span className="trace-ok-info">All parameters normal</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ConnectionLatencyCard({ monitor }: { monitor: ConnectionMonitor }) {
  const tone = monitor.status === "available" ? "operational" : monitor.status === "unavailable" ? "outage" : "no-traffic";
  return (
    <div className={`status-item-card latency-monitor-card status-item-card--${tone}`}>
      <div className="status-item-header-wrap latency-monitor-header">
        <div className="status-item-left-sec">
          <div className="status-dot-pulse">
            <span className={`dot dot--${tone}`} />
            {tone === "operational" && <span className={`ring ring--${tone}`} />}
          </div>
          <div className="status-item-identity">
            <div className="identity-top">
              <h3>{monitor.name}</h3>
              <span className={`status-badge-inline badge--${tone}`}>{fmtConnection(monitor.status)}</span>
            </div>
            <code>{monitor.baseUrl}</code>
          </div>
        </div>

        <div className="latency-monitor-spark">
          {monitor.samples.length > 0 ? (
            <ConnectionSparkline samples={monitor.samples} id={monitor.id} />
          ) : (
            <span className="no-sparkline-text">No samples yet</span>
          )}
        </div>

        <div className="status-item-right-sec latency-monitor-metrics">
          <div className="header-metric">
            <span className="m-label">Checks</span>
            <strong className="m-val">{compactNumber(monitor.checks)}</strong>
          </div>
          <div className="header-metric">
            <span className="m-label">Connected</span>
            <strong className="m-val">{monitor.okCount} / {monitor.checks}</strong>
          </div>
          <div className="header-metric">
            <span className="m-label">Uptime</span>
            <strong className="m-val">{monitor.uptime !== undefined ? `${(monitor.uptime * 100).toFixed(0)}%` : "N/A"}</strong>
          </div>
          <div className="header-metric">
            <span className="m-label">Last</span>
            <strong className="m-val">{fmtLatency(monitor.lastLatencyMs)}</strong>
          </div>
        </div>
      </div>

      <div className="latency-monitor-stats">
        <div className="lm-stat"><span>Avg</span><strong>{fmtLatency(monitor.avgLatencyMs)}</strong></div>
        <div className="lm-stat"><span>Min</span><strong>{fmtLatency(monitor.minLatencyMs)}</strong></div>
        <div className="lm-stat"><span>Max</span><strong>{fmtLatency(monitor.maxLatencyMs)}</strong></div>
        <div className="lm-stat"><span>Failures</span><strong>{compactNumber(monitor.failCount)}</strong></div>
        <div className="lm-stat lm-stat--time"><span>Last checked</span><strong>{monitor.lastCheckedAt ? formatUsageDateTime(monitor.lastCheckedAt) : "Never"}</strong></div>
      </div>
    </div>
  );
}

function ConnectionSparkline({ samples, id }: { samples: ConnectionSample[]; id: string }) {
  const width = 160;
  const height = 36;
  const points = samples.slice(-40);
  const latencies = points.map((s) => (s.ok && typeof s.latencyMs === "number" ? s.latencyMs : null));
  const known = latencies.filter((l): l is number => l !== null);
  const max = known.length > 0 ? Math.max(...known) : 1;
  const min = known.length > 0 ? Math.min(...known) : 0;
  const range = max - min || 1;
  const step = points.length > 1 ? width / (points.length - 1) : width;
  const gradId = `lmgrad-${id}`;

  const path = latencies
    .map((l, i) => {
      if (l === null) return null;
      const x = i * step;
      const y = height - 4 - ((l - min) / range) * (height - 8);
      return { x, y };
    })
    .filter((p): p is { x: number; y: number } => p !== null);

  const line = path.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");

  return (
    <svg className="connection-sparkline" width={width} height={height} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--primary, #6366f1)" stopOpacity="0.9" />
          <stop offset="100%" stopColor="var(--primary, #6366f1)" stopOpacity="0.1" />
        </linearGradient>
      </defs>
      {points.map((s, i) => (
        <circle key={i} cx={(i * step).toFixed(1)} cy={height - 3} r={1.6} fill={s.ok ? "var(--success, #10b981)" : "var(--danger, #ef4444)"} opacity={0.85} />
      ))}
      {line && <path d={line} fill="none" stroke={`url(#${gradId})`} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />}
    </svg>
  );
}

function EmptyStatus({ message }: { message: string }) {
  return <div className="status-list-empty">{message}</div>;
}

function resolveGlobalLevel(providers: ProviderStatusSummary[]): StatusLevel {
  if (providers.length === 0) return "no-traffic";
  if (providers.some((p) => p.level === "outage")) return "outage";
  if (providers.some((p) => p.level === "degraded")) return "degraded";
  return "operational";
}

function globalStatusMessage(level: StatusLevel): string {
  if (level === "operational") return "All Systems Operational";
  if (level === "degraded") return "Systems Degraded";
  if (level === "outage") return "Major Outage Detected";
  return "No Data Stream";
}

function globalStatusSubtext(level: StatusLevel, outages: number, degraded: number): string {
  if (level === "operational") return "Gateway proxy and upstream LLM providers are responding normally.";
  if (level === "outage") return `${outages} provider${outages > 1 ? "s" : ""} experiencing downtime${degraded > 0 ? `, ${degraded} degraded` : ""}.`;
  if (level === "degraded") return `${degraded} provider${degraded > 1 ? "s" : ""} responding with elevated latency or errors.`;
  return "No API events recorded. Route traffic to starting collecting observability statistics.";
}

function fmtSuccess(stats: { successRate?: number }): string {
  if (stats.successRate === undefined) return "N/A";
  return `${(stats.successRate * 100).toFixed(1)}%`;
}

function fmtLatency(value: number | undefined): string {
  if (value === undefined) return "N/A";
  return `${Math.round(value)}ms`;
}

function fmtConnection(status: string | undefined): string {
  if (status === "available") return "Connected";
  if (status === "unavailable") return "Disconnected";
  return "Unknown";
}
