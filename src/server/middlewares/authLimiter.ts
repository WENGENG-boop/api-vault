import type { IncomingMessage } from "node:http";
import { AppError } from "../../main/errors";

class SimpleLimiter {
  private readonly attempts = new Map<string, { window: number; count: number }>();
  constructor(private readonly limit: number, private readonly windowMs: number) {}

  allow(key: string): boolean {
    const window = Math.floor(Date.now() / this.windowMs);
    const current = this.attempts.get(key);
    return !current || current.window !== window || current.count < this.limit;
  }

  consume(key: string): boolean {
    const window = Math.floor(Date.now() / this.windowMs);
    const current = this.attempts.get(key);
    const next = current?.window === window ? { window, count: current.count + 1 } : { window, count: 1 };
    this.attempts.set(key, next);
    return next.count <= this.limit;
  }

  reset(): void {
    this.attempts.clear();
  }
}

const authFailures = new SimpleLimiter(12, 60_000);

// Test-only hook. The limiter is a process-global singleton (correct for
// production: one bucket per client IP), so test cases that assert exact
// counts must reset it to stay isolated from each other.
export function resetAuthLimiter(): void {
  authFailures.reset();
}

export function enforceAuthLimiter(req: IncomingMessage): void {
  const key = authLimiterKey(req);
  if (!authFailures.allow(key)) {
    throw new AppError("Too many authentication attempts. Try again later.", 429, "auth_rate_limited");
  }
}

export function recordAuthFailure(req: IncomingMessage): void {
  authFailures.consume(authLimiterKey(req));
}

export function authLimiterKey(req: Pick<IncomingMessage, "headers" | "socket">): string {
  if (process.env.API_VAULT_TRUST_PROXY === "1") {
    const forwarded = req.headers["x-forwarded-for"];
    const value = Array.isArray(forwarded) ? forwarded.join(",") : forwarded;
    const rightmost = value?.split(",").map((item) => item.trim()).filter(Boolean).at(-1);
    if (rightmost) return rightmost;
  }
  // Key on the network peer only. The Host header is client-controlled, so
  // including it would let a brute-force attacker reset their bucket each
  // request by rotating Host, defeating the limiter.
  return req.socket.remoteAddress ?? "local";
}
