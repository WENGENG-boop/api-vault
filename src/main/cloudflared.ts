import { spawn, type ChildProcess } from "node:child_process";
import type { CloudflaredApiResponse, CloudflaredConfig, CloudflaredLogEntry, CloudflaredStatus } from "../shared/types";

const TUNNEL_TIMEOUT_MS = 30_000;
const CLOUDFLARED_INSTALL_URL = "https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/";
const MAX_LOGS = 500;

type Phase = "idle" | "starting" | "running" | "stopping" | "error";

export class CloudflaredManager {
  private process: ChildProcess | null = null;
  private publicUrl: string | null = null;
  private error: string | null = null;
  private missingBinary = false;
  private phase: Phase = "idle";
  private startedAt: string | undefined;
  private lastExitAt: string | undefined;
  private lastExitCode: number | undefined;
  private pending: Promise<unknown> = Promise.resolve();
  private logs: CloudflaredLogEntry[] = [];
  private timeout: NodeJS.Timeout | null = null;
  private stopRequested = false;

  start(proxyPort: number, input: CloudflaredConfig = {}): Promise<CloudflaredApiResponse> {
    return this.runExclusive(async () => this.startInternal(proxyPort, input));
  }

  stop(): Promise<CloudflaredApiResponse> {
    return this.runExclusive(async () => this.stopInternal());
  }

  getLogs(limit = 200): CloudflaredLogEntry[] {
    const safeLimit = Math.max(1, Math.min(1000, Math.floor(limit)));
    return this.logs.slice(-safeLimit);
  }

  getStatus(): CloudflaredStatus {
    return {
      running: this.phase === "running" && this.process !== null,
      phase: this.phase,
      publicUrl: this.publicUrl ?? undefined,
      startedAt: this.startedAt,
      lastExitAt: this.lastExitAt,
      lastExitCode: this.lastExitCode,
      error: this.error ?? undefined,
      missingBinary: this.missingBinary || undefined,
      installUrl: this.missingBinary ? CLOUDFLARED_INSTALL_URL : undefined
    };
  }

  private async startInternal(proxyPort: number, input: CloudflaredConfig): Promise<CloudflaredApiResponse> {
    if (this.process) {
      await this.stopInternal();
    }
    const config = normalizeConfig(proxyPort, input);
    const targetUrl = `${config.protocol}://127.0.0.1:${config.targetPort}`;
    const args = ["tunnel", "--url", targetUrl];
    if (config.hostname) args.push("--hostname", config.hostname);
    if (config.noAutoUpdate) args.push("--no-autoupdate");

    this.phase = "starting";
    this.stopRequested = false;
    this.error = null;
    this.publicUrl = null;
    this.missingBinary = false;
    this.startedAt = new Date().toISOString();
    this.pushLog("system", "info", `starting cloudflared: ${args.join(" ")}`);

    try {
      this.process = spawn("cloudflared", args, { stdio: ["ignore", "pipe", "pipe"], detached: false });
    } catch (e) {
      return this.failStart(e instanceof Error ? e.message : String(e), "PROCESS_ERROR", config);
    }

    this.process.stdout?.setEncoding("utf8");
    this.process.stderr?.setEncoding("utf8");

    return new Promise<CloudflaredApiResponse>((resolve) => {
      const cleanup = () => {
        if (!this.process) return;
        this.process.stdout?.removeAllListeners("data");
        this.process.stderr?.removeAllListeners("data");
        this.process.removeAllListeners("exit");
        this.process.removeAllListeners("error");
        if (this.timeout) {
          clearTimeout(this.timeout);
          this.timeout = null;
        }
      };

      const settle = (result: CloudflaredApiResponse) => {
        cleanup();
        resolve(result);
      };

      const onChunk = (stream: "stdout" | "stderr", chunk: string) => {
        for (const line of chunk.split(/\r?\n/).map((s) => s.trim()).filter(Boolean)) {
          this.pushLog(stream, /error|fail/i.test(line) ? "error" : "info", line);
          const candidate = extractCloudflaredUrl(line);
          if (!candidate) continue;
          if (!isValidPublicUrl(candidate)) continue;
          this.publicUrl = candidate;
          this.phase = "running";
          this.error = null;
          settle({ ok: true, code: "OK", status: this.getStatus(), config });
          return;
        }
      };

      this.process!.stdout?.on("data", (d) => onChunk("stdout", String(d)));
      this.process!.stderr?.on("data", (d) => onChunk("stderr", String(d)));

      this.process!.on("error", (err) => {
        const msg = err.message || "cloudflared process error";
        settle(this.failStart(msg, isMissingBinaryError(msg) ? "MISSING_BINARY" : "PROCESS_ERROR", config));
      });

      this.process!.on("exit", (code) => {
        this.lastExitAt = new Date().toISOString();
        this.lastExitCode = code ?? undefined;
        this.pushLog("system", code === 0 ? "info" : "error", `cloudflared exited: ${String(code)}`);
        this.process = null;
        if (this.stopRequested || this.phase === "stopping") {
          this.phase = "idle";
          this.publicUrl = null;
          this.error = null;
          settle({ ok: true, code: "MANUAL_STOP", status: this.getStatus(), config });
          return;
        }
        if (this.publicUrl && code !== 0) {
          this.phase = "error";
          this.error = `cloudflared exited unexpectedly with code ${String(code)}`;
          settle({ ok: false, code: "PROCESS_EXITED", message: this.error, status: this.getStatus(), config });
          return;
        }
        if (!this.publicUrl) {
          this.phase = "error";
          this.error = "Tunnel URL not found before process exit";
          settle({ ok: false, code: "TUNNEL_URL_NOT_FOUND", message: this.error, status: this.getStatus(), config });
          return;
        }
      });

      this.timeout = setTimeout(() => {
        if (this.publicUrl) return;
        this.phase = "error";
        this.error = "Timed out waiting for tunnel URL";
        this.stopProcessOnly();
        settle({ ok: false, code: "START_TIMEOUT", message: this.error, status: this.getStatus(), config });
      }, TUNNEL_TIMEOUT_MS);
      this.timeout.unref?.();
    });
  }

