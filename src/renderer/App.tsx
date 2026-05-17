import React, { useEffect, useMemo, useState } from "react";
import type { AddKeyInput, AppState, BalanceConfig, BalanceSnapshot, CloudflaredStatus, LocalService, ProviderSafe, ProxyModelRule, ProxyTokenInput, UsageEvent, UsageRollup } from "../shared/types";
import { apiClient, copyTextToClipboard } from "./apiClient";
import type { UrlTestResult } from "./apiClient";

type UrlTestStatus = UrlTestResult & { testing?: boolean };

type Tab = "dashboard" | "providers" | "proxy-tokens" | "local-services" | "usage" | "billing";
type AnalyticsRange = "1h" | "24h" | "7d" | "all";
type AnalyticsStatus = "all" | "ok" | "failed";
type DashboardRange = "all" | "30d" | "7d" | "today";
type DashboardView = "overview" | "models";
interface AnalyticsRow {
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

const STATE_REFRESH_INTERVAL_MS = 5000;
const USAGE_PAGE_SIZE = 100;

function globalProxyBaseUrl(proxyPort: number | undefined, gateway: "openai" | "anthropic" | "auto"): string | undefined {
  if (!proxyPort) return undefined;
  if (gateway === "auto") return `http://127.0.0.1:${proxyPort}/proxy/auto/v1`;
  return gateway === "openai"
    ? `http://127.0.0.1:${proxyPort}/proxy/openai/v1`
    : `http://127.0.0.1:${proxyPort}/proxy/anthropic`;
}

function gatewayLabel(event: UsageEvent): string {
  if (event.gatewayType === "openai") return "openai global";
  if (event.gatewayType === "anthropic") return "anthropic global";
  if (event.gatewayType === "auto") return "auto global";
  if (event.gatewayType === "public-proxy") return "public proxy";
  if (event.gatewayType === "local-service") return "local service";
  if (event.gatewayType === "legacy-key") return "legacy key url";
  return "provider url";
}
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
          {(["dashboard", "providers", "proxy-tokens", "local-services", "usage", "billing"] as Tab[]).map((t) => (
            <button key={t} className={tab === t ? "active" : ""} onClick={() => setTab(t)}>
              {t === "proxy-tokens" ? "Proxy Tokens" : t === "local-services" ? "Local Services" : t.charAt(0).toUpperCase() + t.slice(1)}
            </button>
          ))}
        </div>
        {state.proxyPort && <div className="proxy-status">Proxy: 127.0.0.1:{state.proxyPort}</div>}
        {state.cloudflared.running && <div className="proxy-status" title={state.cloudflared.publicUrl ?? ""}>Tunnel: Active</div>}
        {!state.cloudflared.running && <div className="proxy-status" style={{ color: "var(--muted)" }}>Tunnel: Off</div>}
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
        {tab === "proxy-tokens" && <ProxyTokens state={state} setState={setState} showMsg={showMsg} showErr={showErr} />}
        {tab === "local-services" && <LocalServicesPage state={state} setState={setState} showMsg={showMsg} showErr={showErr} />}
        {tab === "usage" && <Usage state={state} />}
        {tab === "billing" && <Billing state={state} setState={setState} showMsg={showMsg} showErr={showErr} />}
      </main>
    </div>
  );
}

/* 鈹€鈹€鈹€ Dashboard 鈹€鈹€鈹€ */
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
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(Math.round(value));
}

