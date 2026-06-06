# Development

## Stack

- **Language:** TypeScript
- **Frontend:** Next.js (App Router, static export) + React 19
- **Backend:** Node.js built-in `http` server (no web framework)
- **Tests:** Node's built-in test runner (`node --test`)
- **Optional:** Electron desktop wrapper

## Toolchain Layout

Two separate TypeScript projects:

| Config | Scope | Output |
|--------|-------|--------|
| `tsconfig.main.json` | `src/main`, `src/server`, `src/shared`, `src/electron` | `dist-main/` |
| `tsconfig.json` | Next.js landing page (`src/app`) | `.next/` → `out/` |

## Scripts

```bash
npm run build:main      # tsc -> dist-main/
npm run build:renderer  # next build -> out/
npm run build           # both
npm run serve           # run dist-main/server/server.js
npm run dev             # build, then serve
npm run dev:renderer    # next dev against a separately running server
npm run electron        # build, then launch Electron
npm run pack:dir        # build an unpacked Electron app
npm run pack:win        # build artifacts/electron/API Vault <version>.exe
npm test                # build:main, then node --test tests/*.test.cjs
npm start               # build, then serve
```

Electron packages include `dist-main/` inside the application archive and copy
the static frontend to `resources/out/`. Packaged vault data is stored in
Electron's per-user `userData` directory rather than beside the executable.

## Typecheck

```bash
npx tsc --noEmit -p tsconfig.main.json   # backend
npx tsc --noEmit -p tsconfig.json        # Next.js landing page
```

Both must be clean before committing.

## Tests

Tests live in `tests/*.test.cjs` and require the **built** backend
(`dist-main/`), which they `require()` directly. Always `npm run build:main`
first (or just `npm test`, which does it for you).

```bash
npm test
```

When code relies on a process-global singleton (e.g. the auth rate limiter),
tests that assert exact counts must reset that state for isolation — see
`resetAuthLimiter()` used in `tests/server-http.test.cjs`.

## Conventions

- Keep `src/main/*` framework-free so it can be reused by the server and the
  Electron wrapper.
- Validate input at system boundaries (request handlers, store mutations).
- Keep files focused; prefer small modules over large ones.
- Never log or commit secrets. Mask keys in any user-facing output.
- Errors thrown from handlers should be `AppError` (or mapped via `toAppError`)
  so they carry a status code and a stable machine-readable `code`.

## Adding an API Endpoint

1. Add the route to `src/server/routes/apiRoutes.ts` (place it relative to the
   `requireAdminSession` line depending on whether it needs auth).
2. Implement the operation on `VaultStore` (`src/main/store.ts`) so persistence
   and encryption stay centralized.
3. Add the matching management-console request in `public/vault/b2/src/api.js`.
4. Add a test in `tests/`.

## Project Structure Reference

See [Architecture](./architecture.md) for the full source-tree map and the
runtime request flow.

## Pre-Commit Checklist

- [ ] `npx tsc --noEmit` clean for both projects
- [ ] `npm test` passes
- [ ] No secrets, `.env`, or `.api-vault/` staged
- [ ] New env vars documented in [Configuration](./configuration.md)
- [ ] New endpoints documented in [API Reference](./api-reference.md)
