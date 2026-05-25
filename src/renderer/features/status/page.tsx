import { useMemo, useState } from "react";
import type { AppState, UsageEvent } from "../../../shared/types";
import {
  buildModelStatusSummaries,
  buildProviderStatusSummaries,
  statusLabel,
  type ModelProviderStatusSummary,
  type ModelStatusSummary,
  type ProviderStatusSummary,
  type StatusLevel,
  type StatusMetricSummary
} from "../../../shared/statusStats";
import { compactNumber, formatUsageDateTime } from "../../shared/utils";

type ViewMode = "providers" | "models";

export function StatusPage({ state }: { state: AppState }) {
  const [view, setView] = useState<ViewMode>("providers");
  const [expandedId, setExpandedId] = useState<string | undefined>();

  const providerSummaries = useMemo(
    () => buildProviderStatusSummaries(state.providers, state.usageEvents, state.usageRollups ?? []),
    [state.providers, state.usageEvents, state.usageRollups]
  );
  const modelSummaries = useMemo(
    () => buildModelStatusSummaries(state.usageEvents, state.usageRollups ?? [], state.modelCatalog ?? []),
    [state.usageEvents, state.usageRollups, state.modelCatalog]
  );

  const globalLevel = resolveGlobalLevel(providerSummaries);
  const outageCount = providerSummaries.filter((p) => p.level === "outage").length;
  const degradedCount = providerSummaries.filter((p) => p.level === "degraded").length;
  const operationalCount = providerSummaries.filter((p) => p.level === "operational").length;
  const totalCalls = providerSummaries.reduce((sum, p) => sum + p.calls, 0);

  const toggle = (id: string) => setExpandedId(expandedId === id ? undefined : id);

  return (
    <div className="status-page">
      {/* Global status banner */}
      <div className={`status-global-banner status-global-banner--${globalLevel}`}>
        <div className="status-global-icon">
          <GlobalStatusIcon level={globalLevel} />
        </div>
        <div className="status-global-text">
          <h2>{globalStatusMessage(globalLevel)}</h2>
          <p>{globalStatusSubtext(globalLevel, outageCount, degradedCount)}</p>
        </div>
      </div>

      {/* Summary counters */}
      <div className="status-counters">
        <CounterCard label="Operational" value={operationalCount} level="operational" />
        <CounterCard label="Degraded" value={degradedCount} level="degraded" />
        <CounterCard label="Outage" value={outageCount} level="outage" />
        <CounterCard label="Total Calls (7d)" value={totalCalls} />
        <CounterCard label="Providers" value={providerSummaries.length} />
        <CounterCard label="Models" value={modelSummaries.length} />
      </div>

      {/* View toggle */}
      <div className="status-view-toggle">
        <button className={view === "providers" ? "active" : ""} onClick={() => { setView("providers"); setExpandedId(undefined); }}>
          By Provider
        </button>
        <button className={view === "models" ? "active" : ""} onClick={() => { setView("models"); setExpandedId(undefined); }}>
          By Model
        </button>
      </div>

      {/* Provider view */}
      {view === "providers" && (
        <div className="status-section">
          <div className="status-section-header">
            <h3>Provider Status</h3>
            <span className="status-section-sub">Aggregated health across all models per provider (7-day window)</span>
          </div>
          <div className="status-items">
            {providerSummaries.map((p) => (
              <ProviderCard key={p.providerId} provider={p} events={state.usageEvents} expanded={expandedId === p.providerId} onToggle={() => toggle(p.providerId)} />
            ))}
            {providerSummaries.length === 0 && <EmptyStatus message="No providers configured. Add a provider and route traffic through API Vault." />}
          </div>
        </div>
      )}

      {/* Model view */}
      {view === "models" && (
        <div className="status-section">
          <div className="status-section-header">
            <h3>Model Status</h3>
            <span className="status-section-sub">Per-model health with provider breakdown. Only models with recorded traffic appear.</span>
          </div>
          <div className="status-items">
            {modelSummaries.map((m) => (
              <ModelCard key={m.modelName} model={m} events={state.usageEvents} expanded={expandedId === m.modelName} onToggle={() => toggle(m.modelName)} />
            ))}
            {modelSummaries.length === 0 && <EmptyStatus message="No model traffic recorded yet. Make API calls through a provider to see per-model status." />}
          </div>
        </div>
      )}

      <div className="status-footer">
        <span>Data from the last 7 days of recorded usage and provider connectivity tests.</span>
      </div>
    </div>
  );
}

