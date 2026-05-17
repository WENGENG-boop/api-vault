import { spawn, type ChildProcess } from "node:child_process";
import type { CloudflaredStatus } from "../shared/types";

const TUNNEL_TIMEOUT_MS = 30_000;
const CLOUDFLARED_INSTALL_URL = "https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/";

export class CloudflaredManager {
  private process: ChildProcess | null = null;
  private publicUrl: string | null = null;
  private error: string | null = null;
  private missingBinary = false;

  async start(port: number): Promise<CloudflaredStatus> {
    this.stop();

    const url = `http://127.0.0.1:${port}`;
    try {
      this.process = spawn("cloudflared", ["tunnel", "--url", url], {
        stdio: ["ignore", "pipe", "pipe"],
        detached: false,
      });
    } catch (e) {
      const message = String((e as Error).message ?? e);
      if (isMissingBinaryError(message)) {
        this.missingBinary = true;
        this.error = "cloudflared is not installed. Please download and install it first.";
      } else {
        this.error = `Failed to start cloudflared: ${message}`;
      }
      return this.getStatus();
    }

    this.process.stdout?.setEncoding("utf8");
    this.process.stderr?.setEncoding("utf8");

    return new Promise<CloudflaredStatus>((resolve) => {
      const timeout = setTimeout(() => {
        if (!this.publicUrl) {
          this.error = "Timed out waiting for tunnel URL";
          this.stop();
          resolve(this.getStatus());
        }
      }, TUNNEL_TIMEOUT_MS);

      const onStdout = (data: string) => {
        const match = data.match(/https:\/\/[a-zA-Z0-9-]+\.trycloudflare\.com/);
        if (match) {
          this.publicUrl = match[0];
          clearTimeout(timeout);
          resolve(this.getStatus());
        }
      };

      const onStderr = (data: string) => {
        const match = data.match(/https:\/\/[a-zA-Z0-9-]+\.trycloudflare\.com/);
        if (match) {
          this.publicUrl = match[0];
          clearTimeout(timeout);
          resolve(this.getStatus());
        }
        const errMatch = data.match(/error|failed|not found/i);
        if (errMatch && !this.publicUrl) {
          this.error = data.trim();
        }
      };

      this.process!.stdout?.on("data", onStdout);
      this.process!.stderr?.on("data", onStderr);

      this.process!.on("error", (err) => {
        clearTimeout(timeout);
        if (isMissingBinaryError(err.message)) {
          this.missingBinary = true;
          this.error = "cloudflared is not installed. Please download and install it first.";
        } else {
          this.error = `cloudflared process error: ${err.message}`;
        }
        resolve(this.getStatus());
      });

      this.process!.on("exit", (code) => {
        clearTimeout(timeout);
        if (!this.publicUrl && code !== 0 && !this.error) {
          this.error = `cloudflared exited with code ${code}`;
        }
        this.process = null;
        resolve(this.getStatus());
      });
    });
  }

  stop(): void {
    if (this.process) {
      try {
        this.process.kill("SIGTERM");
      } catch {
        // ignore
      }
      this.process = null;
    }
    this.publicUrl = null;
    this.error = null;
    this.missingBinary = false;
  }

  getStatus(): CloudflaredStatus {
    return {
      running: this.process !== null && this.publicUrl !== null,
      publicUrl: this.publicUrl ?? undefined,
      error: this.error ?? undefined,
      missingBinary: this.missingBinary || undefined,
      installUrl: this.missingBinary ? CLOUDFLARED_INSTALL_URL : undefined,
    };
  }
}

function isMissingBinaryError(message: string): boolean {
  return /ENOENT|not recognized|not found/i.test(message);
}
