import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { CloudflaredManager } from "../main/cloudflared";
import { ProxyServer } from "../main/proxy";
import { VaultStore } from "../main/store";
import { DATA_PATH, DEFAULT_PORT, LISTEN_HOST } from "./config/serverConfig";
import { applyCors, isAllowedHost } from "./middlewares/cors";
import { AdminSessionManager } from "./middlewares/adminSession";
import { sendError, sendText } from "./utils/responses";
import { serveStatic } from "./utils/staticAssets";
import { startAutoSync } from "./services/autoSyncService";
import { handleLocalServiceProxy } from "./services/localServiceProxy";
import { handleApi } from "./routes/apiRoutes";
import { createSetupBootstrapToken, isApiVaultRunning, listenFixedPort, localAppUrl, openBrowser, warnIfDockerAllowedHostsMissing, warnIfPublicBindIsRisky } from "./startup";
export interface LocalServerContext {
  store: VaultStore;
  proxy: ProxyServer;
  cloudflared?: CloudflaredManager;
  adminSessions?: AdminSessionManager;
  setupBootstrapToken?: string;
}

export function createApiServer(context: LocalServerContext) {
  context.adminSessions ??= new AdminSessionManager();
  return createServer((req, res) => {
    handleRequest(req, res, context).catch((error) => {
      sendError(res, error);
    });
  });
}

async function handleRequest(req: IncomingMessage, res: ServerResponse, context: LocalServerContext) {
  if (!isAllowedHost(req.headers.host)) {
    sendText(res, 403, "Forbidden host");
    return;
  }
  if (applyCors(req, res)) return;

  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "127.0.0.1"}`);

  const apiLocalProxyMatch = url.pathname.match(/^\/api\/proxy\/local\/([^/]+)(\/.*)?$/);
  if (apiLocalProxyMatch) {
    const serviceId = decodeURIComponent(apiLocalProxyMatch[1]);
    const suffixPath = apiLocalProxyMatch[2] ?? "/";
    await handleLocalServiceProxy(context.store, req, res, serviceId, suffixPath, url.search);
    return;
  }

  if (url.pathname.startsWith("/api/")) {
    await handleApi(req, res, url, context);
    return;
  }

  if (url.pathname.startsWith("/proxy/")) {
    const localProxyMatch = url.pathname.match(/^\/proxy\/local\/([^/]+)(\/.*)?$/);
    if (localProxyMatch) {
      const serviceId = decodeURIComponent(localProxyMatch[1]);
      const suffixPath = localProxyMatch[2] ?? "/";
      await handleLocalServiceProxy(context.store, req, res, serviceId, suffixPath, url.search);
      return;
    }
    await context.proxy.handleRequest(req, res, Number(url.port || DEFAULT_PORT));
    return;
  }

  serveStatic(url.pathname, res);
}

if (require.main === module) {
  const store = new VaultStore(DATA_PATH);
  const proxy = new ProxyServer(store);
  const cloudflared = new CloudflaredManager();
  const adminSessions = new AdminSessionManager();
  const setupBootstrapToken = store.status.initialized ? undefined : createSetupBootstrapToken();
  const server = createApiServer({ store, proxy, cloudflared, adminSessions, setupBootstrapToken });

  const stopAutoSync = startAutoSync(store);
  if (setupBootstrapToken) {
    console.warn(`FIRST-TIME SETUP TOKEN: ${setupBootstrapToken}`);
    console.warn("Remote setup must send this value in the x-api-vault-bootstrap header.");
  }
  warnIfDockerAllowedHostsMissing();
  warnIfPublicBindIsRisky(store);

  proxy.start()
    .then(() => listenFixedPort(server, DEFAULT_PORT))
    .then((port) => {
      const url = localAppUrl(port);
      console.log(`API Vault is running at ${url}`);
      if (LISTEN_HOST === "0.0.0.0") {
        console.log(`API Vault is listening on all container interfaces (${LISTEN_HOST}:${port})`);
      }
      console.log(`Vault data: ${DATA_PATH}`);
      openBrowser(url);
    })
    .catch(async (error) => {
      if ((error as NodeJS.ErrnoException).code === "EADDRINUSE") {
        const url = localAppUrl(DEFAULT_PORT);
        if (await isApiVaultRunning(DEFAULT_PORT)) {
          console.log(`API Vault is already running at ${url}`);
          openBrowser(url);
          stopAutoSync();
          proxy.stop();
          return;
        }
        console.error(`Port ${DEFAULT_PORT} is already in use by another application.`);
        console.error("Stop that process or set PORT to one shared API Vault port intentionally.");
        stopAutoSync();
        proxy.stop();
        process.exit(1);
      }
      console.error(error);
      stopAutoSync();
      proxy.stop();
      process.exit(1);
    });
}
