# Deployment

API Vault is a single Node process. You can run it directly, in Docker, or
behind a tunnel/reverse proxy for remote access.

## Local (direct)

```bash
npm install
npm run build
npm run serve   # http://127.0.0.1:3210
```

On Windows you can instead double-click `start-api-vault.bat`.

## Docker

```bash
docker compose up -d --build
```

Open `http://localhost:3210`. The compose file binds the container publicly
(`API_VAULT_DOCKER=1` → `0.0.0.0`) and persists data by mounting the vault
directory:

```yaml
volumes:
  - ./.api-vault:/app/.api-vault
```

So your encrypted vault stays in the project folder and survives restarts.

Docker publishing makes the port reachable, but the server still rejects
non-local `Host` headers by default. To access it as
`http://192.168.1.20:3210`, explicitly set the exact value clients send:

```yaml
environment:
  API_VAULT_ALLOWED_HOSTS: "192.168.1.20:3210,vault.example.com"
```

Restart after changing it. When `API_VAULT_DOCKER=1` and this variable is
unset, startup logs warn that remote requests will receive `403 Forbidden`.

```bash
docker compose logs -f      # logs
docker compose down         # stop
docker compose up -d --build  # rebuild after updates
```

Reset all data:

```bash
docker compose down
rm -rf .api-vault           # PowerShell: Remove-Item -Recurse -Force .\.api-vault
```

> Because the container binds `0.0.0.0`, anything that can reach the host port
> can reach the management UI. Restrict the port, or place auth/HTTPS in front.

## Remote Access

The dashboard and `/api/*` surface should **not** be exposed raw. For letting a
remote app reach the proxy, prefer one of:

1. **Cloudflare Tunnel** — managed from the Local Services page (or `cloudflared`
   directly). No inbound port; gives you an HTTPS hostname.
2. **Tailscale / VPN** — private network access without public exposure.
3. **Reverse proxy** (nginx/Caddy) terminating HTTPS, with auth in front of
   `/api/*` and the dashboard.

In all cases, expose only what you need and use **proxy tokens** (`proxy_…`) for
third-party calls so real provider keys never leave the server. See
[`../REMOTE_ACCESS.md`](../REMOTE_ACCESS.md) for detailed tunnel/reverse-proxy
recipes and [Security](./security.md) for the access-control rationale.

## Cloudflare Tunnel (built in)

The Local Services page can manage a `cloudflared` tunnel. Requires the
`cloudflared` binary on `PATH`. Phases: `idle → starting → running → stopping`
(or `error`). Control it via:

```text
GET  /api/cloudflared/status
POST /api/cloudflared/start    { config: { targetPort, protocol, hostname?, noAutoUpdate? } }
POST /api/cloudflared/stop
GET  /api/cloudflared/logs?limit=200
```

## Using the Proxy from Another App

Local app on the same machine:

```text
http://127.0.0.1:3210/proxy/<providerId>/v1
```

Cloud/remote app (after deploying behind HTTPS):

```text
https://api-vault.example.com/proxy/v1   (with Authorization: Bearer proxy_xxx)
```

`127.0.0.1` will **not** work for a cloud caller — it points at the caller's own
machine. The service must be reachable at a real address.

## Production Notes

- Set a fixed `PORT` and an explicit `BIND_HOST`.
- Set `API_VAULT_ALLOWED_HOSTS` to every trusted hostname/IP (including a
  non-default port) used to reach the service.
- Set `API_VAULT_CORS_ORIGINS` to the exact origins that need browser access.
- Consider lowering `API_VAULT_ADMIN_SESSION_TTL_MS` for shared machines.
- Back up `.api-vault/vault.json` (it's encrypted) if the data matters.
