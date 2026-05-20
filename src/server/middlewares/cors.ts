import type { IncomingMessage, ServerResponse } from "node:http";
import { DEFAULT_PORT } from "../config/serverConfig";

export function applyCors(req: IncomingMessage, res: ServerResponse): boolean {
  const origin = req.headers.origin;
  if (origin && isAllowedOrigin(origin, req.headers.host)) {
    res.setHeader("access-control-allow-origin", origin);
    res.setHeader("access-control-allow-methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
    res.setHeader("access-control-allow-headers", "content-type, x-api-vault-admin, authorization");
  }

  if (req.method !== "OPTIONS") return false;
  res.writeHead(204);
  res.end();
  return true;
}

function isAllowedOrigin(origin: string, hostHeader?: string): boolean {
  const configured = (process.env.API_VAULT_CORS_ORIGINS || "").split(",").map((item) => item.trim()).filter(Boolean);
  if (configured.length > 0) return configured.includes(origin);
  const host = hostHeader ?? `127.0.0.1:${DEFAULT_PORT}`;
  return origin === `http://${host}` || origin === `http://127.0.0.1:${DEFAULT_PORT}` || origin === `http://localhost:${DEFAULT_PORT}`;
}
