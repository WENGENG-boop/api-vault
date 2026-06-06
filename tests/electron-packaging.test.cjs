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

test("Electron package metadata can produce all supported desktop artifacts", () => {
  const pkg = JSON.parse(read("package.json"));

  assert.equal(pkg.scripts["pack:win"], "npm run build && node scripts/package-electron.mjs win x64");
  assert.equal(pkg.scripts["pack:mac:x64"], "npm run build && node scripts/package-electron.mjs mac x64");
  assert.equal(pkg.scripts["pack:mac:arm64"], "npm run build && node scripts/package-electron.mjs mac arm64");
  assert.equal(pkg.scripts["pack:linux"], "npm run build && node scripts/package-electron.mjs linux x64");
  assert.equal(pkg.build.appId, "com.apivault.desktop");
  assert.equal(pkg.build.productName, "API Vault");
  assert.equal(pkg.build.artifactName, "${productName}-${version}-${os}-${arch}.${ext}");
  assert.equal(pkg.build.directories.output, "release-electron");
  assert.deepEqual(pkg.build.files, ["dist-main/**/*", "package.json"]);
  assert.deepEqual(pkg.build.extraResources, [{ from: "out", to: "out", filter: ["**/*"] }]);
  assert.deepEqual(pkg.build.win.target, ["portable"]);
  assert.equal(pkg.build.win.signAndEditExecutable, false);
  assert.deepEqual(pkg.build.mac.target, ["dmg"]);
  assert.equal(pkg.build.mac.identity, null);
  assert.deepEqual(pkg.build.linux.target, ["AppImage"]);
});

test("multi-platform packaging uses a temporary directory and separates artifacts by platform", () => {
  const source = read("scripts", "package-electron.mjs");

  assert.match(source, /tmpdir\(\)/);
  assert.match(source, /--config\.directories\.output=/);
  assert.match(source, /artifacts[\\/]electron/);
  assert.match(source, /portable/);
  assert.match(source, /dmg/);
  assert.match(source, /AppImage/);
  assert.match(source, /x64/);
  assert.match(source, /arm64/);
  assert.match(source, /"--publish", "never"/);
});

test("GitHub Actions builds every Electron target and releases v tags", () => {
  const workflow = read(".github", "workflows", "electron-release.yml");

  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /tags:\s*\n\s*- "v\*"/);
  assert.match(workflow, /windows-latest/);
  assert.match(workflow, /macos-latest/);
  assert.match(workflow, /ubuntu-latest/);
  assert.match(workflow, /pack:win/);
  assert.match(workflow, /pack:mac:x64/);
  assert.match(workflow, /pack:mac:arm64/);
  assert.match(workflow, /pack:linux/);
  assert.match(workflow, /actions\/checkout@v5/);
  assert.match(workflow, /actions\/setup-node@v5/);
  assert.match(workflow, /softprops\/action-gh-release@v2/);
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
