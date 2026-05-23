const test = require("node:test");
const assert = require("node:assert/strict");
const {
  createVaultHeader,
  unlockVaultHeader,
  encryptString,
  decryptString
} = require("../dist-main/main/crypto.js");

test("vault header unlocks with the correct password", () => {
  const { header, key } = createVaultHeader("correct horse battery staple");
  const unlocked = unlockVaultHeader("correct horse battery staple", header);
  const encrypted = encryptString(key, "sk-live-secret");

  assert.equal(decryptString(unlocked, encrypted), "sk-live-secret");
  assert.notEqual(encrypted.ciphertext.includes("sk-live-secret"), true);
});

test("vault header rejects a wrong password", () => {
  const { header } = createVaultHeader("correct horse battery staple");
  assert.throws(() => unlockVaultHeader("wrong password", header));
});
