// Ships API Vault's local-log parsers (ESM .js, not compiled by tsc) into the
// build output so `node dist-main/server/server.js` can dynamically import them.
// Runs after `tsc -p tsconfig.main.json` in the `build:main` npm script.
import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const src = resolve(root, "src/main/localUsage/parsers");
const dest = resolve(root, "dist-main/main/localUsage/parsers");

if (!existsSync(src)) {
  console.error(`[copy-parsers] source not found: ${src}`);
  process.exit(1);
}

rmSync(dest, { recursive: true, force: true });
mkdirSync(dirname(dest), { recursive: true });
cpSync(src, dest, { recursive: true });
console.log(`[copy-parsers] copied parsers -> ${dest}`);
