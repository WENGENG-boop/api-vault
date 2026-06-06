# Security

API Vault stores real provider API keys, so its security model matters. This
document describes how secrets are protected and what the trust boundaries are.

## Threat Model & Intended Deployment

API Vault is **local-first**. The default bind is `127.0.0.1`, meaning only the
local machine can reach it. In that mode the trust boundary is the OS user
account.

When you expose it (Docker `0.0.0.0`, a tunnel, or a reverse proxy), the network
becomes part of the threat model. **Do not expose the management UI to the
internet without HTTPS plus an additional access-control layer.** The server
prints a warning when it binds publicly.

## Encryption at Rest

- **Cipher:** AES-256-GCM (authenticated). Each secret has its own random
  12-byte IV and an auth tag; tampering fails decryption.
- **Key derivation:** scrypt over the master password with a random 16-byte
  salt. Current parameters: `N=65536, r=8, p=1, maxmem=128 MB`. Older vaults
  using `N=16384` are still readable (parameters are stored in the vault header)
  and upgraded opportunistically.
- **Master password:** minimum 8 characters. The derived key lives **in memory
  only while unlocked** and is dropped on lock. There is no recovery — losing
  the password means losing the data.
- **Verifier:** the vault header stores an encrypted known string so a wrong
  password is detected immediately on unlock.

Secrets encrypted this way include provider API keys, query keys, and proxy
token secrets. The plaintext file is written atomically (temp file + rename).

## Key Hashing & Masking

- Incoming provider keys are matched via an HMAC-SHA-256 (`hashApiKey`) keyed by
  the master key, so lookups don't require decrypting every stored key.
- Proxy token secrets are stored as SHA-256 hashes for lookup; the plaintext is
  also kept encrypted so it can be revealed in the UI on demand.
- Keys are **masked** in all list/state responses (e.g. `sk-****1234`). Full
  plaintext is only returned by explicit `…/secret` endpoints (admin only).

## Authentication

### Admin sessions (management API)

- First-time setup is accepted directly from a loopback network peer. Remote
  setup requires the random one-time bootstrap token printed at startup, so a
  network client cannot claim an uninitialized vault without console access.
- Setup/unlock issue an `admin_<random>` token (32 random bytes, base64url).
- Only the SHA-256 hash is stored server-side, with a 12-hour TTL
  (`API_VAULT_ADMIN_SESSION_TTL_MS`). Validation looks up that hash in the
  process-local session map.
- Lock revokes the current session.

### Proxy authentication

- **Proxy tokens** (`proxy_…`) gate the public gateway and carry per-token
  model/provider allowlists, enable/disable, expiry, and rate limits.
- **Provider keys** gate provider/global routes: the caller presents a key that
  must match a stored one; API Vault forwards using the real key.

## Brute-Force Protection

`setup` and `unlock` are rate-limited to 12 attempts per minute **per client
IP**. By default the limiter keys on the network peer address only, not the
client-controlled `Host` or forwarding headers. When a trusted final proxy
overwrites or sanitizes `X-Forwarded-For`, set `API_VAULT_TRUST_PROXY=1` to use
its rightmost non-empty value. Successful unlocks do not consume the failure
quota.

## Header Hygiene on Proxying

When forwarding upstream, API Vault:

- strips hop-by-hop headers (`connection`, `transfer-encoding`, etc.);
- strips inbound credential headers (`authorization`, `x-api-key`, `api-key`,
  `x-provider-api-key`, `cookie`, `proxy-*`) so the client's placeholder key is
  never leaked upstream;
- injects the correct real credential for the target protocol.

## Local-Service Proxy Gate

`/proxy/local/*` injects stored local-service keys without a proxy token, so by
default it only accepts **loopback** clients. To use it from another host set
`API_VAULT_ALLOW_REMOTE_LOCAL_PROXY=1` — only do this behind your own access
control.

## Path Traversal

Static file serving resolves requests against the export directory and rejects
any path that escapes it (`..` / absolute paths), falling back to the SPA shell.
Account-pool auth-file uploads sanitize the filename and confirm the resolved
path stays inside the configured directory.

## Server-Side Request Forwarding (SSRF note)

Endpoints like `/api/test-url` and the proxy fetch arbitrary upstream URLs **by
design** (you configure the providers). These are admin-authenticated. Treat the
admin session as fully trusted, and don't run API Vault as a network egress
point for untrusted users.

## Operational Checklist

- [ ] Keep the bind on `127.0.0.1` unless you have a reason not to.
- [ ] If exposed, front it with HTTPS + auth (reverse proxy, tunnel, or VPN).
- [ ] Use **proxy tokens**, never raw provider keys, for remote/third-party use.
- [ ] Never commit `.api-vault/` or `.env`.
- [ ] Use a strong, unique master password.
