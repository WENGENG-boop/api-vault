# Implementation Plan: Local Services, Cloudflared, Connection Status, Heatmap Fix

## Context

This plan builds on existing code and reuses work from a prior worktree branch
(`.claude/worktrees/silly-poitras-72a111/`) that already implemented Cloudflared
tunnel management and Local Services CRUD. The main branch has zero cloudflared
code and no dedicated local service module — `isLocal` is just a boolean flag on
`ProviderRecord`. The user needs 6 enhancements shipped together.

## Files to modify (all in main branch)

| File | Changes |
|------|---------|
| `src/shared/types.ts` | Add `LocalService`, `CloudflaredStatus`, `GatewayType` union member, `UrlTestResult` modelNames field |
| `src/main/store.ts` | Add `localServices` + `cloudflaredPublicUrl` to `PersistedData`; add CRUD methods |
| `src/main/cloudflared.ts` | **NEW** — `CloudflaredManager` class (from worktree) |
| `src/server/server.ts` | Add Cloudflared routes, LocalService routes, `/proxy/local/:serviceId` handler, modelName support in test-url |
| `src/renderer/apiClient.ts` | Add cloudflared + localServices API methods; update `UrlTestResult` |
| `src/renderer/App.tsx` | Add LocalServices panel, Cloudflared panel, ProviderConnectionStatus card, heatmap fix, card height unification |
| `src/renderer/styles.css` | Add all new component styles + layout fixes |

---

## Step 1 — types.ts

Add types and update existing interfaces:

```typescript
// New
export type LocalServiceStatus = "unknown" | "available" | "unavailable";
export type LocalServiceProtocol = "openai-compatible" | "custom" | "unknown";

export interface LocalService {
  id: string;
  name: string;
  baseUrl: string;
  type: LocalServiceProtocol;
  status: LocalServiceStatus;
  latencyMs?: number;
  lastCheckedAt?: string;
  publicAccessUrl?: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CloudflaredStatus {
  running: boolean;
  publicUrl?: string;
  error?: string;
}
```

- Extend `GatewayType` union: `"local-service"`
- Add to `AppState`: `localServices: LocalService[]`, `cloudflared: CloudflaredStatus`
- Update `UrlTestResult` (in apiClient.ts) to include `modelNames?: string[]`

---

## Step 2 — cloudflared.ts (NEW)

Copy from worktree branch as-is (`CloudflaredManager` class). Spawns
`cloudflared tunnel --url http://127.0.0.1:<port>`, parses stdout/stderr for
`https://*.trycloudflare.com`, 30-second timeout.

---

## Step 3 — store.ts

- Add `localServices: LocalService[]` and `cloudflaredPublicUrl?: string` to `PersistedData`
- Add getter/setter/CRUD methods:
  - `getLocalServices()`, `getLocalService(id)`, `upsertLocalService(input)`, `deleteLocalService(id)`, `updateLocalServiceStatus(id, status, latencyMs, checkedAt)`
  - `getCloudflaredPublicUrl()`, `setCloudflaredPublicUrl(url?)`
- Update `getState()` to include `localServices` and `cloudflared` status (proxy port from server)
- Update `normalizeData()` to provide defaults for new fields
- Default `localServices: []` in `load()`

---

## Step 4 — server.ts

### New Cloudflared routes:
- `GET /api/cloudflared/status` → `cloudflared.getStatus()`
- `POST /api/cloudflared/start` → `cloudflared.start(proxyPort)`, persist publicUrl
- `POST /api/cloudflared/stop` → `cloudflared.stop()`, clear publicUrl

### New LocalService routes:
- `GET /api/local-services` → `store.getLocalServices()`
- `POST /api/local-services` → `store.upsertLocalService(body)`
- `DELETE /api/local-services/:id` → `store.deleteLocalService(id)`
- `POST /api/local-services/:id/test` → test connection, update status

### Proxy route for local services:
Add match before the generic `/proxy/` handler:
`/proxy/local/:serviceId/*` → `handleLocalServiceProxy()`

### `handleLocalServiceProxy()`:
- Look up `LocalService` by `serviceId`
- Forward request via `fetch()`
- Record `UsageEvent` with `gatewayType: "local-service"`
- On error, record with error message

### Update `testUpstreamUrl()`:
- Return `modelNames?: string[]` extracted from `/models` response JSON
- Increase timeouts: 5s for local, 10s for remote
- Parse response JSON after successful fetch to extract model names

### Server startup:
- Create `CloudflaredManager` instance
- Pass it to `getState()` calls so cloudflared status is in AppState

---

## Step 5 — apiClient.ts

### Update `UrlTestResult`:
```typescript
export interface UrlTestResult {
  ok: boolean;
  status?: number;
  latencyMs: number;
  error?: string;
  checkedAt: string;
  modelNames?: string[];
}
```

