# Implementation Plan: Local Services, Cloudflared, URL Test, Dashboard Fixes

## Context
This project is a local API Vault (key management + proxy + usage tracking) with zero external runtime dependencies. The UI is a single React SPA in `App.tsx`, the backend is a Node.js HTTP server, and data is stored in a JSON file. Currently, providers support an `isLocal` flag, but there's no dedicated local service management, Cloudflared tunnel integration, or structured connection status tracking. The Dashboard's overview sidebar has a "Model Token Leaderboard" that duplicates the models view, and the heatmap layout can shift card heights.

---

## Changes Overview

### Files to modify:
| File | Changes |
|------|---------|
| `src/shared/types.ts` | Add `LocalService`, `CloudflaredStatus`, extend `UrlTestResult` with `modelNames` |
| `src/main/store.ts` | Add `localServices` to `PersistedData`, CRUD methods, `updateLocalServiceStatus()` |
| `src/main/cloudflared.ts` | **NEW** — `CloudflaredManager` class: spawn/stop tunnel, parse public URL |
| `src/server/server.ts` | Add API routes: local services CRUD, Cloudflared start/stop/status, enhanced test-url |
| `src/main/proxy.ts` | Add `/proxy/local/:serviceId/*` route for forwarding to local services |
| `src/renderer/apiClient.ts` | Add methods for local services CRUD, Cloudflared control, enhanced test-url |
| `src/renderer/App.tsx` | Add Local Services UI, Cloudflared controls, replace ModelTokenLeaderboard with Provider Connection Status card, fix heatmap, unify card heights |
| `src/renderer/styles.css` | New component styles, heatmap fix, unified card height CSS variables |

---

## Detailed Implementation

### 1. Types (`src/shared/types.ts`)

**Add** `LocalServiceStatus` type:
```ts
export type LocalServiceStatus = "unknown" | "available" | "unavailable";
```

**Add** `LocalService` interface:
```ts
export interface LocalService {
  id: string;
  name: string;
  baseUrl: string;
  type: "openai-compatible" | "custom" | "unknown";
  status: LocalServiceStatus;
  latencyMs?: number;
  lastCheckedAt?: string;
  publicAccessUrl?: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}
```

**Add** `CloudflaredStatus` to AppState:
```ts
export interface CloudflaredStatus {
  running: boolean;
  publicUrl?: string;
  error?: string;
}
```

**Extend** `AppState`:
```ts
export interface AppState {
  // ... existing fields
  localServices: LocalService[];
  cloudflared: CloudflaredStatus;
}
```

**Extend** `UrlTestResult` in `apiClient.ts`:
```ts
export interface UrlTestResult {
  ok: boolean;
  status?: number;
  latencyMs: number;
  error?: string;
  checkedAt: string;
  modelNames?: string[];  // NEW: model names if OpenAI-compatible
}
```

### 2. Store (`src/main/store.ts`)

**Add** to `PersistedData`:
```ts
interface PersistedData {
  // ... existing
  localServices: LocalServiceRecord[];
}
```

**Add methods:**
- `getLocalServices()` → `LocalService[]`
- `upsertLocalService(input)` → `LocalService`
- `deleteLocalService(id)`
- `updateLocalServiceStatus(id, status, latencyMs, checkedAt)` — called after URL test
- `getLocalService(id)` — for proxy resolution

**Migration:** `normalizeData()` ensures `localServices` defaults to `[]` if missing from old JSON.

### 3. Cloudflared (`src/main/cloudflared.ts`) — **NEW FILE**

```ts
export class CloudflaredManager {
  private process?: ChildProcess;
  private publicUrl?: string;
  private error?: string;

  async start(port: number): Promise<string>;
  stop(): void;
  getStatus(): { running: boolean; publicUrl?: string; error?: string };
}
```

- Spawns `cloudflared tunnel --url http://127.0.0.1:{port}`
- Parses `https://*.trycloudflare.com` from stdout lines
- If `cloudflared` not found in PATH, returns error
- Timeout: fail tunnel if no URL received within 30 seconds
- On stop: kills child process and cleans up

### 4. Server (`src/server/server.ts`)