function formatUsageDateTime(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return value;
  const pad = (item: number) => String(item).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function shortLabel(value: string, max = 18): string {
  return value.length > max ? `${value.slice(0, Math.max(0, max - 3))}...` : value;
}

interface DashboardSummary {
  sessions: number;
  messages: number;
  totalTokens: number;
  activeDays: number;
  currentStreak: number;
  longestStreak: number;
  peakHour: string;
  favoriteModel: string;
}

interface ProviderTokenSummary {
  total: number;
  input: number;
  output: number;
  cached: number;
  calls: number;
}

interface HeatmapDay {
  key: string;
  label: string;
  tokens: number;
}

interface ModelTokenShare {
  label: string;
  tokens: number;
  input: number;
  output: number;
  percent: number;
  color: string;
}

function Dashboard({ state }: { state: AppState }) {
  const [dashboardView, setDashboardView] = useState<DashboardView>("overview");
  const [dashboardRange, setDashboardRange] = useState<DashboardRange>("all");
  const rows = useMemo(() => dashboardRowsForRange(state.usageEvents, state.usageRollups ?? [], dashboardRange), [state.usageEvents, state.usageRollups, dashboardRange]);
  const ranking = useMemo(() => buildModelTokenRanking(rows), [rows]);
  const summary = useMemo(() => buildDashboardSummary(rows, ranking), [rows, ranking]);
  const providerTokens = useMemo(() => buildProviderTokenStats(state.providers, rows), [state.providers, rows]);
  const topProvider = useMemo(() => buildTopProviderToken(state.providers, providerTokens), [state.providers, providerTokens]);
  const heatmap = useMemo(() => buildTokenHeatmap(rows, dashboardRange), [rows, dashboardRange]);
  const modelShares = useMemo(() => buildModelTokenShares(ranking), [ranking]);

  return (
    <div className="page dashboard-page">
      <div className="dashboard-greeting">
        <span className="dashboard-spark" aria-hidden="true" />
        <h2>What's up next, Developer?</h2>
      </div>

      <div className="dashboard-workspace">
        <section className="dashboard-panel dashboard-main-panel">
          <div className="dashboard-panel-toolbar">
            <div className="dashboard-tab-group" aria-label="Dashboard view">
              <button type="button" className={dashboardView === "overview" ? "active" : ""} onClick={() => setDashboardView("overview")}>Overview</button>
              <button type="button" className={dashboardView === "models" ? "active" : ""} onClick={() => setDashboardView("models")}>Models</button>
            </div>
            <div className="dashboard-tab-group dashboard-range-group" aria-label="Dashboard range">
              {(["all", "30d", "7d", "today"] as DashboardRange[]).map((range) => (
                <button key={range} type="button" className={dashboardRange === range ? "active" : ""} onClick={() => setDashboardRange(range)}>
                  {range === "all" ? "All" : range}
                </button>
              ))}
            </div>
          </div>

          {dashboardView === "overview" ? (
            <div className="dashboard-view dashboard-view-overview">
              <DashboardOverview summary={summary} heatmap={heatmap} />
            </div>
          ) : (
            <div className="dashboard-view dashboard-view-models">
              <DashboardModels shares={modelShares} totalTokens={summary.totalTokens} />
            </div>
          )}
        </section>

        <aside className="dashboard-rail">
          <section className="dashboard-side-card dashboard-card-fixed dashboard-top-provider-card">
            <div className="dashboard-side-head">
              <h3>Top Token Provider</h3>
              <span>{topProvider ? `${compactNumber(topProvider.stats.total)} tokens` : "No data"}</span>
            </div>
            <DashboardTopProvider topProvider={topProvider} />
          </section>

          <section className="dashboard-side-card dashboard-card-fixed dashboard-connection-card">
            <div className="dashboard-side-head">
              <h3>API Connection Status</h3>
            </div>
            <div className="dashboard-card-scroll">
              <ProviderConnectionStatus
                providers={state.providers}
                localServices={state.localServices}
                cloudflared={state.cloudflared}
              />
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}

function DashboardOverview({ summary, heatmap }: { summary: DashboardSummary; heatmap: HeatmapDay[] }) {
  const tiles = [
    { label: "Sessions", value: compactNumber(summary.sessions) },
    { label: "Messages", value: compactNumber(summary.messages) },
    { label: "Total tokens", value: compactNumber(summary.totalTokens) },
    { label: "Active days", value: compactNumber(summary.activeDays) },
    { label: "Current streak", value: `${summary.currentStreak}d` },
    { label: "Longest streak", value: `${summary.longestStreak}d` },
    { label: "Peak hour", value: summary.peakHour },
    { label: "Favorite model", value: shortLabel(summary.favoriteModel, 18) }
  ];

  return (
    <>
      <div className="dashboard-stat-grid">
        {tiles.map((tile) => (
          <div key={tile.label} className="dashboard-stat-tile">
            <span>{tile.label}</span>
            <strong>{tile.value}</strong>
          </div>
        ))}
      </div>
      <DashboardHeatmap days={heatmap} />
      <p className="dashboard-note">
        {summary.totalTokens > 0 ? `You've routed ${compactNumber(summary.totalTokens)} tokens through API Vault.` : "No token activity yet."}
      </p>
    </>
  );
}

function DashboardModels({ shares, totalTokens }: { shares: ModelTokenShare[]; totalTokens: number }) {
  if (!shares.length) return <EmptyChart label="No model token data yet" />;

  return (
    <div className="dashboard-model-view">
      <div className="dashboard-model-axis">
        <span>0</span>
        <span>{compactNumber(totalTokens)}</span>
      </div>
      <div className="dashboard-model-bars">
        {shares.map((item) => (
          <div key={item.label} className="dashboard-model-row">
            <strong>{shortLabel(item.label, 22)}</strong>
            <div className="dashboard-model-bar">
              <span style={{ width: `${Math.max(3, item.percent)}%`, background: item.color }} />
            </div>
            <em>{item.percent.toFixed(1)}%</em>
          </div>
        ))}
      </div>
      <div className="dashboard-model-breakdown">
        {shares.slice(0, 4).map((item) => (
          <div key={item.label}>
            <span style={{ background: item.color }} />
            <strong>{shortLabel(item.label, 20)}</strong>
            <em>{compactNumber(item.input)} in - {compactNumber(item.output)} out</em>
          </div>
        ))}
      </div>
    </div>
  );
}

function DashboardHeatmap({ days }: { days: HeatmapDay[] }) {
  const max = Math.max(...days.map((day) => day.tokens), 0);
  const count = days.length;
  const cellSize = count <= 1 ? 48 : count <= 7 ? 32 : count <= 30 ? 18 : 12;
  const cols = count <= 1 ? 1 : 7;
  const showLabels = count <= 7;
  if (count === 0 || (count === 1 && max === 0)) {
    return <div className="dashboard-heatmap-wrap"><p className="empty" style={{ padding: "12px 0" }}>No usage data yet</p></div>;
  }
  return (
    <div className="dashboard-heatmap-wrap">
      <div className="dashboard-heatmap" aria-label="Token activity by day" style={{ gridTemplateColumns: `repeat(${cols}, ${cellSize}px)` }}>
        {days.map((day) => {
          const level = max <= 0 || day.tokens <= 0 ? 0 : Math.max(1, Math.ceil((day.tokens / max) * 4));
          return (
            <div key={day.key} className="dashboard-heat-wrapper">
              <span
                className={`dashboard-heat-cell level-${level}`}
                style={{ width: cellSize, height: cellSize }}
                title={`${day.label}: ${compactNumber(day.tokens)} tokens`}
              />
              {showLabels && <span className="dashboard-heat-label">{day.label}</span>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ProviderConnectionStatus({ providers, localServices, cloudflared }: {
  providers: ProviderSafe[];
  localServices: LocalService[];
  cloudflared: CloudflaredStatus;
}) {
  const [tests, setTests] = useState<Record<string, { ok?: boolean; latencyMs?: number; status?: number; checkedAt?: string; error?: string; testing?: boolean }>>({});

  const items = useMemo(() => {
    const result: Array<{ id: string; name: string; baseUrl: string; type: "provider" | "local"; status?: string; latencyMs?: number; lastCheckedAt?: string }> = [];
    for (const p of providers) result.push({ id: p.id, name: p.name, baseUrl: p.baseUrl, type: "provider", status: p.status, latencyMs: p.latencyMs, lastCheckedAt: p.lastCheckedAt });
    for (const s of localServices) result.push({ id: s.id, name: s.name, baseUrl: s.baseUrl, type: "local", status: s.status, latencyMs: s.latencyMs, lastCheckedAt: s.lastCheckedAt });
    return result;
  }, [providers, localServices]);

  async function testItem(item: { id: string; baseUrl: string; type: string }) {
    setTests((prev) => ({ ...prev, [`${item.type}:${item.id}`]: { testing: true } }));
    try {
      if (item.type === "local") {
        const result = await apiClient.testLocalService(item.id);
        setTests((prev) => ({ ...prev, [`${item.type}:${item.id}`]: { ...result, testing: false } }));
      } else {
        const result = await apiClient.testUrl({ baseUrl: item.baseUrl, providerId: item.id });
        setTests((prev) => ({ ...prev, [`${item.type}:${item.id}`]: { ...result, testing: false } }));
      }
    } catch (e) {
      setTests((prev) => ({ ...prev, [`${item.type}:${item.id}`]: { ok: false, latencyMs: 0, error: e instanceof Error ? e.message : String(e), checkedAt: new Date().toISOString(), testing: false } }));
    }
  }

  if (items.length === 0) {
    return <p className="empty">No providers or local services yet.</p>;
  }

  return (
    <div className="connection-status-list">
      {items.map((item) => {
        const key = `${item.type}:${item.id}`;
        const test = tests[key];
        const ok = test?.ok ?? (item.status === "available" ? true : item.status === "unavailable" ? false : undefined);
        const latencyMs = test?.latencyMs ?? item.latencyMs;
        const checkedAt = test?.checkedAt ?? item.lastCheckedAt;
        const publicAccessUrl = item.type === "local" && cloudflared.running && cloudflared.publicUrl
          ? `${cloudflared.publicUrl}/api/proxy/local/${item.id}/v1`
          : undefined;
        return (
          <div key={key} className="connection-status-item">
            <div className="connection-status-top">
              <span className={`connection-status-dot ${test?.testing ? "testing" : ok === undefined ? "idle" : ok ? "ok" : "fail"}`} />
              <strong>{shortLabel(item.name, 16)}</strong>
              <button type="button" className="connection-test-btn" onClick={() => testItem(item)} disabled={test?.testing}>
                {test?.testing ? "..." : "Test"}
              </button>
            </div>
            <div className="connection-status-url">{shortLabel(item.baseUrl, 32)}</div>
            <div className="connection-status-latency">
              {ok === undefined ? "Unknown" : ok ? "Available" : "Unavailable"}
              {latencyMs !== undefined ? ` - ${latencyMs}ms` : ""}
              {checkedAt ? ` - ${new Date(checkedAt).toLocaleTimeString()}` : ""}
            </div>
            {test?.error && <div className="connection-status-error">{shortLabel(test.error, 46)}</div>}
            {publicAccessUrl && <div className="connection-status-url">{shortLabel(publicAccessUrl, 42)}</div>}
          </div>
        );
      })}
    </div>
  );
}

function DashboardTopProvider({ topProvider }: { topProvider?: { provider: ProviderSafe; stats: ProviderTokenSummary } }) {
  if (!topProvider) return <p className="empty">No provider token usage yet.</p>;
  const { provider, stats } = topProvider;

  return (
    <div className="dashboard-provider-token-list">
      <div className="dashboard-provider-token-item dashboard-provider-token-item-featured">
        <div className="dashboard-provider-token-title">
          <strong>{provider.name}</strong>
          <span>{compactNumber(stats.calls)} calls</span>
        </div>
        <div className="dashboard-provider-token-total">{compactNumber(stats.total)} tokens</div>
        <small>input {compactNumber(stats.input)} - output {compactNumber(stats.output)}{stats.cached > 0 ? ` - cached ${compactNumber(stats.cached)}` : ""}</small>
      </div>
    </div>
  );
}

function buildTopProviderToken(providers: ProviderSafe[], stats: Map<string, ProviderTokenSummary>): { provider: ProviderSafe; stats: ProviderTokenSummary } | undefined {
  let top: { provider: ProviderSafe; stats: ProviderTokenSummary } | undefined;
  for (const provider of providers) {
    const item = stats.get(provider.id) ?? { total: 0, input: 0, output: 0, cached: 0, calls: 0 };
    if (!top || item.total > top.stats.total || (item.total === top.stats.total && item.calls > top.stats.calls)) {
      top = { provider, stats: item };
    }
  }
  return top && (top.stats.total > 0 || top.stats.calls > 0) ? top : undefined;
}
function dashboardRowsForRange(events: UsageEvent[], rollups: UsageRollup[], range: DashboardRange): AnalyticsRow[] {
  const rows = buildAnalyticsRows(events, rollups, "all");
  if (range === "all") return rows;
  if (range === "today") {
    const todayKey = localDayKey(new Date());
    return rows.filter((row) => {
      const date = new Date(row.startedAt);
      return Number.isFinite(date.getTime()) && localDayKey(date) === todayKey;
    });
  }
  const days = range === "7d" ? 7 : 30;
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  return rows.filter((row) => {
    const time = new Date(row.startedAt).getTime();
    return Number.isFinite(time) && time >= cutoff;
  });
}

function buildDashboardSummary(rows: AnalyticsRow[], ranking: Array<{ label: string; tokens: number }>): DashboardSummary {
  const sessions = new Set<string>();
  const days = new Set<string>();
  const hours = new Map<number, number>();
  let messages = 0;
  let totalTokens = 0;

  for (const row of rows) {
    messages += row.calls;
    totalTokens += row.totalTokens;
    if (row.calls > 0) sessions.add(row.sessionKey);
    const date = new Date(row.startedAt);
    if (!Number.isFinite(date.getTime())) continue;
    days.add(localDayKey(date));
    hours.set(date.getHours(), (hours.get(date.getHours()) ?? 0) + row.calls);
  }

  let peakHour = "No calls";
  let peakCalls = 0;
  for (const [hour, calls] of hours) {
    if (calls > peakCalls) {
      peakCalls = calls;
      peakHour = formatDashboardHour(hour);
    }
  }

  return {
    sessions: sessions.size,
    messages,
    totalTokens,
    activeDays: days.size,
    currentStreak: calculateCurrentStreak(days),
    longestStreak: calculateLongestStreak(days),
    peakHour,
    favoriteModel: ranking[0]?.label ?? "No model"
  };
}

function buildProviderTokenStats(providers: ProviderSafe[], rows: AnalyticsRow[]): Map<string, ProviderTokenSummary> {
  const map = new Map<string, ProviderTokenSummary>();
  for (const provider of providers) map.set(provider.id, { total: 0, input: 0, output: 0, cached: 0, calls: 0 });
  for (const row of rows) {
    const target = map.get(row.providerId) ?? { total: 0, input: 0, output: 0, cached: 0, calls: 0 };
    target.total += row.totalTokens;
    target.input += row.inputTokens;
    target.output += row.outputTokens;
    target.cached += row.cachedInputTokens;
    target.calls += row.calls;
    map.set(row.providerId, target);
  }
  return map;
}

function buildTokenHeatmap(rows: AnalyticsRow[], range: DashboardRange): HeatmapDay[] {
  if (range === "today") {
    const todayKey = localDayKey(new Date());
    let tokens = 0;
    for (const row of rows) {
      const date = new Date(row.startedAt);
      if (Number.isFinite(date.getTime()) && localDayKey(date) === todayKey) tokens += row.totalTokens;
    }
    const today = new Date(); today.setHours(0, 0, 0, 0);
    return [{ key: todayKey, label: today.toLocaleDateString("en-US", { month: "short", day: "numeric" }), tokens }];
  }

  const totals = new Map<string, number>();
  for (const row of rows) {
    const date = new Date(row.startedAt);
    if (!Number.isFinite(date.getTime())) continue;
    const key = localDayKey(date);
    totals.set(key, (totals.get(key) ?? 0) + row.totalTokens);
  }

  const end = new Date();
  end.setHours(0, 0, 0, 0);

  let dayCount: number;
  if (range === "7d") {
    dayCount = 7;
  } else if (range === "30d") {
    dayCount = 30;
  } else {
    // "all": from earliest data to today, capped at 365
    let earliest = end.getTime();
    for (const row of rows) {
      const t = new Date(row.startedAt).getTime();
      if (Number.isFinite(t) && t < earliest) earliest = t;
    }
    dayCount = Math.min(365, Math.max(7, Math.ceil((end.getTime() - earliest) / (24 * 60 * 60 * 1000)) + 1));
  }

  return Array.from({ length: dayCount }, (_, index) => {
    const date = new Date(end);
    date.setDate(end.getDate() - (dayCount - 1 - index));
    const key = localDayKey(date);
    return {
      key,
      label: date.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
      tokens: totals.get(key) ?? 0
    };
  });
}

function buildModelTokenShares(ranking: Array<{ label: string; tokens: number; input: number; output: number }>): ModelTokenShare[] {
  const total = ranking.reduce((sum, item) => sum + item.tokens, 0);
  const colors = ["#2f6fdb", "#4f8ae8", "#78a8ef", "#9dbff3", "#c1d6f7", "#d9e6fb"];
  if (total <= 0) return [];
  return ranking.slice(0, 6).map((item, index) => ({
    label: item.label,
    tokens: item.tokens,
    input: item.input,
    output: item.output,
    percent: (item.tokens / total) * 100,
    color: colors[index % colors.length]
  }));
}

function localDayKey(value: Date): string {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
}

function calculateCurrentStreak(days: Set<string>): number {
  const cursor = new Date();
  cursor.setHours(0, 0, 0, 0);
  let count = 0;
  while (days.has(localDayKey(cursor))) {
    count += 1;
    cursor.setDate(cursor.getDate() - 1);
    if (count > 3660) break;
  }
  return count;
}

function calculateLongestStreak(days: Set<string>): number {
  const values = Array.from(days)
    .map((key) => new Date(`${key}T00:00:00`).getTime())
    .filter((time) => Number.isFinite(time))
    .sort((a, b) => a - b);
  let longest = 0;
  let current = 0;
  let previous = 0;
  for (const time of values) {
    current = current === 0 || time - previous === 24 * 60 * 60 * 1000 ? current + 1 : 1;
    longest = Math.max(longest, current);
    previous = time;
  }
  return longest;
}

function formatDashboardHour(hour: number): string {
  const date = new Date();
  date.setHours(hour, 0, 0, 0);
  return date.toLocaleTimeString("en-US", { hour: "numeric" });
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

/* 鈹€鈹€鈹€ Providers 鈹€鈹€鈹€ */
function ModelTokenLeaderboard({ data, limit, onItemClick }: {
  data: ReturnType<typeof buildModelTokenRanking>;
  limit?: number;
  onItemClick?: () => void;
}) {
  if (!data.length) return <EmptyChart label="No token data yet" />;
  const max = Math.max(...data.map((item) => item.tokens), 1);
  const visible = limit ? data.slice(0, limit) : data;

  return (
    <div className="model-token-board">
      {visible.map((item, index) => {
        const content = (
          <>
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
          </>
        );
        return onItemClick ? (
          <button key={item.label} type="button" className="model-token-row model-token-row-button" onClick={onItemClick}>
            {content}
          </button>
        ) : (
          <div key={item.label} className="model-token-row">
            {content}
          </div>
        );
      })}
    </div>
  );
}

function ModelRankingModal({ ranking, totalTokens, onClose }: {
  ranking: ReturnType<typeof buildModelTokenRanking>;
  totalTokens: number;
  onClose: () => void;
}) {
  return (
    <div className="dashboard-rank-modal-backdrop" onClick={onClose}>
      <div className="dashboard-rank-modal" role="dialog" aria-modal="true" aria-label="All model token ranking" onClick={(event) => event.stopPropagation()}>
        <div className="dashboard-rank-modal-header">
          <div>
            <h3>Model Token Ranking</h3>
            <p>{compactNumber(totalTokens)} tokens across all models</p>
          </div>
          <button type="button" onClick={onClose}>Close</button>
        </div>
        <div className="dashboard-rank-list">
          <ModelTokenLeaderboard data={ranking} />
        </div>
      </div>
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

function aggregateRows(rows: AnalyticsRow[]): AggregateStats {
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

function statsCost(stats: AggregateStats): string {
  return stats.costCount > 0 ? formatMoney(stats.cost, stats.currency) : "Not returned";
}

function UrlTestIndicator({ test }: { test?: UrlTestStatus }) {
  if (!test) return <span className="url-test-dot url-test-dot--idle" title="Not tested" />;
  if (test.testing) return <span className="url-test-dot url-test-dot--testing" title="Testing..." />;
  const cls = test.ok ? "url-test-dot--ok" : "url-test-dot--fail";
  const tip = test.ok
    ? `OK ${test.status ?? ""} - ${test.latencyMs}ms - ${new Date(test.checkedAt).toLocaleTimeString()}`
    : `Failed: ${test.error ?? `HTTP ${test.status ?? "?"}`} - ${new Date(test.checkedAt).toLocaleTimeString()}`;
  return <span className={`url-test-dot ${cls}`} title={tip} />;
}

function UrlTestStatusLine({ test }: { test?: UrlTestStatus }) {
  if (!test) return <div className="url-test-status url-test-status--idle">Not tested</div>;
  if (test.testing) return <div className="url-test-status url-test-status--testing">Testing...</div>;
  const time = new Date(test.checkedAt).toLocaleTimeString();
  if (test.ok) {
    return (
      <div className="url-test-status url-test-status--ok">
        OK {test.status} 路 <strong>{test.latencyMs}ms</strong> 路 checked {time}
      </div>
    );
  }
  return (
    <div className="url-test-status url-test-status--fail">
      Failed: {test.error ?? `HTTP ${test.status ?? "?"}`} 路 checked {time}
    </div>
  );
}

function Providers({ state, setState, showMsg, showErr }: {
  state: AppState; setState: (s: AppState) => void; showMsg: (m: string) => void; showErr: (e: unknown) => void;
}) {
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | undefined>();
  const [form, setForm] = useState<any>(emptyForm());
  const [selectedProviderId, setSelectedProviderId] = useState<string | undefined>();
  const [providerEditId, setProviderEditId] = useState<string | undefined>();
  const [providerEditForm, setProviderEditForm] = useState<any>({});
  const [urlTests, setUrlTests] = useState<Record<string, UrlTestStatus>>({});
  const [formTest, setFormTest] = useState<UrlTestStatus | undefined>();
  const [editTest, setEditTest] = useState<UrlTestStatus | undefined>();
  const selectedProvider = state.providers.find((provider) => provider.id === selectedProviderId);
  const openaiGlobalUrl = globalProxyBaseUrl(state.proxyPort, "openai");
  const anthropicGlobalUrl = globalProxyBaseUrl(state.proxyPort, "anthropic");
  const autoGlobalUrl = globalProxyBaseUrl(state.proxyPort, "auto");
  const allUsageRows = useMemo(() => buildAnalyticsRows(state.usageEvents, state.usageRollups ?? [], "all"), [state.usageEvents, state.usageRollups]);

  async function runProviderUrlTest(p: ProviderSafe) {
    setUrlTests((prev) => ({ ...prev, [p.id]: { ...(prev[p.id] ?? { ok: false, latencyMs: 0, checkedAt: "" }), testing: true } }));
    try {
      const result = await apiClient.testUrl({ baseUrl: p.baseUrl, protocol: p.protocol, providerId: p.id });
      setUrlTests((prev) => ({ ...prev, [p.id]: { ...result, testing: false } }));
    } catch (e) {
      setUrlTests((prev) => ({ ...prev, [p.id]: { ok: false, latencyMs: 0, error: e instanceof Error ? e.message : String(e), checkedAt: new Date().toISOString(), testing: false } }));
    }
  }

  useEffect(() => {
    if (state.providers.length === 0) return;
    const run = () => { state.providers.forEach((p) => { runProviderUrlTest(p); }); };
    run();
    const timer = window.setInterval(run, 60_000);
    return () => window.clearInterval(timer);
  }, [state.providers.map((p) => `${p.id}:${p.baseUrl}:${p.protocol}`).join("|")]);

  async function testFormUrl() {
    if (!form.baseUrl?.trim()) return;
    setFormTest({ ok: false, latencyMs: 0, checkedAt: "", testing: true });
    try {
      const result = await apiClient.testUrl({ baseUrl: form.baseUrl, protocol: form.protocol, providerId: editId });
      setFormTest({ ...result, testing: false });
    } catch (e) {
      setFormTest({ ok: false, latencyMs: 0, error: e instanceof Error ? e.message : String(e), checkedAt: new Date().toISOString(), testing: false });
    }
  }

  async function testEditUrl(providerId?: string) {
    if (!providerEditForm.baseUrl?.trim()) return;
    setEditTest({ ok: false, latencyMs: 0, checkedAt: "", testing: true });
    try {
      const result = await apiClient.testUrl({ baseUrl: providerEditForm.baseUrl, protocol: providerEditForm.protocol, providerId });
      setEditTest({ ...result, testing: false });
    } catch (e) {
      setEditTest({ ok: false, latencyMs: 0, error: e instanceof Error ? e.message : String(e), checkedAt: new Date().toISOString(), testing: false });
    }
  }

  function emptyForm(): any {
    return { providerName: "", keyName: "", protocol: "openai-compatible", baseUrl: "", currency: "USD", apiKey: "", queryKey: "", balanceConfig: { ...defaultBalanceConfig } };
  }

  function startEdit(p: ProviderSafe) {
    setForm({ id: p.id, name: p.name, protocol: p.protocol, baseUrl: p.baseUrl, currency: p.currency, apiKey: "", queryKey: "", balanceConfig: { ...p.balanceConfig } });
    setEditId(p.id);
    setProviderEditId(undefined);
    setSelectedProviderId(undefined);
    setShowForm(true);
  }

  function startProviderMetaEdit(p: ProviderSafe) {
    setProviderEditId(p.id);
    setProviderEditForm({
      name: p.name,
      protocol: p.protocol,
      baseUrl: p.baseUrl,
      currency: p.currency,
      balanceConfig: { ...p.balanceConfig }
    });
  }

  async function saveProviderMeta(providerId: string) {
    try {
      const s = await apiClient.saveProviderMeta({
        id: providerId,
        name: providerEditForm.name,
        protocol: providerEditForm.protocol,
        baseUrl: providerEditForm.baseUrl,
        currency: providerEditForm.currency,
        balanceConfig: providerEditForm.balanceConfig
      });
      setState(s);
      setProviderEditId(undefined);
      setProviderEditForm({});
      showMsg("Provider updated");
    } catch (e) { showErr(e); }
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
    try { const s = await apiClient.deleteProvider(id); setState(s); setSelectedProviderId(undefined); showMsg("Deleted"); }
    catch (e) { showErr(e); }
  }

  async function copyKey(providerId: string, keyId: string) {
    try {
      const result = await apiClient.copyKey(providerId, keyId, "api");
      showMsg(result.copied ? "API key copied" : "Clipboard blocked. Press Ctrl+C in the selected box.");
    }
    catch (e) { showErr(e); }
  }

  async function copyProxy(providerId: string) {
    try {
      const result = await apiClient.copyProviderProxyUrl(providerId);
      showMsg(result.copied ? `Copied: ${result.text}` : "Clipboard blocked. Press Ctrl+C in the selected box.");
    }
    catch (e) { showErr(e); }
  }

  async function copyGlobalProxy(gateway: "openai" | "anthropic" | "auto") {
    const url = globalProxyBaseUrl(state.proxyPort, gateway);
    if (!url) {
      showErr("Proxy is not running");
      return;
    }
    try {
      const result = await copyTextToClipboard(url);
      showMsg(result.copied ? `Copied: ${result.text}` : "Clipboard blocked. Press Ctrl+C in the selected box.");
    } catch (e) { showErr(e); }
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
        Recorded {state.totals.totalCalls} calls. For another app or platform to appear here, use the global API Vault Base URL for its protocol and keep sending the real API key.
      </div>

      <div className="global-proxy-panel">
        <div className="global-proxy-head">
          <div>
            <h3>Global API Vault Base URLs</h3>
            <p>Use one URL per protocol, or use Auto for providers that support both OpenAI and Anthropic request formats.</p>
          </div>
        </div>
        <div className="global-proxy-grid">
          <div className="global-proxy-card">
            <strong>OpenAI-compatible</strong>
            <code>{openaiGlobalUrl ?? "Proxy is not running"}</code>
            <button disabled={!openaiGlobalUrl} onClick={() => copyGlobalProxy("openai")}>Copy OpenAI Base URL</button>
          </div>
          <div className="global-proxy-card">
            <strong>Anthropic-compatible</strong>
            <code>{anthropicGlobalUrl ?? "Proxy is not running"}</code>
            <button disabled={!anthropicGlobalUrl} onClick={() => copyGlobalProxy("anthropic")}>Copy Anthropic Base URL</button>
          </div>
          <div className="global-proxy-card">
            <strong>Auto-compatible</strong>
            <code>{autoGlobalUrl ?? "Proxy is not running"}</code>
            <button disabled={!autoGlobalUrl} onClick={() => copyGlobalProxy("auto")}>Copy Auto Base URL</button>
          </div>
        </div>
        <span className="provider-proxy-note global-proxy-note">
          <strong>if connection, model-list, or model fetch fails, remove the trailing /v1 from this api vault base url and try again.</strong>
        </span>
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
                <option value="openai-anthropic-compatible">OpenAI + Anthropic Compatible</option>
              </select>
            </label>
            <label>Base URL
              <div className="url-input-row">
                <input value={form.baseUrl} onChange={(e) => { setForm({ ...form, baseUrl: e.target.value }); setFormTest(undefined); }} placeholder="https://api.openai.com/v1" />
                <UrlTestIndicator test={formTest} />
                <button type="button" onClick={testFormUrl} disabled={!form.baseUrl?.trim() || formTest?.testing}>Test</button>
              </div>
              {formTest && !formTest.testing && (
                <span className={`url-test-msg ${formTest.ok ? "url-test-msg--ok" : "url-test-msg--fail"}`}>
                  {formTest.ok ? `OK ${formTest.status} - ${formTest.latencyMs}ms` : `Failed: ${formTest.error ?? `HTTP ${formTest.status ?? "?"}`}`}
                </span>
              )}
            </label>
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

      <div className="provider-list provider-list-compact">
        {state.providers.map((p) => {
          const providerRows = allUsageRows.filter((row) => row.providerId === p.id);
          const providerStats = aggregateRows(providerRows);
          return (
            <div
              key={p.id}
              className="provider-card provider-card-compact"
              role="button"
              tabIndex={0}
              onClick={() => setSelectedProviderId(p.id)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  setSelectedProviderId(p.id);
                }
              }}
            >
              <div className="provider-summary-top">
                <div className="provider-summary-name">
                  <strong>{p.name}</strong>
                  <span className="provider-protocol">{p.protocol}</span>
                  <span className="provider-protocol">{p.apiKeys.length} keys</span>
                </div>
                <button
                  type="button"
                  className="provider-open-button"
                  onClick={(event) => { event.stopPropagation(); setSelectedProviderId(p.id); }}
                >
                  Open
                </button>
              </div>
              <div className="provider-url provider-summary-base">
                <UrlTestIndicator test={urlTests[p.id]} />
                <span>{p.baseUrl}</span>
              </div>
              <UrlTestStatusLine test={urlTests[p.id]} />
              <div className="provider-stats provider-summary-stats">
                <span>{providerStats.calls} calls</span>
                <span>{compactNumber(providerStats.totalTokens)} tokens</span>
                <span>{statsCost(providerStats)}</span>
                <span>{providerStats.lastUsedAt ? `Last ${new Date(providerStats.lastUsedAt).toLocaleString()}` : "Not used yet"}</span>
              </div>
              <div className="provider-summary-actions">
                <button
                  type="button"
                  onClick={(event) => { event.stopPropagation(); startEdit(p); }}
                >
                  Add Key
                </button>
              </div>
            </div>
          );
        })}
        {state.providers.length === 0 && <p className="empty">No providers yet. Add one to get started.</p>}
      </div>

      {selectedProvider && (() => {
        const providerRows = allUsageRows.filter((row) => row.providerId === selectedProvider.id);
        const providerStats = aggregateRows(providerRows);
        return (
          <div className="provider-modal-backdrop" onClick={() => setSelectedProviderId(undefined)}>
            <div className="provider-modal" role="dialog" aria-modal="true" aria-label={`${selectedProvider.name} provider details`} onClick={(event) => event.stopPropagation()}>
              <div className="provider-modal-header">
                <div>
                  <div className="provider-header">
                    <strong>{selectedProvider.name}</strong>
                    <span className="provider-protocol">{selectedProvider.protocol}</span>
                    <span className="provider-protocol">{selectedProvider.apiKeys.length} keys</span>
                  </div>
                  <div className="provider-url">
                    <UrlTestIndicator test={urlTests[selectedProvider.id]} />
                    <span>{selectedProvider.baseUrl}</span>
                    <button type="button" className="url-test-retry" onClick={() => runProviderUrlTest(selectedProvider)} disabled={urlTests[selectedProvider.id]?.testing}>Test now</button>
                  </div>
                  <UrlTestStatusLine test={urlTests[selectedProvider.id]} />
                </div>
                <button className="provider-modal-close" onClick={() => setSelectedProviderId(undefined)}>Close</button>
              </div>

              {providerEditId === selectedProvider.id ? (
                <div className="provider-meta-editor">
                  <div className="provider-meta-editor-head">
                    <strong>Edit provider</strong>
                    <span>Update the upstream base URL and supported request format.</span>
                  </div>
                  <div className="provider-meta-grid">
                    <label>Provider Name
                      <input value={providerEditForm.name ?? ""} onChange={(event) => setProviderEditForm({ ...providerEditForm, name: event.target.value })} />
                    </label>
                    <label>Protocol
                      <select value={providerEditForm.protocol ?? "openai-compatible"} onChange={(event) => setProviderEditForm({ ...providerEditForm, protocol: event.target.value })}>
                        <option value="openai-compatible">OpenAI Compatible</option>
                        <option value="anthropic-compatible">Anthropic Compatible</option>
                        <option value="openai-anthropic-compatible">OpenAI + Anthropic Compatible</option>
                      </select>
                    </label>
                    <label>Base URL
                      <div className="url-input-row">
                        <input value={providerEditForm.baseUrl ?? ""} onChange={(event) => { setProviderEditForm({ ...providerEditForm, baseUrl: event.target.value }); setEditTest(undefined); }} />
                        <UrlTestIndicator test={editTest} />
                        <button type="button" onClick={() => testEditUrl(selectedProvider?.id)} disabled={!providerEditForm.baseUrl?.trim() || editTest?.testing}>Test</button>
                      </div>
                      {editTest && !editTest.testing && (
                        <span className={`url-test-msg ${editTest.ok ? "url-test-msg--ok" : "url-test-msg--fail"}`}>
                          {editTest.ok ? `OK ${editTest.status} - ${editTest.latencyMs}ms` : `Failed: ${editTest.error ?? `HTTP ${editTest.status ?? "?"}`}`}
                        </span>
                      )}
                    </label>
                    <label>Currency
                      <input value={providerEditForm.currency ?? ""} onChange={(event) => setProviderEditForm({ ...providerEditForm, currency: event.target.value })} />
                    </label>
                  </div>
                  <div className="provider-actions provider-meta-actions">
                    <button className="btn-primary" onClick={() => saveProviderMeta(selectedProvider.id)}>Save Provider</button>
                    <button onClick={() => { setProviderEditId(undefined); setProviderEditForm({}); }}>Cancel</button>
                  </div>
                </div>
              ) : (
                <div className="provider-actions provider-meta-toolbar">
                  <button onClick={() => startProviderMetaEdit(selectedProvider)}>Edit Provider</button>
                </div>
              )}

              <div className="provider-stats provider-modal-stats">
                <span>{providerStats.calls} calls</span>
                <span>{compactNumber(providerStats.totalTokens)} tokens</span>
                <span>{statsCost(providerStats)}</span>
                <span>{providerStats.lastUsedAt ? `Last ${new Date(providerStats.lastUsedAt).toLocaleString()}` : "Not used yet"}</span>
              </div>

              {selectedProvider.proxyBaseUrl && (
                <div className="base-url-pair provider-proxy-block">
                  <div>
                    <span>Original Base URL</span>
                    <code>{selectedProvider.baseUrl}</code>
                  </div>
                  <div className="vault-base-url">
                    <span>Advanced provider URL - compatibility fallback</span>
                    <code>{selectedProvider.proxyBaseUrl}</code>
                  </div>
                  <div className="provider-actions provider-proxy-actions">
                    <button onClick={() => copyProxy(selectedProvider.id)}>Copy Provider URL</button>
                    <span className="provider-proxy-note">
                      <strong>advanced provider-specific url. the global openai/anthropic urls above are recommended for most third-party apps.</strong>
                      <strong>if connection, model-list, or model fetch fails, remove the trailing /v1 from this api vault base url and try again.</strong>
                    </span>
                  </div>
                </div>
              )}

              <div className="key-list provider-modal-keys">
                {selectedProvider.apiKeys.map((key) => {
                  const keyStats = aggregateRows(providerRows.filter((row) => row.apiKeyId === key.id));
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
                      <div className="provider-actions">
                        <button onClick={() => copyKey(selectedProvider.id, key.id)}>Copy Key</button>
                        <button className="btn-danger" onClick={() => removeKey(selectedProvider.id, key.id)}>Delete Key</button>
                      </div>
                    </div>
                  );
                })}
                {selectedProvider.apiKeys.length === 0 && <div className="empty-key">No keys under this provider.</div>}
              </div>

              <div className="provider-actions provider-modal-actions">
                <button onClick={() => startEdit(selectedProvider)}>Add Key Here</button>
                <button className="btn-danger" onClick={() => remove(selectedProvider.id)}>Delete Provider</button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}

/* 鈹€鈹€鈹€ Usage 鈹€鈹€鈹€ */
function ProxyTokens({ state, setState, showMsg, showErr }: {
  state: AppState; setState: (s: AppState) => void; showMsg: (m: string) => void; showErr: (e: unknown) => void;
}) {
  const firstProvider = state.providers[0];
  const [secret, setSecret] = useState("");
  const [form, setForm] = useState<ProxyTokenInput>({
    name: "remote client",
    enabled: true,
    allowedProviderIds: firstProvider ? [firstProvider.id] : [],
    allowedModels: [],
    allowStreaming: true,
    requestsPerMinute: 60,
    requestsPerDay: 10000,
    expiresAt: ""
  });
  const [rule, setRule] = useState<ProxyModelRule>({
    publicModel: "",
    providerId: firstProvider?.id ?? "",
    apiKeyId: firstProvider?.apiKeys[0]?.id,
    upstreamModel: ""
  });

  function selectedProvider(id: string) {
    return state.providers.find((provider) => provider.id === id);
  }

  function addRule() {
    if (!rule.publicModel.trim() || !rule.providerId || !rule.upstreamModel.trim()) return;
    setForm({ ...form, allowedModels: [...form.allowedModels, rule] });
    const provider = selectedProvider(rule.providerId);
    setRule({ publicModel: "", providerId: provider?.id ?? "", apiKeyId: provider?.apiKeys[0]?.id, upstreamModel: "" });
  }

  async function create() {
    try {
      const result = await apiClient.createProxyToken(form);
      setState(result.state);
      setSecret(result.secret);
      showMsg("Proxy token created and copied");
    } catch (e) { showErr(e); }
  }

  async function remove(id: string) {
    if (!confirm("Delete this proxy token?")) return;
    try { const s = await apiClient.deleteProxyToken(id); setState(s); showMsg("Proxy token deleted"); }
    catch (e) { showErr(e); }
  }

  async function regenerate(id: string) {
    try {
      const result = await apiClient.regenerateProxyToken(id);
      setState(result.state);
      setSecret(result.secret);
      showMsg("New proxy token copied");
    } catch (e) { showErr(e); }
  }

  async function toggle(tokenId: string, enabled: boolean) {
    const token = state.proxyTokens.find((item) => item.id === tokenId);
    if (!token) return;
    try {
      const s = await apiClient.updateProxyToken(tokenId, { ...token, enabled });
      setState(s);
      showMsg(enabled ? "Proxy token enabled" : "Proxy token disabled");
    } catch (e) { showErr(e); }
  }

  return (
    <div className="page">
      <div className="page-header proxy-token-page-header">
        <h2>Proxy Tokens</h2>
        <span className="proxy-token-count">{state.proxyTokens.length} active token{state.proxyTokens.length === 1 ? "" : "s"}</span>
      </div>
      <div className="usage-hint proxy-token-hint">
        Use <code>Authorization: Bearer proxy_xxx</code> against <code>/proxy/v1/chat/completions</code>. Real provider keys never leave API Vault.
      </div>
      <div className="form-card proxy-token-form">
        <div className="proxy-token-section-head">
          <h3>Create Proxy Token</h3>
          <span>Create scoped access for external clients</span>
        </div>
        <div className="form-grid">
          <label>Name<input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
          <label>Requests / minute<input type="number" value={form.requestsPerMinute} onChange={(e) => setForm({ ...form, requestsPerMinute: Number(e.target.value) })} /></label>
          <label>Requests / day<input type="number" value={form.requestsPerDay} onChange={(e) => setForm({ ...form, requestsPerDay: Number(e.target.value) })} /></label>
          <label>Expires at<input type="datetime-local" value={form.expiresAt ?? ""} onChange={(e) => setForm({ ...form, expiresAt: e.target.value })} /></label>
          <label className="proxy-token-toggle"><input type="checkbox" checked={form.allowStreaming} onChange={(e) => setForm({ ...form, allowStreaming: e.target.checked })} /> Allow streaming</label>
        </div>
        <div className="proxy-token-provider-list">
          <strong>Allowed providers</strong>
          {state.providers.map((provider) => (
            <label key={provider.id} className="proxy-token-chip">
              <input type="checkbox" checked={form.allowedProviderIds.includes(provider.id)} onChange={(e) => setForm({
                ...form,
                allowedProviderIds: e.target.checked ? [...form.allowedProviderIds, provider.id] : form.allowedProviderIds.filter((id) => id !== provider.id)
              })} />
              {provider.name}
            </label>
          ))}
        </div>
        <div className="proxy-rule-builder">
          <div className="proxy-token-section-head">
            <h4>Model Mapping</h4>
            <span>Public name -&gt; provider / upstream model</span>
          </div>
          <div className="form-grid">
            <label>Public model<input value={rule.publicModel} onChange={(e) => setRule({ ...rule, publicModel: e.target.value })} placeholder="claude-desktop" /></label>
            <label>Provider<select value={rule.providerId} onChange={(e) => {
              const provider = selectedProvider(e.target.value);
              setRule({ ...rule, providerId: e.target.value, apiKeyId: provider?.apiKeys[0]?.id });
            }}>{state.providers.map((provider) => <option key={provider.id} value={provider.id}>{provider.name}</option>)}</select></label>
            <label>Key<select value={rule.apiKeyId ?? ""} onChange={(e) => setRule({ ...rule, apiKeyId: e.target.value || undefined })}>
              <option value="">First key</option>
              {(selectedProvider(rule.providerId)?.apiKeys ?? []).map((key) => <option key={key.id} value={key.id}>{key.name} {key.keyMasked}</option>)}
            </select></label>
            <label>Upstream model<input value={rule.upstreamModel} onChange={(e) => setRule({ ...rule, upstreamModel: e.target.value })} placeholder="real-model-id" /></label>
          </div>
          <button className="proxy-token-add-rule" onClick={addRule}>Add model rule</button>
          <div className="proxy-rule-list">
            {form.allowedModels.map((item, index) => (
              <span key={`${item.publicModel}-${index}`} className="proxy-rule-item">
                <code>{item.publicModel}</code> {"->"} {selectedProvider(item.providerId)?.name ?? item.providerId} / <code>{item.upstreamModel}</code>
                <button onClick={() => setForm({ ...form, allowedModels: form.allowedModels.filter((_, i) => i !== index) })}>Remove</button>
              </span>
            ))}
            {form.allowedModels.length === 0 && <p className="empty">No model mapping rules yet.</p>}
          </div>
        </div>
        <button className="btn-primary" onClick={create} disabled={state.providers.length === 0}>Create Token</button>
        {secret && <div className="secret-once"><strong>Copy this now. It is shown once:</strong><code>{secret}</code></div>}
      </div>
      <div className="proxy-token-list">
        {state.proxyTokens.map((token) => (
          <div key={token.id} className="proxy-token-card">
            <div className="proxy-token-card-head">
              <strong>{token.name}</strong>
              <span className={`proxy-token-state ${token.enabled ? "enabled" : "disabled"}`}>{token.enabled ? "Enabled" : "Disabled"}</span>
            </div>
            <code className="proxy-token-mask">{token.tokenMasked}</code>
            <div className="proxy-token-meta">
              <span>{token.allowedModels.length} model rules</span>
              <span>{token.requestsPerMinute}/min</span>
              <span>{token.requestsPerDay}/day</span>
              <span>stream {token.allowStreaming ? "on" : "off"}</span>
            </div>
            <div className="provider-actions proxy-token-actions">
              <button onClick={() => toggle(token.id, !token.enabled)}>{token.enabled ? "Disable" : "Enable"}</button>
              <button onClick={() => regenerate(token.id)}>Regenerate</button>
              <button className="btn-danger" onClick={() => remove(token.id)}>Delete</button>
            </div>
          </div>
        ))}
        {state.proxyTokens.length === 0 && <p className="empty">No proxy tokens yet. Create one before using a public tunnel.</p>}
      </div>
    </div>
  );
}

	/* 鈹€鈹€鈹€ Local Services 鈹€鈹€鈹€ */
	function LocalServicesPage({ state, setState, showMsg, showErr }: {
	  state: AppState; setState: (s: AppState) => void; showMsg: (m: string) => void; showErr: (e: unknown) => void;
	}) {
	  const [showForm, setShowForm] = useState(false);
	  const [form, setForm] = useState({ name: "", baseUrl: "", type: "unknown" as string, notes: "", apiKey: "" });
	  const [cfTestResult, setCfTestResult] = useState<{ ok?: boolean; status?: number; latencyMs?: number; error?: string; modelNames?: string[]; testing?: boolean }>({});
	  const [cfStatus, setCfStatus] = useState<CloudflaredStatus>(state.cloudflared);
	  const [cfLoading, setCfLoading] = useState(false);
	  const [serviceTests, setServiceTests] = useState<Record<string, { ok?: boolean; latencyMs?: number; error?: string; modelNames?: string[]; testing?: boolean }>>({});

	  useEffect(() => {
	    apiClient.getCloudflaredStatus().then(setCfStatus).catch(() => {});
	  }, []);

	  async function testUrl() {
	    if (!form.baseUrl.trim()) return;
	    setCfTestResult({ testing: true });
	    try {
	      const protocol = form.type === "anthropic-compatible" ? "anthropic-compatible" : "openai-compatible";
	      const result = await apiClient.testUrl({ baseUrl: form.baseUrl, protocol, isLocal: true, type: form.type, apiKey: form.apiKey });
	      setCfTestResult({ ...result, testing: false });
	    } catch (e) {
	      setCfTestResult({ ok: false, error: e instanceof Error ? e.message : String(e), testing: false });
	    }
	  }

	  async function save() {
	    if (!form.name.trim() || !form.baseUrl.trim()) return;
	    try {
	      const s = await apiClient.saveLocalService({
	        name: form.name,
	        baseUrl: form.baseUrl,
	        type: form.type as any,
	        notes: form.notes,
	        apiKey: form.apiKey
	      });
	      setState(s);
	      setShowForm(false);
	      setForm({ name: "", baseUrl: "", type: "unknown", notes: "", apiKey: "" });
	      showMsg("Local service added");
	    } catch (e) { showErr(e); }
	  }

	  async function remove(id: string) {
	    if (!confirm("Delete this local service?")) return;
	    try { const s = await apiClient.deleteLocalService(id); setState(s); showMsg("Deleted"); }
	    catch (e) { showErr(e); }
	  }

	  async function testService(id: string) {
	    setServiceTests((prev) => ({ ...prev, [id]: { testing: true } }));
	    try {
	      const result = await apiClient.testLocalService(id);
	      setServiceTests((prev) => ({ ...prev, [id]: { ...result, testing: false } }));
	      const s = await apiClient.getState();
	      setState(s);
	    } catch (e) {
	      setServiceTests((prev) => ({ ...prev, [id]: { ok: false, error: e instanceof Error ? e.message : String(e), testing: false } }));
	    }
	  }

	  async function startTunnel() {
	    setCfLoading(true);
	    try {
	      const status = await apiClient.startCloudflared();
	      setCfStatus(status);
	      if (status.publicUrl) showMsg(`Tunnel: ${status.publicUrl}`);
	      else if (status.error) showErr(status.error);
	    } catch (e) { showErr(e); }
	    finally { setCfLoading(false); }
	  }

	  async function stopTunnel() {
	    setCfLoading(true);
	    try {
	      await apiClient.stopCloudflared();
	      setCfStatus({ running: false });
	    } catch (e) { showErr(e); }
	    finally { setCfLoading(false); }
	  }

	  const publicUrl = cfStatus.publicUrl || state.cloudflared.publicUrl;

	  return (
	    <div className="page">
	      <div className="page-header">
	        <h2>Local Services</h2>
	        <div className="page-header-actions">
	          {cfStatus.running ? (
	            <button className="btn-danger" onClick={stopTunnel} disabled={cfLoading}>{cfLoading ? "Stopping..." : "Stop Tunnel"}</button>
	          ) : (
	            <button className="btn-primary" onClick={startTunnel} disabled={cfLoading}>{cfLoading ? "Starting..." : "Start Cloudflared Tunnel"}</button>
	          )}
	          <button className="btn-primary" onClick={() => { setShowForm(true); setCfTestResult({}); }}>+ Add Local Service</button>
	        </div>
	      </div>

	      {cfStatus.error && <div className="toast error" style={{ position: "static", marginBottom: 12 }}>{cfStatus.error}</div>}
	      {cfStatus.missingBinary && cfStatus.installUrl && (
	        <div className="cloudflared-panel cloudflared-panel-muted" style={{ marginBottom: 12 }}>
	          <div className="cloudflared-panel-head">
	            <span className="connection-status-dot fail" />
	            <strong>Cloudflared not installed</strong>
	          </div>
	          <p className="cloudflared-panel-hint">Install Cloudflared, then return here and click Start Cloudflared Tunnel again.</p>
	          <div className="provider-actions" style={{ marginTop: 8 }}>
	            <a className="btn-primary" href={cfStatus.installUrl} target="_blank" rel="noreferrer">Download Cloudflared</a>
	          </div>
	        </div>
	      )}
	      {cfStatus.running && publicUrl && (
	        <div className="cloudflared-panel">
	          <div className="cloudflared-panel-head">
	            <span className="connection-status-dot ok" />
	            <strong>Cloudflared Tunnel Active</strong>
	          </div>
	          <div className="cloudflared-panel-url">
	            <span>Public URL:</span>
	            <code>{publicUrl}</code>
	          </div>
	          <p className="cloudflared-panel-hint">
	            Use the public URL to access local services from external devices or tools.
	            Append <code>/api/proxy/local/:serviceId/v1</code> for a specific service.
	          </p>
	        </div>
	      )}
	      {!cfStatus.running && (
	        <div className="cloudflared-panel cloudflared-panel-muted">
	          <div className="cloudflared-panel-head">
	            <span className="connection-status-dot idle" />
	            <strong>Public access is not enabled</strong>
	          </div>
	          <p className="cloudflared-panel-hint">Start Cloudflared Tunnel to generate public proxy URLs for local services.</p>
	        </div>
	      )}

	      {showForm && (
	        <div className="form-card">
	          <h3>Add Local Service</h3>
	          <div className="form-grid">
	            <label>Service Name<input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. My Local LLM" /></label>
	            <label>Base URL
	              <div className="url-input-row">
	                <input value={form.baseUrl} onChange={(e) => { setForm({ ...form, baseUrl: e.target.value }); setCfTestResult({}); }} placeholder="http://127.0.0.1:8045/v1" />
	                <button type="button" onClick={testUrl} disabled={!form.baseUrl.trim() || cfTestResult.testing}>Test</button>
	              </div>
	              {cfTestResult.testing && <span className="url-test-msg url-test-msg--testing">Testing...</span>}
	              {!cfTestResult.testing && cfTestResult.ok !== undefined && (
	                <span className={`url-test-msg ${cfTestResult.ok ? "url-test-msg--ok" : "url-test-msg--fail"}`}>
	                  {cfTestResult.ok
	                    ? `OK ${cfTestResult.status} - ${cfTestResult.latencyMs}ms${cfTestResult.modelNames?.length ? ` - ${cfTestResult.modelNames.length} models` : ""}`
	                    : `Failed: ${cfTestResult.error ?? `HTTP ${cfTestResult.status}`}`}
	                </span>
	              )}
	            </label>
	            <label>Type
	              <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
	                <option value="unknown">Unknown</option>
	                <option value="openai-compatible">OpenAI Compatible</option>
	                <option value="anthropic-compatible">Anthropic Compatible</option>
	                <option value="custom">Custom</option>
	              </select>
	            </label>
	            <label>API Key (optional)
	              <input type="password" value={form.apiKey} onChange={(e) => setForm({ ...form, apiKey: e.target.value })} placeholder="sk-... or service key" />
	            </label>
	            <label>Notes<textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={2} placeholder="Optional notes" /></label>
	          </div>
	          <div className="form-actions">
	            <button className="btn-primary" onClick={save}>Save</button>
	            <button onClick={() => setShowForm(false)}>Cancel</button>
	          </div>
	        </div>
	      )}

	      <div className="provider-list provider-list-compact">
	        {state.localServices.map((service) => {
	          const test = serviceTests[service.id];
	          const publicAccessUrl = publicUrl ? `${publicUrl}/api/proxy/local/${service.id}/v1` : undefined;
	          return (
	            <div key={service.id} className="provider-card provider-card-compact">
	              <div className="provider-summary-top">
	                <div className="provider-summary-name">
	                  <strong>{service.name}</strong>
	                  <span className="provider-protocol provider-local-badge">Local</span>
	                  <span className="provider-protocol">{service.type}</span>
	                </div>
	              </div>
	              <div className="provider-url provider-summary-base">
	                <span className={`connection-status-dot ${test?.testing ? "testing" : service.status === "available" ? "ok" : service.status === "unavailable" ? "fail" : "idle"}`} />
	                <span>{service.baseUrl}</span>
	              </div>
	              {test?.testing && <div className="url-test-status url-test-status--testing">Testing...</div>}
	              {!test?.testing && test?.ok !== undefined && (
	                <div className={`url-test-status ${test.ok ? "url-test-status--ok" : "url-test-status--fail"}`}>
	                  {test.ok ? `OK - ${test.latencyMs}ms${test.modelNames?.length ? ` - ${test.modelNames.length} models` : ""}` : `Failed: ${test.error}`}
	                </div>
	              )}
	              {!test?.testing && test?.ok === undefined && service.status === "available" && (
	                <div className="url-test-status url-test-status--ok">Available - {service.latencyMs}ms</div>
	              )}
	              {!test?.testing && test?.ok === undefined && service.status === "unavailable" && (
	                <div className="url-test-status url-test-status--fail">Unavailable</div>
	              )}
	              <div className="provider-stats provider-summary-stats">
	                {service.latencyMs !== undefined && <span>{service.latencyMs}ms latency</span>}
	                {service.lastCheckedAt && <span>Last checked: {new Date(service.lastCheckedAt).toLocaleString()}</span>}
	                {service.hasApiKey && <span>Key: {service.keyMasked ?? "configured"}</span>}
	              </div>
	              {publicAccessUrl && (
	                <div className="local-routing-url" style={{ marginTop: 8 }}>
	                  <span>Public proxy access:</span>
	                  <code>{publicAccessUrl}</code>
	                </div>
	              )}
	              <div className="provider-actions" style={{ marginTop: 8 }}>
	                <button onClick={() => testService(service.id)} disabled={test?.testing}>Test Connection</button>
	                <button className="btn-danger" onClick={() => remove(service.id)}>Delete</button>
	              </div>
	            </div>
	          );
	        })}
	        {state.localServices.length === 0 && !showForm && <p className="empty">No local services configured. Add one to track usage of local API services.</p>}
	      </div>
	    </div>
	  );
	}

function Usage({ state }: { state: AppState }) {
  const [filter, setFilter] = useState("");
  const [providerId, setProviderId] = useState("all");
  const [apiKeyId, setApiKeyId] = useState("all");
  const [page, setPage] = useState(1);
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
        (e.proxyTokenName ?? "").toLowerCase().includes(lower) ||
        (e.baseUrl ?? "").toLowerCase().includes(lower) ||
        (e.gatewayBaseUrl ?? "").toLowerCase().includes(lower) ||
        gatewayLabel(e).toLowerCase().includes(lower) ||
        (e.error ?? "").toLowerCase().includes(lower) ||
        String(e.status).includes(lower))
    );
  }, [apiKeyId, filter, providerId, state.usageEvents]);

  const totalCost = useMemo(() => filtered.reduce((sum, e) => sum + (e.realCost ?? 0), 0), [filtered]);
  const pageCount = Math.max(1, Math.min(10, Math.ceil(filtered.length / USAGE_PAGE_SIZE)));
  const currentPage = Math.min(page, pageCount);
  const paged = useMemo(() => {
    const start = (currentPage - 1) * USAGE_PAGE_SIZE;
    return filtered.slice(start, start + USAGE_PAGE_SIZE);
  }, [currentPage, filtered]);
  const pageStart = filtered.length === 0 ? 0 : (currentPage - 1) * USAGE_PAGE_SIZE + 1;
  const pageEnd = Math.min(currentPage * USAGE_PAGE_SIZE, filtered.length);

  useEffect(() => { setPage(1); }, [apiKeyId, filter, providerId]);
  useEffect(() => { setPage((value) => Math.min(value, pageCount)); }, [pageCount]);

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
          <input className="filter-input" placeholder="Filter model, gateway, base URL, status, error..." value={filter} onChange={(e) => setFilter(e.target.value)} />
        </div>
      </div>
      {totalCost > 0 && <div className="cost-summary">Total cost (filtered): {formatMoney(totalCost)}</div>}
      {filtered.length > 0 && (
        <div className="usage-pagination">
          <span>showing {pageStart}-{pageEnd} of {filtered.length} logs</span>
          <div>
            <button disabled={currentPage === 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>Prev</button>
            {Array.from({ length: pageCount }, (_, index) => index + 1).map((item) => (
              <button key={item} className={item === currentPage ? "active" : ""} onClick={() => setPage(item)}>{item}</button>
            ))}
            <button disabled={currentPage === pageCount} onClick={() => setPage((value) => Math.min(pageCount, value + 1))}>Next</button>
          </div>
        </div>
      )}
      <UsageTable events={paged} />
      {filtered.length === 0 && <p className="empty">No usage events yet. {state.providers.length} providers are configured; make API calls through a copied proxy URL to see records here.</p>}
    </div>
  );
}

/* 鈹€鈹€鈹€ Billing 鈹€鈹€鈹€ */
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

/* 鈹€鈹€鈹€ UsageTable 鈹€鈹€鈹€ */
function UsageTable({ events }: { events: UsageEvent[] }) {
  return (
    <div className="table-wrap">
      <table className="usage-table">
        <thead>
          <tr>
            <th>Time</th>
            <th>Provider</th>
            <th>Base URL</th>
            <th>Gateway</th>
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
              <td>{formatUsageDateTime(e.startedAt)}</td>
              <td>{e.providerName}</td>
              <td><code>{e.baseUrl ?? "-"}</code></td>
              <td><span className="gateway-pill" title={e.gatewayBaseUrl ?? ""}>{gatewayLabel(e)}</span></td>
              <td>{e.apiKeyName ?? e.apiKeyMasked ?? "-"}</td>
              <td>{e.model ?? "-"}</td>
              <td><span className={`status ${e.ok ? "ok" : "fail"}`}>{e.ok ? "success" : "failed"} {e.status}</span></td>
              <td>{e.inputTokens !== undefined ? compactNumber(e.inputTokens) : "-"}</td>
              <td>{e.outputTokens !== undefined ? compactNumber(e.outputTokens) : "-"}</td>
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













