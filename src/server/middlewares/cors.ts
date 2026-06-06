import type { IncomingMessage, ServerResponse } from "node:http";
import { DEFAULT_PORT } from "../config/serverConfig";

export function applyCors(req: IncomingMessage, res: ServerResponse): boolean {
  const origin = req.headers.origin;
  if (origin && isAllowedOrigin(origin, req.headers.host)) {
    res.setHeader("access-control-allow-origin", origin);
    res.setHeader("access-control-allow-methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
    res.setHeader("access-control-allow-headers", "content-type, x-api-vault-admin, x-api-vault-bootstrap, authorization");
  }

  if (req.method !== "OPTIONS") return false;
  res.writeHead(204);
  res.end();
  return true;
}

export function isAllowedHost(hostHeader?: string): boolean {
  const configured = configuredHosts();
  if (configured.length > 0) return hostHeader ? configured.includes(normalizeHost(hostHeader)) : false;
  const hostname = hostName(hostHeader);
  return isLocalHostname(hostname);
}

function isAllowedOrigin(origin: string, hostHeader?: string): boolean {
  const configured = (process.env.API_VAULT_CORS_ORIGINS || "").split(",").map((item) => item.trim()).filter(Boolean);
  if (configured.length > 0) return configured.includes(origin);
  try {
    const url = new URL(origin);
    if (!/^https?:$/.test(url.protocol)) return false;
    if (!isLocalHostname(url.hostname)) return false;
    const requestPort = hostPort(hostHeader) || String(DEFAULT_PORT);
    const originPort = url.port || (url.protocol === "https:" ? "443" : "80");
    return originPort === requestPort || originPort === String(DEFAULT_PORT);
  } catch {
    return false;
  }
}

function configuredHosts(): string[] {
  return (process.env.API_VAULT_ALLOWED_HOSTS || "")
    .split(",")
    .map((item) => normalizeHost(item))
    .filter(Boolean);
}

function normalizeHost(value: string): string {
  return value.trim().toLowerCase().replace(/\.$/, "");
}

function hostName(hostHeader?: string): string {
  const host = normalizeHost(hostHeader || "");
  if (!host) return "";
  if (host.startsWith("[")) return host.slice(1, host.indexOf("]"));
  return host.split(":")[0];
}

function hostPort(hostHeader?: string): string {
  const host = normalizeHost(hostHeader || "");
  if (!host) return "";
  if (host.startsWith("[")) {
    const rest = host.slice(host.indexOf("]") + 1);
    return rest.startsWith(":") ? rest.slice(1) : "";
  }
  const parts = host.split(":");
  return parts.length > 1 ? parts[parts.length - 1] : "";
}

function isLocalHostname(hostname: string): boolean {
  const host = normalizeHost(hostname);
  return host === "localhost" || host === "127.0.0.1" || host === "::1";
}
