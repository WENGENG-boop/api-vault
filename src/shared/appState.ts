import type { AppState, CloudflaredStatus, DashboardTotals } from "./types";

export function emptyDashboardTotals(): DashboardTotals {
  return {
    totalCalls: 0,
    callsToday: 0,
    okCalls: 0,
    failedCalls: 0,
    realCostTotal: 0,
    realCostCount: 0
  };
}

export function idleCloudflaredStatus(): CloudflaredStatus {
  return { running: false };
}

export function withAppStateDefaults(state: AppState): AppState {
  return {
    ...state,
    providers: state.providers ?? [],
    proxyTokens: state.proxyTokens ?? [],
    accountPools: state.accountPools ?? [],
    modelCatalog: state.modelCatalog ?? [],
    usageEvents: state.usageEvents ?? [],
    usageRollups: state.usageRollups ?? [],
    balanceSnapshots: state.balanceSnapshots ?? [],
    totals: state.totals ?? emptyDashboardTotals(),
    localServices: state.localServices ?? [],
    cloudflared: state.cloudflared ?? idleCloudflaredStatus()
  };
}

export function publicLockedAppState(initialized: boolean, proxyPort?: number): AppState {
  return {
    initialized,
    unlocked: false,
    proxyPort,
    providers: [],
    proxyTokens: [],
    accountPools: [],
    modelCatalog: [],
    usageEvents: [],
    usageRollups: [],
    balanceSnapshots: [],
    totals: emptyDashboardTotals(),
    localServices: [],
    cloudflared: idleCloudflaredStatus()
  };
}
