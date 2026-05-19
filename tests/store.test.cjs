const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { VaultStore } = require("../dist-main/main/store.js");

function tempVaultPath(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  return {
    dir,
    file: path.join(dir, "vault.json")
  };
}

function usageEvent(index, startedAt) {
  return {
    id: `event-${index}`,
    providerId: "provider-1",
    providerName: "Provider",
    protocol: "openai-compatible",
    path: "/v1/chat/completions",
    method: "POST",
    model: index % 2 === 0 ? "model-a" : "model-b",
    status: 200,
    ok: true,
    startedAt,
    latencyMs: 10,
    inputTokens: 10,
    outputTokens: 5,
    totalTokens: 15
  };
}

test("store keeps recent 1000 usage events and rolls older calls into week and month buckets", () => {
  const { dir, file } = tempVaultPath("api-vault-store-rollup-");
  try {
    const store = new VaultStore(file);
    store.setup("test-password-123");

    for (let index = 0; index < 1005; index += 1) {
      const startedAt = new Date(Date.UTC(2026, 0, 1, 0, index)).toISOString();
      store.appendUsage(usageEvent(index, startedAt));
    }

    const state = store.getState();
    assert.equal(state.usageEvents.length, 1000);
    assert.equal(state.totals.totalCalls, 1005);
    assert.equal(state.usageRollups.filter((rollup) => rollup.period === "week").reduce((sum, item) => sum + item.calls, 0), 5);
    assert.equal(state.usageRollups.filter((rollup) => rollup.period === "month").reduce((sum, item) => sum + item.calls, 0), 5);
    assert.equal(state.usageRollups.filter((rollup) => rollup.period === "month").reduce((sum, item) => sum + item.totalTokens, 0), 75);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("store reloads disk state after pending usage is flushed by a state read", () => {
  const { dir, file } = tempVaultPath("api-vault-store-reload-");
  try {
    const first = new VaultStore(file);
    first.setup("test-password-123");
    const second = new VaultStore(file);
    second.unlock("test-password-123");

    assert.equal(second.getState().totals.totalCalls, 0);
    first.appendUsage(usageEvent(1, "2026-01-01T00:00:00.000Z"));
    assert.equal(first.getState().totals.totalCalls, 1);

    const state = second.getState();
    assert.equal(state.totals.totalCalls, 1);
    assert.equal(state.usageEvents[0].id, "event-1");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("store batches usage and last-used writes until flush", () => {
  const { dir, file } = tempVaultPath("api-vault-store-buffer-");
  try {
    const store = new VaultStore(file);
    store.setup("test-password-123");
    const added = store.addKeyWithAutoMerge({
      providerName: "Buffered Provider",
      keyName: "buffered",
      protocol: "openai-compatible",
      baseUrl: "https://buffered.example/v1",
      currency: "USD",
      apiKey: "sk-buffered",
      balanceConfig: { enabled: false }
    });
    const token = store.createProxyToken({
      name: "buffered token",
      allowedProviderIds: [added.provider.id],
      allowedModels: [],
      allowStreaming: true,
      requestsPerMinute: 60,
      requestsPerDay: 1000
    }).token;

    store.appendUsage(usageEvent(2, "2026-01-01T00:02:00.000Z"));
    store.markApiKeyUsed(added.provider.id, added.apiKey.id, "2026-01-01T00:02:01.000Z");
    store.markProxyTokenUsed(token.id, "2026-01-01T00:02:02.000Z");

    let persisted = JSON.parse(fs.readFileSync(file, "utf8"));
    assert.equal(persisted.usageEvents.length, 0);
    assert.equal(persisted.providers[0].apiKeys[0].lastUsedAt, undefined);
    assert.equal(persisted.proxyTokens[0].lastUsedAt, undefined);

    const state = store.getState();
    assert.equal(state.usageEvents.length, 1);
    assert.equal(state.providers[0].apiKeys[0].lastUsedAt, "2026-01-01T00:02:01.000Z");
    assert.equal(state.proxyTokens[0].lastUsedAt, "2026-01-01T00:02:02.000Z");

    persisted = JSON.parse(fs.readFileSync(file, "utf8"));
    assert.equal(persisted.usageEvents.length, 1);
    assert.equal(persisted.providers[0].apiKeys[0].lastUsedAt, "2026-01-01T00:02:01.000Z");
    assert.equal(persisted.proxyTokens[0].lastUsedAt, "2026-01-01T00:02:02.000Z");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("store backfills api key hashes for older vault data on unlock", () => {
  const { dir, file } = tempVaultPath("api-vault-store-keyhash-");
  try {
    const first = new VaultStore(file);
    first.setup("test-password-123");
    const added = first.addKeyWithAutoMerge({
      providerName: "Hash Backfill",
      keyName: "legacy",
      protocol: "openai-compatible",
      baseUrl: "https://vendor.example/v1",
      currency: "USD",
      apiKey: "sk-legacy",
      balanceConfig: { enabled: false }
    });
    assert.ok(added.apiKey.id);

    const legacyData = JSON.parse(fs.readFileSync(file, "utf8"));
    delete legacyData.providers[0].apiKeys[0].keyHash;
    fs.writeFileSync(file, `${JSON.stringify(legacyData, null, 2)}\n`, "utf8");

    const second = new VaultStore(file);
    second.unlock("test-password-123");
    const migrated = JSON.parse(fs.readFileSync(file, "utf8"));

    assert.match(migrated.providers[0].apiKeys[0].keyHash, /^[a-f0-9]{64}$/);
    assert.equal(JSON.stringify(migrated).includes("sk-legacy"), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});