  private async stopInternal(): Promise<CloudflaredApiResponse> {
    this.phase = "stopping";
    this.stopRequested = true;
    this.stopProcessOnly();
    this.phase = "idle";
    this.publicUrl = null;
    this.error = null;
    return { ok: true, code: "OK", status: this.getStatus() };
  }

  private stopProcessOnly(): void {
    if (this.timeout) {
      clearTimeout(this.timeout);
      this.timeout = null;
    }
    if (this.process) {
      try { this.process.kill("SIGTERM"); } catch {}
      this.process.removeAllListeners();
      this.process.stdout?.removeAllListeners();
      this.process.stderr?.removeAllListeners();
      this.process = null;
    }
  }

  private failStart(message: string, code: Exclude<CloudflaredApiResponse["code"], "OK">, config?: CloudflaredConfig): CloudflaredApiResponse {
    if (isMissingBinaryError(message)) {
      this.missingBinary = true;
      this.error = "cloudflared is not installed. Please download and install it first.";
      this.phase = "error";
      return { ok: false, code: "MISSING_BINARY", message: this.error, status: this.getStatus(), config };
    }
    this.error = message;
    this.phase = "error";
    return { ok: false, code, message, status: this.getStatus(), config };
  }

  private runExclusive<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.pending.then(fn, fn);
    this.pending = next.then(() => undefined, () => undefined);
    return next;
  }

  private pushLog(stream: "stdout" | "stderr" | "system", level: "info" | "warn" | "error", message: string): void {
    this.logs.push({ ts: new Date().toISOString(), level, stream, message });
    if (this.logs.length > MAX_LOGS) this.logs.splice(0, this.logs.length - MAX_LOGS);
  }
}

function isMissingBinaryError(message: string): boolean {
  return /ENOENT|not recognized|not found/i.test(message);
}

export function extractCloudflaredUrl(line: string): string | null {
  const match = line.match(/https?:\/\/[^\s"']+/i);
  return match ? match[0].replace(/[),.;]+$/, "") : null;
}

export function isValidPublicUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

function normalizeConfig(proxyPort: number, config: CloudflaredConfig): Required<CloudflaredConfig> {
  const targetPort = Number.isFinite(config.targetPort) && Number(config.targetPort) > 0 ? Math.floor(Number(config.targetPort)) : proxyPort;
  const protocol = config.protocol === "https" ? "https" : "http";
  const hostname = (config.hostname ?? "").trim();
  const noAutoUpdate = Boolean(config.noAutoUpdate);
  return { targetPort, protocol, hostname, noAutoUpdate };
}
