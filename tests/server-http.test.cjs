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
      assert.ok(["Bearer sk-real", "Bearer sk-fake"].includes(req.headers.authorization));
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
    const mergedProvider = result.data.providers[0];
    const key2 = mergedProvider.apiKeys.find((item) => item.name === "key2");
    assert.ok(key2);

    result = await requestJson(apiBase, `/api/providers/${provider.id}/keys/${key1.id}/secret?kind=api`);
    assert.equal(result.status, 200);
    assert.equal(result.data.secret, "sk-real");

    result = await requestJson(apiBase, `/api/providers/${provider.id}/proxy-url`);
    assert.equal(result.status, 200);
    assert.equal(result.data.url.includes(`/${key1.id}/`), false);
    assert.equal(result.data.url, mergedProvider.proxyBaseUrl);

    const keyRouteResult = await requestJson(apiBase, `/api/providers/${provider.id}/keys/${key1.id}/proxy-url`);
    assert.equal(keyRouteResult.status, 200);
    assert.equal(keyRouteResult.data.url, result.data.url);

    const providerProxyNoKey = await fetch(`http://127.0.0.1:${proxy.getPort()}/proxy/${provider.id}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: "vendor-model", messages: [] })
    });
    assert.equal(providerProxyNoKey.status, 400);
    assert.equal((await providerProxyNoKey.json()).code, "missing_api_key");

    const previousFallback = process.env.API_VAULT_ALLOW_PROVIDER_PROXY_WITHOUT_KEY;
    process.env.API_VAULT_ALLOW_PROVIDER_PROXY_WITHOUT_KEY = "1";
    try {
      const providerProxyFallback = await fetch(`http://127.0.0.1:${proxy.getPort()}/proxy/${provider.id}/v1/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model: "vendor-model", messages: [] })
      });
      assert.equal(providerProxyFallback.status, 200);
      assert.equal((await providerProxyFallback.json()).usage.total_tokens, 18);
    } finally {
      if (previousFallback === undefined) {
        delete process.env.API_VAULT_ALLOW_PROVIDER_PROXY_WITHOUT_KEY;
      } else {
        process.env.API_VAULT_ALLOW_PROVIDER_PROXY_WITHOUT_KEY = previousFallback;
      }
    }

    const openaiGlobalUrl = `http://127.0.0.1:${proxy.getPort()}/proxy/openai/v1`;
    const chat = await fetch(`${openaiGlobalUrl}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer sk-real" },
      body: JSON.stringify({ model: "vendor-model", messages: [{ role: "user", content: "ping" }] })
    });
    assert.equal(chat.status, 200);
    assert.equal((await chat.json()).usage.total_tokens, 18);

    const secondChat = await fetch(`${openaiGlobalUrl}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer sk-fake" },
      body: JSON.stringify({ model: "vendor-model", messages: [{ role: "user", content: "ping2" }] })
    });
    assert.equal(secondChat.status, 200);
    assert.equal((await secondChat.json()).usage.total_tokens, 18);

    result = await requestJson(apiBase, "/api/proxy-tokens", {
      method: "POST",
      body: {
        name: "ci client",
        allowedProviderIds: [provider.id],
        allowedModels: [{
          publicModel: "public-chat",
          providerId: provider.id,
          apiKeyId: key1.id,
          upstreamModel: "vendor-model"
        }],
        allowStreaming: false,
        requestsPerMinute: 10,
        requestsPerDay: 100
      }
    });
    assert.equal(result.status, 200);
    assert.match(result.data.secret, /^proxy_/);
    assert.equal(result.data.state.proxyTokens.length, 1);
    assert.equal(JSON.stringify(result.data.state).includes(result.data.secret), false);

    const publicProxy = await fetch(`http://127.0.0.1:${proxy.getPort()}/proxy/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${result.data.secret}` },
      body: JSON.stringify({ model: "public-chat", messages: [{ role: "user", content: "remote" }] })
    });
    assert.equal(publicProxy.status, 200);
    assert.equal((await publicProxy.json()).usage.total_tokens, 18);

    result = await requestJson(apiBase, `/api/providers/${provider.id}/test-balance`, { method: "POST" });
    assert.equal(result.status, 200);
    assert.equal(result.data.result.snapshot.balance, 91.25);
    assert.equal(result.data.result.snapshot.spent, 8.75);

    result = await requestJson(apiBase, "/api/state");
    assert.equal(result.status, 200);
    assert.equal(result.data.usageEvents.length, 4);
    const publicEvent = result.data.usageEvents.find((event) => event.gatewayType === "public-proxy");
    assert.equal(publicEvent.proxyTokenName, "ci client");
    assert.equal(publicEvent.model, "vendor-model");
    const key1Event = result.data.usageEvents.find((event) => event.apiKeyId === key1.id && event.gatewayType === "openai");
    const key2Event = result.data.usageEvents.find((event) => event.apiKeyId === key2.id);
    assert.equal(key1Event.apiKeyName, "key1");
    assert.equal(key2Event.apiKeyName, "key2");
    assert.equal(key1Event.baseUrl, `http://127.0.0.1:${upstreamPort}/v1`);
    assert.equal(key1Event.gatewayType, "openai");
    assert.equal(key1Event.gatewayBaseUrl, openaiGlobalUrl);
    assert.equal(key2Event.gatewayType, "openai");
    assert.equal(key2Event.gatewayBaseUrl, openaiGlobalUrl);
    assert.equal(key1Event.realCost, 0.0123);
    assert.equal(key1Event.currency, "credits");
    assert.equal(result.data.balanceSnapshots.length, 1);
    assert.equal(upstreamHits.length, 5);

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

    const missingKeyGlobal = await fetch(`http://127.0.0.1:${proxy.getPort()}/proxy/openai/v1/models`);
    assert.equal(missingKeyGlobal.status, 401);
    assert.equal((await missingKeyGlobal.json()).code, "missing_api_key");

    const unknownKeyGlobal = await fetch(`http://127.0.0.1:${proxy.getPort()}/proxy/openai/v1/models`, {
      headers: { authorization: "Bearer sk-not-registered" }
    });
    assert.equal(unknownKeyGlobal.status, 404);
    assert.equal((await unknownKeyGlobal.json()).code, "api_key_not_found");

    result = await requestJson(apiBase, "/api/providers/add-key", {
      method: "POST",
      body: {
        providerName: "Dup One",
        keyName: "dup-a",
        protocol: "openai-compatible",
        baseUrl: "https://dup-one.example/v1",
        currency: "USD",
        apiKey: "sk-dup",
        balanceConfig: { enabled: false }
      }
    });
    assert.equal(result.status, 200);

    result = await requestJson(apiBase, "/api/providers/add-key", {
      method: "POST",
      body: {
        providerName: "Dup Two",
        keyName: "dup-b",
        protocol: "openai-compatible",
        baseUrl: "https://dup-two.example/v1",
        currency: "USD",
        apiKey: "sk-dup",
        balanceConfig: { enabled: false }
      }
    });
    assert.equal(result.status, 200);

    const duplicateKeyGlobal = await fetch(`http://127.0.0.1:${proxy.getPort()}/proxy/openai/v1/models`, {
      headers: { authorization: "Bearer sk-dup" }
    });
    assert.equal(duplicateKeyGlobal.status, 409);
    assert.equal((await duplicateKeyGlobal.json()).code, "duplicate_api_key");

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

