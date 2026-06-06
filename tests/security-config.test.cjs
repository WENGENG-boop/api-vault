const test = require("node:test");
const assert = require("node:assert/strict");

const { warnIfDockerAllowedHostsMissing } = require("../dist-main/server/startup.js");

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
