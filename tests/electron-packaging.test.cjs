const test = require("node:test");
const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), "utf8");

test("server paths accept explicit packaged-runtime overrides", () => {
  const configPath = path.join(root, "dist-main", "server", "config", "serverConfig.js");
  const distDir = path.join(root, "packaged-test", "resources", "out");
  const dataPath = path.join(root, "packaged-test", "user-data", "vault.json");
  const script = `
    const config = require(${JSON.stringify(configPath)});
    process.stdout.write(JSON.stringify({ distDir: config.DIST_DIR, dataPath: config.DATA_PATH }));
  `;
  const output = execFileSync(process.execPath, ["-e", script], {
    cwd: path.join(root, "docs"),
    env: {
      ...process.env,
      API_VAULT_DIST_DIR: distDir,
      API_VAULT_DATA_PATH: dataPath
    },
    encoding: "utf8"
  });

  assert.deepEqual(JSON.parse(output), { distDir, dataPath });
});

test("Electron entry configures packaged resources and user data before loading the backend", () => {
  const source = read("src", "electron", "main.ts");

  assert.match(source, /app\.isPackaged/);
  assert.match(source, /process\.resourcesPath/);
  assert.match(source, /app\.getPath\("userData"\)/);
  assert.match(source, /API_VAULT_DIST_DIR/);
  assert.match(source, /API_VAULT_DATA_PATH/);
  assert.match(source, /import\("\.\.\/server\/config\/serverConfig\.js"\)/);
});

test("Electron package metadata can produce a Windows portable build", () => {
  const pkg = JSON.parse(read("package.json"));

  assert.equal(pkg.scripts["pack:win"], "npm run build && node scripts/package-electron-win.mjs");
  assert.equal(pkg.build.appId, "com.apivault.desktop");
  assert.equal(pkg.build.productName, "API Vault");
  assert.equal(pkg.build.directories.output, "release-electron");
  assert.deepEqual(pkg.build.files, ["dist-main/**/*", "package.json"]);
  assert.deepEqual(pkg.build.extraResources, [{ from: "out", to: "out", filter: ["**/*"] }]);
  assert.deepEqual(pkg.build.win.target, ["portable"]);
  assert.equal(pkg.build.win.signAndEditExecutable, false);
});

test("Windows packaging uses a temporary build directory and copies back the portable artifact", () => {
  const source = read("scripts", "package-electron-win.mjs");

  assert.match(source, /tmpdir\(\)/);
  assert.match(source, /--config\.directories\.output=/);
  assert.match(source, /artifacts[\\/]electron/);
});

test("Electron only shuts down its owned backend when the app quits", () => {
  const source = read("src", "electron", "main.ts");

  assert.match(source, /app\.on\("before-quit"/);
  assert.match(source, /autoSyncStop\?\.\(\)/);
  assert.match(source, /cloudflared\?\.stop/);
  const windowClosed = source.match(/app\.on\("window-all-closed"[\s\S]*?\n\}\);/)?.[0] ?? "";
  assert.doesNotMatch(windowClosed, /proxy\?\.stop|shutdownOwnedServer/);
});

test("auto-sync service exposes a disposer so duplicate starts can exit cleanly", () => {
  const source = read("src", "server", "services", "autoSyncService.ts");
  const server = read("src", "server", "server.ts");

  assert.match(source, /export function startAutoSync\(store: VaultStore\): \(\) => void/);
  assert.match(source, /clearInterval/);
  assert.match(source, /\.unref\?\.\(\)/);
  assert.match(server, /stopAutoSync/);
});
