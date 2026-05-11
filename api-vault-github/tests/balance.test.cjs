const http = require("node:http");
const test = require("node:test");
const assert = require("node:assert/strict");
const { syncBalance } = require("../dist-main/main/balance.js");

test("syncs real balance from a custom provider endpoint", async () => {
  const server = http.createServer((req, res) => {
    assert.equal(req.headers.authorization, "Bearer q-real");
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ data: { balance: "42.25", used: 7.5, currency: "USD" } }));
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;

  try {
    const result = await syncBalance({
      id: "provider-1",
      name: "Third Party",
      protocol: "openai-compatible",
      baseUrl: "https://vendor.example/v1",
      currency: "USD",
      hasApiKey: true,
      hasQueryKey: true,
      apiKey: "sk-real",
      queryKey: "q-real",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      balanceConfig: {
        enabled: true,
        url: `http://127.0.0.1:${port}/balance`,
        method: "GET",
        headersJson: "{\"Authorization\":\"Bearer {{queryKey}}\"}",
        bodyTemplate: "",
        balancePath: "data.balance",
        spentPath: "data.used",
        currencyPath: "data.currency",
        responseCostPath: ""
      }
    });

    assert.equal(result.snapshot.ok, true);
    assert.equal(result.snapshot.balance, 42.25);
    assert.equal(result.snapshot.spent, 7.5);
    assert.equal(result.snapshot.currency, "USD");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("syncs New API token usage without treating unlimited quota as a negative balance", async () => {
  const server = http.createServer((req, res) => {
    assert.equal(req.headers.authorization, "Bearer sk-real");
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({
      code: true,
        data: {
          object: "token_usage",
          name: "demo token",
          total_available: -29894104,
          total_granted: 0,
          total_used: 29894104,
        unlimited_quota: true
      },
      message: "ok"
    }));
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;

  try {
    const result = await syncBalance({
      id: "provider-1",
      name: "New API",
      protocol: "openai-compatible",
      baseUrl: "https://vendor.example/v1",
      currency: "RMB",
      hasApiKey: true,
      hasQueryKey: false,
      apiKey: "sk-real",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      balanceConfig: {
        enabled: true,
        url: `http://127.0.0.1:${port}/api/usage/token`,
        method: "GET",
        headersJson: "{\"Authorization\":\"Bearer {{apiKey}}\"}",
        bodyTemplate: "",
        balancePath: "data.total_available",
        spentPath: "data.total_used",
        currencyPath: "",
        responseCostPath: ""
      }
    });

    assert.equal(result.snapshot.ok, true);
    assert.equal(result.snapshot.balance, undefined);
    assert.equal(result.snapshot.spent, 29894104);
    assert.equal(result.snapshot.granted, 0);
    assert.equal(result.snapshot.currency, undefined);
    assert.equal(result.snapshot.unlimitedQuota, true);
    assert.equal(result.snapshot.tokenName, "demo token");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("uses unit returned by the balance endpoint", async () => {
  const server = http.createServer((req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ data: { available: 1200, used: 34, unit: "credits" } }));
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;

  try {
    const result = await syncBalance({
      id: "provider-1",
      name: "Credits Provider",
      protocol: "openai-compatible",
      baseUrl: "https://vendor.example/v1",
      currency: "USD",
      hasApiKey: true,
      hasQueryKey: false,
      apiKey: "sk-real",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      balanceConfig: {
        enabled: true,
        url: `http://127.0.0.1:${port}/usage`,
        method: "GET",
        headersJson: "",
        bodyTemplate: "",
        balancePath: "data.available",
        spentPath: "data.used",
        currencyPath: "",
        responseCostPath: ""
      }
    });

    assert.equal(result.snapshot.ok, true);
    assert.equal(result.snapshot.balance, 1200);
    assert.equal(result.snapshot.spent, 34);
    assert.equal(result.snapshot.currency, "credits");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