### New methods:
```typescript
getCloudflaredStatus: () => Promise<CloudflaredStatus>;
startCloudflared: () => Promise<CloudflaredStatus>;
stopCloudflared: () => Promise<CloudflaredStatus>;
getLocalServices: () => Promise<LocalService[]>;
saveLocalService: (input: Partial<LocalService> & { name: string; baseUrl: string }) => Promise<AppState>;
deleteLocalService: (id: string) => Promise<AppState>;
testLocalService: (id: string) => Promise<UrlTestResult & { status?: string }>;
```

---

## Step 6 — App.tsx

### A. New LocalServices tab/component
- Add `"local-services"` to `Tab` type
- Add nav button in sidebar (between "Proxy Tokens" and "Usage")
- `LocalServices` component:
  - Form to add name, baseUrl, type, notes
  - Card grid showing all local services
  - Each card: name, URL, status dot, latency, last checked, test button
  - If cloudflared running, show public proxy URL
  - Delete button with confirmation

### B. Cloudflared panel
- Show in sidebar as a status indicator + toggle button
- Can also be embedded in the LocalServices page as a section
- Show: running/stopped, public URL, start/stop button, error message

### C. Replace ModelTokenLeaderboard with ProviderConnectionStatus
- In `Dashboard()`:
  - Remove the second `dashboard-side-card` containing `ModelTokenLeaderboard`
  - Replace with `ProviderConnectionStatus` card
- `ProviderConnectionStatus` component:
  - Merges `state.providers` + `state.localServices` into a connection list
  - Shows at most 3 items with internal scroll
  - Each item: name, short base URL, status dot (green/red/gray), latency, "Test" button
  - Empty state when nothing configured
  - Update `urlTests` state to include local services

### D. Heatmap fix
- Root cause: `.dashboard-heatmap` uses `grid-template-columns` set via inline `style`, and the grid row height varies based on cell content (label visibility). The container has `max-width: 100%` but no fixed height, so as cells grow/shrink, the layout shifts.
- Fixes:
  1. Wrap `.dashboard-heatmap` in a container with `overflow: auto` + `min-height` to prevent layout shifts
  2. Ensure heatmap wrapper has `overflow-x: auto` and `overflow-y: hidden` for horizontal scrolling
  3. Remove `grid-template-columns` from inline style and use CSS to handle it
  4. Set `min-height: 60px` on heatmap wrapper to prevent collapse
  5. Fix tooltip overlap: add `z-index: 10` and `position: relative` to heat cells
  6. Ensure empty state shows a clear message

### E. Unify Overview card heights
- Add CSS class `dashboard-card-fixed` to the side cards:
  ```css
  .dashboard-card-fixed {
    height: 320px;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  ```
- The inner content area gets `flex: 1; overflow-y: auto; min-height: 0;`
- The heatmap wrapper also gets consistent height via `min-height` + `overflow`
- The main panel and side cards both use the same height logic

### F. Test URL with model names
- After testing, show model names in `UrlTestStatusLine` if available
- Update `UrlTestResult` usage throughout to display model names

---

## Step 7 — styles.css

### New styles:
- `.local-service-grid` — grid layout for local service cards
- `.local-service-card` — individual service card
- `.cloudflared-panel` / `.cloudflared-status` — cloudflared UI
- `.connection-status-card` / `.connection-status-item` — ProviderConnectionStatus items
- `.connection-status-dot` — green/red/gray dot classes

### Heatmap fix:
- `.dashboard-heatmap-wrap` — wrapper with `overflow: auto; min-height: 60px; padding: 4px 0;`
- `.dashboard-heat-cell` — add `position: relative; z-index: 1;` for tooltip context

### Card height unification:
- `.dashboard-card-fixed` — fixed height + flex column + overflow hidden
- `.dashboard-card-scroll` — scrollable inner content

---

## Verification

1. **Build check**: Run `npm run build` (or `npx tsc -p tsconfig.main.json && npx vite build`). If build succeeds, confirm output.
2. **Manual test**: Start the server, open the UI, verify:
   - Can add `http://127.0.0.1:8045/v1` as a local service
   - Test Connection works (shows status, latency, models)
   - Overview no longer shows Model Token Leaderboard
   - Overview shows Provider Connection Status with providers/local services
   - Heatmap doesn't break layout
   - Cards have uniform height
3. **Screenshot proof**: If dev server runs via Claude Preview, capture screenshots.

## API Changes Summary

### New endpoints:
| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/cloudflared/status` | Get tunnel status |
| POST | `/api/cloudflared/start` | Start Cloudflared tunnel |
| POST | `/api/cloudflared/stop` | Stop Cloudflared tunnel |
| GET | `/api/local-services` | List local services |
| POST | `/api/local-services` | Create/update local service |
| DELETE | `/api/local-services/:id` | Delete local service |
| POST | `/api/local-services/:id/test` | Test connection |
| * | `/proxy/local/:serviceId/*` | Proxy to local service |

### Updated endpoints:
| Method | Path | Change |
|--------|------|--------|
| POST | `/api/test-url` | Returns `modelNames[]` in response |
| GET | `/api/state` | Returns `localServices[]` + `cloudflared` |
