const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), "utf8");

test("the active frontends do not depend on the retired React renderer", () => {
  const layout = read("src", "app", "layout.tsx");
  const tsconfig = read("tsconfig.json");

  assert.equal(fs.existsSync(path.join(root, "src", "renderer")), false);
  assert.doesNotMatch(layout, /renderer/);
  assert.doesNotMatch(tsconfig, /src\/renderer/);
});

test("every b2 feature API call is implemented by the frontend API client", () => {
  const apiSource = read("public", "vault", "b2", "src", "api.js");
  const implemented = new Set(
    [
      ...apiSource.matchAll(/\basync\s+([A-Za-z0-9_]+)\s*\(/g),
      ...apiSource.matchAll(/\b([A-Za-z0-9_]+):\s*\([^)]*\)\s*=>/g)
    ].map((match) => match[1])
  );
  const featureDir = path.join(root, "public", "vault", "b2", "src", "features");
  const missing = [];

  for (const name of fs.readdirSync(featureDir).filter((file) => file.endsWith(".js"))) {
    const source = fs.readFileSync(path.join(featureDir, name), "utf8");
    for (const match of source.matchAll(/\bapi\.([A-Za-z0-9_]+)\s*\(/g)) {
      if (!implemented.has(match[1])) missing.push(`${name}: api.${match[1]}`);
    }
  }

  assert.deepEqual(missing, []);
});

test("account pool actions guard import prerequisites and consume handled errors", () => {
  const accountPools = read("public", "vault", "b2", "src", "features", "account-pools.js");

  assert.match(accountPools, /if \(!p\.providerId\)/);
  assert.match(accountPools, /if \(!p\.modelNames\.length\)/);
  assert.match(accountPools, /async function run[\s\S]*catch \{\}/);
  assert.match(accountPools, /Import models[\s\S]*catch \{\}/);
});

test("b2 dashboard action center lets every actionable issue be dismissed", () => {
  const dashboard = read("public", "vault", "b2", "src", "features", "dashboard.js");

  for (const key of ["providers", "tokens", "models", "tunnel"]) {
    assert.match(dashboard, new RegExp(`dismissibleAction\\("${key}"`));
  }
  assert.match(dashboard, /dismissAction\("failed"/);
});

test("b2 dashboard hides the action center when no actionable issues remain", () => {
  const dashboard = read("public", "vault", "b2", "src", "features", "dashboard.js");

  assert.match(dashboard, /if \(!visible\.length\) return null/);
  assert.doesNotMatch(dashboard, /All systems go/);
});

test("b2 dashboard activity snapshot includes compacted usage rollups", () => {
  const dashboard = read("public", "vault", "b2", "src", "features", "dashboard.js");

  assert.match(dashboard, /dashboardActivityRows/);
  assert.match(dashboard, /usageRollups/);
  assert.match(dashboard, /rollup\.period !== period/);
});

test("b2 dashboard activity snapshot defaults to a non-empty recent window", () => {
  const dashboard = read("public", "vault", "b2", "src", "features", "dashboard.js");

  assert.match(dashboard, /ui\("dash", \{ range: "7d" \}\)/);
});

test("b2 call tables render absolute date and time instead of relative age", () => {
  const dashboard = read("public", "vault", "b2", "src", "features", "dashboard.js");
  const status = read("public", "vault", "b2", "src", "features", "status.js");
  const usage = read("public", "vault", "b2", "src", "features", "usage.js");

  for (const source of [dashboard, status, usage]) {
    assert.match(source, /dateTime\(e\.startedAt\)/);
    assert.doesNotMatch(source, /relTime\(e\.startedAt\)/);
  }
});

test("b2 analytics pages expose custom date-time ranges", () => {
  const apiAnalytics = read("public", "vault", "b2", "src", "features", "api-analytics.js");
  const localTools = read("public", "vault", "b2", "src", "features", "local-tools.js");

  for (const source of [apiAnalytics, localTools]) {
    assert.match(source, /value: "custom", label: "Custom"/);
    assert.match(source, /type: "datetime-local"/);
    assert.match(source, /customRangeControls/);
  }
});
