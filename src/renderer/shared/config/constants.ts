export { defaultBalanceConfig } from "../../../shared/balanceConfig";

export const STATE_REFRESH_INTERVAL_MS = 5000;
export const USAGE_PAGE_SIZE = 100;
// Upper bound on Usage Log pages. Kept in step with the main-process
// RECENT_USAGE_LIMIT (10000) so retained requests stay browsable: 10000 / 100.
export const USAGE_MAX_PAGES = 100;
