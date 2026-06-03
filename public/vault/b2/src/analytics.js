// analytics.js — derive dashboard/status metrics from usage events.
import { tokensOf } from "./format.js";

const DAY = 86400e3;

export function rangeStart(range) {
  const now = Date.now();
  if (range === "today") { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime(); }
  if (range === "24h") return now - DAY;
  if (range === "7d") return now - 7 * DAY;
  if (range === "30d") return now - 30 * DAY;
  if (range === "90d") return now - 90 * DAY;
  return 0;
}

export function inRange(events, range) {
  const start = rangeStart(range);
  return start ? events.filter((e) => new Date(e.startedAt).getTime() >= start) : events.slice();
}

export function overview(events) {
  const sorted = [...events].sort((a, b) => new Date(a.startedAt) - new Date(b.startedAt));
  let sessions = 0, lastTs = -Infinity;
  const dayset = new Set(), hourCount = new Array(24).fill(0), modelCount = {};
  let totalTokens = 0, input = 0, output = 0;
  for (const e of sorted) {
    const ts = new Date(e.startedAt).getTime();
    if (ts - lastTs > 30 * 60e3) sessions++;
    lastTs = ts;
    const d = new Date(ts); dayset.add(d.toDateString());
    hourCount[d.getHours()]++;
    const t = tokensOf(e); totalTokens += t; input += e.inputTokens || 0; output += e.outputTokens || 0;
    if (e.model) modelCount[e.model] = (modelCount[e.model] || 0) + 1;
  }
  const peakHour = hourCount.indexOf(Math.max(...hourCount));
  const favoriteModel = Object.entries(modelCount).sort((a, b) => b[1] - a[1])[0]?.[0] || "—";
  const { current, longest } = streaks(dayset);
  return {
    sessions, messages: events.length, totalTokens, input, output,
    activeDays: dayset.size, currentStreak: current, longestStreak: longest,
    peakHour: hourCount.some((x) => x) ? peakHour : null, favoriteModel,
  };
}

function streaks(dayset) {
  const days = [...dayset].map((d) => new Date(d).setHours(0, 0, 0, 0)).sort((a, b) => a - b);
  if (!days.length) return { current: 0, longest: 0 };
  let longest = 1, run = 1;
  for (let i = 1; i < days.length; i++) {
    if (days[i] - days[i - 1] === DAY) run++; else run = 1;
    longest = Math.max(longest, run);
  }
  // current streak counts back from today/yesterday
  const today = new Date().setHours(0, 0, 0, 0);
  let current = 0, cursor = today;
  const set = new Set(days);
  if (!set.has(today)) cursor = today - DAY;
  while (set.has(cursor)) { current++; cursor -= DAY; }
  return { current, longest };
}

export function dailyTokens(events, days = 14) {
  const out = []; const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
  for (let i = days - 1; i >= 0; i--) {
    const start = todayStart.getTime() - i * DAY;
    const end = start + DAY;
    let sum = 0;
    for (const e of events) { const ts = new Date(e.startedAt).getTime(); if (ts >= start && ts < end) sum += tokensOf(e); }
    out.push({ label: new Date(start).toLocaleDateString(undefined, { month: "numeric", day: "numeric" }), value: sum });
  }
  return out;
}

// Aggregate KPI bundle for one window. `costOf` maps an event -> estimated cost.
export function bundle(events, costOf) {
  const sorted = [...events].sort((a, b) => new Date(a.startedAt) - new Date(b.startedAt));
  let totalTokens = 0, input = 0, output = 0, cached = 0, estCost = 0;
  let sessions = 0, lastTs = -Infinity, sessionStart = 0, activeMs = 0;
  let minTs = Infinity, maxTs = -Infinity;
  for (const e of sorted) {
    const ts = new Date(e.startedAt).getTime();
    totalTokens += tokensOf(e); input += e.inputTokens || 0; output += e.outputTokens || 0; cached += e.cachedInputTokens || 0;
    estCost += costOf ? (costOf(e) || 0) : 0;
    if (ts < minTs) minTs = ts; if (ts > maxTs) maxTs = ts;
    if (ts - lastTs > 30 * 60e3) {
      if (sessions > 0) activeMs += Math.max(0, lastTs - sessionStart);
      sessions++; sessionStart = ts;
    }
    lastTs = ts;
  }
  if (sessions > 0) activeMs += Math.max(0, lastTs - sessionStart);
  const messages = events.length;
  return {
    estCost, totalTokens, input, output, cached,
    activeMs, totalMs: sorted.length ? Math.max(0, maxTs - minTs) : 0,
    sessions, totalMessages: messages * 2, userMessages: messages,
  };
}

