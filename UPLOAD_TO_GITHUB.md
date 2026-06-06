# Upload To GitHub

Repository:

```text
https://github.com/WENGENG-boop/api-vault
```

Open PowerShell in this folder:

```powershell
cd C:\Users\eason\Desktop\项目\api-vault-github
```

Then run:

```powershell
git status --short
git add -A
git diff --cached --name-only
git diff --cached
git commit -m "Update API Vault"
git push
```

Review the staged file list and diff before committing. Never commit `.api-vault/`,
`.env*`, local databases, certificates, credentials, or local tool settings.

If GitHub authentication has expired, run:

```powershell
gh auth login -h github.com
```

## What This Folder Contains

This folder is the clean GitHub release copy. It includes source code, Docker files, startup scripts, tests, and documentation.

It does not include:

```text
.api-vault/
node_modules/
dist/
dist-main/
tools/
.claude/
.codex/
.agents/
.env*
*.db
*.sqlite*
*.pem
*.key
*.log
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
