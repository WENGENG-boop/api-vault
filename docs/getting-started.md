# Getting Started

## Prerequisites

- **Node.js** LTS (18+) and npm — <https://nodejs.org/en/download/>
- Optionally **Docker** for containerized runs

## Install

```bash
npm install
```

## Build

The build has two stages, wired together by `npm run build`:

```bash
npm run build
```

- `build:main` — compiles the Node server and core logic with `tsc`
  (`tsconfig.main.json`) into `dist-main/`.
- `build:renderer` — runs `next build`, producing a static export in `out/`.

You can run them individually:

```bash
npm run build:main      # backend only
npm run build:renderer  # frontend only
```

## Run

```bash
npm run serve
```

This starts the compiled server (`dist-main/server/server.js`). By default it:

- listens on `http://127.0.0.1:3210`
- serves the dashboard at `/vault`
- serves the marketing/landing page at `/`
- opens your browser automatically (disable with `API_VAULT_NO_OPEN=1`)

`npm start` and `npm run dev` both build first and then serve.

## First-Time Setup

1. Open `http://127.0.0.1:3210/vault`.
2. Set a **master password** (minimum 8 characters). This derives the
   encryption key for your vault — there is no recovery if you lose it.
3. Add a **provider** and its original upstream base URL, e.g.:
   - `https://api.openai.com/v1`
   - `https://api.anthropic.com`
   - `https://openrouter.ai/api/v1`
4. Add your real **API key** under that provider.
5. Copy the **API Vault Base URL** shown on the provider card, e.g.
   `http://127.0.0.1:3210/proxy/<providerId>/v1`.
6. Paste that URL into the third-party app's "Base URL" field. Keep using your
   real API key in that app — API Vault uses it to match the correct stored key.

After this, every call the third-party app makes appears in the dashboard.

## Windows Double-Click

Double-click `start-api-vault.bat`. It checks for Node/npm, installs
dependencies, builds, starts the server on port 3210, and opens the browser.

## Verify Your Install

```bash
npm test
```

Runs `build:main` and the Node test suite (`tests/*.test.cjs`). All tests
should pass.

## Where Data Lives

Your vault is created on first setup at:

```text
.api-vault/vault.json
```

It holds encrypted provider/key data and local usage records. It is excluded
from Git by `.gitignore` and must never be committed. See
[Configuration](./configuration.md#data-storage) for details.
