import { app, BrowserWindow, shell } from "electron";
import type { Server } from "node:http";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { ProxyServer } from "../main/proxy";
import type { CloudflaredManager } from "../main/cloudflared";

let mainWindow: BrowserWindow | undefined;
let proxy: ProxyServer | undefined;
let cloudflared: CloudflaredManager | undefined;
let apiServer: Server | undefined;
let ownsLocalServer = false;
let autoSyncStop: (() => void) | undefined;

function configureRuntimePaths(): void {
  const appRoot = app.isPackaged ? process.resourcesPath : app.getAppPath();
  process.env.API_VAULT_DIST_DIR ||= join(appRoot, "out");
  process.env.API_VAULT_DATA_PATH ||= app.isPackaged
    ? join(app.getPath("userData"), "vault.json")
    : join(appRoot, ".api-vault", "vault.json");
}

async function ensureLocalServer(): Promise<number> {
  const [
    { CloudflaredManager },
    { ProxyServer },
    { VaultStore },
    { DATA_PATH, DEFAULT_PORT },
    { AdminSessionManager },
    { createApiServer },
    { startAutoSync },
    { isApiVaultRunning, listenFixedPort, warnIfPublicBindIsRisky }
  ] = await Promise.all([
    import("../main/cloudflared.js"),
    import("../main/proxy.js"),
    import("../main/store.js"),
    import("../server/config/serverConfig.js"),
    import("../server/middlewares/adminSession.js"),
    import("../server/server.js"),
    import("../server/services/autoSyncService.js"),
    import("../server/startup.js")
  ]);

  if (await isApiVaultRunning(DEFAULT_PORT)) return DEFAULT_PORT;

  const store = new VaultStore(DATA_PATH);
  const ownedProxy = new ProxyServer(store);
  const ownedCloudflared = new CloudflaredManager();
  const server = createApiServer({
    store,
    proxy: ownedProxy,
    cloudflared: ownedCloudflared,
    adminSessions: new AdminSessionManager()
  });

  const ownedAutoSyncStop = startAutoSync(store);
  warnIfPublicBindIsRisky(store);
  await ownedProxy.start();
  try {
    const port = await listenFixedPort(server, DEFAULT_PORT);
    proxy = ownedProxy;
    cloudflared = ownedCloudflared;
    apiServer = server;
    autoSyncStop = ownedAutoSyncStop;
    ownsLocalServer = true;
    return port;
  } catch (error) {
    ownedAutoSyncStop();
    ownedProxy.stop();
    throw error;
  }
}

function shutdownOwnedServer(): void {
  if (!ownsLocalServer) return;
  autoSyncStop?.();
  void cloudflared?.stop();
  proxy?.stop();
  apiServer?.close();
  cloudflared = undefined;
  proxy = undefined;
  apiServer = undefined;
  autoSyncStop = undefined;
  ownsLocalServer = false;
}

function vaultUrl(port: number): string {
  if (process.env.API_VAULT_ELECTRON_DEV_URL) {
    return `${process.env.API_VAULT_ELECTRON_DEV_URL.replace(/\/$/, "")}/vault`;
  }
  const exportedVaultIndex = resolve(process.env.API_VAULT_DIST_DIR || join(app.getAppPath(), "out"), "vault", "index.html");
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
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
    return { action: "deny" };
  });

  await mainWindow.loadURL(vaultUrl(port));
}

app.whenReady()
  .then(async () => {
    configureRuntimePaths();
    await createWindow();
  })
  .catch((error) => {
    console.error("Failed to start API Vault Electron:", error);
    app.quit();
  });

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) void createWindow();
});

app.on("before-quit", shutdownOwnedServer);

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
