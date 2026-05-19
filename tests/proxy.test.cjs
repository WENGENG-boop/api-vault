const test = require("node:test");
const assert = require("node:assert/strict");
const {
  buildUpstreamHeaders,
  buildUpstreamUrl,
  normalizeProxySuffixPath
} = require("../dist-main/main/proxy.js");
const { buildProxyBaseUrl } = require("../dist-main/main/store.js");

test("builds upstream URL without duplicating version path", () => {
  assert.equal(
    buildUpstreamUrl("https://vendor.example/v1", "/v1/chat/completions", "?x=1"),
    "https://vendor.example/v1/chat/completions?x=1"
  );
  assert.equal(
    buildUpstreamUrl("https://vendor.example/v1", "/chat/completions", ""),
    "https://vendor.example/v1/chat/completions"
  );
});

test("normalizes duplicated version path from third-party gateways", () => {
  assert.equal(
    normalizeProxySuffixPath("https://vendor.example/v1", "/v1/v1/messages"),
    "/v1/messages"
  );
  assert.equal(
    normalizeProxySuffixPath("https://vendor.example", "/v1/v1/models"),
    "/v1/models"
  );
  assert.equal(
    buildUpstreamUrl("https://vendor.example", normalizeProxySuffixPath("https://vendor.example", "/v1/v1/models"), ""),
    "https://vendor.example/v1/models"
  );
  assert.equal(
    buildUpstreamUrl("https://vendor.example/v1", normalizeProxySuffixPath("https://vendor.example/v1", "/v1/v1/messages"), ""),
    "https://vendor.example/v1/messages"
  );
});

test("builds shared provider-level proxy base URL for OpenAI-compatible providers", () => {
  assert.equal(
    buildProxyBaseUrl(12345, "provider-1", "key-1", "https://vendor.example", "openai-compatible"),
    "http://127.0.0.1:12345/proxy/provider-1/v1"
  );
  assert.equal(
    buildProxyBaseUrl(12345, "provider-1", "key-1", "https://vendor.example/openai", "openai-compatible"),
    "http://127.0.0.1:12345/proxy/provider-1/openai/v1"
  );
  assert.equal(
    buildProxyBaseUrl(12345, "provider-1", "key-1", "https://vendor.example/openai/v1", "openai-compatible"),
    "http://127.0.0.1:12345/proxy/provider-1/openai/v1"
  );
  assert.equal(
    buildProxyBaseUrl(12345, "provider-1", "key-1", "https://vendor.example", "anthropic-compatible"),
    "http://127.0.0.1:12345/proxy/provider-1"
  );
});

test("injects OpenAI-compatible auth header", () => {
  const headers = buildUpstreamHeaders(
    {
      authorization: "Bearer old",
      "content-type": "application/json",
      cookie: "sid=secret",
      host: "local",
      "proxy-authorization": "Basic secret",
      "x-provider-api-key": "leaky",
      "x-client-token": "business-token",
      "x-idempotency-token": "idem-123"
    },
    "openai-compatible",
    "sk-real"
  );
  assert.equal(headers.get("authorization"), "Bearer sk-real");
  assert.equal(headers.get("content-type"), "application/json");
  assert.equal(headers.get("host"), null);
  assert.equal(headers.get("cookie"), null);
  assert.equal(headers.get("proxy-authorization"), null);
  assert.equal(headers.get("x-provider-api-key"), null);
  assert.equal(headers.get("x-client-token"), "business-token");
  assert.equal(headers.get("x-idempotency-token"), "idem-123");
});

test("injects Anthropic-compatible auth header", () => {
  const headers = buildUpstreamHeaders(
    { "x-api-key": "old" },
    "anthropic-compatible",
    "ak-real"
  );
  assert.equal(headers.get("x-api-key"), "ak-real");
  assert.equal(headers.get("anthropic-version"), "2023-06-01");
});