function ProviderCard({ provider, events, expanded, onToggle }: { provider: ProviderStatusSummary; events: UsageEvent[]; expanded: boolean; onToggle: () => void }) {
  const recentCalls = useMemo(() => {
    if (!expanded) return [];
    return events.filter((e) => e.providerId === provider.providerId).slice(0, 20);
  }, [expanded, events, provider.providerId]);

  return (
    <div className={`status-item status-item--${provider.level}`}>
      <button type="button" className="status-item-header" onClick={onToggle} aria-expanded={expanded}>
        <div className="status-item-left">
          <StatusIndicator level={provider.level} />
          <div className="status-item-info">
            <strong>{provider.providerName}</strong>
            <code>{provider.baseUrl}</code>
          </div>
        </div>
        <div className="status-item-right">
          <MetricChip label="Status" value={statusLabel(provider.level)} level={provider.level} />
          <MetricChip label="Success" value={fmtSuccess(provider)} />
          <MetricChip label="Latency" value={fmtLatency(provider.avgLatencyMs)} />
          <MetricChip label="Calls" value={compactNumber(provider.calls)} />
          <span className={`status-chevron ${expanded ? "open" : ""}`} aria-hidden="true" />
        </div>
      </button>
      {expanded && (
        <div className="status-item-details">
          <div className="status-detail-row">
            <DetailCell label="Connection" value={fmtConnection(provider.providerStatus)} />
            <DetailCell label="Test Latency" value={fmtLatency(provider.testLatencyMs)} />
            <DetailCell label="Last Checked" value={provider.lastCheckedAt ? formatUsageDateTime(provider.lastCheckedAt) : "Never"} />
            <DetailCell label="Success Rate" value={fmtSuccess(provider)} highlight={provider.level !== "operational" && provider.level !== "no-traffic"} />
            <DetailCell label="Total Calls" value={compactNumber(provider.calls)} />
            <DetailCell label="Failed Calls" value={compactNumber(provider.failedCalls)} highlight={provider.failedCalls > 0} />
            <DetailCell label="Avg Latency" value={fmtLatency(provider.avgLatencyMs)} />
            <DetailCell label="Last Call" value={provider.lastUsedAt ? formatUsageDateTime(provider.lastUsedAt) : "No calls"} />
          </div>
          {provider.calls > 0 && <SuccessBar ok={provider.okCalls} failed={provider.failedCalls} />}
          {recentCalls.length > 0 && <RecentCallsTable calls={recentCalls} />}
        </div>
      )}
    </div>
  );
}

