# API Vault

[中文说明](README.zh-CN.md)
https://github.com/user-attachments/assets/6177b8bd-7224-4616-b868-cac45d7ffc14
A self-hosted API key management dashboard with built-in reverse proxy, usage tracking, and balance sync. Manage multiple AI providers and API keys from one local interface.

## Why

If you use multiple AI API providers (OpenAI, Anthropic, DeepSeek, OpenRouter, etc.) and juggle many keys across different tools, API Vault gives you:

- One place to manage all providers and keys
- Automatic usage tracking (tokens, cost, latency, errors) for every call
- A unified proxy URL you paste into any OpenAI-compatible tool
- Balance and quota sync from provider billing APIs
- Proxy Tokens for safe remote access without exposing real keys

## How It Works

```
Your AI tool  →  API Vault proxy  →  Real provider API
                      ↓
              Records usage data
```

Instead of putting `https://api.openai.com/v1` directly in your tools, you use the API Vault proxy URL:

```
http://127.0.0.1:3210/proxy/<providerId>/v1
```

API Vault injects the real key, forwards the request, records the result, and returns the response.

## Features

- **Dashboard** — overview of total calls, tokens, cost, success rate
- **Providers** — add/manage providers with multiple keys each, auto-grouped by base URL
- **Usage** — full call history with model, tokens, latency, status, error details
- **Analytics** — model token leaderboard and usage breakdown
- **Billing** — custom balance/usage sync via configurable JSON-path rules
- **Models** — model catalog with auto-sync from provider `/models` endpoint
- **Proxy Tokens** — generate scoped tokens for remote access with rate limits, model mapping, and expiration
- **Account Pools** — CPA connector for bulk account management
- **Local Services** — manage local AI services with health checks
- **Cloudflared Tunnel** — one-click public tunnel via Cloudflare

### Protocol Support

- OpenAI-compatible (`/v1/chat/completions`, `/v1/models`)
- Anthropic-compatible (`/v1/messages`)

### Security

- Master password encryption for all vault data
- API keys masked in UI, decrypted only for proxying
- Admin session tokens for management, separate proxy tokens for external calls
- Vault file excluded from git by default

## Quick Start

### Docker (recommended)

```bash
docker compose up -d --build
```

Open http://localhost:3210

### Windows

Double-click `start-api-vault.bat` (requires [Node.js LTS](https://nodejs.org/))

### Manual

```bash
npm install
npm run build
npm run serve
```

## First-Time Setup

1. Open http://127.0.0.1:3210
2. Set a master password
3. Add a provider (e.g. `https://api.openai.com/v1`) and your API key
4. Copy the **API Vault Base URL** from the provider card
5. Paste it into your AI tool's Base URL field
6. Calls now flow through API Vault and appear in the dashboard

## Remote Access

For CI, scripts, or other machines, create a **Proxy Token** instead of exposing real keys:

```bash
curl http://YOUR_HOST/proxy/v1/chat/completions \
  -H "Authorization: Bearer proxy_xxx" \
  -H "Content-Type: application/json" \
  -d '{"model":"gpt-4o","messages":[{"role":"user","content":"hello"}]}'
```

See [REMOTE_ACCESS.md](./REMOTE_ACCESS.md) for Cloudflare Tunnel, Tailscale, and reverse proxy setup.

## Tech Stack

- Node.js + TypeScript
- React + Vite (browser UI)
- Pure Node.js HTTP server (no Express)
- Docker

This is a local browser app, not an Electron desktop app.

## Project Structure

```
src/
  main/       Core logic: vault, proxy, balance, usage, crypto
  renderer/   React frontend
  server/     HTTP server, routes, middlewares
  shared/     Shared TypeScript types
tests/        Node.js test suite
```

## Data Storage

All data is stored locally in `.api-vault/vault.json` (encrypted). Docker mounts this as a volume for persistence.

## Development

```bash
npm run dev          # Build and start server
npm run dev:renderer # Vite dev server for frontend
npm test             # Run tests
```

## Limitations

- Only tracks requests that pass through the proxy
- Provider balance APIs vary; some need manual JSON-path config
- Cloud tools can't reach local `127.0.0.1` — deploy on a server or use a tunnel
- Single-user local tool; no built-in team sharing or cloud sync

## License

MIT
