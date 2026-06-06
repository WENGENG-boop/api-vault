# API Reference

There are two surfaces: the **Management API** (`/api/*`, used by the dashboard)
and the **Proxy Gateway** (`/proxy/*`, called by third-party apps). All examples
assume the default `http://127.0.0.1:3210`.

---

## Authentication

### Management API

- `POST /api/vault/setup` and `POST /api/vault/unlock` are **unauthenticated**
  but rate-limited per client IP (see [Security](./security.md)). Setup is
  additionally restricted to loopback network peers unless the request sends
  the startup token in `x-api-vault-bootstrap`. On success
  they return the app state **plus an `adminToken`**.
- Every other `/api/*` endpoint requires that token in a header:

  ```http
  x-api-vault-admin: admin_<token>
  ```

- `GET /api/state` works either way: with a valid admin token it returns the
  full state; otherwise it returns a reduced public state.

### Proxy Gateway

- Token routes (`/proxy/v1`, and `/proxy/:id` with a `proxy_` bearer) require a
  **proxy token**: `Authorization: Bearer proxy_<secret>`.
- Provider routes (`/proxy/openai`, `/proxy/anthropic`, `/proxy/auto`,
  `/proxy/by-key`, `/proxy/:id`) require a **registered provider API key** as the
  bearer/`x-api-key`. API Vault matches it to a stored key and swaps in the real
  upstream key.

---

## Management API

### Vault lifecycle

| Method | Path | Auth | Body | Notes |
|--------|------|------|------|-------|
| `GET` | `/api/state` | optional | — | Full state with admin token, else public state. |
| `POST` | `/api/vault/setup` | rate-limited; loopback or bootstrap header | `{ password }` | Initialize a new vault. Returns `adminToken`. |
| `POST` | `/api/vault/unlock` | rate-limited | `{ password }` | Unlock. Returns `adminToken`. |
| `POST` | `/api/vault/lock` | admin | — | Lock the vault and revoke the session. |

### Providers & keys

| Method | Path | Body / Query |
|--------|------|--------------|
| `POST` | `/api/providers` | `ProviderInput` (optionally `apiKey`, `keyName`, `queryKey`) |
| `POST` | `/api/providers/add-key` | `AddKeyInput` (auto-merges by host when no `providerId`) |
| `POST` | `/api/providers/:id/keys` | `ApiKeyInput` |
| `DELETE` | `/api/providers/:id/keys/:keyId` | — |
| `GET` | `/api/providers/:id/keys/:keyId/secret` | `?kind=api\|query` |
| `GET` | `/api/providers/:id/keys/:keyId/proxy-url` | — |
| `GET` | `/api/providers/:id/secret` | `?kind=api\|query` (first key) |
| `GET` | `/api/providers/:id/proxy-url` | — |
| `DELETE` | `/api/providers/:id` | — |
| `POST` | `/api/providers/:id/test-balance` | — |

### Proxy tokens

| Method | Path | Body |
|--------|------|------|
| `POST` | `/api/proxy-tokens` | `ProxyTokenInput` — returns `{ secret, token, state }` |
| `POST` | `/api/proxy-tokens/:id` | `ProxyTokenInput` (update) |
| `DELETE` | `/api/proxy-tokens/:id` | — |
| `GET` | `/api/proxy-tokens/:id/secret` | returns `{ secret }` |
| `POST` | `/api/proxy-tokens/:id/secret` | `{ secret }` (set an explicit secret) |
| `POST` | `/api/proxy-tokens/:id/regenerate` | returns a new `{ secret, token, state }` |

### Model catalog

| Method | Path | Body |
|--------|------|------|
| `GET` | `/api/model-catalog` | — |
| `POST` | `/api/model-catalog/manual` | `ProviderModelInput` |
| `POST` | `/api/model-catalog/sync-provider/:id` | — |
| `POST` | `/api/model-catalog/:id` | `ProviderModelInput` (upsert by id) |
| `DELETE` | `/api/model-catalog/:id` | — |

### Account pools

