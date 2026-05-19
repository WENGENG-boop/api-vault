import React, { useMemo } from "react";
import type { UsageEvent, UsageRollup } from "../../shared/types";
import { EmptyChart, ModelTokenLeaderboard } from "../common";
import { buildAnalyticsRows, buildModelTokenRanking, compactNumber, modelLabel, shortLabel, type AnalyticsRange, type AnalyticsRow } from "../viewUtils";

export function UsageAnalytics({ events, rollups }: { events: UsageEvent[]; rollups: UsageRollup[] }) {
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



export function AnalyticsCard({ title, subtitle, wide, children }: {
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
