import { createHash, createHmac, randomBytes } from "node:crypto";

export function maskKey(key: string): string {
  const trimmed = key.trim();
  if (trimmed.length <= 4) return "****";
  if (/^sk-/i.test(trimmed)) return `sk-****${trimmed.slice(-4)}`;
  if (/^pk-/i.test(trimmed)) return `pk-****${trimmed.slice(-4)}`;
  if (/^bearer\s+/i.test(trimmed)) return `Bearer ****${trimmed.slice(-4)}`;
  return `${trimmed.slice(0, 3)}****${trimmed.slice(-4)}`;
}

export function generateProxyTokenSecret(): string {
  return `proxy_${randomBytes(24).toString("base64url")}`;
}

export function hashProxyToken(secret: string): string {
  return createHash("sha256").update(secret, "utf8").digest("hex");
}

export function hashApiKey(masterKey: Buffer, apiKey: string): string {
  return createHmac("sha256", masterKey).update(apiKey.trim(), "utf8").digest("hex");
}

export function maskProxyToken(secret: string): string {
  const trimmed = secret.trim();
  return trimmed.length <= 10 ? "proxy_****" : `${trimmed.slice(0, 10)}****${trimmed.slice(-4)}`;
}
