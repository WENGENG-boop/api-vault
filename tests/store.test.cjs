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

test("store keeps recent 10000 usage events and rolls older calls into week and month buckets", () => {
  const { dir, file } = tempVaultPath("api-vault-store-rollup-");
  try {
    const store = new VaultStore(file);
    store.setup("test-password-123");

    for (let index = 0; index < 10005; index += 1) {
      const startedAt = new Date(Date.UTC(2026, 0, 1, 0, index)).toISOString();
      store.appendUsage(usageEvent(index, startedAt));
    }

    const state = store.getState();
    assert.equal(state.usageEvents.length, 10000);
    assert.equal(state.totals.totalCalls, 10005);
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

test("store links account pools to providers and imports synced models into proxy tokens", () => {
  const { dir, file } = tempVaultPath("api-vault-account-pool-");
  try {
    const store = new VaultStore(file);
    store.setup("test-password-123");

    const pool = store.upsertAccountPool({
      name: "CPA Pool",
      kind: "cpa",
      baseUrl: "http://127.0.0.1:8317",
      apiKey: "cpa-proxy-key"
    });
    assert.equal(pool.hasApiKey, true);

    store.updateAccountPoolSyncResult(pool.id, {
      ok: true,
      status: 200,
      rootStatus: 200,
      modelsStatus: 200,
      latencyMs: 12,
      checkedAt: "2026-05-19T00:00:00.000Z",
      modelNames: ["claude-cpa", "codex-cpa"]
    });

    const linked = store.ensureAccountPoolProvider(pool.id);
    assert.equal(linked.provider.baseUrl, "http://127.0.0.1:8317/v1");
    assert.equal(linked.provider.protocol, "openai-compatible");
    assert.equal(linked.provider.apiKeys.length, 1);

    const token = store.createProxyToken({
      name: "client",
      allowedProviderIds: [],
      allowedModels: [],
      allowStreaming: true,
      requestsPerMinute: 60,
      requestsPerDay: 1000
    }).token;

    const imported = store.importAccountPoolModelsToProxyToken(pool.id, { proxyTokenId: token.id });
    assert.equal(imported.importedCount, 2);

    const state = store.getState();
    const updatedToken = state.proxyTokens.find((item) => item.id === token.id);
    assert.ok(updatedToken);
    assert.equal(updatedToken.allowedProviderIds.includes(linked.provider.id), true);
    assert.deepEqual(updatedToken.allowedModels.map((rule) => ({
      publicModel: rule.publicModel,
      providerId: rule.providerId,
      upstreamModel: rule.upstreamModel
    })), [
      { publicModel: "claude-cpa", providerId: linked.provider.id, upstreamModel: "claude-cpa" },
      { publicModel: "codex-cpa", providerId: linked.provider.id, upstreamModel: "codex-cpa" }
    ]);

    const persisted = fs.readFileSync(file, "utf8");
    assert.equal(persisted.includes("cpa-proxy-key"), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("store keeps provider model catalog metadata and synced models", () => {
  const { dir, file } = tempVaultPath("api-vault-model-catalog-");
  try {
    const store = new VaultStore(file);
    store.setup("test-password-123");
    const added = store.addKeyWithAutoMerge({
      providerName: "Catalog Provider",
      keyName: "catalog",
      protocol: "openai-compatible",
      baseUrl: "https://catalog.example/v1",
      currency: "USD",
      apiKey: "sk-catalog",
      balanceConfig: { enabled: false }
    });

    const manual = store.upsertProviderModel({
      providerId: added.provider.id,
      modelId: "claude-sonnet-4-20250514",
      displayName: "Claude Sonnet 4",
      aliases: ["sonnet 4", "claude 4 sonnet"],
      capabilities: ["text", "vision", "tool"],
      contextWindow: 200000,
      source: "manual"
    });
    assert.equal(manual.providerName, "Catalog Provider");
    assert.equal(manual.displayName, "Claude Sonnet 4");

    store.upsertSyncedProviderModels(added.provider.id, ["claude-sonnet-4-20250514", "gpt-4o"], "2026-05-19T00:00:00.000Z");
    const state = store.getState();
    const catalog = state.modelCatalog.sort((a, b) => a.modelId.localeCompare(b.modelId));
    assert.equal(catalog.length, 2);
    assert.equal(catalog[0].modelId, "claude-sonnet-4-20250514");
    assert.equal(catalog[0].aliases.includes("sonnet 4"), true);
    assert.equal(catalog[0].source, "manual");
    assert.equal(catalog[1].modelId, "gpt-4o");
    assert.equal(catalog[1].source, "auto");
    assert.equal(catalog[1].capabilities.includes("vision"), true);

    const persisted = fs.readFileSync(file, "utf8");
    assert.equal(persisted.includes("sk-catalog"), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});


