import type { Server } from "node:http";
import { spawn } from "node:child_process";
import type { VaultStore } from "../main/store";
import { DEFAULT_PORT, LISTEN_HOST } from "./config/serverConfig";

export function warnIfPublicBindIsRisky(store: VaultStore): void {
  if (LISTEN_HOST !== "0.0.0.0") return;
  const state = store.getState();
  if (state.proxyTokens.length === 0) {
    console.warn("WARNING: BIND_HOST=0.0.0.0 is enabled, but no Proxy Token exists yet. Public /proxy/v1 calls will be rejected until you create one.");
  }
  console.warn("WARNING: Do not expose the management UI directly to the internet. Put HTTPS, access control, or a private tunnel in front of it.");
}

export async function listenFixedPort(server: Server, port: number): Promise<number> {
  return new Promise<number>((resolveListen, rejectListen) => {
    const onError = (error: NodeJS.ErrnoException) => {
      server.off("listening", onListening);
      rejectListen(error);
    };
    const onListening = () => {
      server.off("error", onError);
      resolveListen(port);
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port, LISTEN_HOST);
  });
}

export async function isApiVaultRunning(port: number): Promise<boolean> {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/state`);
    if (!response.ok) return false;
    const data = await response.json() as Record<string, unknown>;
    return "initialized" in data && "unlocked" in data && "providers" in data;
  } catch {
    return false;
  }
}

export function openBrowser(url: string): void {
  if (process.env.API_VAULT_NO_OPEN === "1") return;
  const options = { detached: true, stdio: "ignore" as const };
  if (process.platform === "win32") {
    spawn("cmd", ["/c", "start", "", url], options).unref();
  } else if (process.platform === "darwin") {
    spawn("open", [url], options).unref();
  } else {
    spawn("xdg-open", [url], options).unref();
  }
}

export function localAppUrl(port = DEFAULT_PORT): string {
  return `http://127.0.0.1:${port}/vault`;
}
