const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), "utf8");

const html = read("website", "index.html");
const script = read("website", "app.js");

test("website uses the approved product-demo-first structure", () => {
  assert.match(html, /class="site-shell"/);
  assert.match(html, /One local control plane for every AI API/);
  assert.match(html, /id="problems"/);
  assert.match(html, /id="workflow"/);
  assert.match(html, /id="features"/);
  assert.match(html, /id="start"/);
  assert.match(html, /id="faq"/);
});

test("website keeps GitHub as the dominant conversion action", () => {
  const githubActions = html.match(/data-i18n="(?:nav|hero|cta)\.github"/g) ?? [];
  assert.ok(githubActions.length >= 3);
});

test("website bilingual script contains readable Simplified Chinese", () => {
  assert.match(script, /一个本地控制台，管理你的所有 AI API/);
  assert.match(script, /在 GitHub 查看/);
  assert.doesNotMatch(script, /(?:鈥|銆|鍦|鐨|涓|浜|鏁|寮)/);
});

test("published website assets match their source files", () => {
  assert.equal(read("public", "website", "styles.css"), read("website", "styles.css"));
  assert.equal(read("public", "website", "app.js"), read("website", "app.js"));
});

