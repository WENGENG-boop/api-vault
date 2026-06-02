const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const script = fs.readFileSync(path.resolve(__dirname, "..", "start-api-vault.bat"), "utf8");

test("Windows starter opens the vault backend page", () => {
  assert.match(script, /set "BASE_URL=http:\/\/127\.0\.0\.1:3210"/);
  assert.match(script, /set "APP_URL=%BASE_URL%\/vault"/);
  assert.doesNotMatch(script, /set "APP_URL=http:\/\/127\.0\.0\.1:3210"/);
});

test("Windows starter checks server health at the API root", () => {
  assert.match(script, /'%BASE_URL%\/api\/state'/);
  assert.doesNotMatch(script, /'%APP_URL%\/api\/state'/);
});