test("HTTP API CORS defaults to the current local service origin", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "api-vault-cors-"));
  const store = new VaultStore(path.join(tempDir, "vault.json"));
  const proxy = new ProxyServer(store);
  await proxy.start();
  const api = createApiServer({ store, proxy });
  const apiPort = await listen(api);
  const apiBase = `http://127.0.0.1:${apiPort}`;

  try {
    const sameOrigin = await fetch(`${apiBase}/api/state`, {
      headers: { origin: apiBase }
    });
    assert.equal(sameOrigin.headers.get("access-control-allow-origin"), apiBase);

    const otherOrigin = await fetch(`${apiBase}/api/state`, {
      headers: { origin: "http://localhost:9999" }
    });
    assert.equal(otherOrigin.headers.get("access-control-allow-origin"), null);
  } finally {
    proxy.stop();
    await close(api);
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("provider proxy parses JSON stream flag before injecting stream options", async () => {
  let upstreamBody = "";
  const upstream = http.createServer((req, res) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      upstreamBody = Buffer.concat(chunks).toString("utf8");
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({
        model: "vendor-model",
        choices: [],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }
      }));
    });
  });

  const upstreamPort = await listen(upstream);
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "api-vault-stream-"));
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

    result = await requestJson(apiBase, "/api/providers/add-key", {
      method: "POST",
      body: {
        providerName: "Stream Provider",
        keyName: "stream",
        protocol: "openai-compatible",
        baseUrl: `http://127.0.0.1:${upstreamPort}/v1`,
        currency: "USD",
        apiKey: "sk-stream",
        balanceConfig: { enabled: false }
      }
    });
    assert.equal(result.status, 200);
    const provider = result.data.providers[0];

    const response = await fetch(`http://127.0.0.1:${proxy.getPort()}/proxy/${provider.id}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer sk-stream" },
      rawBody: undefined,
      body: `{ "model": "vendor-model", "stream" : true, "messages": [] }`
    });
    assert.equal(response.status, 200);
    await response.text();

    const forwarded = JSON.parse(upstreamBody);
    assert.equal(forwarded.stream, true);
    assert.deepEqual(forwarded.stream_options, { include_usage: true });
  } finally {
    proxy.stop();
    await close(api);
    await close(upstream);
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("URL test falls back to unauthenticated Anthropic-compatible probes when models route returns 404 with a key", async () => {
  const upstreamHits = [];
  const upstream = http.createServer((req, res) => {
    upstreamHits.push({ url: req.url, xApiKey: req.headers["x-api-key"] });
    if (req.url === "/anthropic/models" && !req.headers["x-api-key"]) {
      res.writeHead(401, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "missing auth" }));
      return;
    }
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "not found" }));
  });

  const upstreamPort = await listen(upstream);
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "api-vault-anthropic-test-url-"));
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

    result = await requestJson(apiBase, "/api/providers/add-key", {
      method: "POST",
      body: {
        providerName: "Anthropic Route",
        keyName: "anthropic",
        protocol: "anthropic-compatible",
        baseUrl: `http://127.0.0.1:${upstreamPort}/anthropic`,
        currency: "USD",
        apiKey: "sk-anthropic",
        balanceConfig: { enabled: false }
      }
    });
    assert.equal(result.status, 200);
    const provider = result.data.providers[0];

    result = await requestJson(apiBase, "/api/test-url", {
      method: "POST",
      body: {
        providerId: provider.id,
        protocol: "anthropic-compatible",
        baseUrl: provider.baseUrl
      }
    });

    assert.equal(result.status, 200);
    assert.equal(result.data.ok, true);
    assert.equal(result.data.status, 401);
    assert.equal(upstreamHits.some((hit) => hit.url === "/anthropic/models" && hit.xApiKey === undefined), true);
  } finally {
    proxy.stop();
    await close(api);
    await close(upstream);
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("global gateways can route dual OpenAI and Anthropic compatible providers", async () => {
  const upstreamHits = [];
  const upstream = http.createServer((req, res) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      upstreamHits.push({
        url: req.url,
        authorization: req.headers.authorization,
        xApiKey: req.headers["x-api-key"],
        anthropicVersion: req.headers["anthropic-version"]
      });

      if (req.url === "/v1/chat/completions") {
        assert.equal(req.headers.authorization, "Bearer sk-dual");
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({
          model: "dual-openai-model",
          choices: [],
          usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 }
        }));
        return;
      }

      if (req.url === "/v1/messages") {
        assert.equal(req.headers["x-api-key"], "sk-dual");
        assert.ok(req.headers["anthropic-version"]);
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({
          model: "dual-anthropic-model",
          content: [],
          usage: { input_tokens: 7, output_tokens: 4 }
        }));
        return;
      }

      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "unexpected route" }));
    });
  });

  const upstreamPort = await listen(upstream);
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "api-vault-dual-"));
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

    result = await requestJson(apiBase, "/api/providers/add-key", {
      method: "POST",
      body: {
        providerName: "Dual Provider",
        keyName: "dual",
        protocol: "openai-anthropic-compatible",
        baseUrl: `http://127.0.0.1:${upstreamPort}`,
        currency: "USD",
        apiKey: "sk-dual",
        balanceConfig: { enabled: false }
      }
    });
    assert.equal(result.status, 200);
    assert.equal(result.data.providers[0].protocol, "openai-anthropic-compatible");

    const openaiGlobal = `http://127.0.0.1:${proxy.getPort()}/proxy/openai/v1`;
    const anthropicGlobal = `http://127.0.0.1:${proxy.getPort()}/proxy/anthropic`;
    const autoGlobal = `http://127.0.0.1:${proxy.getPort()}/proxy/auto/v1`;

    let response = await fetch(`${openaiGlobal}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer sk-dual" },
      body: JSON.stringify({ model: "dual-openai-model", messages: [] })
    });
    assert.equal(response.status, 200);

    response = await fetch(`${anthropicGlobal}/v1/messages`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": "sk-dual", "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: "dual-anthropic-model", messages: [] })
    });
    assert.equal(response.status, 200);

    response = await fetch(`${autoGlobal}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer sk-dual" },
      body: JSON.stringify({ model: "dual-openai-model", messages: [] })
    });
    assert.equal(response.status, 200);

    response = await fetch(`${autoGlobal}/messages`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": "sk-dual", "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: "dual-anthropic-model", messages: [] })
    });
    assert.equal(response.status, 200);

    result = await requestJson(apiBase, "/api/state");
    assert.equal(result.status, 200);
    assert.equal(result.data.usageEvents.length, 4);
    assert.equal(result.data.usageEvents.filter((event) => event.gatewayType === "auto").length, 2);
    assert.equal(result.data.usageEvents.some((event) => event.protocol === "openai-compatible"), true);
    assert.equal(result.data.usageEvents.some((event) => event.protocol === "anthropic-compatible"), true);
    assert.equal(upstreamHits.length, 4);
  } finally {
    proxy.stop();
    await close(api);
    await close(upstream);
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});






