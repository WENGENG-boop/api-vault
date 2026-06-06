const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { createApiServer } = require("../dist-main/server/server.js");
const { handleApi } = require("../dist-main/server/routes/apiRoutes.js");
const { ProxyServer } = require("../dist-main/main/proxy.js");
const { VaultStore } = require("../dist-main/main/store.js");
const { resetAuthLimiter } = require("../dist-main/server/middlewares/authLimiter.js");

async function listen(server) {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return server.address().port;
}

async function close(server) {
  if (server.listening) {
    await new Promise((resolve) => server.close(resolve));
  }
}

async function requestWithHost(port, route, headers = {}) {
  return await new Promise((resolve, reject) => {
    const req = http.request({
      host: "127.0.0.1",
      port,
      path: route,
      method: "GET",
      headers
    }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => resolve({
        status: res.statusCode,
        headers: res.headers,
        body: Buffer.concat(chunks).toString("utf8")
      }));
    });
    req.on("error", reject);
    req.end();
  });
}

const adminTokens = new Map();

async function requestJson(baseUrl, route, options = {}) {
  const headers = { ...(options.headers || (options.body === undefined ? {} : { "content-type": "application/json" })) };
  const adminToken = adminTokens.get(baseUrl);
  if (adminToken && !headers["x-api-vault-admin"]) headers["x-api-vault-admin"] = adminToken;
  const response = await fetch(`${baseUrl}${route}`, {
    method: options.method || "GET",
    headers: Object.keys(headers).length ? headers : undefined,
    body: options.rawBody ?? (options.body === undefined ? undefined : JSON.stringify(options.body))
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : undefined;
  if (data?.adminToken) adminTokens.set(baseUrl, data.adminToken);
  return {
    status: response.status,
    ok: response.ok,
    data
  };
}

test("remote vault setup requires the startup bootstrap token", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "api-vault-bootstrap-"));
  const store = new VaultStore(path.join(tempDir, "vault.json"));
  const bootstrapToken = "bootstrap-test-secret";
  const api = http.createServer((req, res) => {
    Object.defineProperty(req.socket, "remoteAddress", { value: "192.168.1.50" });
    const url = new URL(req.url || "/", `http://${req.headers.host || "127.0.0.1"}`);
    handleApi(req, res, url, { store, setupBootstrapToken: bootstrapToken }).catch((error) => {
      res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: error.message }));
    });
  });
  const apiPort = await listen(api);
  const apiBase = `http://127.0.0.1:${apiPort}`;

  try {
    let result = await requestJson(apiBase, "/api/vault/setup", {
      method: "POST",
      body: { password: "test-password-123" }
    });
    assert.equal(result.status, 403);
    assert.equal(result.data.code, "setup_loopback_required");

    result = await requestJson(apiBase, "/api/vault/setup", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-vault-bootstrap": bootstrapToken
      },
      body: { password: "test-password-123" }
    });
    assert.equal(result.status, 200);
    assert.equal(result.data.initialized, true);
  } finally {
    await close(api);
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

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
    const proxyTokenSecret = result.data.secret;

    const publicProxy = await fetch(`http://127.0.0.1:${proxy.getPort()}/proxy/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${proxyTokenSecret}` },
      body: JSON.stringify({ model: "public-chat", messages: [{ role: "user", content: "remote" }] })
    });
    assert.equal(publicProxy.status, 200);
    assert.equal((await publicProxy.json()).usage.total_tokens, 18);

    const providerScopedPublicProxy = await fetch(`http://127.0.0.1:${proxy.getPort()}/proxy/${provider.id}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${proxyTokenSecret}` },
      body: JSON.stringify({ model: "public-chat", messages: [{ role: "user", content: "remote scoped" }] })
    });
    assert.equal(providerScopedPublicProxy.status, 200);
    assert.equal((await providerScopedPublicProxy.json()).usage.total_tokens, 18);

    result = await requestJson(apiBase, `/api/providers/${provider.id}/test-balance`, { method: "POST" });
    assert.equal(result.status, 200);
    assert.equal(result.data.result.snapshot.balance, 91.25);
    assert.equal(result.data.result.snapshot.spent, 8.75);

    result = await requestJson(apiBase, "/api/state");
    assert.equal(result.status, 200);
    assert.equal(result.data.usageEvents.length, 5);
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
    assert.equal(upstreamHits.length, 6);

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

