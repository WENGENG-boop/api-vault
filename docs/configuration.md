# Configuration

All configuration is via environment variables. There is no config file —
runtime behavior is controlled by the variables below, read at process start.

## Network & Server

| Variable | Default | Effect |
|----------|---------|--------|
| `PORT` | `3210` | Port the public server listens on. |
| `BIND_HOST` | `127.0.0.1` | Interface to bind. Overrides `HOST`. |
| `HOST` | `127.0.0.1` | Fallback bind interface if `BIND_HOST` unset. |
| `API_VAULT_DOCKER` | _(unset)_ | When `1`, the default bind becomes `0.0.0.0` (so the container is reachable). Explicit `BIND_HOST`/`HOST` still win. |
| `API_VAULT_CORS_ORIGINS` | _(unset)_ | Comma-separated origin allowlist. When set, only these origins get CORS headers. When unset, only the local host and `localhost`/`127.0.0.1` on `PORT` are allowed. |
| `API_VAULT_NO_OPEN` | _(unset)_ | When `1`, do **not** auto-open the browser on startup. |

> **Binding to `0.0.0.0` exposes the management UI to the network.** Always put
> HTTPS, access control, or a private tunnel in front of it. The server logs a
> warning when it binds publicly. See [Security](./security.md).

## Sessions & Limits

| Variable | Default | Effect |
|----------|---------|--------|
| `API_VAULT_ADMIN_SESSION_TTL_MS` | `43200000` (12h) | Lifetime of an admin session token issued on unlock/setup. |
| `API_VAULT_PROXY_TIMEOUT_MS` | `300000` (5min) | Upstream request timeout for proxied calls. |
| `API_VAULT_MAX_BODY_BYTES` | `5000000` (5 MB) | Max request body size for the `/proxy` gateway. |

The management API (`/api/*`) enforces a separate fixed JSON body limit of
**2 MB**.

## Proxy Behavior

| Variable | Default | Effect |
|----------|---------|--------|
| `API_VAULT_ALLOW_REMOTE_LOCAL_PROXY` | _(unset)_ | When `1`, allow non-loopback clients to use the **local-service** proxy (`/proxy/local/*`). Off by default so stored local-service keys are not relayed to the network when bound to `0.0.0.0`. |
| `API_VAULT_ALLOW_PROVIDER_PROXY_WITHOUT_KEY` | _(unset)_ | When `1`, allow `/proxy/:providerId` requests that carry **no** incoming API key to use the provider's first stored key. Off by default — normally an incoming key must match a stored one. |

## Multimodal (image handling)

| Variable | Default | Effect |
|----------|---------|--------|
| `API_VAULT_MAX_IMAGE_BYTES` | `20971520` (20 MB) | Max size of an image fetched/inlined during protocol conversion. |
| `API_VAULT_IMAGE_FETCH_TIMEOUT_MS` | `15000` (15s) | Timeout when fetching a remote image referenced in a request. |

## Frontend (build time)

| Variable | Default | Effect |
|----------|---------|--------|
| `NEXT_PUBLIC_API_BASE_URL` | _(unset)_ | Base URL the dashboard prefixes onto API calls. Unset means same-origin (the normal self-hosted case). Used by `next dev` to point the renderer at a separately running server. Inlined at build time. |

## Electron (optional desktop wrapper)

| Variable | Default | Effect |
|----------|---------|--------|
| `API_VAULT_ELECTRON_DEV_URL` | _(unset)_ | If set, the Electron window loads this URL (dev mode) instead of the packaged build. |
| `API_VAULT_ELECTRON_FILE` | _(unset)_ | Overrides the packaged HTML file path the Electron window loads. |

## Data Storage

The vault file path is derived from the working directory:

```text
<cwd>/.api-vault/vault.json
```

- Created on first setup; contains **encrypted** provider/key data plus local
  usage records.
- Excluded from Git via `.gitignore`. **Never commit it.**
- To reset all local data, stop the app and delete the `.api-vault/` directory.

Static assets are served from `<cwd>/out` (the Next.js export). If you run the
server from a different working directory, both the vault and the static assets
resolve relative to that directory.
