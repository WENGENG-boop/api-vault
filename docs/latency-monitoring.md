# Latency Monitoring

The Status page has a dedicated **Connection Latency** view that tracks response
latency over time. It is intentionally kept separate from the success-rate
metrics — this view is about *how fast*, not *how reliable*.

Open it at `/vault` → **Status** → the **Connection Latency** tab.

## Two Data Sources

The view shows two groups of cards, both latency-only:

1. **Provider Connections** — latency of the background connection probe that
   runs **every ~10 seconds per provider** (the same probe that drives the
   green/red health dot). This covers all configured providers, whether or not
   they have received real traffic.
2. **Models** — latency of **real proxied calls**, grouped per
   `model × provider`. Derived from recorded usage events, so a model only
   appears here once it has actually been called.

## How the Data Is Aggregated

Raw 10-second probe samples are **averaged into one bucket per hour** and
retained for **7 days** (up to 168 hourly buckets per provider). Each hourly
bucket keeps:

| Field | Meaning |
|-------|---------|
| `count` | number of latency samples in the hour |
| `sum` | sum of latencies → **average = sum / count** |
| `min` / `max` | fastest / slowest sample in the hour |
| `ok` / `total` | successful vs total probes (used for context, not shown as a rate) |

A failed probe still increments `total` but contributes no latency, so averages
reflect only successful responses.

Model latency is bucketed the same way on the client, from the recent usage
events.

## Time Range Selector

A selector at the top of the view controls the window. All views plot **hourly
average points**:

| Option | Window |
|--------|--------|
| **Last Hour** | the most recent hour (a single hourly point) |
| **Last 24h** | the last 24 hourly points |
| **Last 7 Days** | the full 168-hour history |
| **Specific Day** | a chosen calendar day from the last 7 days (its 24 hours) |

## Card Details

Each card (collapsed) shows the window's **Avg / Min / Max** latency, the sample
count, and a small latency sparkline. **Click a card to expand** it:

- a larger **hourly latency curve**, and
- a **detailed table** with per-hour `avg / min / max / sample-count` rows.

## Limits & Notes

- **Provider probe history** is complete for the full 7 days (hourly buckets are
  persisted in the vault file and restored on restart).
- **Model latency** comes from the in-memory recent usage events (capped at
  1000). Under very high traffic this may not span the full 7 days; the provider
  probe series always does.
- "Last Hour" is a single hourly average by design, since data is aggregated
  hourly. Use Last 24h / 7 Days / a specific day for trend curves.
- The probe interval and retention are fixed in code (10s interval,
  `LATENCY_HISTORY_HOURS = 168`). See
  [`src/server/services/autoSyncService.ts`](../src/server/services/autoSyncService.ts)
  and `updateProviderConnectionStatus` in
  [`src/main/store.ts`](../src/main/store.ts).
