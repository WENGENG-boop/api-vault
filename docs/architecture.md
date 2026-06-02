# Architecture

API Vault is a single Node.js process that serves a static frontend, a
management API, and a forwarding proxy. There is no database — all state lives
in one encrypted JSON file.

## Source Layout

```text
src/
  main/        Core logic (framework-free, reusable by server & electron)
    crypto.ts            AES-256-GCM + scrypt KDF, vault header
    store.ts             VaultStore: persistence, encryption, all domain ops
    storeSecrets.ts      key hashing/masking helpers
    proxy.ts             ProxyServer: the /proxy gateway + upstream forwarding
    proxyRoutes.ts       proxy URL parsing (public/global/by-key/provider)
    multimodal.ts        image handling + OpenAI<->Anthropic conversion
    usage.ts             token/usage extraction from responses & SSE
    balance.ts           provider balance/usage sync via JSON-path
    cloudflared.ts       Cloudflare Tunnel process manager
    httpUtils.ts         body reading, header filtering, timeouts
    jsonPath.ts, modelList.ts, cpaConnector.ts, errors.ts

  server/      The HTTP server that wires everything together
    server.ts            createApiServer + request router
    startup.ts           listen/bind, browser open, public-bind warnings
    config/serverConfig.ts   ports, bind host, data path, dist dir
    routes/apiRoutes.ts      all /api/* management endpoints
    middlewares/
      adminSession.ts    admin token issue/validate (12h TTL)
      authLimiter.ts     per-IP brute-force limiter for setup/unlock
      cors.ts            origin allowlist
    services/
      localServiceProxy.ts    /proxy/local/* forwarding (loopback-gated)
      autoSyncService.ts      background balance + latency polling
      upstreamProbeService.ts connection testing
      accountPoolAuthService.ts, modelCatalogService.ts
    utils/
      staticAssets.ts    serves the Next.js export from out/
      requestBody.ts, responses.ts

  app/         Next.js App Router (frontend entry)
    layout.tsx           root layout
    page.tsx             / landing page (renders website/ at build time)
    vault/page.tsx       /vault dashboard (mounts the renderer App)

  renderer/    React dashboard UI (feature pages, shared components, apiClient)
  electron/    Optional Electron desktop wrapper (main.ts)
  shared/      TypeScript types shared across all layers
```

## Processes & Servers

At runtime there are **two HTTP listeners**:

1. **Public server** (`server.ts`, default port 3210) — serves static assets,
   the `/api/*` management API, and the `/proxy/*` gateway. Bound per
   `LISTEN_HOST`.
2. **Internal proxy server** (`ProxyServer` in `proxy.ts`) — bound to a random
   loopback port on `127.0.0.1`. The public server forwards `/proxy/*` traffic
   into it. This separation keeps proxy forwarding isolated from the management
   surface.

## Request Routing (public server)

`handleRequest` in `server.ts` dispatches in this order:

1. **CORS preflight** — `applyCors` short-circuits `OPTIONS`.
2. `/api/proxy/local/:id/*` → `handleLocalServiceProxy` (loopback-gated).
3. `/api/*` → `handleApi` (management API; admin session required after
   setup/unlock).
4. `/proxy/local/:id/*` → `handleLocalServiceProxy`.
5. `/proxy/*` → forwarded into the internal `ProxyServer`.
6. Everything else → `serveStatic` (Next.js export from `out/`).

## Proxy Gateway Flow

For a `/proxy/*` request, `ProxyServer.handleRequest`:

1. Parses the route (`parseProxyRoute`): `public` (`/proxy/v1`), `global`
   (`/proxy/openai|anthropic|auto`), `by-key`, or `provider` (`/proxy/:id`).
2. Authenticates: a `proxy_…` token (public/token routes) or a registered
   provider API key (provider/global routes).
3. Resolves the target provider + real upstream key from the encrypted store.
4. Normalizes the path, infers protocol (OpenAI vs Anthropic), optionally
   converts the body (multimodal), and strips client credential headers.
5. Forwards to the upstream with the **real** injected key.
6. Streams or buffers the response, extracts usage (tokens/cost/model), and
   records a `UsageEvent` in the store.

## Data Model & Persistence

`VaultStore` (`store.ts`) is the single source of truth:

- Holds the decrypted master key in memory only while **unlocked**.
- Reads/writes one JSON file via an atomic temp-file + rename.
- Encrypts secrets (API keys, query keys, proxy-token secrets) with
  AES-256-GCM; the key is derived from the master password with scrypt.
- Batches usage/last-used writes (flush every 5s or 50 events) and caps recent
  usage and balance snapshots at 1000 entries each.

See [Security](./security.md) for the cryptographic details and
[Configuration](./configuration.md) for tunables.
