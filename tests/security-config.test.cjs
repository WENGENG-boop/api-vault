const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { warnIfDockerAllowedHostsMissing } = require("../dist-main/server/startup.js");
const { isSetupRequestAllowed } = require("../dist-main/server/routes/apiRoutes.js");
const { authLimiterKey } = require("../dist-main/server/middlewares/authLimiter.js");

test("Docker startup warns when remote Host allowlist is not configured", () => {
  const previousDocker = process.env.API_VAULT_DOCKER;
  const previousHosts = process.env.API_VAULT_ALLOWED_HOSTS;
  const warnings = [];
  const originalWarn = console.warn;

  process.env.API_VAULT_DOCKER = "1";
  delete process.env.API_VAULT_ALLOWED_HOSTS;
  console.warn = (message) => warnings.push(String(message));

  try {
    warnIfDockerAllowedHostsMissing();
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /API_VAULT_ALLOWED_HOSTS/);
    assert.match(warnings[0], /remote requests will receive 403/i);
  } finally {
    console.warn = originalWarn;
    if (previousDocker === undefined) delete process.env.API_VAULT_DOCKER;
    else process.env.API_VAULT_DOCKER = previousDocker;
    if (previousHosts === undefined) delete process.env.API_VAULT_ALLOWED_HOSTS;
    else process.env.API_VAULT_ALLOWED_HOSTS = previousHosts;
  }
});

test("Docker startup does not warn when Host allowlist is configured", () => {
  const previousDocker = process.env.API_VAULT_DOCKER;
  const previousHosts = process.env.API_VAULT_ALLOWED_HOSTS;
  const warnings = [];
  const originalWarn = console.warn;

  process.env.API_VAULT_DOCKER = "1";
  process.env.API_VAULT_ALLOWED_HOSTS = "vault.example.com";
  console.warn = (message) => warnings.push(String(message));

  try {
    warnIfDockerAllowedHostsMissing();
    assert.deepEqual(warnings, []);
  } finally {
    console.warn = originalWarn;
    if (previousDocker === undefined) delete process.env.API_VAULT_DOCKER;
    else process.env.API_VAULT_DOCKER = previousDocker;
    if (previousHosts === undefined) delete process.env.API_VAULT_ALLOWED_HOSTS;
    else process.env.API_VAULT_ALLOWED_HOSTS = previousHosts;
  }
});

test("vault setup only accepts loopback network peers", () => {
  assert.equal(isSetupRequestAllowed({ socket: { remoteAddress: "127.0.0.1" } }), true);
  assert.equal(isSetupRequestAllowed({ socket: { remoteAddress: "::ffff:127.0.0.1" } }), true);
  assert.equal(isSetupRequestAllowed({ socket: { remoteAddress: "192.168.1.50" } }), false);
});

test("auth limiter ignores forwarded addresses unless proxy trust is explicit", () => {
  const previous = process.env.API_VAULT_TRUST_PROXY;
  delete process.env.API_VAULT_TRUST_PROXY;
  try {
    assert.equal(authLimiterKey({
      headers: { "x-forwarded-for": "198.51.100.10, 203.0.113.20" },
      socket: { remoteAddress: "127.0.0.1" }
    }), "127.0.0.1");
  } finally {
    if (previous === undefined) delete process.env.API_VAULT_TRUST_PROXY;
    else process.env.API_VAULT_TRUST_PROXY = previous;
  }
});

test("trusted proxy auth limiter uses the rightmost forwarded address", () => {
  const previous = process.env.API_VAULT_TRUST_PROXY;
  process.env.API_VAULT_TRUST_PROXY = "1";
  try {
    assert.equal(authLimiterKey({
      headers: { "x-forwarded-for": "198.51.100.10, 203.0.113.20" },
      socket: { remoteAddress: "127.0.0.1" }
    }), "203.0.113.20");
  } finally {
    if (previous === undefined) delete process.env.API_VAULT_TRUST_PROXY;
    else process.env.API_VAULT_TRUST_PROXY = previous;
  }
});

test("package metadata uses production naming while preserving the legacy vault verifier", () => {
  const root = path.resolve(__dirname, "..");
  const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  const cryptoSource = fs.readFileSync(path.join(root, "src", "main", "crypto.ts"), "utf8");

  assert.equal(packageJson.name, "api-vault");
  assert.doesNotMatch(packageJson.description, /\bdemo\b/i);
  assert.match(cryptoSource, /api-vault-demo-verifier/);
});
