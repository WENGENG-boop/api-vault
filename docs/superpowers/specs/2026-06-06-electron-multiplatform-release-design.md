# Electron Multi-Platform Release Design

## Goal

Build unsigned API Vault desktop artifacts on the matching GitHub-hosted
operating systems:

- Windows x64 portable `.exe`
- macOS x64 and arm64 `.dmg`
- Linux x64 `.AppImage`

## Packaging

A single `scripts/package-electron.mjs` entry point selects the electron-builder
target and architecture, builds into a temporary directory, and copies only the
distributable artifact into `artifacts/electron/<platform>-<arch>/`.

The checked-in package metadata defines deterministic artifact names and keeps
code signing disabled until signing credentials are configured.

## Automation

`.github/workflows/electron-release.yml` runs a platform matrix on manual
dispatch and on tags matching `v*`. Every run uploads build artifacts. Tag runs
also create a GitHub Release and attach all generated packages.
