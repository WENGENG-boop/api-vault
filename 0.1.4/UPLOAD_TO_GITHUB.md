# Upload To GitHub

Repository:

```text
https://github.com/WENGENG-boop/api-vault
```

Open PowerShell in this folder, then run:

```powershell
git init
git branch -M main
git add .
git commit -m "Initial API Vault release"
git remote add origin https://github.com/WENGENG-boop/api-vault.git
git push -u origin main
```

If Git asks you to sign in, follow the browser login prompt from Git Credential Manager.

## What This Folder Contains

This folder is the clean GitHub release copy. It includes source code, Docker files, startup scripts, tests, and documentation.

It does not include:

```text
.api-vault/
.claude/
node_modules/
dist/
dist-main/
tools/
*.log
.env
.env.*
```

## After Upload

Users can clone the repository and start with Docker:

```bash
docker compose up -d --build
```

Or on Windows:

```text
start-api-vault.bat
```
