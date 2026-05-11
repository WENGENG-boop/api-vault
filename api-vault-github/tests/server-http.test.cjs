const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { createApiServer } = require("../dist-main/server/server.js");
const { ProxyServer } = require("../dist-main/main/proxy.js");
const { VaultStore } = require("../dist-main/main/store.js");

async function listen(server) {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return server.address().port;
}

async function close(server) {
  if (server.listening) {
    await new Promise((resolve) => server.close(resolve));
  }
}

async function requestJson(baseUrl, route, options = {}) {
  const response = await fetch(`${baseUrl}${route}`, {
    method: options.method || "GET",
    headers: options.headers || (options.body === undefined ? undefined : { "content-type": "application/json" }),
    body: options.rawBody ?? (options.body === undefined ? undefined : JSON.stringify(options.body))
  });
  const text = await response.text();
  return {
    status: response.status,
    ok: response.ok,
    data: text ? JSON.parse(text) : undefined
  };
}

test("HTTP API manages vault, providers, proxy usage, and billing sync", async () => {
  const upstreamHits = [];
  const upstream = http.createServer((req, res) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      const body = Buffer.concat(chunks).toString("utf8");
      upstreamHits.push({ url: req.url, authorization: req.headers.authorization, body });

      if (req.url === "/v1/billing") {
        assert.equal(req.headers.authorization, "Bearer q-real");
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ data: { balance: "91.25", used: 8.75, currency: "USD" } }));
        return;
      }

      assert.equal(req.url, "/v1/chat/completions");
      assert.equal(req.headers.authorization, "Bearer sk-real");
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({
        model: "vendor-model",
        choices: [{ message: { role: "assistant", content: "pong" } }],
        usage: { prompt_tokens: 11, completion_tokens: 7, total_tokens: 18, cost: 0.0123, currency: "credits" }
      }));
    });
  });

  const upstreamPort = await listen(upstream);
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "api-vault-http-"));
  const store = new VaultStore(path.join(tempDir, "vault.json"));
  const proxy = new ProxyServer(store);
  await proxy.start();
  const api = createApiServer({ store, proxy });
  const apiPort = await listen(api);
  const apiBase = `http://127.0.0.1:${apiPort}`;

  try {
    let result = await requestJson(apiBase, "/api/vault/setup", {
      method: "POST",
      body: { password: "test-password-123" }
    });
    assert.equal(result.status, 200);
    assert.equal(result.data.unlocked, true);

    result = await requestJson(apiBase, "/api/providers/add-key", {
      method: "POST",
      body: {
        providerName: "OpenAI Third Party",
        keyName: "key1",
        protocol: "openai-compatible",
        baseUrl: `http://127.0.0.1:${upstreamPort}/v1`,
        currency: "USD",
        apiKey: "sk-real",
        queryKey: "q-real",
        balanceConfig: {
          enabled: true,
          url: `http://127.0.0.1:${upstreamPort}/v1/billing`,
          method: "GET",
          headersJson: "{\"Authorization\":\"Bearer {{queryKey}}\"}",
          bodyTemplate: "",
          balancePath: "data.balance",
          spentPath: "data.used",
          currencyPath: "data.currency",
          responseCostPath: "usage.cost"
        }
      }
    });
    assert.equal(result.status, 200);
    assert.equal(JSON.stringify(result.data).includes("sk-real"), false);
    const provider = result.data.providers[0];
    const key1 = provider.apiKeys[0];

    result = await requestJson(apiBase, "/api/providers/add-key", {
      method: "POST",
      body: {
        providerName: "Should Merge",
        keyName: "key2",
        protocol: "openai-compatible",
        baseUrl: `http://127.0.0.1:${upstreamPort}/v1`,
        currency: "USD",
        apiKey: "sk-fake",
        balanceConfig: { enabled: false }
      }
    });
    assert.equal(result.status, 200);
    assert.equal(result.data.providers.length, 1);
    assert.equal(result.data.providers[0].apiKeys.length, 2);

    result = await requestJson(apiBase, `/api/providers/${provider.id}/keys/${key1.id}/secret?kind=api`);
    assert.equal(result.status, 200);
    assert.equal(result.data.secret, "sk-real");

    result = await requestJson(apiBase, `/api/providers/${provider.id}/keys/${key1.id}/proxy-url`);
    assert.equal(result.status, 200);
    const chat = await fetch(`${result.data.url}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer replaced" },
      body: JSON.stringify({ model: "vendor-model", messages: [{ role: "user", content: "ping" }] })
    });
    assert.equal(chat.status, 200);
    assert.equal((await chat.json()).usage.total_tokens, 18);

    result = await requestJson(apiBase, `/api/providers/${provider.id}/test-balance`, { method: "POST" });
    assert.equal(result.status, 200);
    assert.equal(result.data.result.snapshot.balance, 91.25);
    assert.equal(result.data.result.snapshot.spent, 8.75);

    result = await requestJson(apiBase, "/api/state");
    assert.equal(result.status, 200);
    assert.equal(result.data.usageEvents.length, 1);
    assert.equal(result.data.usageEvents[0].apiKeyId, key1.id);
    assert.equal(result.data.usageEvents[0].apiKeyName, "key1");
    assert.equal(result.data.usageEvents[0].baseUrl, `http://127.0.0.1:${upstreamPort}/v1`);
    assert.equal(result.data.usageEvents[0].realCost, 0.0123);
    assert.equal(result.data.usageEvents[0].currency, "credits");
    assert.equal(result.data.balanceSnapshots.length, 1);
    assert.equal(upstreamHits.length, 2);

    const persisted = fs.readFileSync(path.join(tempDir, "vault.json"), "utf8");
    assert.equal(persisted.includes("sk-real"), false);
    assert.equal(persisted.includes("q-real"), false);
  } finally {
    proxy.stop();
    await close(api);
    await close(upstream);
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("HTTP API returns specific status codes for invalid inputs", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "api-vault-errors-"));
  const store = new VaultStore(path.join(tempDir, "vault.json"));
  const proxy = new ProxyServer(store);
  await proxy.start();
  const api = createApiServer({ store, proxy });
  const apiPort = await listen(api);
  const apiBase = `http://127.0.0.1:${apiPort}`;

  try {
    let result = await requestJson(apiBase, "/api/nope");
    assert.equal(result.status, 404);
    assert.equal(result.data.code, "api_route_not_found");

    result = await requestJson(apiBase, "/api/vault/setup", {
      method: "POST",
      headers: { "content-type": "application/json" },
      rawBody: "{bad-json"
    });
    assert.equal(result.status, 400);
    assert.equal(result.data.code, "invalid_json");

    result = await requestJson(apiBase, "/api/vault/setup", {
      method: "POST",
      body: { password: "test-password-123" }
    });
    assert.equal(result.status, 200);

    result = await requestJson(apiBase, "/api/providers/add-key", {
      method: "POST",
      body: {
        providerName: "Missing Key",
        keyName: "missing",
        protocol: "openai-compatible",
        baseUrl: "https://example.com/v1",
        currency: "USD",
        balanceConfig: { enabled: false }
      }
    });
    assert.equal(result.status, 400);
    assert.equal(result.data.code, "api_key_required");

    result = await requestJson(apiBase, "/api/providers/add-key", {
      method: "POST",
      body: {
        providerName: "Bad URL",
        keyName: "bad",
        protocol: "openai-compatible",
        baseUrl: "ftp://example.com/v1",
        currency: "USD",
        apiKey: "sk-test",
        balanceConfig: { enabled: false }
      }
    });
    assert.equal(result.status, 400);
    assert.equal(result.data.code, "invalid_url");

    const unknownProxy = await fetch(`http://127.0.0.1:${proxy.getPort()}/proxy/missing/v1/chat/completions`, {
      method: "POST",
      body: "{}"
    });
    assert.equal(unknownProxy.status, 404);
    assert.equal((await unknownProxy.json()).code, "provider_not_found");

    result = await requestJson(apiBase, "/api/vault/lock", { method: "POST" });
    assert.equal(result.status, 200);

    result = await requestJson(apiBase, "/api/providers/add-key", {
      method: "POST",
      body: {
        providerName: "Locked",
        keyName: "locked",
        protocol: "openai-compatible",
        baseUrl: "https://example.com/v1",
        currency: "USD",
        apiKey: "sk-test",
        balanceConfig: { enabled: false }
      }
    });
    assert.equal(result.status, 423);
    assert.equal(result.data.code, "vault_locked");
  } finally {
    proxy.stop();
    await close(api);
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