| Method | Path | Body |
|--------|------|------|
| `GET` | `/api/account-pools` | — |
| `POST` | `/api/account-pools` | `AccountPoolInput & { createProvider? }` |
| `DELETE` | `/api/account-pools/:id` | — |
| `POST` | `/api/account-pools/:id/create-provider` | — |
| `POST` | `/api/account-pools/:id/test` | — |
| `POST` | `/api/account-pools/:id/sync-models` | — |
| `POST` | `/api/account-pools/:id/import-models-to-proxy-token` | `{ proxyTokenId, modelNames? }` |
| `POST` | `/api/account-pools/:id/upload-auth` | `{ fileName, content }` |

### Local services

| Method | Path | Body |
|--------|------|------|
| `GET` | `/api/local-services` | — |
| `POST` | `/api/local-services` | `{ name, baseUrl, apiKey?, ... }` |
| `DELETE` | `/api/local-services/:id` | — |
| `POST` | `/api/local-services/:id/test` | — |

### Connectivity & Cloudflare Tunnel

| Method | Path | Body / Query |
|--------|------|--------------|
| `POST` | `/api/test-url` | `{ baseUrl, protocol?, providerId?, isLocal?, apiKey? }` |
| `GET` | `/api/cloudflared/status` | — |
| `POST` | `/api/cloudflared/start` | `{ config? }` — `targetPort`, `protocol`, `hostname?`, `noAutoUpdate?` |
| `POST` | `/api/cloudflared/stop` | — |
| `GET` | `/api/cloudflared/logs` | `?limit=200` |

Cloudflared error codes: `MISSING_BINARY`, `START_TIMEOUT`,
`TUNNEL_URL_NOT_FOUND`, `PROCESS_EXITED`, `PROCESS_ERROR`, `MANAGER_UNAVAILABLE`.

---

## Proxy Gateway

| Route | Auth | Purpose |
|-------|------|---------|
| `/proxy/v1/*` | proxy token | Public multi-provider gateway; routing decided by model + token rules. |
| `/proxy/openai/v1/*` | provider key | Force OpenAI-compatible forwarding. |
| `/proxy/anthropic/*` | provider key | Force Anthropic-compatible forwarding. |
| `/proxy/auto/v1/*` | provider key | Infer protocol from the request. |
| `/proxy/by-key/*` | provider key | Resolve provider purely from the incoming key. |
| `/proxy/:providerId/*` | provider key **or** proxy token | Provider-scoped gateway. |
| `/proxy/local/:id/*` | loopback only* | Forward to a configured local service. |

\* Local-service proxy is restricted to loopback clients unless
`API_VAULT_ALLOW_REMOTE_LOCAL_PROXY=1`.

### Model listing

`GET /proxy/v1/models` with a proxy token returns an OpenAI-style list of the
public model names that token is allowed to use:

```bash
curl http://127.0.0.1:3210/proxy/v1/models \
  -H "Authorization: Bearer proxy_xxx"
```

### Chat completion (example)

```bash
curl http://127.0.0.1:3210/proxy/v1/chat/completions \
  -H "Authorization: Bearer proxy_xxx" \
  -H "content-type: application/json" \
  -d '{"model":"<public-model>","messages":[{"role":"user","content":"hi"}]}'
```

API Vault validates the token, applies model/provider permissions and rate
limits, injects the real provider key, forwards upstream, and records usage.

### Rate limiting

Proxy tokens carry `requestsPerMinute` and `requestsPerDay` limits. Exceeding
either returns `429` with code `rate_limited`.

---

## Error Shape

Errors are JSON with a stable machine-readable `code`:

```json
{ "error": "Missing or invalid admin session", "code": "admin_session_required" }
```

Common codes: `vault_initialized`, `admin_session_required`,
`auth_rate_limited`, `proxy_token_required`, `proxy_token_disabled`,
`proxy_token_expired`, `rate_limited`, `missing_api_key`, `api_key_not_found`,
`provider_not_found`, `proxy_timeout`, `upstream_error`, `local_proxy_forbidden`.
