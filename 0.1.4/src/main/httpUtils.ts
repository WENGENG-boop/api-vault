import type { IncomingMessage } from "node:http";

export const DEFAULT_BODY_LIMIT_BYTES = 5_000_000;
export const JSON_BODY_LIMIT_BYTES = 2_000_000;
export const DEFAULT_PROXY_TIMEOUT_MS = 30_000;

const HOP_BY_HOP_HEADERS = new Set([
  "connection",
  "content-length",
  "host",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade"
]);

export async function readRequestBody(
  req: IncomingMessage,
  maxBytes = DEFAULT_BODY_LIMIT_BYTES
): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.length;
    if (total > maxBytes) throw new Error("Request body is too large");
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

export function shouldSendBody(method?: string): boolean {
  const upper = method?.toUpperCase();
  return upper !== "GET" && upper !== "HEAD";
}

export function toArrayBuffer(buffer: Buffer): ArrayBuffer {
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;
}

export function toResponseHeaders(headers: Headers): Record<string, string> {
  const result: Record<string, string> = {};
  headers.forEach((value, name) => {
    if (!isHopByHopHeader(name)) result[name] = value;
  });
  return result;
}

export function isHopByHopHeader(name: string): boolean {
  return HOP_BY_HOP_HEADERS.has(name.toLowerCase());
}

export function proxyTimeoutMs(): number {
  const value = Number(process.env.API_VAULT_PROXY_TIMEOUT_MS || DEFAULT_PROXY_TIMEOUT_MS);
  return Number.isFinite(value) && value > 0 ? value : DEFAULT_PROXY_TIMEOUT_MS;
}
