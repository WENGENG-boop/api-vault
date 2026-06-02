# API Vault Documentation

API Vault is a local-first dashboard and proxy for managing multiple AI API
providers, API keys, proxy tokens, and usage records. It sits between your
tools and upstream providers, injecting the real key, forwarding the request,
and recording every call.

This folder is the technical documentation. For a product-level overview, see
the top-level [`../README.md`](../README.md).

## Table of Contents

| Document | What it covers |
|----------|----------------|
| [Getting Started](./getting-started.md) | Install, build, run, and first-time setup |
| [Architecture](./architecture.md) | Modules, processes, and the request/response flow |
| [Configuration](./configuration.md) | Every environment variable, port, and data path |
| [API Reference](./api-reference.md) | Management REST API and the proxy gateway API |
| [Latency Monitoring](./latency-monitoring.md) | The Status page's hourly latency view (provider probe + model calls) |
| [Security](./security.md) | Encryption, authentication, rate limiting, threat model |
| [Deployment](./deployment.md) | Docker, remote access, and Cloudflare Tunnel |
| [Development](./development.md) | Build pipeline, tests, project layout, contributing |

## At a Glance

- **Default URL:** `http://127.0.0.1:3210/vault`
- **Frontend:** Next.js (static export) + React 19
- **Backend:** Node.js HTTP server (no framework), TypeScript
- **Storage:** single encrypted file at `.api-vault/vault.json` (AES-256-GCM)
- **Binding:** loopback (`127.0.0.1`) by default; `0.0.0.0` in Docker

## Two Kinds of Endpoints

API Vault exposes two distinct surfaces. Keep them separate when reasoning
about access control:

1. **Management API** (`/api/*`) — drives the dashboard. Protected by an
   **admin session** obtained from the master password.
2. **Proxy gateway** (`/proxy/*`) — what third-party apps call. Protected by
   either a registered provider **API key** or a **proxy token** (`proxy_…`).

See [API Reference](./api-reference.md) and [Security](./security.md) for the
full details.
