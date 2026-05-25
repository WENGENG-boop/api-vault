import { syncBalance } from "../../main/balance";
import type { VaultStore } from "../../main/store";
import { testUpstreamUrl } from "./upstreamProbeService";

const lastSyncTimes = new Map<string, number>();

export function startAutoSync(store: VaultStore): void {
  // Balance auto-sync (every 60s)
  setInterval(() => {
    if (!store.status.unlocked) return;
    const state = store.getState();
    for (const provider of state.providers) {
      const interval = provider.balanceConfig.autoSyncIntervalMs;
      if (!provider.balanceConfig.enabled || !interval || interval <= 0) continue;
      const lastSync = lastSyncTimes.get(provider.id) ?? 0;
      if (Date.now() - lastSync < interval) continue;
      lastSyncTimes.set(provider.id, Date.now());
      const full = store.getBalanceProvider(provider.id);
      syncBalance(full).then((result) => {
        store.appendBalance(result.snapshot);
      }).catch((error) => {
        console.warn(`Auto-sync balance failed for ${provider.name} (${provider.id}):`, (error as Error).message ?? error);
      });
    }
  }, 60_000);

  // Latency check (every 10s)
  setInterval(() => {
    if (!store.status.unlocked) return;
    const state = store.getState();
    for (const provider of state.providers) {
      const apiKey = store.getProviderFirstApiKeyPlaintext(provider.id);
      testUpstreamUrl(store, {
        baseUrl: provider.baseUrl,
        protocol: provider.protocol,
        providerId: provider.id,
        isLocal: provider.isLocal,
        apiKey
      }).then((result) => {
        store.updateProviderConnectionStatus(
          provider.id,
          result.ok ? "available" : "unavailable",
          result.latencyMs,
          result.checkedAt
        );
      }).catch((err) => {
        console.warn(`Background latency test failed for provider ${provider.name} (${provider.id}):`, err.message ?? err);
      });
    }
  }, 10_000);
}

