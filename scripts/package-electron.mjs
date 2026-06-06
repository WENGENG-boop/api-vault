import { copyFileSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const targets = {
  win: {
    host: "win32",
    builderArgs: ["--win", "portable"],
    extension: ".exe"
  },
  mac: {
    host: "darwin",
    builderArgs: ["--mac", "dmg"],
    extension: ".dmg"
  },
  linux: {
    host: "linux",
    builderArgs: ["--linux", "AppImage"],
    extension: ".AppImage"
  }
};
const architectures = new Set(["x64", "arm64"]);
const platform = process.argv[2];
const architecture = process.argv[3] ?? "x64";
const target = targets[platform];

if (!target) {
  throw new Error(`Unsupported Electron platform "${platform}". Use win, mac, or linux.`);
}
if (!architectures.has(architecture)) {
  throw new Error(`Unsupported Electron architecture "${architecture}". Use x64 or arm64.`);
}
if (process.platform !== target.host) {
  throw new Error(`${platform}-${architecture} packages must be built on ${target.host}.`);
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const output = join(
  tmpdir(),
  `api-vault-electron-build-${platform}-${architecture}-${process.pid}-${Date.now()}`
);
const builderCli = resolve(root, "node_modules/electron-builder/cli.js");
const artifactDir = resolve(root, "artifacts/electron", `${platform}-${architecture}`);

const result = spawnSync(
  process.execPath,
  [
    builderCli,
    ...target.builderArgs,
    `--${architecture}`,
    `--config.directories.output=${output}`
  ],
  {
    cwd: root,
    env: {
      ...process.env,
      CSC_IDENTITY_AUTO_DISCOVERY: "false"
    },
    stdio: "inherit"
  }
);

if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);

const artifacts = readdirSync(output, { withFileTypes: true }).filter(
  (entry) => entry.isFile() && entry.name.toLowerCase().endsWith(target.extension.toLowerCase())
);
if (artifacts.length === 0) {
  throw new Error(`${target.extension} Electron artifact not found in ${output}`);
}

mkdirSync(artifactDir, { recursive: true });
for (const artifact of artifacts) {
  const destination = join(artifactDir, artifact.name);
  copyFileSync(join(output, artifact.name), destination);
  console.log(`[package-electron] copied ${platform}-${architecture} artifact -> ${destination}`);
}

try {
  rmSync(output, { recursive: true, force: true });
} catch (error) {
  console.warn(`[package-electron] temporary output cleanup skipped: ${error.message}`);
}
