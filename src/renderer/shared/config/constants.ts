import type { BalanceConfig } from "../../../shared/types";

export const STATE_REFRESH_INTERVAL_MS = 5000;
export const USAGE_PAGE_SIZE = 100;

export const defaultBalanceConfig: BalanceConfig = {
  enabled: false, url: "", method: "GET",
  headersJson: '{\n  "Authorization": "Bearer {{queryKey}}"\n}',
  bodyTemplate: "", balancePath: "", spentPath: "",
  currencyPath: "", responseCostPath: "", autoSyncIntervalMs: 0
};
