import { app, BrowserWindow, shell } from "electron";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { CloudflaredManager } from "../main/cloudflared";
import { ProxyServer } from "../main/proxy";
import { VaultStore } from "../main/store";
import { DATA_PATH, DEFAULT_PORT } from "../server/config/serverConfig";
import { AdminSessionManager } from "../server/middlewares/adminSession";
import { createApiServer } from "../server/server";
import { startAutoSync } from "../server/services/autoSyncService";
import { isApiVaultRunning, listenFixedPort, warnIfPublicBindIsRisky } from "../server/startup";

let mainWindow: BrowserWindow | undefined;
let proxy: ProxyServer | undefined;

async function ensureLocalServer(): Promise<number> {
  if (await isApiVaultRunning(DEFAULT_PORT)) return DEFAULT_PORT;

  const store = new VaultStore(DATA_PATH);
  proxy = new ProxyServer(store);
  const server = createApiServer({
    store,
    proxy,
    cloudflared: new CloudflaredManager(),
    adminSessions: new AdminSessionManager()
  });

  startAutoSync(store);
  warnIfPublicBindIsRisky(store);
  await proxy.start();
  return listenFixedPort(server, DEFAULT_PORT);
}

function vaultUrl(port: number): string {
  if (process.env.API_VAULT_ELECTRON_DEV_URL) {
    return `${process.env.API_VAULT_ELECTRON_DEV_URL.replace(/\/$/, "")}/vault`;
  }
  const exportedVaultIndex = resolve(process.cwd(), "out", "vault", "index.html");
  if (process.env.API_VAULT_ELECTRON_FILE === "1") {
    return pathToFileURL(exportedVaultIndex).toString();
  }
  return `http://127.0.0.1:${port}/vault`;
}

async function createWindow() {
  const port = await ensureLocalServer();
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 1024,
    minHeight: 720,
    title: "API Vault",
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true
    }
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  await mainWindow.loadURL(vaultUrl(port));
}

app.whenReady().then(createWindow);

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) void createWindow();
});

app.on("window-all-closed", () => {
  proxy?.stop();
  if (process.platform !== "darwin") app.quit();
});
