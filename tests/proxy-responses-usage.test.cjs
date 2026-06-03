const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { ProxyServer } = require("../dist-main/main/proxy.js");
const { VaultStore } = require("../dist-main/main/store.js");

function listen(server) {
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server.address().port)));
}
function close(server) {
  return new Promise((resolve) => (server.listening ? server.close(resolve) : resolve()));
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Reproduces a jmr-style OpenAI Responses API streaming reply (Codex / GPT-5):
// the terminal `response.completed` event nests usage under `response.usage`.
const RESPONSES_SSE = [
  'event: response.created',
  'data: {"type":"response.created","response":{"id":"resp_1","model":"gpt-5.5","usage":null}}',
  '',
  'event: response.output_text.delta',
  'data: {"type":"response.output_text.delta","delta":"Hello"}',
  '',
  'event: response.completed',
  'data: {"type":"response.completed","response":{"id":"resp_1","model":"gpt-5.5","usage":{"input_tokens":1234,"input_tokens_details":{"cached_tokens":200},"output_tokens":567,"output_tokens_details":{"reasoning_tokens":100},"total_tokens":1801}}}',
  '',
  'data: [DONE]',
  ''
].join('\n');

test("streaming /v1/responses (jmr-style) records input/output tokens", async () => {
  const upstream = http.createServer((req, res) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      assert.equal(req.url, "/v1/responses");
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.end(RESPONSES_SSE);
    });
  });
  const upstreamPort = await listen(upstream);
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "api-vault-responses-"));
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
        publicModel: "codex",
        providerId: added.provider.id,
        apiKeyId: added.apiKey.id,
        upstreamModel: "gpt-5.5"
      }],
      allowStreaming: true,
      requestsPerMinute: 100,
      requestsPerDay: 1000
    });

    const response = await fetch(`http://127.0.0.1:${proxy.getPort()}/proxy/v1/responses`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token.secret}` },
      body: JSON.stringify({ model: "codex", stream: true, input: "hi" })
    });
    assert.equal(response.status, 200);
    const text = await response.text();
    assert.ok(text.includes("response.completed"), "stream should be relayed to the client unchanged");

    // Usage is appended in the server's stream 'end' handler, just after res.end().
    let event;
    for (let i = 0; i < 40 && !event; i++) {
      const state = store.getState();
      event = state.usageEvents.find((e) => (e.path || "").includes("responses")) || state.usageEvents[0];
      if (!event) await sleep(25);
    }
    assert.ok(event, "a usage event should be recorded for the /v1/responses call");
    assert.ok((event.path || "").includes("responses"), `unexpected path: ${event.path}`);
    assert.equal(event.inputTokens, 1234);
    assert.equal(event.outputTokens, 567);
    assert.equal(event.cachedInputTokens, 200);
    assert.equal(event.totalTokens, 1801);
    assert.equal(event.model, "gpt-5.5");
    assert.equal(event.ok, true);
  } finally {
    proxy.stop();
    await close(upstream);
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
