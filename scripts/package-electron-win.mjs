import { copyFileSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const output = join(tmpdir(), `api-vault-electron-build-${process.pid}-${Date.now()}`);
const builderCli = resolve(root, "node_modules/electron-builder/cli.js");
const artifactDir = resolve(root, "artifacts/electron");

const result = spawnSync(
  process.execPath,
  [builderCli, "--win", "portable", `--config.directories.output=${output}`],
  { cwd: root, env: process.env, stdio: "inherit" }
);

if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);

const portable = readdirSync(output, { withFileTypes: true })
  .find((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".exe"));
if (!portable) throw new Error(`Portable Electron executable not found in ${output}`);

mkdirSync(artifactDir, { recursive: true });
const destination = join(artifactDir, portable.name);
copyFileSync(join(output, portable.name), destination);
console.log(`[package-electron-win] copied portable artifact -> ${destination}`);

try {
  rmSync(output, { recursive: true, force: true });
} catch (error) {
  console.warn(`[package-electron-win] temporary output cleanup skipped: ${error.message}`);
}