**New API routes:**

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/local-services` | List all local services |
| POST | `/api/local-services` | Create/update local service |
| DELETE | `/api/local-services/:id` | Delete local service |
| POST | `/api/local-services/:id/test` | Test connection and update status |
| GET | `/api/cloudflared/status` | Get tunnel status |
| POST | `/api/cloudflared/start` | Start tunnel |
| POST | `/api/cloudflared/stop` | Stop tunnel |
| POST | `/api/test-url` | **Enhanced** — also returns modelNames |

**Enhanced `testUpstreamUrl()`:**
- Return `modelNames` array when successful against an OpenAI-compatible endpoint
- Parse `{ data: [{ id: "model-name" }, ...] }` from response
- For non-OpenAI-compatible or failed tests, `modelNames` is empty

**Local proxy route** `/api/proxy/local/:serviceId/*`:
- Forwarded to the proxy's handler for `local-service` gateway type
- Records usage events with `gatewayType: "local-service"`
- Uses store's `appendUsage()` for recording

**Integration with proxy:** All `/proxy/local/:serviceId/*` requests in `proxy.ts` will be handled by a new `handleLocalProxy()` method that resolves the local service, proxies the request, and records usage with the service name as `providerName`.

### 5. Proxy (`src/main/proxy.ts`)

**Add** `handleLocalProxy()`:
- Matches `/proxy/local/:serviceId/*` path pattern
- Resolves local service from store
- Forwards request to `{service.baseUrl}/{suffixPath}`
- No API key injection (local services may not need keys)
- Records usage event with `gatewayType: "local-service"` and `providerId: service.id`, `providerName: service.name`
- Supports streaming for OpenAI-compatible local services

**Register** this handler before the `globalMatch` check in `handleRequest()`:
```
const localMatch = incomingUrl.pathname.match(/^\/proxy\/local\/([^/]+)(\/.*)?$/);
if (localMatch) { await this.handleLocalProxy(req, res, localMatch[1], localMatch[2] ?? "/"); return; }
```

### 6. API Client (`src/renderer/apiClient.ts`)

**Add methods:**
- `getLocalServices(): Promise<LocalService[]>`
- `saveLocalService(input): Promise<LocalService>`
- `deleteLocalService(id): Promise<void>`
- `testLocalService(id): Promise<UrlTestResult>`
- `getCloudflaredStatus(): Promise<CloudflaredStatus>`
- `startCloudflared(): Promise<CloudflaredStatus>`
- `stopCloudflared(): Promise<CloudflaredStatus>`

### 7. UI (`src/renderer/App.tsx`)

#### A. Sidebar — Add "Local Services" tab
Add `"local-services"` to the `Tab` type. The providers page's local service features move here. Show a badge for available/unavailable local services.

#### B. Local Services Page (new component inline)
- List of local services with status indicators
- "Add Local Service" form: name, baseUrl, type dropdown, notes
- Test connection button per service
- Shows public access URL if Cloudflared is running
- Each service can be "promoted" to a full provider (creates a provider with same baseUrl and isLocal=true)

#### C. Cloudflared Controls
- In the sidebar or a card at the top of Local Services page
- Toggle button: "Enable Public Access" / "Disable Public Access"
- Shows public URL when tunnel is running
- Shows "公网访问未启用" when not running (as requested)

#### D. Dashboard — Replace ModelTokenLeaderboard
**Remove** from `Dashboard()`:
```tsx
<section className="dashboard-side-card dashboard-leaderboard-card">
  <h3>Model Token Leaderboard</h3>
  <ModelTokenLeaderboard data={ranking} limit={3} .../>
</section>
```

**Add** `ProviderConnectionStatus` card:
```tsx
<section className="dashboard-side-card dashboard-connection-card">
  <h3>Provider Connection Status</h3>
  <div className="connection-list">
    {connections.slice(0, 3).map(conn => (
      <ConnectionRow key={conn.id} ... />
    ))}
  </div>
  {connections.length > 3 && <div className="connection-overflow">...</div>}
  {connections.length === 0 && <p>No providers configured</p>}
</section>
```

Each connection row shows:
- Green/yellow/grey dot (available/unavailable/unknown)
- Provider/service name (short)
- Base URL (truncated)
- Latency (if available)
- "Test" button
- Available/unavailable/unknown text

Data source: combines `state.providers` and `state.localServices`, using URL test results stored in each.

#### E. Heatmap Fix
Root cause analysis:
- `dashboard-heatmap` is a CSS grid with `gap: 4px` and no `min-height` on its parent
- When heatmap has few days (e.g., "today" range → 1 cell, 48px), the container collapses
- When heatmap has many days (e.g., "all" → 365 cells, 12px each), it expands
- The `dashboard-main-panel` and `dashboard-side-card` have no fixed height, so the rail follows content height

**Fix:**
1. Set `min-height: 120px` on `.dashboard-heatmap` using the unified card height variable
2. Add `overflow-y: auto` to the heatmap container when content exceeds it
3. Wrap heatmap cells in a scrollable wrapper:
   ```css
   .dashboard-heatmap {
     min-height: var(--card-content-min-height, 100px);
     max-height: var(--card-content-max-height, 160px);
     overflow-y: auto;
   }
   ```
4. Remove absolute positioning anywhere inside the heatmap
5. Ensure tooltips are `position: fixed` or use `z-index` layering above other cards

#### F. Unified Card Heights
**Add CSS variables:**
```css
:root {
  --card-min-height: 200px;
  --card-content-max-height: 260px;
}
```

**Apply to:**
- `.dashboard-main-panel` — `min-height: var(--card-min-height)`
- `.dashboard-side-card` — `min-height: var(--card-min-height)`
- `.dashboard-stat-grid` — stable height regardless of tile counts
- Content overflow → `overflow-y: auto` inside each card

The key: all dashboard cards use `min-height` (not fixed height), so they're visually aligned. Content exceeding the min-height uses internal scroll.

### 8. CSS (`src/renderer/styles.css`)

**Add styles:**
- `.local-service-list` — grid/list layout for local service cards
- `.local-service-card` — per-service card with status
- `.connection-list` — flex column for connection status rows
- `.connection-row` — per-row with dot, name, URL, latency, test button
- `.connection-dot` — reusable status dot (green/yellow/grey)
- `.cloudflared-panel` — Cloudflared control card
- `.cloudflared-url` — public URL display with copy button

**Modify styles:**
- `.dashboard-heatmap` — add `min-height`, `max-height`, `overflow-y`
- `.dashboard-side-card` — add `min-height` using CSS variable
- `.dashboard-main-panel` — add `min-height` using CSS variable
- Remove `max-height: none` on `.dashboard-provider-token-list` and `.dashboard-leaderboard-card .model-token-board` (from line 1762)

---

## Verification

1. **Build check:** `npm run build` (builds both main and renderer)
2. **Type check:** no TypeScript errors (strict mode)
3. **Local service test:** Add a local service pointing to a local HTTP server, click "Test", verify status/latency/model names
4. **Cloudflared test:** Start tunnel, verify public URL appears, access a local service via public URL
5. **Dashboard:** Verify no Model Token Leaderboard card, Provider Connection Status card shows correctly, heatmap doesn't shift layout
6. **Responsive:** Test dashboard at 1440px, 1024px, 768px widths
