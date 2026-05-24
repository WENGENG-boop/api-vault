import { useMemo, useState } from "react";
import type { AppState, CloudflaredStatus, LocalService, ProviderSafe, UsageEvent, UsageRollup } from "../../../shared/types";
import type { AppTab } from "../../app/types";
import { apiClient } from "../../shared/api";
import { Button, EmptyChart, PageHeader, StatusPill, getLatencyColorClass } from "../../shared/components";
import { buildAnalyticsRows, buildModelTokenRanking, compactNumber, shortLabel, type AnalyticsRow } from "../../shared/utils";

type DashboardRange = "all" | "30d" | "7d" | "today";
type DashboardView = "overview" | "models";

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



export function Dashboard({ state, onNavigate }: { state: AppState; onNavigate: (tab: AppTab) => void }) {
  const [dashboardView, setDashboardView] = useState<DashboardView>("overview");
  const [dashboardRange, setDashboardRange] = useState<DashboardRange>("all");
  const rows = useMemo(() => dashboardRowsForRange(state.usageEvents, state.usageRollups ?? [], dashboardRange), [state.usageEvents, state.usageRollups, dashboardRange]);
  const ranking = useMemo(() => buildModelTokenRanking(rows), [rows]);
  const summary = useMemo(() => buildDashboardSummary(rows, ranking), [rows, ranking]);
  const providerTokens = useMemo(() => buildProviderTokenStats(state.providers, rows), [state.providers, rows]);
  const topProvider = useMemo(() => buildTopProviderToken(state.providers, providerTokens), [state.providers, providerTokens]);
  const heatmap = useMemo(() => buildTokenHeatmap(rows, dashboardRange), [rows, dashboardRange]);
  const modelShares = useMemo(() => buildModelTokenShares(ranking), [ranking]);
  const actions = useMemo(() => buildDashboardActions(state), [state]);

  return (
    <div className="page dashboard-page">
      <PageHeader
        title="Dashboard"
        description="Operational overview and next actions for the API Vault gateway."
        actions={<StatusPill tone={state.cloudflared.running ? "ok" : "neutral"}>{state.cloudflared.running ? "Tunnel active" : "Tunnel off"}</StatusPill>}
      />

      <section className="dashboard-action-center" aria-label="Recommended actions">
        <div className="dashboard-action-head">
          <div>
            <h3>Action Center</h3>
            <p>{actions.length ? "Resolve these items to make the gateway ready for real traffic." : "The core setup is ready. Watch usage and provider health from here."}</p>
          </div>
          <span>{actions.length} open</span>
        </div>
        <div className="dashboard-action-grid">
          {actions.length ? actions.map((action) => (
            <article key={action.id} className={`dashboard-action-card dashboard-action-card--${action.tone}`}>
              <div>
                <StatusPill tone={action.tone}>{action.badge}</StatusPill>
                <h4>{action.title}</h4>
                <p>{action.description}</p>
              </div>
              <Button variant={action.tone === "fail" ? "danger" : "secondary"} onClick={() => onNavigate(action.tab)}>
                {action.cta}
              </Button>
            </article>
          )) : (
            <article className="dashboard-action-card dashboard-action-card--ok">
              <div>
                <StatusPill tone="ok">Ready</StatusPill>
                <h4>Gateway baseline is configured</h4>
                <p>Providers, proxy tokens, and model mappings are present. Review recent usage when calls start flowing.</p>
              </div>
              <Button onClick={() => onNavigate("usage")}>Open usage log</Button>
            </article>
          )}
        </div>
      </section>

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
              <button type="button" className="btn-test-action" onClick={() => testItem(item)} disabled={test?.testing}>
                {test?.testing ? "Testing..." : "Test"}
              </button>
            </div>
            <div className="connection-status-url">{shortLabel(item.baseUrl, 32)}</div>
            <div className="connection-status-latency">
              {ok === undefined ? "Unknown" : ok ? "Available" : "Unavailable"}
              {latencyMs !== undefined ? (
                <>
                  {" - "}
                  <strong className={getLatencyColorClass(latencyMs)}>{latencyMs}ms</strong>
                </>
              ) : ""}
              {checkedAt ? ` - checked ${new Date(checkedAt).toLocaleTimeString()}` : ""}
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
    const item = stats.get(provider.id);
    if (!item) continue;
    if (!top || item.total > top.stats.total || (item.total === top.stats.total && item.calls > top.stats.calls)) {
      top = { provider, stats: item };
    }
  }
  return top && top.stats.total > 0 ? top : undefined;
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

interface DashboardAction {
  id: string;
  title: string;
  description: string;
  badge: string;
  cta: string;
  tab: AppTab;
  tone: "ok" | "fail" | "warn" | "neutral";
}

function buildDashboardActions(state: AppState): DashboardAction[] {
  const actions: DashboardAction[] = [];
  const hasProviders = state.providers.length > 0;
  const hasProxyTokens = state.proxyTokens.length > 0;
  const hasModelMappings = state.proxyTokens.some((token) => token.allowedModels.length > 0);
  const failedEvents = state.usageEvents.filter((event) => !event.ok).length;
  const hasLocalServices = state.localServices.length > 0;

  if (!hasProviders) {
    actions.push({
      id: "providers",
      title: "Add a Provider",
      description: "Connect at least one upstream provider before clients can route requests.",
      badge: "Setup",
      cta: "Add provider",
      tab: "providers",
      tone: "warn"
    });
  }

  if (hasProviders && !hasProxyTokens) {
    actions.push({
      id: "proxy-tokens",
      title: "Create a Proxy Token",
      description: "Issue a scoped token so external clients can call the public proxy without real provider keys.",
      badge: "Access",
      cta: "Create token",
      tab: "proxy-tokens",
      tone: "warn"
    });
  }

  if (hasProxyTokens && !hasModelMappings) {
    actions.push({
      id: "model-mapping",
      title: "Configure Model Mapping",
      description: "Map public model names to provider models so proxy calls resolve predictably.",
      badge: "Routing",
      cta: "Edit mappings",
      tab: "proxy-tokens",
      tone: "warn"
    });
  }

  if (failedEvents > 0) {
    actions.push({
      id: "failed-usage",
      title: "Review Failed Requests",
      description: `${failedEvents} usage event${failedEvents === 1 ? "" : "s"} failed. Inspect status, upstream URL, latency, and error details.`,
      badge: "Failure",
      cta: "Open usage",
      tab: "usage",
      tone: "fail"
    });
  }

  if (!state.cloudflared.running && hasLocalServices) {
    actions.push({
      id: "cloudflared",
      title: "Start Tunnel for Local Services",
      description: "Local services are configured, but Cloudflared is off. Start a tunnel to expose public service proxy URLs.",
      badge: "Tunnel",
      cta: "Open services",
      tab: "local-services",
      tone: "neutral"
    });
  }

  return actions;
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