test("proxy records upstream non-2xx error bodies and fills missing failure model", async () => {
  const upstream = http.createServer((req, res) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      res.writeHead(400, { "content-type": "application/json" });
      res.end(JSON.stringify({
        error: {
          message: "jmr request rejected because the account is not enabled",
          type: "invalid_request_error",
          code: "account_not_enabled"
        },
        model: "jmr"
      }));
    });
  });

  const upstreamPort = await listen(upstream);
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "api-vault-upstream-error-"));
  const store = new VaultStore(path.join(tempDir, "vault.json"));
  const proxy = new ProxyServer(store);
  await proxy.start();

  try {
    store.setup("test-password-123");
    const added = store.addKeyWithAutoMerge({
      providerName: "JMR",
      keyName: "jmr-key",
      protocol: "openai-compatible",
      baseUrl: `http://127.0.0.1:${upstreamPort}/v1`,
      currency: "USD",
      apiKey: "sk-jmr",
      balanceConfig: { enabled: false }
    });
    const token = store.createProxyToken({
      name: "jmr token",
      allowedProviderIds: [added.provider.id],
      allowedModels: [{
        publicModel: "public-jmr",
        providerId: added.provider.id,
        apiKeyId: added.apiKey.id,
        upstreamModel: "jmr"
      }],
      allowStreaming: false,
      requestsPerMinute: 10,
      requestsPerDay: 100
    });

    const globalResponse = await fetch(`http://127.0.0.1:${proxy.getPort()}/proxy/openai/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer sk-jmr" },
      body: JSON.stringify({ messages: [{ role: "user", content: "hi" }] })
    });
    assert.equal(globalResponse.status, 400);
    assert.equal((await globalResponse.json()).error.message, "jmr request rejected because the account is not enabled");

    const publicResponse = await fetch(`http://127.0.0.1:${proxy.getPort()}/proxy/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token.secret}` },
      body: JSON.stringify({ model: "public-jmr", messages: [{ role: "user", content: "hi" }] })
    });
    assert.equal(publicResponse.status, 400);

    const state = store.getState();
    assert.equal(state.usageEvents.length, 2);
    for (const event of state.usageEvents) {
      assert.equal(event.status, 400);
      assert.equal(event.ok, false);
      assert.equal(event.model, "jmr");
      assert.match(event.error, /account_not_enabled/);
      assert.match(event.error, /jmr request rejected/);
      assert.equal(event.errorMessage, event.error);
    }
  } finally {
    proxy.stop();
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
    assert.equal(result.status, 401);
    assert.equal(result.data.code, "admin_session_required");

    result = await requestJson(apiBase, "/api/vault/setup", {
      method: "POST",
      headers: { "content-type": "application/json" },
      rawBody: "{bad-json"
    });
    assert.equal(result.status, 400);
    assert.equal(result.data.code, "invalid_json");

    result = await requestJson(apiBase, "/api/vault/setup", {
      method: "POST",
      headers: { "content-type": "application/json" },
      rawBody: ""
    });
    assert.equal(result.status, 400);
    assert.equal(result.data.code, "body_required");

    result = await requestJson(apiBase, "/api/vault/setup", {
      method: "POST",
      body: { password: "test-password-123" }
    });
    assert.equal(result.status, 200);

    result = await requestJson(apiBase, "/api/nope");
    assert.equal(result.status, 404);
    assert.equal(result.data.code, "api_route_not_found");

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

    const unauthenticatedState = await fetch(`${apiBase}/api/state`);
    assert.equal(unauthenticatedState.status, 200);
    const unauthenticatedStateJson = await unauthenticatedState.json();
    assert.equal(unauthenticatedStateJson.unlocked, false);
    assert.deepEqual(unauthenticatedStateJson.providers, []);

    const unauthenticatedAdminWrite = await fetch(`${apiBase}/api/providers/add-key`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        providerName: "No Admin Session",
        keyName: "no-session",
        protocol: "openai-compatible",
        baseUrl: "https://example.com/v1",
        currency: "USD",
        apiKey: "sk-test",
        balanceConfig: { enabled: false }
      })
    });
    assert.equal(unauthenticatedAdminWrite.status, 401);
    assert.equal((await unauthenticatedAdminWrite.json()).code, "admin_session_required");

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
    assert.equal(result.status, 401);
    assert.equal(result.data.code, "admin_session_required");
  } finally {
    proxy.stop();
    await close(api);
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("HTTP API manages account pools, creates providers, and imports models to proxy tokens", async () => {
  const cpaHits = [];
  const cpa = http.createServer((req, res) => {
    cpaHits.push({ url: req.url, authorization: req.headers.authorization });
    if (req.url === "/") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
      return;
    }
    if (req.url === "/v1/models") {
      assert.equal(req.headers.authorization, "Bearer cpa-proxy-key");
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ data: [{ id: "claude-cpa" }, { id: "codex-cpa" }] }));
      return;
    }
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "not found" }));
  });

  const cpaPort = await listen(cpa);
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "api-vault-account-pools-http-"));
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

    result = await requestJson(apiBase, "/api/account-pools", {
      method: "POST",
      body: {
        name: "CPA Pool",
        kind: "cpa",
        baseUrl: `http://127.0.0.1:${cpaPort}`,
        apiKey: "cpa-proxy-key",
        authsDirectory: path.join(tempDir, "auths"),
        createProvider: true
      }
    });
    assert.equal(result.status, 200);
    assert.equal(result.data.state.accountPools.length, 1);
    assert.equal(result.data.state.providers.length, 1);
    assert.equal(result.data.state.providers[0].baseUrl, `http://127.0.0.1:${cpaPort}/v1`);
    const pool = result.data.state.accountPools[0];
    const provider = result.data.state.providers[0];

    result = await requestJson(apiBase, "/api/test-url", {
      method: "POST",
      body: {
        providerId: provider.id,
        protocol: provider.protocol,
        baseUrl: provider.baseUrl
      }
    });
    assert.equal(result.status, 200);
    assert.equal(result.data.ok, true);

    result = await requestJson(apiBase, `/api/account-pools/${pool.id}/sync-models`, { method: "POST" });
    assert.equal(result.status, 200);
    assert.equal(result.data.result.ok, true);
    assert.deepEqual(result.data.result.modelNames, ["claude-cpa", "codex-cpa"]);

    result = await requestJson(apiBase, "/api/proxy-tokens", {
      method: "POST",
      body: {
        name: "account pool client",
        allowedProviderIds: [],
        allowedModels: [],
        allowStreaming: true,
        requestsPerMinute: 60,
        requestsPerDay: 1000
      }
    });
    assert.equal(result.status, 200);
    const token = result.data.state.proxyTokens[0];
    const proxySecret = result.data.secret;

    result = await requestJson(apiBase, `/api/account-pools/${pool.id}/import-models-to-proxy-token`, {
      method: "POST",
      body: { proxyTokenId: token.id }
    });
    assert.equal(result.status, 200);
    assert.equal(result.data.result.importedCount, 2);
    const updatedToken = result.data.state.proxyTokens[0];
    assert.equal(updatedToken.allowedProviderIds.includes(provider.id), true);
    assert.deepEqual(updatedToken.allowedModels.map((rule) => [rule.publicModel, rule.providerId, rule.upstreamModel]), [
      ["claude-cpa", provider.id, "claude-cpa"],
      ["codex-cpa", provider.id, "codex-cpa"]
    ]);

    const proxyModels = await fetch(`http://127.0.0.1:${proxy.getPort()}/proxy/v1/models`, {
      headers: { authorization: `Bearer ${proxySecret}` }
    });
    assert.equal(proxyModels.status, 200);
    assert.deepEqual((await proxyModels.json()).data.map((model) => model.id), ["claude-cpa", "codex-cpa"]);

    result = await requestJson(apiBase, `/api/account-pools/${pool.id}/upload-auth`, {
      method: "POST",
      body: {
        fileName: "../claude-auth.json",
        content: JSON.stringify({ token: "auth-secret" })
      }
    });
    assert.equal(result.status, 200);
    assert.equal(result.data.result.fileName, "claude-auth.json");
    assert.equal(fs.existsSync(path.join(tempDir, "auths", "claude-auth.json")), true);
    assert.equal(JSON.stringify(result.data).includes("auth-secret"), false);

    const persisted = fs.readFileSync(path.join(tempDir, "vault.json"), "utf8");
    assert.equal(persisted.includes("cpa-proxy-key"), false);
    assert.ok(cpaHits.some((hit) => hit.url === "/v1/models"));
  } finally {
    proxy.stop();
    await close(api);
    await close(cpa);
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("HTTP API syncs account pool models from non-OpenAI model list shapes", async () => {
  const cpa = http.createServer((req, res) => {
    if (req.url === "/v1/models") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({
        models: [
          { name: "models/gemini-2.5-pro" },
          { modelId: "claude-opus-4.1" },
          "grok-4"
        ]
      }));
      return;
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
  });

  const cpaPort = await listen(cpa);
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "api-vault-account-pools-model-shapes-"));
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

    result = await requestJson(apiBase, "/api/account-pools", {
      method: "POST",
      body: {
        name: "Mixed Models Pool",
        kind: "cpa",
        baseUrl: `http://127.0.0.1:${cpaPort}`,
        apiKey: "cpa-proxy-key",
        createProvider: true
      }
    });
    assert.equal(result.status, 200);
    const pool = result.data.state.accountPools[0];

    result = await requestJson(apiBase, `/api/account-pools/${pool.id}/sync-models`, { method: "POST" });
    assert.equal(result.status, 200);
    assert.equal(result.data.result.ok, true);
    assert.deepEqual(result.data.result.modelNames, ["gemini-2.5-pro", "claude-opus-4.1", "grok-4"]);
  } finally {
    proxy.stop();
    await close(api);
    await close(cpa);
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("HTTP API syncs provider models and stores manual aliases", async () => {
  const upstreamHits = [];
  const upstream = http.createServer((req, res) => {
    upstreamHits.push({ url: req.url, authorization: req.headers.authorization });
    if (req.url === "/v1/models") {
      assert.equal(req.headers.authorization, "Bearer sk-catalog");
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ data: [{ id: "gpt-4o" }, { id: "claude-sonnet-4-20250514" }] }));
      return;
    }
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "not found" }));
  });

  const upstreamPort = await listen(upstream);
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "api-vault-model-catalog-http-"));
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
        providerName: "Catalog Provider",
        keyName: "catalog",
        protocol: "openai-compatible",
        baseUrl: `http://127.0.0.1:${upstreamPort}/v1`,
        currency: "USD",
        apiKey: "sk-catalog",
        balanceConfig: { enabled: false }
      }
    });
    assert.equal(result.status, 200);
    const provider = result.data.providers[0];

    result = await requestJson(apiBase, `/api/model-catalog/sync-provider/${provider.id}`, { method: "POST" });
    assert.equal(result.status, 200);
    assert.equal(result.data.result.ok, true);
    assert.equal(result.data.result.syncedCount, 2);
    assert.equal(result.data.state.modelCatalog.length, 2);
    const sonnet = result.data.state.modelCatalog.find((model) => model.modelId === "claude-sonnet-4-20250514");
    assert.ok(sonnet);

    result = await requestJson(apiBase, `/api/model-catalog/${sonnet.id}`, {
      method: "POST",
      body: {
        providerId: provider.id,
        modelId: sonnet.modelId,
        displayName: "Claude Sonnet 4",
        aliases: ["sonnet 4"],
        capabilities: ["text", "vision", "tool"],
        source: "manual"
      }
    });
    assert.equal(result.status, 200);
    const updated = result.data.state.modelCatalog.find((model) => model.id === sonnet.id);
    assert.equal(updated.displayName, "Claude Sonnet 4");
    assert.equal(updated.aliases.includes("sonnet 4"), true);

    result = await requestJson(apiBase, "/api/model-catalog");
    assert.equal(result.status, 200);
    assert.equal(result.data.some((model) => model.displayName === "Claude Sonnet 4"), true);
    assert.ok(upstreamHits.some((hit) => hit.url === "/v1/models"));

    const persisted = fs.readFileSync(path.join(tempDir, "vault.json"), "utf8");
    assert.equal(persisted.includes("sk-catalog"), false);
  } finally {
    proxy.stop();
    await close(api);
    await close(upstream);
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("HTTP API syncs provider models from local mappings when upstream model route is unavailable", async () => {
  const upstream = http.createServer((req, res) => {
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "not found" }));
  });

  const upstreamPort = await listen(upstream);
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "api-vault-model-catalog-known-"));
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
        providerName: "Anthropic Without Models",
        keyName: "default",
        protocol: "anthropic-compatible",
        baseUrl: `http://127.0.0.1:${upstreamPort}/anthropic`,
        currency: "USD",
        apiKey: "sk-anthropic",
        balanceConfig: { enabled: false }
      }
    });
    assert.equal(result.status, 200);
    const provider = result.data.providers[0];
    const key = provider.apiKeys[0];

    result = await requestJson(apiBase, "/api/proxy-tokens", {
      method: "POST",
      body: {
        name: "known mappings",
        allowedProviderIds: [provider.id],
        allowedModels: [
          {
            publicModel: "claude-deepseek",
            providerId: provider.id,
            apiKeyId: key.id,
            upstreamModel: "deepseek-v4-pro"
          },
          {
            publicModel: "claude-xiaomi",
            providerId: provider.id,
            apiKeyId: key.id,
            upstreamModel: "mimo-v2.5-pro"
          }
        ],
        allowStreaming: true,
        requestsPerMinute: 60,
        requestsPerDay: 1000
      }
    });
    assert.equal(result.status, 200);

    result = await requestJson(apiBase, `/api/model-catalog/sync-provider/${provider.id}`, { method: "POST" });
    assert.equal(result.status, 200);
    assert.equal(result.data.result.ok, true);
    assert.deepEqual(result.data.result.modelIds, ["deepseek-v4-pro", "mimo-v2.5-pro"]);
    assert.equal(result.data.state.modelCatalog.length, 2);
  } finally {
    proxy.stop();
    await close(api);
    await close(upstream);
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("URL test uses an independent timeout for each probe attempt", async () => {
  const upstreamHits = [];
  const upstream = http.createServer((req, res) => {
    upstreamHits.push(req.url);
    if (req.url === "/slow/models") {
      setTimeout(() => {
        if (res.destroyed) return;
        res.writeHead(504, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "too slow" }));
      }, 5500);
      return;
    }
    if (req.url === "/slow/v1/models") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ data: [{ id: "fast-model" }] }));
      return;
    }
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "not found" }));
  });

  const upstreamPort = await listen(upstream);
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "api-vault-test-url-timeout-"));
  const store = new VaultStore(path.join(tempDir, "vault.json"));
  const proxy = new ProxyServer(store);
  await proxy.start();
  const api = createApiServer({ store, proxy });
  const apiPort = await listen(api);
  const apiBase = `http://127.0.0.1:${apiPort}`;

  try {
    let setup = await requestJson(apiBase, "/api/vault/setup", {
      method: "POST",
      body: { password: "test-password-123" }
    });
    assert.equal(setup.status, 200);

    const result = await requestJson(apiBase, "/api/test-url", {
      method: "POST",
      body: {
        protocol: "openai-compatible",
        baseUrl: `http://127.0.0.1:${upstreamPort}/slow`,
        isLocal: true
      }
    });

    assert.equal(result.status, 200);
    assert.equal(result.data.ok, true);
    assert.equal(result.data.status, 200);
    assert.deepEqual(result.data.modelNames, ["fast-model"]);
    assert.deepEqual(upstreamHits.slice(0, 2), ["/slow/models", "/slow/v1/models"]);
  } finally {
    proxy.stop();
    await close(api);
    await close(upstream);
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

    const rebinding = await requestWithHost(apiPort, "/api/state", {
      host: `evil.example:${apiPort}`,
      origin: `http://evil.example:${apiPort}`
    });
    assert.equal(rebinding.status, 403);
    assert.equal(rebinding.headers["access-control-allow-origin"], undefined);
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

test("URL test probes Anthropic messages route when models route is missing", async () => {
  const upstreamHits = [];
  const upstream = http.createServer((req, res) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      upstreamHits.push({
        method: req.method,
        url: req.url,
        xApiKey: req.headers["x-api-key"],
        anthropicVersion: req.headers["anthropic-version"],
        body: Buffer.concat(chunks).toString("utf8")
      });
      if (req.method === "POST" && req.url === "/anthropic/v1/messages") {
        assert.equal(req.headers["x-api-key"], "sk-anthropic");
        assert.ok(req.headers["anthropic-version"]);
        res.writeHead(400, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "missing model" }));
        return;
      }
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "not found" }));
    });
  });

  const upstreamPort = await listen(upstream);
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "api-vault-anthropic-messages-test-url-"));
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
        providerName: "Anthropic Messages Route",
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
    assert.equal(result.data.status, 400);
    assert.equal(upstreamHits.some((hit) => hit.method === "POST" && hit.url === "/anthropic/v1/messages" && hit.xApiKey === "sk-anthropic"), true);
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

