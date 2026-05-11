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

test("store keeps recent 100 usage events and rolls older calls into week and month buckets", () => {
  const { dir, file } = tempVaultPath("api-vault-store-rollup-");
  try {
    const store = new VaultStore(file);
    store.setup("test-password-123");

    for (let index = 0; index < 105; index += 1) {
      const startedAt = new Date(Date.UTC(2026, 0, 1, 0, index)).toISOString();
      store.appendUsage(usageEvent(index, startedAt));
    }

    const state = store.getState();
    assert.equal(state.usageEvents.length, 100);
    assert.equal(state.totals.totalCalls, 105);
    assert.equal(state.usageRollups.filter((rollup) => rollup.period === "week").reduce((sum, item) => sum + item.calls, 0), 5);
    assert.equal(state.usageRollups.filter((rollup) => rollup.period === "month").reduce((sum, item) => sum + item.calls, 0), 5);
    assert.equal(state.usageRollups.filter((rollup) => rollup.period === "month").reduce((sum, item) => sum + item.totalTokens, 0), 75);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("store reloads disk state so multiple local server processes do not diverge", () => {
  const { dir, file } = tempVaultPath("api-vault-store-reload-");
  try {
    const first = new VaultStore(file);
    first.setup("test-password-123");
    const second = new VaultStore(file);
    second.unlock("test-password-123");

    assert.equal(second.getState().totals.totalCalls, 0);
    first.appendUsage(usageEvent(1, "2026-01-01T00:00:00.000Z"));

    const state = second.getState();
    assert.equal(state.totals.totalCalls, 1);
    assert.equal(state.usageEvents[0].id, "event-1");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
