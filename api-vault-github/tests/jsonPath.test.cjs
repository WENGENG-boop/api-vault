const test = require("node:test");
const assert = require("node:assert/strict");
const {
  readBooleanPath,
  readJsonPath,
  readNumberPath,
  readStringPath
} = require("../dist-main/main/jsonPath.js");

test("reads nested object and array paths", () => {
  const payload = {
    data: {
      accounts: [
        { balance: "12.50", currency: "USD" },
        { balance: 3 }
      ],
      enabled: "true"
    }
  };

  assert.equal(readJsonPath(payload, "data.accounts[1].balance"), 3);
  assert.equal(readNumberPath(payload, "data.accounts[0].balance"), 12.5);
  assert.equal(readStringPath(payload, "$.data.accounts[0].currency"), "USD");
  assert.equal(readBooleanPath(payload, "data.enabled"), true);
});
