import React, { useEffect, useMemo, useState } from "react";
import type { AddKeyInput, AppState, BalanceConfig, BalanceSnapshot, ProviderSafe, UsageEvent, UsageRollup } from "../shared/types";
import { apiClient } from "./apiClient";

type Tab = "dashboard" | "providers" | "usage" | "billing";
type AnalyticsRange = "1h" | "24h" | "7d" | "all";
type AnalyticsStatus = "all" | "ok" | "failed";
interface AnalyticsRow {
  providerId: string;
  providerName: string;
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
}

const STATE_REFRESH_INTERVAL_MS = 5000;

const defaultBalanceConfig: BalanceConfig = {
  enabled: false, url: "", method: "GET",
  headersJson: '{\n  "Authorization": "Bearer {{queryKey}}"\n}',
  bodyTemplate: "", balancePath: "", spentPath: "",
  currencyPath: "", responseCostPath: "", autoSyncIntervalMs: 0
};

export default function App() {
  const [state, setState] = useState<AppState | null>(null);
  const [tab, setTab] = useState<Tab>("dashboard");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    apiClient.getState().then(setState).catch((e) => setError(e.message));
  }, []);

  useEffect(() => {
    if (!state?.unlocked) return;
    const timer = window.setInterval(() => {
      apiClient.getState().then(setState).catch(() => {});
    }, STATE_REFRESH_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [state?.unlocked]);

  const showMsg = (msg: string) => { setMessage(msg); setTimeout(() => setMessage(""), 3000); };
  const showErr = (e: unknown) => { const m = e instanceof Error ? e.message : String(e); setError(m); setTimeout(() => setError(""), 5000); };

  if (!state) return <div className="loading">Loading...</div>;

  if (!state.initialized) {
    return (
      <div className="auth-page">
        <div className="auth-card">
          <h1>API Vault</h1>
          <p>Set a master password to encrypt your API keys.</p>
          <input type="password" placeholder="Master password (8+ chars)" value={password}
            onChange={(e) => setPassword(e.target.value)} onKeyDown={(e) => e.key === "Enter" && setup()} />
          <button onClick={setup}>Initialize Vault</button>
          {error && <div className="error-msg">{error}</div>}
        </div>
      </div>
    );
  }

  if (!state.unlocked) {
    return (
      <div className="auth-page">
        <div className="auth-card">
          <h1>API Vault</h1>
          <p>Enter your master password to unlock.</p>
          <input type="password" placeholder="Master password" value={password}
            onChange={(e) => setPassword(e.target.value)} onKeyDown={(e) => e.key === "Enter" && unlock()} />
          <button onClick={unlock}>Unlock</button>
          {error && <div className="error-msg">{error}</div>}
        </div>
      </div>
    );
  }

  async function setup() {
    try { const s = await apiClient.setupVault(password); setState(s); setPassword(""); }
    catch (e) { showErr(e); }
  }
  async function unlock() {
    try { const s = await apiClient.unlockVault(password); setState(s); setPassword(""); }
    catch (e) { showErr(e); }
  }
  async function lock() {
    try { const s = await apiClient.lockVault(); setState(s); }
    catch (e) { showErr(e); }
  }

  return (
    <div className="app">
      <nav className="sidebar">
        <div className="brand">API Vault</div>
        <div className="nav-items">
          {(["dashboard", "providers", "usage", "billing"] as Tab[]).map((t) => (
            <button key={t} className={tab === t ? "active" : ""} onClick={() => setTab(t)}>
              {t.charAt(0).toUpperCase() + t.slice(1)}
            </button>
          ))}
        </div>
        {state.proxyPort && <div className="proxy-status">Proxy: 127.0.0.1:{state.proxyPort}</div>}
        <button className="lock-btn" onClick={lock}>Lock Vault</button>
      </nav>
      <main className="content">
        {message && <div className="toast success">{message}</div>}
        {error && <div className="toast error">{error}</div>}
        {state.unlocked && (
          <div className="recording-indicator">
            <strong>{state.totals.totalCalls}</strong> calls recorded
            {state.totals.totalCalls > 0 && <button onClick={() => setTab("usage")}>View Usage</button>}
          </div>
        )}
        {tab === "dashboard" && <Dashboard state={state} />}
        {tab === "providers" && <Providers state={state} setState={setState} showMsg={showMsg} showErr={showErr} />}
        {tab === "usage" && <Usage state={state} />}
        {tab === "billing" && <Billing state={state} setState={setState} showMsg={showMsg} showErr={showErr} />}
      </main>
    </div>
  );
}

/* ─── Dashboard ─── */
function formatMoney(value: number, currency?: string): string {
  const unit = currency?.trim();
  return unit ? `${unit} ${value.toFixed(4)}` : value.toFixed(4);
}

function formatBalanceValue(value: number, unit?: string): string {
  const label = unit?.trim();
  const isQuota = label?.toLowerCase() === "quota";
  const formatted = value.toLocaleString(undefined, {
    maximumFractionDigits: isQuota ? 0 : 4
  });
  if (!label) return formatted;
  return isQuota ? `${formatted} quota` : `${label} ${formatted}`;
}

function formatBalanceSummary(snapshot: BalanceSnapshot): string {
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

function modelLabel(item: Pick<UsageEvent, "model">): string {
  return item.model?.trim() || "No model";
}

function eventTokens(event: Pick<UsageEvent, "totalTokens" | "inputTokens" | "outputTokens">): number {
  if (event.totalTokens !== undefined) return event.totalTokens;
  const input = event.inputTokens ?? 0;
  const output = event.outputTokens ?? 0;
  return input + output;
}

function compactNumber(value: number): string {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 1, notation: "compact" }).format(value);
}

