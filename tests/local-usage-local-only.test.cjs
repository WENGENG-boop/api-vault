const test = require("node:test");
const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const root = path.resolve(__dirname, "..");
const parserRoot = path.join(root, "src", "main", "localUsage", "parsers");
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), "utf8");

test("local usage does not register the cloud-only Cursor parser", () => {
  const registry = read("src", "main", "localUsage", "parsers", "index.js");

  assert.doesNotMatch(registry, /parseCursor|['"]cursor['"]\s*:/);
  assert.equal(fs.existsSync(path.join(parserRoot, "cursor.js")), false);
});

test("local usage parsers only make loopback network requests", () => {
  const networkParsers = fs.readdirSync(parserRoot)
    .filter((name) => name.endsWith(".js"))
    .filter((name) => /\bfetch\s*\(/.test(fs.readFileSync(path.join(parserRoot, name), "utf8")));

  assert.deepEqual(networkParsers, ["antigravity.js"]);
  assert.match(read("src", "main", "localUsage", "parsers", "antigravity.js"), /http:\/\/127\.0\.0\.1:/);
});

test("local usage runtime and product UI use API Vault-owned naming", () => {
  const sources = [
    read("src", "main", "localUsage", "index.ts"),
    read("src", "main", "localUsage", "parsers", "index.js"),
    read("src", "main", "localUsage", "parsers", "kiro.js"),
    read("src", "shared", "types.ts"),
    read("scripts", "copy-parsers.mjs"),
    read("public", "vault", "b2", "src", "features", "local-tools.js"),
    read("public", "vault", "b2", "src", "pricing-data.js")
  ].join("\n");

  assert.doesNotMatch(sources, /vibe[- ]?cafe|vibe-usage|vible/i);
});

test("parser build copy removes stale runtime files", () => {
  const staleFile = path.join(root, "dist-main", "main", "localUsage", "parsers", "stale-cloud-parser.js");
  fs.mkdirSync(path.dirname(staleFile), { recursive: true });
  fs.writeFileSync(staleFile, "throw new Error('stale parser loaded');\n");

  try {
    execFileSync(process.execPath, [path.join(root, "scripts", "copy-parsers.mjs")], {
      cwd: root,
      stdio: "pipe"
    });
    assert.equal(fs.existsSync(staleFile), false);
  } finally {
    fs.rmSync(staleFile, { force: true });
  }
});

test("local usage bucket totals include cached input tokens", async () => {
  const parserIndex = await import(pathToFileURL(path.join(root, "dist-main", "main", "localUsage", "parsers", "index.js")));
  const buckets = parserIndex.aggregateToBuckets([{
    source: "codex",
    model: "gpt-test",
    project: "api-vault",
    timestamp: new Date("2026-01-01T00:05:00.000Z"),
    inputTokens: 10,
    outputTokens: 20,
    cachedInputTokens: 30,
    reasoningOutputTokens: 40
  }]);

  assert.equal(buckets[0].totalTokens, 100);
});

test("local usage API and UI surface parser warnings instead of silently showing no data", () => {
  const runtime = read("src", "main", "localUsage", "index.ts");
  const route = read("src", "server", "routes", "apiRoutes.ts");
  const ui = read("public", "vault", "b2", "src", "features", "local-tools.js");

  assert.match(runtime, /warnings/);
  assert.match(route, /warnings/);
  assert.match(ui, /warnings/);
  assert.doesNotMatch(runtime, /catch\s*\{\s*\/\/ Per-parser failures[\s\S]*?\n\s*\}/);
});

test("local tools cache is reset when switching between demo and live", () => {
  const storeSource = read("public", "vault", "b2", "src", "store.js");
  const shellSource = read("public", "vault", "b2", "src", "shell.js");

  assert.match(storeSource, /clearUi/);
  assert.match(shellSource, /clearUi\("lt-data"\)/);
});
