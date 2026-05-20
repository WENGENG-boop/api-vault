import { syncBalance } from "../../main/balance";
import type { VaultStore } from "../../main/store";

const lastSyncTimes = new Map<string, number>();

export function startAutoSync(store: VaultStore): void {
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
}