function shortLabel(value: string, max = 18): string {
  return value.length > max ? `${value.slice(0, Math.max(0, max - 3))}...` : value;
}

function Dashboard({ state }: { state: AppState }) {
  const latestBalances = useMemo(() => {
    const map = new Map<string, BalanceSnapshot>();
    for (const snap of state.balanceSnapshots) {
      if (!map.has(snap.providerId) && snap.ok) map.set(snap.providerId, snap);
    }
    return map;
  }, [state.balanceSnapshots]);
  const providerReportedTokens = useMemo(() => {
    let total = 0;
    for (const snap of latestBalances.values()) {
      const unit = snap.currency?.toLowerCase();
      if (snap.ok && snap.spent !== undefined && (unit === "token_usage" || unit === "tokens" || unit === "token")) {
        total += snap.spent;
      }
    }
    return total;
  }, [latestBalances]);

  return (
    <div className="page">
      <h2>Dashboard</h2>
      <div className="metrics">
        <div className="metric-card">
          <span className="metric-value">{state.totals.totalCalls}</span>
          <span className="metric-label">Total Calls</span>
        </div>
        <div className="metric-card">
          <span className="metric-value metric-value-text">
            {providerReportedTokens > 0 ? compactNumber(providerReportedTokens) : "Not returned"}
          </span>
          <span className="metric-label">Total Tokens</span>
        </div>
        <div className="metric-card">
          <span className="metric-value">{state.totals.callsToday}</span>
          <span className="metric-label">Today</span>
        </div>
        <div className="metric-card">
          <span className="metric-value">{state.totals.okCalls}</span>
          <span className="metric-label">Success</span>
        </div>
        <div className="metric-card">
          <span className="metric-value">{state.totals.failedCalls}</span>
          <span className="metric-label">Failed</span>
        </div>
        <div className="metric-card">
          <span className="metric-value metric-value-text">
            {state.totals.realCostCount > 0 ? formatMoney(state.totals.realCostTotal) : "Not returned"}
          </span>
          <span className="metric-label">Tracked Cost</span>
        </div>
      </div>

      {state.providers.length > 0 && (
        <div className="section">
          <h3>Provider Balances</h3>
          <div className="balance-grid">
            {state.providers.map((p) => {
              const bal = latestBalances.get(p.id);
              return (
                <div key={p.id} className="balance-card">
                  <div className="balance-name">{p.name}</div>
                  {bal ? (
                    <div className="balance-info">
                      {bal.unlimitedQuota && <div>Balance: Unlimited quota</div>}
                      {!bal.unlimitedQuota && bal.balance !== undefined && <div>Balance: {formatBalanceValue(bal.balance, bal.currency)}</div>}
                      {bal.spent !== undefined && <div>Spent: {formatBalanceValue(bal.spent, bal.currency)}</div>}
                      {bal.granted !== undefined && <div>Granted: {formatBalanceValue(bal.granted, bal.currency)}</div>}
                      {bal.tokenName && <div>Token: {bal.tokenName}</div>}
                      <div className="balance-time">{new Date(bal.checkedAt).toLocaleString()}</div>
                    </div>
                  ) : (
                    <div className="balance-info muted">No balance data</div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      <UsageAnalytics events={state.usageEvents} rollups={state.usageRollups ?? []} />
    </div>
  );
}

function UsageAnalytics({ events, rollups }: { events: UsageEvent[]; rollups: UsageRollup[] }) {
  const rows = useMemo(() => buildAnalyticsRows(events, rollups, "all"), [events, rollups]);
  const ranking = useMemo(() => buildModelTokenRanking(rows), [rows]);
  const totalTokens = ranking.reduce((sum, item) => sum + item.tokens, 0);

  return (
    <div className="section analytics-section">
      <div className="analytics-header">
        <div>
          <h3>Model Token Leaderboard</h3>
          <p>{compactNumber(totalTokens)} tokens across all providers</p>
        </div>
      </div>
      {ranking.length === 0 ? (
        <p className="empty">No token usage recorded yet.</p>
      ) : (
        <ModelTokenLeaderboard data={ranking} />
      )}
    </div>
  );
}

function AnalyticsCard({ title, subtitle, wide, children }: {
  title: string;
  subtitle: string;
  wide?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className={`analytics-card ${wide ? "analytics-card-wide" : ""}`}>
      <div className="analytics-card-head">
        <strong>{title}</strong>
        <span>{subtitle}</span>
      </div>
      {children}
    </div>
  );
}

function buildAnalyticsRows(events: UsageEvent[], rollups: UsageRollup[], range: AnalyticsRange): AnalyticsRow[] {
  const rows: AnalyticsRow[] = events.map((event) => ({
    providerId: event.providerId,
    providerName: event.providerName,
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
    startedAt: event.startedAt
  }));

  if (range === "7d" || range === "all") {
    const period = range === "7d" ? "week" : "month";
    for (const rollup of rollups) {
      if (rollup.period !== period) continue;
      rows.push({
        providerId: rollup.providerId,
        providerName: rollup.providerName,
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
        startedAt: rollup.bucketStart
      });
    }
  }

  return rows;
}

function buildTokenBars(events: AnalyticsRow[]) {
  const map = new Map<string, { label: string; input: number; output: number; cached: number; total: number }>();
  for (const event of events) {
    const total = event.totalTokens;
    if (!total) continue;
    const label = modelLabel(event);
    const row = map.get(label) ?? { label, input: 0, output: 0, cached: 0, total: 0 };
    row.input += event.inputTokens;
    row.output += event.outputTokens;
    row.cached += event.cachedInputTokens;
    row.total += total;
    map.set(label, row);
  }
  return Array.from(map.values()).sort((a, b) => b.total - a.total).slice(0, 8);
}

function buildTokenTimeSeries(events: AnalyticsRow[], range: AnalyticsRange) {
  const map = new Map<string, { label: string; sort: number; value: number }>();
  for (const event of events) {
    const tokens = event.totalTokens;
    if (!tokens) continue;
    const bucket = timeBucket(event.startedAt, range);
    const row = map.get(bucket.key) ?? { label: bucket.label, sort: bucket.sort, value: 0 };
    row.value += tokens;
    map.set(bucket.key, row);
  }
  return Array.from(map.values()).sort((a, b) => a.sort - b.sort).slice(-16);
}

function buildModelTrend(events: AnalyticsRow[], range: AnalyticsRange) {
  const labels = new Map<string, { label: string; sort: number }>();
  const modelCounts = new Map<string, number>();
  const bucketCounts = new Map<string, Map<string, number>>();

  for (const event of events) {
    const model = modelLabel(event);
    const bucket = timeBucket(event.startedAt, range);
    labels.set(bucket.key, { label: bucket.label, sort: bucket.sort });
    modelCounts.set(model, (modelCounts.get(model) ?? 0) + event.calls);
    const row = bucketCounts.get(model) ?? new Map<string, number>();
    row.set(bucket.key, (row.get(bucket.key) ?? 0) + event.calls);
    bucketCounts.set(model, row);
  }

  const sortedBuckets = Array.from(labels.entries()).sort((a, b) => a[1].sort - b[1].sort).slice(-16);
  const topModels = Array.from(modelCounts.entries()).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([name]) => name);

  return {
    labels: sortedBuckets.map(([, item]) => item.label),
    series: topModels.map((name) => ({
      label: name,
      values: sortedBuckets.map(([key]) => bucketCounts.get(name)?.get(key) ?? 0)
    }))
  };
}

function buildCallDistribution(events: AnalyticsRow[]) {
  const map = new Map<string, number>();
  for (const event of events) {
    const label = modelLabel(event);
    map.set(label, (map.get(label) ?? 0) + event.calls);
  }
  const rows = Array.from(map.entries())
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value);
  const top = rows.slice(0, 5);
  const other = rows.slice(5).reduce((sum, item) => sum + item.value, 0);
  return other ? [...top, { label: "Other", value: other }] : top;
}

function buildCallRanking(events: AnalyticsRow[]) {
  const map = new Map<string, { label: string; calls: number; tokens: number; success: number }>();
  for (const event of events) {
    const label = modelLabel(event);
    const row = map.get(label) ?? { label, calls: 0, tokens: 0, success: 0 };
    row.calls += event.calls;
    row.tokens += event.totalTokens;
    row.success += event.okCalls;
    map.set(label, row);
  }
  return Array.from(map.values()).sort((a, b) => b.calls - a.calls || b.tokens - a.tokens).slice(0, 8);
}

function buildModelTokenRanking(events: AnalyticsRow[]) {
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

function timeBucket(value: string, range: AnalyticsRange) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return { key: "unknown", label: "Unknown", sort: 0 };
  const copy = new Date(date);
  if (range === "1h") {
    copy.setSeconds(0, 0);
    copy.setMinutes(Math.floor(copy.getMinutes() / 5) * 5);
    return { key: copy.toISOString(), label: copy.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }), sort: copy.getTime() };
  }
  if (range === "24h") {
    copy.setMinutes(0, 0, 0);
    return { key: copy.toISOString(), label: copy.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }), sort: copy.getTime() };
  }
  copy.setHours(0, 0, 0, 0);
  return { key: copy.toISOString(), label: copy.toLocaleDateString([], { month: "short", day: "numeric" }), sort: copy.getTime() };
}

function EmptyChart({ label = "No chart data yet" }: { label?: string }) {
  return <div className="empty-chart">{label}</div>;
}

function TokenBarChart({ data }: { data: ReturnType<typeof buildTokenBars> }) {
  if (!data.length) return <EmptyChart label="No token usage recorded yet" />;

  const width = 560;
  const height = 240;
  const max = Math.max(...data.map((item) => item.total), 1);
  const plotWidth = width - 116;
  const barHeight = 18;
  const gap = 13;

  return (
    <svg className="analytics-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Token consumption by model">
      {data.map((item, index) => {
        const y = 26 + index * (barHeight + gap);
        const inputWidth = plotWidth * (item.input / max);
        const outputWidth = plotWidth * (item.output / max);
        const cachedWidth = plotWidth * (item.cached / max);
        const totalWidth = Math.max(2, plotWidth * (item.total / max));
        return (
          <g key={item.label}>
            <text x="0" y={y + 13} className="chart-label">{shortLabel(item.label, 16)}</text>
            <rect x="104" y={y} width={plotWidth} height={barHeight} rx="4" className="chart-bar-bg" />
            <rect x="104" y={y} width={totalWidth} height={barHeight} rx="4" className="chart-bar-total" />
            <rect x="104" y={y} width={inputWidth} height={barHeight} rx="4" className="chart-bar-input" />
            <rect x={104 + inputWidth} y={y} width={outputWidth} height={barHeight} className="chart-bar-output" />
            <rect x={104 + inputWidth + outputWidth} y={y} width={cachedWidth} height={barHeight} className="chart-bar-cached" />
            <text x={width - 2} y={y + 13} textAnchor="end" className="chart-value">{compactNumber(item.total)}</text>
          </g>
        );
      })}
      <g transform={`translate(104 ${height - 20})`} className="chart-legend">
        <circle cx="0" cy="0" r="4" className="legend-input" /><text x="9" y="4">input</text>
        <circle cx="64" cy="0" r="4" className="legend-output" /><text x="73" y="4">output</text>
        <circle cx="136" cy="0" r="4" className="legend-cached" /><text x="145" y="4">cached</text>
      </g>
    </svg>
  );
}

function AreaChart({ data }: { data: ReturnType<typeof buildTokenTimeSeries> }) {
  if (!data.length) return <EmptyChart label="No token timeline yet" />;

  const width = 560;
  const height = 240;
  const pad = { top: 22, right: 22, bottom: 38, left: 48 };
  const max = Math.max(...data.map((point) => point.value), 1);
  const points = data.map((point, index) => {
    const x = pad.left + (data.length === 1 ? 0.5 : index / (data.length - 1)) * (width - pad.left - pad.right);
    const y = height - pad.bottom - (point.value / max) * (height - pad.top - pad.bottom);
    return { ...point, x, y };
  });
  const line = points.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`).join(" ");
  const area = `${line} L ${points[points.length - 1].x} ${height - pad.bottom} L ${points[0].x} ${height - pad.bottom} Z`;

  return (
    <svg className="analytics-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Token area over time">
      <line x1={pad.left} y1={height - pad.bottom} x2={width - pad.right} y2={height - pad.bottom} className="chart-axis" />
      <line x1={pad.left} y1={pad.top} x2={pad.left} y2={height - pad.bottom} className="chart-axis" />
      <text x={pad.left - 8} y={pad.top + 4} textAnchor="end" className="chart-value">{compactNumber(max)}</text>
      <path d={area} className="chart-area" />
      <path d={line} className="chart-line" />
      {points.map((point, index) => (
        <g key={`${point.label}-${index}`}>
          <circle cx={point.x} cy={point.y} r="4" className="chart-dot" />
          {(index === 0 || index === points.length - 1) && (
            <text x={point.x} y={height - 14} textAnchor={index === 0 ? "start" : "end"} className="chart-label">{point.label}</text>
          )}
        </g>
      ))}
    </svg>
  );
}

function ModelTrendChart({ data }: { data: ReturnType<typeof buildModelTrend> }) {
  if (!data.labels.length || !data.series.length) return <EmptyChart label="No model trend yet" />;

  const width = 760;
  const height = 260;
  const pad = { top: 22, right: 28, bottom: 44, left: 48 };
  const colors = ["#2563eb", "#0f172a", "#60a5fa", "#94a3b8"];
  const max = Math.max(...data.series.flatMap((series) => series.values), 1);
  const plotWidth = width - pad.left - pad.right;
  const plotHeight = height - pad.top - pad.bottom;

  return (
    <svg className="analytics-chart trend-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Model call trend">
      <line x1={pad.left} y1={height - pad.bottom} x2={width - pad.right} y2={height - pad.bottom} className="chart-axis" />
      <line x1={pad.left} y1={pad.top} x2={pad.left} y2={height - pad.bottom} className="chart-axis" />
      <text x={pad.left - 8} y={pad.top + 4} textAnchor="end" className="chart-value">{max}</text>
      {data.series.map((series, seriesIndex) => {
        const path = series.values.map((value, index) => {
          const x = pad.left + (data.labels.length === 1 ? 0.5 : index / (data.labels.length - 1)) * plotWidth;
          const y = height - pad.bottom - (value / max) * plotHeight;
          return `${index === 0 ? "M" : "L"} ${x} ${y}`;
        }).join(" ");
        return <path key={series.label} d={path} fill="none" stroke={colors[seriesIndex % colors.length]} className="trend-line" />;
      })}
      {data.labels.map((label, index) => {
        if (index !== 0 && index !== data.labels.length - 1) return null;
        const x = pad.left + (data.labels.length === 1 ? 0.5 : index / (data.labels.length - 1)) * plotWidth;
        return <text key={`${label}-${index}`} x={x} y={height - 16} textAnchor={index === 0 ? "start" : "end"} className="chart-label">{label}</text>;
      })}
      <g transform={`translate(${pad.left} ${height - 2})`} className="chart-legend">
        {data.series.map((series, index) => (
          <g key={series.label} transform={`translate(${index * 156} 0)`}>
            <circle cx="0" cy="0" r="4" fill={colors[index % colors.length]} />
            <text x="9" y="4">{shortLabel(series.label, 16)}</text>
          </g>
        ))}
      </g>
    </svg>
  );
}

function CallPieChart({ data }: { data: ReturnType<typeof buildCallDistribution> }) {
  if (!data.length) return <EmptyChart label="No call distribution yet" />;

  const total = data.reduce((sum, item) => sum + item.value, 0);
  const colors = ["#2563eb", "#0f172a", "#60a5fa", "#94a3b8", "#cbd5e1", "#dbeafe"];
  const radius = 54;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;

  return (
    <div className="pie-layout">
      <svg className="pie-chart" viewBox="0 0 160 160" role="img" aria-label="Call count distribution">
        <circle cx="80" cy="80" r={radius} className="pie-bg" />
        {data.map((item, index) => {
          const length = (item.value / total) * circumference;
          const circle = (
            <circle
              key={item.label}
              cx="80"
              cy="80"
              r={radius}
              fill="none"
              stroke={colors[index % colors.length]}
              strokeWidth="22"
              strokeDasharray={`${length} ${circumference - length}`}
              strokeDashoffset={-offset}
              transform="rotate(-90 80 80)"
            />
          );
          offset += length;
          return circle;
        })}
        <text x="80" y="77" textAnchor="middle" className="pie-total">{total}</text>
        <text x="80" y="96" textAnchor="middle" className="pie-label">calls</text>
      </svg>
      <div className="pie-legend">
        {data.map((item, index) => (
          <div key={item.label}>
            <span style={{ background: colors[index % colors.length] }} />
            <strong>{shortLabel(item.label, 20)}</strong>
            <em>{Math.round((item.value / total) * 100)}%</em>
          </div>
        ))}
      </div>
    </div>
  );
}

function CallLeaderboard({ data }: { data: ReturnType<typeof buildCallRanking> }) {
  if (!data.length) return <EmptyChart label="No ranking data yet" />;
  const max = Math.max(...data.map((item) => item.calls), 1);

  return (
    <div className="leaderboard">
      {data.map((item, index) => (
        <div key={item.label} className="leaderboard-row">
          <span className="rank">{index + 1}</span>
          <div className="leaderboard-main">
            <div className="leaderboard-title">
              <strong>{item.label}</strong>
              <span>{item.calls} calls</span>
            </div>
            <div className="leaderboard-track">
              <div style={{ width: `${Math.max(6, (item.calls / max) * 100)}%` }} />
            </div>
            <small>{compactNumber(item.tokens)} tokens - {item.success}/{item.calls} success</small>
          </div>
        </div>
      ))}
    </div>
  );
}

/* ─── Providers ─── */
function ModelTokenLeaderboard({ data }: { data: ReturnType<typeof buildModelTokenRanking> }) {
  if (!data.length) return <EmptyChart label="No token data yet" />;
  const max = Math.max(...data.map((item) => item.tokens), 1);

  return (
    <div className="model-token-board">
      {data.map((item, index) => (
        <div key={item.label} className="model-token-row">
          <span className="rank">{index + 1}</span>
          <div className="model-token-main">
            <div className="model-token-title">
              <strong>{item.label}</strong>
              <span>{compactNumber(item.tokens)} tokens</span>
            </div>
            <div className="model-token-track">
              <div style={{ width: `${Math.max(5, (item.tokens / max) * 100)}%` }} />
            </div>
            <small>
              input {compactNumber(item.input)} - output {compactNumber(item.output)} - cached {compactNumber(item.cached)} - {item.calls} calls
            </small>
          </div>
        </div>
      ))}
    </div>
  );
}

interface AggregateStats {
  calls: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cost: number;
  costCount: number;
  currency?: string;
  lastUsedAt?: string;
}

function aggregateUsage(events: UsageEvent[]): AggregateStats {
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

function statsCost(stats: AggregateStats): string {
  return stats.costCount > 0 ? formatMoney(stats.cost, stats.currency) : "Not returned";
}

function Providers({ state, setState, showMsg, showErr }: {
  state: AppState; setState: (s: AppState) => void; showMsg: (m: string) => void; showErr: (e: unknown) => void;
}) {
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | undefined>();
  const [form, setForm] = useState<any>(emptyForm());

  function emptyForm(): any {
    return { providerName: "", keyName: "", protocol: "openai-compatible", baseUrl: "", currency: "USD", apiKey: "", queryKey: "", balanceConfig: { ...defaultBalanceConfig } };
  }

  function startEdit(p: ProviderSafe) {
    setForm({ id: p.id, name: p.name, protocol: p.protocol, baseUrl: p.baseUrl, currency: p.currency, apiKey: "", queryKey: "", balanceConfig: { ...p.balanceConfig } });
    setEditId(p.id);
    setShowForm(true);
  }

  async function save() {
    try {
      const payload: AddKeyInput = {
        providerId: editId,
        providerName: form.providerName || form.name,
        protocol: form.protocol,
        baseUrl: form.baseUrl,
        currency: form.currency,
        balanceConfig: form.balanceConfig,
        keyName: form.keyName || "default",
        apiKey: form.apiKey,
        queryKey: form.queryKey
      };
      const s = await apiClient.addKeyWithAutoMerge(payload);
      setState(s);
      setShowForm(false);
      setForm(emptyForm());
      setEditId(undefined);
      showMsg("API key added");
    } catch (e) { showErr(e); }
  }

  async function remove(id: string) {
    if (!confirm("Delete this provider?")) return;
    try { const s = await apiClient.deleteProvider(id); setState(s); showMsg("Deleted"); }
    catch (e) { showErr(e); }
  }

  async function copyKey(providerId: string, keyId: string) {
    try {
      const result = await apiClient.copyKey(providerId, keyId, "api");
      showMsg(result.copied ? "API key copied" : "Clipboard blocked. Press Ctrl+C in the selected box.");
    }
    catch (e) { showErr(e); }
  }

  async function copyProxy(providerId: string, keyId: string) {
    try {
      const result = await apiClient.copyProxyUrl(providerId, keyId);
      showMsg(result.copied ? `Copied: ${result.text}` : "Clipboard blocked. Press Ctrl+C in the selected box.");
    }
    catch (e) { showErr(e); }
  }

  async function removeKey(providerId: string, keyId: string) {
    if (!confirm("Delete this API key?")) return;
    try { const s = await apiClient.deleteKey(providerId, keyId); setState(s); showMsg("API key deleted"); }
    catch (e) { showErr(e); }
  }

  return (
    <div className="page">
      <div className="page-header">
        <h2>Providers</h2>
        <button className="btn-primary" onClick={() => { setForm(emptyForm()); setEditId(undefined); setShowForm(true); }}>+ Add Key</button>
      </div>
      <div className="usage-hint">
        Recorded {state.totals.totalCalls} calls. For another app or platform to appear here, replace its original Base URL with the API Vault Base URL shown under the matching key.
      </div>

      {showForm && (
        <div className="form-card">
          <h3>{editId ? "Add Key to Provider" : "Add API Key"}</h3>
          <div className="form-grid">
            <label>Provider Name<input value={form.providerName ?? form.name ?? ""} onChange={(e) => setForm({ ...form, providerName: e.target.value })} placeholder="Optional, e.g. OpenAI" /></label>
            <label>Key Name<input value={form.keyName ?? ""} onChange={(e) => setForm({ ...form, keyName: e.target.value })} placeholder="e.g. key1, Cursor, server-prod" /></label>
            <label>Protocol
              <select value={form.protocol} onChange={(e) => setForm({ ...form, protocol: e.target.value as any })}>
                <option value="openai-compatible">OpenAI Compatible</option>
                <option value="anthropic-compatible">Anthropic Compatible</option>
              </select>
            </label>
            <label>Base URL<input value={form.baseUrl} onChange={(e) => setForm({ ...form, baseUrl: e.target.value })} placeholder="https://api.openai.com/v1" /></label>
            <label>Currency<input value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })} placeholder="USD" /></label>
            <label>API Key<input type="password" value={form.apiKey ?? ""} onChange={(e) => setForm({ ...form, apiKey: e.target.value })} placeholder={editId ? "(unchanged if empty)" : "sk-..."} /></label>
            <label>Query Key (optional)<input type="password" value={form.queryKey ?? ""} onChange={(e) => setForm({ ...form, queryKey: e.target.value })} placeholder="For billing API if different" /></label>
          </div>
          <details className="balance-config">
            <summary>Balance Sync Config</summary>
            <div className="form-grid">
              <label><input type="checkbox" checked={form.balanceConfig.enabled} onChange={(e) => setForm({ ...form, balanceConfig: { ...form.balanceConfig, enabled: e.target.checked } })} /> Enable balance sync</label>
              <label>Balance URL<input value={form.balanceConfig.url} onChange={(e) => setForm({ ...form, balanceConfig: { ...form.balanceConfig, url: e.target.value } })} placeholder="https://api.example.com/billing" /></label>
              <label>Method
                <select value={form.balanceConfig.method} onChange={(e) => setForm({ ...form, balanceConfig: { ...form.balanceConfig, method: e.target.value as any } })}>
                  <option value="GET">GET</option>
                  <option value="POST">POST</option>
                </select>
              </label>
              <label>Headers JSON<textarea value={form.balanceConfig.headersJson} onChange={(e) => setForm({ ...form, balanceConfig: { ...form.balanceConfig, headersJson: e.target.value } })} rows={3} /></label>
              <label>Balance JSON Path<input value={form.balanceConfig.balancePath} onChange={(e) => setForm({ ...form, balanceConfig: { ...form.balanceConfig, balancePath: e.target.value } })} placeholder="data.balance" /></label>
              <label>Spent JSON Path<input value={form.balanceConfig.spentPath} onChange={(e) => setForm({ ...form, balanceConfig: { ...form.balanceConfig, spentPath: e.target.value } })} placeholder="data.used" /></label>
              <label>Response Cost Path<input value={form.balanceConfig.responseCostPath} onChange={(e) => setForm({ ...form, balanceConfig: { ...form.balanceConfig, responseCostPath: e.target.value } })} placeholder="usage.cost" /></label>
              <label>Auto-sync interval
                <select value={form.balanceConfig.autoSyncIntervalMs ?? 0} onChange={(e) => setForm({ ...form, balanceConfig: { ...form.balanceConfig, autoSyncIntervalMs: Number(e.target.value) } })}>
                  <option value={0}>Off</option>
                  <option value={60000}>1 min</option>
                  <option value={300000}>5 min</option>
                  <option value={900000}>15 min</option>
                  <option value={1800000}>30 min</option>
                </select>
              </label>
            </div>
          </details>
          <div className="form-actions">
            <button className="btn-primary" onClick={save}>Save</button>
            <button onClick={() => setShowForm(false)}>Cancel</button>
          </div>
        </div>
      )}

      <div className="provider-list">
        {state.providers.map((p) => {
          const providerEvents = state.usageEvents.filter((event) => event.providerId === p.id);
          const providerStats = aggregateUsage(providerEvents);
          return (
          <div key={p.id} className="provider-card">
            <div className="provider-header">
              <strong>{p.name}</strong>
              <span className="provider-protocol">{p.protocol}</span>
              <span className="provider-protocol">{p.apiKeys.length} keys</span>
            </div>
            <div className="provider-url">{p.baseUrl}</div>
            <div className="provider-stats">
              <span>{providerStats.calls} calls</span>
              <span>{compactNumber(providerStats.totalTokens)} tokens</span>
              <span>{statsCost(providerStats)}</span>
              <span>{providerStats.lastUsedAt ? `Last ${new Date(providerStats.lastUsedAt).toLocaleString()}` : "Not used yet"}</span>
            </div>
            <div className="key-list">
              {p.apiKeys.map((key) => {
                const keyStats = aggregateUsage(providerEvents.filter((event) => event.apiKeyId === key.id));
                return (
                  <div key={key.id} className="key-row">
                    <div className="key-main">
                      <strong>{key.name}</strong>
                      <code>{key.keyMasked}</code>
                      {key.hasQueryKey && <span className="key-badge">query key</span>}
                    </div>
                    <div className="key-stats">
                      <span>{keyStats.calls} calls</span>
                      <span>{compactNumber(keyStats.totalTokens)} tokens</span>
                      <span>{statsCost(keyStats)}</span>
                      <span>{key.lastUsedAt ? new Date(key.lastUsedAt).toLocaleString() : "Never used"}</span>
                    </div>
                    <div className="base-url-pair">
                      <div>
                        <span>Original Base URL</span>
                        <code>{p.baseUrl}</code>
                      </div>
                      {key.proxyBaseUrl && (
                        <div className="vault-base-url">
                          <span>API Vault Base URL - copy this into the third-party app</span>
                          <code>{key.proxyBaseUrl}</code>
                        </div>
                      )}
                    </div>
                    <div className="provider-actions">
                      <button onClick={() => copyKey(p.id, key.id)}>Copy Key</button>
                      <button onClick={() => copyProxy(p.id, key.id)}>Copy API Vault Base URL</button>
                      <button className="btn-danger" onClick={() => removeKey(p.id, key.id)}>Delete Key</button>
                    </div>
                  </div>
                );
              })}
              {p.apiKeys.length === 0 && <div className="empty-key">No keys under this provider.</div>}
            </div>
            <div className="provider-actions">
              <button onClick={() => startEdit(p)}>Add Key Here</button>
              <button className="btn-danger" onClick={() => remove(p.id)}>Delete Provider</button>
            </div>
          </div>
          );
        })}
        {state.providers.length === 0 && <p className="empty">No providers yet. Add one to get started.</p>}
      </div>
    </div>
  );
}

/* ─── Usage ─── */
function Usage({ state }: { state: AppState }) {
  const [filter, setFilter] = useState("");
  const [providerId, setProviderId] = useState("all");
  const [apiKeyId, setApiKeyId] = useState("all");
  const keyOptions = useMemo(() => {
    const providers = providerId === "all"
      ? state.providers
      : state.providers.filter((provider) => provider.id === providerId);
    return providers.flatMap((provider) => provider.apiKeys.map((key) => ({
      id: key.id,
      label: `${provider.name} / ${key.name}`
    })));
  }, [providerId, state.providers]);
  const filtered = useMemo(() => {
    const lower = filter.toLowerCase();
    return state.usageEvents.filter((e) =>
      (providerId === "all" || e.providerId === providerId) &&
      (apiKeyId === "all" || e.apiKeyId === apiKeyId) &&
      (!filter ||
        (e.model ?? "").toLowerCase().includes(lower) ||
        e.providerName.toLowerCase().includes(lower) ||
        (e.apiKeyName ?? e.apiKeyMasked ?? "").toLowerCase().includes(lower) ||
        (e.baseUrl ?? "").toLowerCase().includes(lower) ||
        (e.error ?? "").toLowerCase().includes(lower) ||
        String(e.status).includes(lower))
    );
  }, [apiKeyId, filter, providerId, state.usageEvents]);

  const totalCost = useMemo(() => filtered.reduce((sum, e) => sum + (e.realCost ?? 0), 0), [filtered]);

  return (
    <div className="page">
      <div className="page-header">
        <h2>Usage Log</h2>
        <div className="usage-filters">
          <select value={providerId} onChange={(e) => { setProviderId(e.target.value); setApiKeyId("all"); }}>
            <option value="all">All providers</option>
            {state.providers.map((provider) => <option key={provider.id} value={provider.id}>{provider.name}</option>)}
          </select>
          <select value={apiKeyId} onChange={(e) => setApiKeyId(e.target.value)}>
            <option value="all">All keys</option>
            {keyOptions.map((key) => <option key={key.id} value={key.id}>{key.label}</option>)}
          </select>
          <input className="filter-input" placeholder="Filter model, base URL, status, error..." value={filter} onChange={(e) => setFilter(e.target.value)} />
        </div>
      </div>
      {totalCost > 0 && <div className="cost-summary">Total cost (filtered): {formatMoney(totalCost)}</div>}
      <UsageTable events={filtered} />
      {filtered.length === 0 && <p className="empty">No usage events yet. {state.providers.length} providers are configured; make API calls through a copied proxy URL to see records here.</p>}
    </div>
  );
}

/* ─── Billing ─── */
function Billing({ state, setState, showMsg, showErr }: {
  state: AppState; setState: (s: AppState) => void; showMsg: (m: string) => void; showErr: (e: unknown) => void;
}) {
  const [syncing, setSyncing] = useState<string | null>(null);

  async function syncBalance(id: string) {
    setSyncing(id);
    try {
      const { result, state: newState } = await apiClient.testBalance(id);
      setState(newState);
      if (result.snapshot.ok) showMsg("Balance synced");
      else showErr(result.snapshot.error ?? "Sync failed");
    } catch (e) { showErr(e); }
    finally { setSyncing(null); }
  }

  return (
    <div className="page">
      <h2>Billing & Balance</h2>
      {state.providers.map((p) => {
        const snapshots = state.balanceSnapshots.filter((s) => s.providerId === p.id);
        const latest = snapshots[0];
        return (
          <div key={p.id} className="billing-card">
            <div className="billing-header">
              <strong>{p.name}</strong>
              <button disabled={syncing === p.id} onClick={() => syncBalance(p.id)}>
                {syncing === p.id ? "Syncing..." : "Sync Now"}
              </button>
            </div>
            {latest ? (
              <div className="billing-data">
                {latest.ok ? (
                  <>
                    {latest.unlimitedQuota && <div>Balance: <strong>Unlimited quota</strong></div>}
                    {!latest.unlimitedQuota && latest.balance !== undefined && <div>Balance: <strong>{formatBalanceValue(latest.balance, latest.currency)}</strong></div>}
                    {latest.spent !== undefined && <div>Spent: <strong>{formatBalanceValue(latest.spent, latest.currency)}</strong></div>}
                    {latest.granted !== undefined && <div>Granted: <strong>{formatBalanceValue(latest.granted, latest.currency)}</strong></div>}
                    {latest.tokenName && <div>Token: <strong>{latest.tokenName}</strong></div>}
                    <div className="billing-time">Last checked: {new Date(latest.checkedAt).toLocaleString()}</div>
                  </>
                ) : (
                  <div className="billing-error">Error: {latest.error}</div>
                )}
              </div>
            ) : (
              <div className="billing-data muted">No balance data. Click "Sync Now" to fetch.</div>
            )}
            {snapshots.length > 1 && (
              <details>
                <summary>History ({snapshots.length} records)</summary>
                <div className="billing-history">
                  {snapshots.slice(0, 20).map((s) => (
                    <div key={s.id} className={`history-row ${s.ok ? "" : "error"}`}>
                      <span>{new Date(s.checkedAt).toLocaleString()}</span>
                      {s.ok ? (
                        <span>{formatBalanceSummary(s)}</span>
                      ) : (
                        <span className="text-error">{s.error}</span>
                      )}
                    </div>
                  ))}
                </div>
              </details>
            )}
          </div>
        );
      })}
      {state.providers.length === 0 && <p className="empty">Add a provider first to sync billing data.</p>}
    </div>
  );
}

/* ─── UsageTable ─── */
function UsageTable({ events }: { events: UsageEvent[] }) {
  return (
    <div className="table-wrap">
      <table className="usage-table">
        <thead>
          <tr>
            <th>Time</th>
            <th>Provider</th>
            <th>Base URL</th>
            <th>Key</th>
            <th>Model</th>
            <th>Status</th>
            <th>Input</th>
            <th>Output</th>
            <th>Cost</th>
            <th>Latency</th>
            <th>Error</th>
          </tr>
        </thead>
        <tbody>
          {events.map((e) => (
            <tr key={e.id} className={e.ok ? "" : "row-error"}>
              <td>{new Date(e.startedAt).toLocaleTimeString()}</td>
              <td>{e.providerName}</td>
              <td><code>{e.baseUrl ?? "-"}</code></td>
              <td>{e.apiKeyName ?? e.apiKeyMasked ?? "-"}</td>
              <td>{e.model ?? "-"}</td>
              <td><span className={`status ${e.ok ? "ok" : "fail"}`}>{e.ok ? "success" : "failed"} {e.status}</span></td>
              <td>{e.inputTokens ?? "-"}</td>
              <td>{e.outputTokens ?? "-"}</td>
              <td>{e.realCost !== undefined ? formatMoney(e.realCost, e.currency) : "Not returned"}</td>
              <td>{e.latencyMs}ms</td>
              <td>{e.error ?? ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