test("public proxy preserves multimodal image inputs across OpenAI and Anthropic formats", async () => {
  const hits = [];
  const imageBytes = Buffer.from("fake-image-bytes");
  const upstream = http.createServer((req, res) => {
    if (req.method === "GET" && req.url === "/image.png") {
      res.writeHead(200, { "content-type": "image/png" });
      res.end(imageBytes);
      return;
    }

    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      const body = Buffer.concat(chunks).toString("utf8");
      hits.push({
        url: req.url,
        authorization: req.headers.authorization,
        xApiKey: req.headers["x-api-key"],
        anthropicVersion: req.headers["anthropic-version"],
        body: JSON.parse(body)
      });

      if (req.url === "/anthropic/v1/messages") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({
          id: "msg_vision",
          type: "message",
          role: "assistant",
          model: "claude-real",
          content: [{ type: "text", text: "saw image" }],
          stop_reason: "end_turn",
          usage: { input_tokens: 10, output_tokens: 3 }
        }));
        return;
      }

      if (req.url === "/openai/v1/chat/completions") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({
          id: "chat_vision",
          object: "chat.completion",
          model: "gpt-real",
          choices: [{ index: 0, message: { role: "assistant", content: "saw data url" }, finish_reason: "stop" }],
          usage: { prompt_tokens: 8, completion_tokens: 2, total_tokens: 10 }
        }));
        return;
      }

      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "unexpected route" }));
    });
  });

  const upstreamPort = await listen(upstream);
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "api-vault-multimodal-public-"));
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
        providerName: "Anthropic Vision",
        keyName: "anthropic",
        protocol: "anthropic-compatible",
        baseUrl: `http://127.0.0.1:${upstreamPort}/anthropic`,
        currency: "USD",
        apiKey: "sk-anthropic",
        balanceConfig: { enabled: false }
      }
    });
    assert.equal(result.status, 200);
    const anthropicProvider = result.data.providers[0];
    const anthropicKey = anthropicProvider.apiKeys[0];

    result = await requestJson(apiBase, "/api/providers/add-key", {
      method: "POST",
      body: {
        providerName: "OpenAI Vision",
        keyName: "openai",
        protocol: "openai-compatible",
        baseUrl: `http://127.0.0.1:${upstreamPort}/openai/v1`,
        currency: "USD",
        apiKey: "sk-openai",
        balanceConfig: { enabled: false }
      }
    });
    assert.equal(result.status, 200);
    const openaiProvider = result.data.providers.find((provider) => provider.name === "OpenAI Vision");
    const openaiKey = openaiProvider.apiKeys[0];

    result = await requestJson(apiBase, "/api/proxy-tokens", {
      method: "POST",
      body: {
        name: "vision clients",
        allowedProviderIds: [anthropicProvider.id, openaiProvider.id],
        allowedModels: [
          {
            publicModel: "public-claude-vision",
            providerId: anthropicProvider.id,
            apiKeyId: anthropicKey.id,
            upstreamModel: "claude-real"
          },
          {
            publicModel: "public-gpt-vision",
            providerId: openaiProvider.id,
            apiKeyId: openaiKey.id,
            upstreamModel: "gpt-real"
          }
        ],
        allowStreaming: false,
        requestsPerMinute: 60,
        requestsPerDay: 1000
      }
    });
    assert.equal(result.status, 200);
    const proxySecret = result.data.secret;
    const publicBase = `http://127.0.0.1:${proxy.getPort()}/proxy/v1`;

    const imageDataUrl = `data:image/png;base64,${imageBytes.toString("base64")}`;
    let response = await fetch(`${publicBase}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${proxySecret}` },
      body: JSON.stringify({
        model: "public-claude-vision",
        messages: [{
          role: "user",
          content: [
            { type: "text", text: "describe this" },
            { type: "image_url", image_url: { url: imageDataUrl } }
          ]
        }]
      })
    });
    assert.equal(response.status, 200);
    let json = await response.json();
    assert.equal(json.choices[0].message.content, "saw image");
    assert.equal(json.usage.prompt_tokens, 10);

    response = await fetch(`${publicBase}/messages`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": proxySecret, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: "public-claude-vision",
        max_tokens: 20,
        messages: [{
          role: "user",
          content: [
            { type: "text", text: "anthropic url image" },
            { type: "image", source: { type: "url", url: imageDataUrl } }
          ]
        }]
      })
    });
    assert.equal(response.status, 200);
    json = await response.json();
    assert.equal(json.content[0].text, "saw image");

    response = await fetch(`${publicBase}/messages`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": proxySecret, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: "public-gpt-vision",
        max_tokens: 20,
        messages: [{
          role: "user",
          content: [
            { type: "text", text: "describe this" },
            { type: "image", source: { type: "base64", media_type: "image/jpeg", data: "aW1hZ2U=" } }
          ]
        }]
      })
    });
    assert.equal(response.status, 200);
    json = await response.json();
    assert.equal(json.content[0].text, "saw data url");
    assert.equal(json.usage.input_tokens, 8);

    const anthropicHit = hits.find((hit) => hit.url === "/anthropic/v1/messages");
    assert.equal(anthropicHit.xApiKey, "sk-anthropic");
    assert.equal(anthropicHit.body.model, "claude-real");
    assert.equal(anthropicHit.body.messages[0].content[1].type, "image");
    assert.equal(anthropicHit.body.messages[0].content[1].source.media_type, "image/png");
    assert.equal(anthropicHit.body.messages[0].content[1].source.data, imageBytes.toString("base64"));
    const anthropicUrlHit = hits.find((hit) => hit.body.messages?.[0]?.content?.[0]?.text === "anthropic url image");
    assert.equal(anthropicUrlHit.body.messages[0].content[1].source.type, "base64");
    assert.equal(anthropicUrlHit.body.messages[0].content[1].source.data, imageBytes.toString("base64"));

    const openaiHit = hits.find((hit) => hit.url === "/openai/v1/chat/completions");
    assert.equal(openaiHit.authorization, "Bearer sk-openai");
    assert.equal(openaiHit.body.model, "gpt-real");
    assert.equal(openaiHit.body.messages[0].content[1].type, "image_url");
    assert.equal(openaiHit.body.messages[0].content[1].image_url.url, "data:image/jpeg;base64,aW1hZ2U=");
  } finally {
    proxy.stop();
    await close(api);
    await close(upstream);
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("public proxy rejects private network image URLs during multimodal conversion", async () => {
  const upstream = http.createServer((req, res) => {
    if (req.method === "GET" && req.url === "/image.png") {
      res.writeHead(200, { "content-type": "image/png" });
      res.end("private-image");
      return;
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({
      id: "msg_private",
      type: "message",
      role: "assistant",
      model: "claude-real",
      content: [{ type: "text", text: "should not be reached" }],
      stop_reason: "end_turn",
      usage: { input_tokens: 1, output_tokens: 1 }
    }));
  });

  const upstreamPort = await listen(upstream);
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "api-vault-private-image-"));
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
        providerName: "Anthropic Vision",
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
    const key = provider.apiKeys[0];

    result = await requestJson(apiBase, "/api/proxy-tokens", {
      method: "POST",
      body: {
        name: "vision clients",
        allowedModels: [{
          publicModel: "public-claude-vision",
          providerId: provider.id,
          apiKeyId: key.id,
          upstreamModel: "claude-real"
        }],
        allowStreaming: false,
        requestsPerMinute: 60,
        requestsPerDay: 1000
      }
    });
    assert.equal(result.status, 200);

    const response = await fetch(`http://127.0.0.1:${proxy.getPort()}/proxy/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${result.data.secret}` },
      body: JSON.stringify({
        model: "public-claude-vision",
        messages: [{
          role: "user",
          content: [
            { type: "text", text: "describe this" },
            { type: "image_url", image_url: { url: `http://127.0.0.1:${upstreamPort}/image.png` } }
          ]
        }]
      })
    });
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /private|local|not allowed/i);
  } finally {
    proxy.stop();
    await close(api);
    await close(upstream);
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("successful unlocks do not consume auth failure quota", async () => {
  // The auth limiter buckets per client IP (process-global). Reset it so this
  // test's exact-count assertions are not polluted by earlier tests' failures.
  resetAuthLimiter();
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "api-vault-auth-limit-"));
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

    for (let index = 0; index < 15; index += 1) {
      result = await requestJson(apiBase, "/api/vault/lock", { method: "POST" });
      assert.equal(result.status, 200);
      result = await requestJson(apiBase, "/api/vault/unlock", {
        method: "POST",
        body: { password: "test-password-123" }
      });
      assert.equal(result.status, 200);
    }

    result = await requestJson(apiBase, "/api/vault/unlock", {
      method: "POST",
      body: { password: "wrong-password" }
    });
    assert.notEqual(result.status, 429);

    for (let index = 0; index < 11; index += 1) {
      result = await requestJson(apiBase, "/api/vault/unlock", {
        method: "POST",
        body: { password: "wrong-password" }
      });
      assert.notEqual(result.status, 429);
    }

    result = await requestJson(apiBase, "/api/vault/unlock", {
      method: "POST",
      body: { password: "wrong-password" }
    });
    assert.equal(result.status, 429);
    assert.equal(result.data.code, "auth_rate_limited");
  } finally {
    proxy.stop();
    await close(api);
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("local service proxy strips management and client credentials before injecting stored key", async () => {
  resetAuthLimiter();
  let upstreamHeaders;
  const upstream = http.createServer((req, res) => {
    upstreamHeaders = req.headers;
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
  });

  const upstreamPort = await listen(upstream);
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "api-vault-local-proxy-"));
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

    result = await requestJson(apiBase, "/api/local-services", {
      method: "POST",
      body: {
        name: "Local upstream",
        baseUrl: `http://127.0.0.1:${upstreamPort}`,
        type: "openai-compatible",
        apiKey: "local-real-key"
      }
    });
    assert.equal(result.status, 200);

    result = await requestJson(apiBase, `/api/proxy/local/${result.data.service.id}/v1/models`, {
      headers: {
        authorization: "Bearer client-placeholder",
        cookie: "session=browser-secret",
        "proxy-authorization": "Basic proxy-secret",
        "x-provider-api-key": "provider-secret"
      }
    });
    assert.equal(result.status, 200);
    assert.equal(upstreamHeaders.authorization, "Bearer local-real-key");
    assert.equal(upstreamHeaders["x-api-vault-admin"], undefined);
    assert.equal(upstreamHeaders.cookie, undefined);
    assert.equal(upstreamHeaders["proxy-authorization"], undefined);
    assert.equal(upstreamHeaders["x-provider-api-key"], undefined);
  } finally {
    proxy.stop();
    await close(api);
    await close(upstream);
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

