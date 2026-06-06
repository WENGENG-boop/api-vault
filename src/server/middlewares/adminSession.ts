import { createHash, randomBytes } from "node:crypto";
import type { IncomingMessage } from "node:http";
import { unauthorized } from "../../main/errors";

const DEFAULT_ADMIN_SESSION_TTL_MS = 12 * 60 * 60 * 1000;

interface AdminSession {
  expiresAt: number;
}

export class AdminSessionManager {
  private readonly sessions = new Map<string, AdminSession>();

  create(): string {
    const token = `admin_${randomBytes(32).toString("base64url")}`;
    const tokenHash = hashToken(token);
    this.sessions.set(tokenHash, {
      expiresAt: Date.now() + adminSessionTtlMs()
    });
    return token;
  }

  validate(token: string | undefined): boolean {
    if (!token?.startsWith("admin_")) return false;
    const tokenHash = hashToken(token);
    const session = this.sessions.get(tokenHash);
    if (!session) return false;
    if (session.expiresAt <= Date.now()) {
      this.sessions.delete(tokenHash);
      return false;
    }
    return true;
  }

  revoke(token: string | undefined): void {
    if (token?.startsWith("admin_")) this.sessions.delete(hashToken(token));
  }

  revokeAll(): void {
    this.sessions.clear();
  }
}

export function extractAdminToken(req: IncomingMessage): string | undefined {
  const header = req.headers["x-api-vault-admin"];
  return (Array.isArray(header) ? header[0] : header)?.trim();
}

export function requireAdminSession(req: IncomingMessage, sessions?: AdminSessionManager): string {
  const token = extractAdminToken(req);
  if (!sessions?.validate(token)) {
    throw unauthorized("Missing or invalid admin session", "admin_session_required");
  }
  return token!;
}

function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

function adminSessionTtlMs(): number {
  const value = Number(process.env.API_VAULT_ADMIN_SESSION_TTL_MS || DEFAULT_ADMIN_SESSION_TTL_MS);
  return Number.isFinite(value) && value > 0 ? value : DEFAULT_ADMIN_SESSION_TTL_MS;
}
