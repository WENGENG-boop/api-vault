# Refactor Report

## Stack

Next.js 16 App Router + React 19 for the unified web frontend, Electron for the desktop shell, and the existing Node HTTP + TypeScript backend for API/proxy/storage behavior.

## Changes Made

### Frontend Structure

- Replaced the Vite renderer entry with a Next.js App Router structure.
- Added `/` as the Next-hosted website page using the existing `website/index.html`, `website/styles.css`, and `website/app.js` output.
- Added `/vault` as the Next-hosted management console using the existing React UI from `src/renderer/app/App.tsx`.
- Moved website browser assets into `public/website/` so Next static export can serve them unchanged.

### Electron

- Added `src/electron/main.ts`.
- Electron starts or reuses the local API Vault server and opens the shared `/vault` frontend.
- Added `npm run electron` for local desktop launch.

### Server and Build

- Changed renderer build from `vite build` to `next build`.
- Changed static frontend serving from `dist/` to Next export output `out/`.
- Updated static asset routing so `/vault`, `/vault/`, and exported nested route directories resolve to their `index.html`.
- Updated Docker build inputs and output copy paths for Next.js.
- Removed the old Vite root `index.html` and `vite.config.ts`.

### Type Compatibility Fixes

- Guarded `window`/`localStorage` access for Next client-component compatibility.
- Fixed a stale analytics barrel export.
- Narrowed the Cloudflared success/failure response branch before reading `message`.

### Security Fixes

| Issue | File | Fix Applied |
|---|---|---|
| Hardcoded secrets | N/A | No hardcoded real secrets were introduced or found in the migration path. |
| Browser globals during server render | `src/renderer/shared/api/apiClient.ts`, `src/renderer/app/AppShell.tsx` | Added runtime guards so Next build/server evaluation does not execute browser-only APIs. |
| Dependency vulnerabilities | `package-lock.json` | `npm audit --audit-level=high` reports 0 high/critical vulnerabilities. Two moderate advisories remain in the Next.js dependency tree. |

### File Structure Changes

```text
src/
  app/
    layout.tsx
    page.tsx
    vault/page.tsx
  electron/
    main.ts
  renderer/
    app/
    features/
    shared/
  server/
  main/
public/
  website/
```

### Dependencies Removed

- Removed Vite and `@vitejs/plugin-react`.

### Dependencies Added

- Added Next.js.
- Added Electron.

## What Was NOT Changed

- Existing management console components, CSS class names, and visual layout were preserved.
- Existing website HTML/CSS/JS was reused to preserve the current website UI.
- Existing HTTP API route signatures were preserved.
- Vault storage format, encryption behavior, and proxy behavior were not changed.

## Verification

- `npm run build` passed.
- `npm test` passed: 40 tests, 40 passing.
- Browser verification passed on a temporary port:
  - `/` rendered the website hero, nav, and sandbox controls.
  - `/vault` rendered the existing vault unlock screen.
  - Browser console showed no errors on either page.
- `npm audit --audit-level=high` passed with 0 high/critical vulnerabilities.

## Recommended Next Steps

- [ ] Decide whether to package Electron with `electron-builder` or keep `npm run electron` as a development launcher.
- [ ] Convert the website HTML into first-class React components later if you want component-level editing; the current version prioritizes unchanged UI.
- [ ] Address the moderate Next.js dependency audit advisories when a non-breaking patched Next release is available.
