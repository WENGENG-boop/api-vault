import type { ServerResponse } from "node:http";
import { createReadStream, existsSync, statSync } from "node:fs";
import { join, normalize, resolve, relative, isAbsolute } from "node:path";
import { DIST_DIR } from "../config/serverConfig";
import { sendText } from "./responses";

export function serveStatic(pathname: string, res: ServerResponse): void {
  const requestedPath = pathname === "/" ? "/index.html" : pathname;
  const absolute = normalize(resolve(DIST_DIR, `.${decodeURIComponent(requestedPath)}`));
  
  const rel = relative(DIST_DIR, absolute);
  const isSafe = !rel.startsWith("..") && !isAbsolute(rel);
  let filePath = join(DIST_DIR, "index.html");
  if (isSafe && existsSync(absolute)) {
    const stats = statSync(absolute);
    filePath = stats.isDirectory() ? join(absolute, "index.html") : absolute;
  } else if (isSafe && !absolute.match(/\.[^/\\]+$/)) {
    filePath = join(absolute, "index.html");
  }

  if (!existsSync(filePath)) {
    sendText(res, 503, "The frontend is not built yet. Run npm run build first.");
    return;
  }

  res.writeHead(200, {
    "content-type": contentType(filePath),
    "cache-control": filePath.endsWith(".html")
      ? "no-cache, no-store, must-revalidate"
      : "public, max-age=31536000, immutable"
  });
  createReadStream(filePath).pipe(res);
}

function contentType(filePath: string): string {
  if (filePath.endsWith(".html")) return "text/html; charset=utf-8";
  if (filePath.endsWith(".js")) return "text/javascript; charset=utf-8";
  if (filePath.endsWith(".css")) return "text/css; charset=utf-8";
  if (filePath.endsWith(".json")) return "application/json; charset=utf-8";
  if (filePath.endsWith(".svg")) return "image/svg+xml";
  if (filePath.endsWith(".png")) return "image/png";
  return "application/octet-stream";
}
