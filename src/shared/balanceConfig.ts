import type { BalanceConfig } from "./types";

export const defaultBalanceConfig: BalanceConfig = {
  enabled: false,
  url: "",
  method: "GET",
  headersJson: "{\n  \"Authorization\": \"Bearer {{queryKey}}\"\n}",
  bodyTemplate: "",
  balancePath: "",
  spentPath: "",
  currencyPath: "",
  responseCostPath: "",
  autoSyncIntervalMs: 0
};