// Per-day token (input/output/cached), cost and duration totals for the last `days`.
export function dailyStacks(events, days, costOf) {
  const out = []; const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
  const byDay = new Map();
  for (let i = days - 1; i >= 0; i--) {
    const start = todayStart.getTime() - i * DAY;
    const o = { label: new Date(start).toLocaleDateString(undefined, { month: "numeric", day: "numeric" }), start, tin: 0, tout: 0, tcached: 0, cost: 0, durMs: 0 };
    out.push(o); byDay.set(start, o);
  }
  for (const e of events) {
    const d = new Date(e.startedAt); d.setHours(0, 0, 0, 0);
    const o = byDay.get(d.getTime());
    if (!o) continue;
    o.tin += e.inputTokens || 0; o.tout += e.outputTokens || 0; o.tcached += e.cachedInputTokens || 0;
    o.cost += costOf ? (costOf(e) || 0) : 0;
    o.durMs += e.latencyMs || 0;
  }
  return out;
}

// 7 (Sun..Sat) x 24 hour activity matrix; `valueOf` selects the metric.
export function weekHour(events, valueOf) {
  const m = Array.from({ length: 7 }, () => new Array(24).fill(0));
  for (const e of events) {
    const d = new Date(e.startedAt);
    if (!Number.isFinite(d.getTime())) continue;
    m[d.getDay()][d.getHours()] += valueOf(e) || 0;
  }
  return m;
}

// Generic distribution with small slices merged into an "Others" bucket.
export function distribution(events, keyFn, nameFn, valueOf, topN = 6) {
  const map = new Map();
  for (const e of events) {
    const k = keyFn(e); if (k == null || k === "") continue;
    let cur = map.get(k);
    if (!cur) { cur = { key: k, name: nameFn(e) || String(k), value: 0 }; map.set(k, cur); }
    cur.value += valueOf(e) || 0;
  }
  const all = [...map.values()].filter((x) => x.value > 0).sort((a, b) => b.value - a.value);
  const total = all.reduce((a, b) => a + b.value, 0);
  if (all.length <= topN) return { items: all, total };
  const head = all.slice(0, topN);
  const rest = all.slice(topN);
  const otherVal = rest.reduce((a, b) => a + b.value, 0);
  const items = otherVal > 0 ? [...head, { key: "__other", name: `Others (${rest.length})`, value: otherVal, other: true }] : head;
  return { items, total };
}

// Current + previous window bounds for a range (ms). `all` covers everything; finite
// ranges also expose the immediately-preceding equal-length window for deltas.
export function windowBounds(range) {
  if (range === "all") return { start: 0, end: Infinity, prevStart: null, prevEnd: null };
  const start = rangeStart(range);
  const now = Date.now();
  const len = Math.max(1, now - start);
  return { start, end: now, prevStart: start - len, prevEnd: start };
}

// Archived month rollups whose bucket falls in [startMs, endMs). Month rollups are the
// complete superset of compacted overflow (every overflow event is in exactly one), so
// using month-only avoids double counting with week rollups.
export function rollupsInWindow(rollups, startMs = 0, endMs = Infinity) {
  return (rollups || []).filter((r) => {
    if (r.period !== "month") return false;
    const t = new Date(r.bucketStart).getTime();
    return Number.isFinite(t) && t >= startMs && t < endMs;
  });
}

