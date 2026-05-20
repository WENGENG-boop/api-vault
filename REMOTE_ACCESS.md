# Remote Access and Public Proxy

API Vault now has a safer remote-call path for CI, another computer, or a private tunnel:

```text
http://127.0.0.1:3210/proxy/v1/chat/completions
http://127.0.0.1:3210/proxy/v1/models
```

External clients must send API Vault's own Proxy Token:

```bash
curl http://YOUR_PUBLIC_HOST/proxy/v1/chat/completions \
  -H "Authorization: Bearer proxy_xxx" \
  -H "Content-Type: application/json" \
  -d '{"model":"public-model-name","messages":[{"role":"user","content":"hello"}]}'
```

The `proxy_xxx` token is not a real provider API key. API Vault validates it, checks provider/model permissions and rate limits, maps the public model name to a real provider model, injects the encrypted provider key internally, forwards the request, and records usage.

## Safe Setup

1. Open API Vault locally.
2. Add providers and real provider API keys.
3. Open `Proxy Tokens`.
4. Create a token with:
   - allowed providers
   - allowed model mappings
   - stream permission
   - requests per minute
   - requests per day
   - optional expiration
5. Copy the generated `proxy_xxx` token immediately. It is shown once.

## Bind Host

By default API Vault listens only on localhost:

```bash
BIND_HOST=127.0.0.1
```

Only set this when you intentionally place API Vault behind a private network or reverse proxy:

```bash
BIND_HOST=0.0.0.0
```

If `BIND_HOST=0.0.0.0`, do not expose the management UI directly to the public internet. Put HTTPS and access control in front of it.

## Recommended Exposure Options

### Tailscale

Use Tailscale when you only need access from your own devices or a small private team. Keep API Vault bound to `127.0.0.1` or expose it only inside the tailnet.

### Cloudflare Tunnel

Use Cloudflare Tunnel for a public HTTPS URL. Protect the management UI with Cloudflare Access. Only `/proxy/v1/*` should be reachable by normal API clients, and those calls still require `Authorization: Bearer proxy_xxx`.

### Reverse Proxy

Use nginx, Caddy, or Traefik for HTTPS. Recommended policy:

- Allow `/proxy/v1/*` with normal HTTPS access.
- Require extra authentication for `/` and `/api/*`.
- Set a request body size limit.
- Keep `API_VAULT_CORS_ORIGINS` empty unless browser clients need CORS.

## Security Notes

- Real provider API keys are encrypted in the vault.
- Logs store masked key metadata only, not full provider keys.
- Public proxy errors are sanitized.
- Proxy tokens can be disabled, deleted, or regenerated.
- Rate limits are enforced per proxy token in the running process.


## Cloudflared Troubleshooting

- Install binary: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/
- Start tunnel from UI Local Services page.
- Stop tunnel from UI before changing port/protocol settings.
- If missingBinary=true: confirm cloudflared --version works in your shell.
- If TUNNEL_URL_NOT_FOUND: check cloudflared logs in /api/cloudflared/logs and verify local target port is reachable.
- If START_TIMEOUT: check firewall/proxy rules and confirm local service is listening.
- If port is occupied: update target port to an available local port and restart tunnel.

