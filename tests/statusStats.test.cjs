const test = require("node:test");
const assert = require("node:assert/strict");
const {
  buildModelStatusSummaries,
  buildProviderStatusSummaries
} = require("../dist-main/shared/statusStats.js");

const now = Date.parse("2026-05-24T12:00:00.000Z");

function provider(id, status = "available") {
  return {
    id,
    name: id === "p1" ? "Provider One" : "Provider Two",
    protocol: "openai-compatible",
    baseUrl: `https://${id}.example/v1`,
    currency: "USD",
    balanceConfig: {},
    apiKeys: [],
    createdAt: "2026-05-01T00:00:00.000Z",
    updatedAt: "2026-05-01T00:00:00.000Z",
    status,
    latencyMs: 123,
    lastCheckedAt: "2026-05-24T11:59:00.000Z"
  };
}

function event(providerId, model, ok, index = 0) {
  return {
    id: `${providerId}-${model}-${ok}-${index}`,
    providerId,
    providerName: providerId === "p1" ? "Provider One" : "Provider Two",
    protocol: "openai-compatible",
    path: "/chat/completions",
    method: "POST",
    model,
    status: ok ? 200 : 500,
    ok,
    startedAt: "2026-05-24T10:00:00.000Z",
    latencyMs: 100 + index
  };
}

test("provider status calculates success rate for the last 7 days", () => {
  const events = [
    event("p1", "gpt-4o", true, 1),
    event("p1", "gpt-4o", true, 2),
    event("p1", "gpt-4o", false, 3),
    { ...event("p1", "gpt-4o", false, 4), startedAt: "2026-05-01T10:00:00.000Z" }
  ];

  const [summary] = buildProviderStatusSummaries([provider("p1")], events, [], now);
  assert.equal(summary.calls, 3);
  assert.equal(summary.okCalls, 2);
  assert.equal(summary.failedCalls, 1);
  assert.equal(summary.successRate, 2 / 3);
  assert.equal(summary.level, "outage");
});

test("model status keeps provider rows separate for the same model", () => {
  const events = [
    event("p1", "gpt-4o", true, 1),
    event("p2", "gpt-4o", true, 2),
    event("p2", "gpt-4o", false, 3)
  ];

  const [summary] = buildModelStatusSummaries(events, [], [], now);
  assert.equal(summary.modelName, "gpt-4o");
  assert.equal(summary.providers.length, 2);
  assert.deepEqual(summary.providers.map((item) => item.providerId).sort(), ["p1", "p2"]);
  assert.equal(summary.providers.find((item) => item.providerId === "p2").failedCalls, 1);
});

test("provider with no calls is no traffic when connection is not failed", () => {
  const [summary] = buildProviderStatusSummaries([provider("p1")], [], [], now);
  assert.equal(summary.calls, 0);
  assert.equal(summary.level, "no-traffic");
});

test("failed provider test marks provider as outage", () => {
  const [summary] = buildProviderStatusSummaries([provider("p1", "unavailable")], [], [], now);
  assert.equal(summary.level, "outage");
});

test("success rate boundaries classify 95 percent and 80 percent correctly", () => {
  const ninetyFive = Array.from({ length: 100 }, (_, index) => event("p1", "gpt-4o", index < 95, index));
  const seventy = Array.from({ length: 100 }, (_, index) => event("p2", "gpt-4o", index < 70, index));

  const summaries = buildProviderStatusSummaries([provider("p1"), provider("p2")], [...ninetyFive, ...seventy], [], now);
  assert.equal(summaries.find((item) => item.providerId === "p1").level, "operational");
  assert.equal(summaries.find((item) => item.providerId === "p2").level, "outage");
});