// Token / cost / call totals from archived rollups in a window — added on top of the live
// event totals so compacted history is never lost from the dashboard.
export function rollupTokenCost(rollups, costOf, startMs = 0, endMs = Infinity) {
  let estCost = 0, totalTokens = 0, input = 0, output = 0, cached = 0, calls = 0;
  for (const r of rollupsInWindow(rollups, startMs, endMs)) {
    totalTokens += r.totalTokens || 0; input += r.inputTokens || 0; output += r.outputTokens || 0; cached += r.cachedInputTokens || 0;
    estCost += costOf ? (costOf(r) || 0) : 0; calls += r.calls || 0;
  }
  return { estCost, totalTokens, input, output, cached, calls };
}

export function modelTokenShare(events) {
  const map = {};
  for (const e of events) { if (!e.model) continue; const t = tokensOf(e); const m = map[e.model] || (map[e.model] = { name: e.model, value: 0, input: 0, output: 0, calls: 0 }); m.value += t; m.input += e.inputTokens || 0; m.output += e.outputTokens || 0; m.calls++; }
  return Object.values(map).sort((a, b) => b.value - a.value);
}

export function topProvider(events) {
  const map = {};
  for (const e of events) {
    const m = map[e.providerId] || (map[e.providerId] = { id: e.providerId, name: e.providerName, calls: 0, total: 0, input: 0, output: 0, cached: 0 });
    m.calls++; m.total += tokensOf(e); m.input += e.inputTokens || 0; m.output += e.outputTokens || 0; m.cached += e.cachedInputTokens || 0;
  }
  return Object.values(map).sort((a, b) => b.total - a.total)[0] || null;
}

// per-entity stats for Status/Providers
export function providerStats(events, providerId) {
  let calls = 0, ok = 0, latSum = 0, latN = 0, tokens = 0, cost = 0, lastUsed = null;
  const sevenDayStart = Date.now() - 7 * DAY; let calls7 = 0;
  for (const e of events) {
    if (e.providerId !== providerId) continue;
    calls++; if (e.ok) ok++; if (e.latencyMs) { latSum += e.latencyMs; latN++; }
    tokens += tokensOf(e); cost += e.realCost || 0;
    if (new Date(e.startedAt).getTime() >= sevenDayStart) calls7++;
    if (!lastUsed || new Date(e.startedAt) > new Date(lastUsed)) lastUsed = e.startedAt;
  }
  return { calls, calls7, successRate: calls ? (ok / calls) * 100 : null, avgLatency: latN ? latSum / latN : null, tokens, cost, lastUsed };
}

export function modelStats(events) {
  const map = {};
  for (const e of events) {
    if (!e.model) continue;
    const m = map[e.model] || (map[e.model] = { model: e.model, providerId: e.providerId, providerName: e.providerName, calls: 0, ok: 0, latSum: 0, latN: 0, lat: [] });
    m.calls++; if (e.ok) m.ok++; if (e.latencyMs) { m.latSum += e.latencyMs; m.latN++; m.lat.push(e.latencyMs); }
  }
  return Object.values(map).map((m) => ({ ...m, successRate: m.calls ? (m.ok / m.calls) * 100 : 0, avgLatency: m.latN ? m.latSum / m.latN : 0 })).sort((a, b) => b.calls - a.calls);
}

export function quantiles(arr) {
  if (!arr.length) return { p50: null, p95: null, p99: null, peak: null };
  const s = [...arr].sort((a, b) => a - b);
  const q = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
  return { p50: q(0.5), p95: q(0.95), p99: q(0.99), peak: s[s.length - 1] };
}

export function recentRequests(events, providerId, model, limit = 15) {
  return events.filter((e) => (providerId ? e.providerId === providerId : true) && (model ? e.model === model : true)).slice(0, limit);
}

export function hourlyLatencyFromEvents(events, model, hours = 24) {
  const buckets = new Array(hours).fill(null).map(() => ({ sum: 0, n: 0 }));
  const now = Date.now(); const HOUR = 3600e3;
  for (const e of events) {
    if (model && e.model !== model) continue;
    const age = now - new Date(e.startedAt).getTime();
    const idx = hours - 1 - Math.floor(age / HOUR);
    if (idx >= 0 && idx < hours && e.latencyMs) { buckets[idx].sum += e.latencyMs; buckets[idx].n++; }
  }
  return buckets.map((b) => (b.n ? b.sum / b.n : 0));
}