function ModelCard({ model, events, expanded, onToggle }: { model: ModelStatusSummary; events: UsageEvent[]; expanded: boolean; onToggle: () => void }) {
  const modelEvents = useMemo(() => {
    if (!expanded) return [];
    return events.filter((e) => e.model?.trim() === model.modelName).slice(0, 30);
  }, [expanded, events, model.modelName]);

  return (
    <div className={`status-item status-item--${model.level}`}>
      <button type="button" className="status-item-header" onClick={onToggle} aria-expanded={expanded}>
        <div className="status-item-left">
          <StatusIndicator level={model.level} />
          <div className="status-item-info">
            <strong>{model.modelName}</strong>
            <span>{model.providers.length} provider{model.providers.length === 1 ? "" : "s"}</span>
          </div>
        </div>
        <div className="status-item-right">
          <MetricChip label="Status" value={statusLabel(model.level)} level={model.level} />
          <MetricChip label="Success" value={fmtSuccess(model)} />
          <MetricChip label="Latency" value={fmtLatency(model.avgLatencyMs)} />
          <MetricChip label="Calls" value={compactNumber(model.calls)} />
          <span className={`status-chevron ${expanded ? "open" : ""}`} aria-hidden="true" />
        </div>
      </button>
      {expanded && (
        <div className="status-item-details">
          <div className="status-model-providers">
            {model.providers.map((mp) => (
              <ModelProviderRow key={`${model.modelName}-${mp.providerId}`} mp={mp} events={modelEvents} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function ModelProviderRow({ mp, events }: { mp: ModelProviderStatusSummary; events: UsageEvent[] }) {
  const [showCalls, setShowCalls] = useState(false);
  const providerCalls = useMemo(() => {
    if (!showCalls) return [];
    return events.filter((e) => e.providerId === mp.providerId).slice(0, 15);
  }, [showCalls, events, mp.providerId]);

  return (
    <div className={`status-model-provider status-model-provider--${mp.level}`}>
      <div className="status-model-provider-left">
        <StatusIndicator level={mp.level} size="sm" />
        <strong>{mp.providerName}</strong>
        {mp.calls > 0 && (
          <button type="button" className="status-calls-toggle" onClick={() => setShowCalls(!showCalls)}>
            {showCalls ? "Hide calls" : "View calls"}
          </button>
        )}
      </div>
      <div className="status-model-provider-metrics">
        <MetricChip label="Status" value={statusLabel(mp.level)} level={mp.level} />
        <MetricChip label="Success" value={fmtSuccess(mp)} />
        <MetricChip label="Latency" value={fmtLatency(mp.avgLatencyMs)} />
        <MetricChip label="Calls" value={compactNumber(mp.calls)} />
        <MetricChip label="Failed" value={compactNumber(mp.failedCalls)} />
        {mp.lastUsedAt && <MetricChip label="Last Call" value={formatUsageDateTime(mp.lastUsedAt)} />}
      </div>
      {mp.calls > 0 && <SuccessBar ok={mp.okCalls} failed={mp.failedCalls} />}
      {showCalls && providerCalls.length > 0 && <RecentCallsTable calls={providerCalls} />}
    </div>
  );
}

function StatusIndicator({ level, size = "md" }: { level: StatusLevel; size?: "sm" | "md" }) {
  return <span className={`status-indicator status-indicator--${level} status-indicator--${size}`} aria-label={statusLabel(level)} />;
}

function MetricChip({ label, value, level }: { label: string; value: string; level?: StatusLevel }) {
  const cls = level ? `status-metric-chip status-metric-chip--${level}` : "status-metric-chip";
  return (
    <span className={cls}>
      <em>{label}</em>
      <strong>{value}</strong>
    </span>
  );
}

function DetailCell({ label, value, highlight = false }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className={`status-detail-cell ${highlight ? "status-detail-cell--warn" : ""}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function SuccessBar({ ok, failed }: { ok: number; failed: number }) {
  const total = ok + failed;
  if (total === 0) return null;
  const okPct = (ok / total) * 100;
  return (
    <div className="status-success-bar">
      <div className="status-success-bar-fill" style={{ width: `${okPct}%` }} />
      <div className="status-success-bar-label">
        <span>{ok} OK</span>
        {failed > 0 && <span className="fail">{failed} Failed</span>}
      </div>
    </div>
  );
}

function CounterCard({ label, value, level }: { label: string; value: number; level?: StatusLevel }) {
  const cls = level && value > 0 ? `status-counter status-counter--${level}` : "status-counter";
  return (
    <div className={cls}>
      <div className="status-counter-icon">
        {getCounterIcon(label, level)}
      </div>
      <div className="status-counter-text">
        <strong>{compactNumber(value)}</strong>
        <span>{label}</span>
      </div>
    </div>
  );
}

function getCounterIcon(label: string, level?: StatusLevel) {
  const size = 22;
  if (level === "operational") {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ color: "var(--success)" }}>
        <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
        <polyline points="22 4 12 14.01 9 11.01"></polyline>
      </svg>
    );
  }
  if (level === "degraded") {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ color: "var(--warn-color)" }}>
        <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path>
        <line x1="12" y1="9" x2="12" y2="13"></line>
        <line x1="12" y1="17" x2="12.01" y2="17"></line>
      </svg>
    );
  }
  if (level === "outage") {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ color: "var(--danger)" }}>
        <circle cx="12" cy="12" r="10"></circle>
        <line x1="15" y1="9" x2="9" y2="15"></line>
        <line x1="9" y1="9" x2="15" y2="15"></line>
      </svg>
    );
  }
  if (label.includes("Calls")) {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ color: "var(--primary)" }}>
        <line x1="18" y1="20" x2="18" y2="10"></line>
        <line x1="12" y1="20" x2="12" y2="4"></line>
        <line x1="6" y1="20" x2="6" y2="14"></line>
      </svg>
    );
  }
  if (label.includes("Providers")) {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ color: "var(--primary)" }}>
        <rect x="2" y="2" width="20" height="8" rx="2" ry="2"></rect>
        <rect x="2" y="14" width="20" height="8" rx="2" ry="2"></rect>
        <line x1="6" y1="6" x2="6.01" y2="6"></line>
        <line x1="6" y1="18" x2="6.01" y2="18"></line>
      </svg>
    );
  }
  if (label.includes("Models")) {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ color: "var(--primary)" }}>
        <polygon points="12 2 2 7 12 12 22 7 12 2"></polygon>
        <polyline points="2 17 12 22 22 17"></polyline>
        <polyline points="2 12 12 17 22 12"></polyline>
      </svg>
    );
  }
  return null;
}

function GlobalStatusIcon({ level }: { level: StatusLevel }) {
  const size = 24;
  if (level === "operational") {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
        <circle cx="12" cy="12" r="10" fill="#1e8e3e" stroke="#1e8e3e" />
        <polyline points="16 9 11 14 8 11" stroke="#ffffff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  if (level === "degraded") {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
        <path d="M12 2.5L2.5 21.5h19L12 2.5z" fill="#f9ab00" stroke="#f9ab00" strokeWidth="1" strokeLinejoin="round" />
        <line x1="12" y1="9" x2="12" y2="14" stroke="#ffffff" strokeWidth="2.5" strokeLinecap="round" />
        <line x1="12" y1="17.5" x2="12.01" y2="17.5" stroke="#ffffff" strokeWidth="3" strokeLinecap="round" />
      </svg>
    );
  }
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="10" fill="#d93025" stroke="#d93025" />
      <line x1="12" y1="7.5" x2="12" y2="13.5" stroke="#ffffff" strokeWidth="2.5" strokeLinecap="round" />
      <line x1="12" y1="17" x2="12.01" y2="17" stroke="#ffffff" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

function EmptyStatus({ message }: { message: string }) {
  return <div className="status-empty">{message}</div>;
}

function resolveGlobalLevel(providers: ProviderStatusSummary[]): StatusLevel {
  if (providers.length === 0) return "no-traffic";
  if (providers.some((p) => p.level === "outage")) return "outage";
  if (providers.some((p) => p.level === "degraded")) return "degraded";
  return "operational";
}

function globalStatusMessage(level: StatusLevel): string {
  if (level === "operational") return "All Systems Operational";
  if (level === "degraded") return "Some Systems Degraded";
  if (level === "outage") return "System Outage Detected";
  return "No Traffic Recorded";
}

function globalStatusSubtext(level: StatusLevel, outages: number, degraded: number): string {
  if (level === "operational") return "All providers are responding normally within expected latency.";
  if (level === "outage") return `${outages} provider${outages > 1 ? "s" : ""} experiencing outage${degraded > 0 ? `, ${degraded} degraded` : ""}.`;
  if (level === "degraded") return `${degraded} provider${degraded > 1 ? "s" : ""} with degraded performance.`;
  return "Add providers and route traffic to see status data.";
}

function fmtSuccess(stats: StatusMetricSummary): string {
  if (stats.successRate === undefined) return "N/A";
  return `${(stats.successRate * 100).toFixed(1)}%`;
}

function fmtLatency(value: number | undefined): string {
  if (value === undefined) return "N/A";
  return `${Math.round(value)}ms`;
}

function fmtConnection(status: string | undefined): string {
  if (status === "available") return "Connected";
  if (status === "unavailable") return "Unreachable";
  return "Unknown";
}

function RecentCallsTable({ calls }: { calls: UsageEvent[] }) {
  return (
    <div className="status-calls-section">
      <div className="status-calls-header">Recent Calls</div>
      <div className="status-calls-table-wrap">
        <table className="status-calls-table">
          <thead>
            <tr>
              <th>Time</th>
              <th>Model</th>
              <th>Status</th>
              <th>Latency</th>
              <th>Tokens</th>
              <th>Error</th>
            </tr>
          </thead>
          <tbody>
            {calls.map((c) => (
              <tr key={c.id} className={c.ok ? "" : "status-call-row--fail"}>
                <td>{formatUsageDateTime(c.startedAt)}</td>
                <td>{c.model ?? "-"}</td>
                <td>
                  <span className={`status-call-badge ${c.ok ? "status-call-badge--ok" : "status-call-badge--fail"}`}>
                    {c.ok ? "OK" : "FAIL"} {c.status}
                  </span>
                </td>
                <td>{c.latencyMs}ms</td>
                <td>{(c.totalTokens ?? ((c.inputTokens ?? 0) + (c.outputTokens ?? 0))) || "-"}</td>
                <td className="status-call-error">{usageErrorText(c)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function usageErrorText(event: UsageEvent): string {
  return event.error ?? event.errorMessage ?? "";
}
