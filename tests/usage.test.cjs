const test = require("node:test");
const assert = require("node:assert/strict");
const {
  extractUsageFromResponse,
  extractUsageFromSSE
} = require("../dist-main/main/usage.js");

const buf = (value) => Buffer.from(typeof value === "string" ? value : JSON.stringify(value), "utf8");
const request = buf({ model: "gpt-5.5", stream: true });

test("chat/completions streaming usage (top-level usage) still works", () => {
  const sse = [
    'data: {"choices":[{"delta":{"content":"hi"}}]}',
    'data: {"choices":[],"usage":{"prompt_tokens":11,"completion_tokens":5,"total_tokens":16}}',
    "data: [DONE]",
    ""
  ].join("\n");
  const usage = extractUsageFromSSE("openai-compatible", request, buf(sse));
  assert.equal(usage.inputTokens, 11);
  assert.equal(usage.outputTokens, 5);
  assert.equal(usage.totalTokens, 16);
});

test("Responses API streaming usage (nested response.usage) is captured", () => {
  // The terminal response.completed event nests usage under `response`, which
  // is how Codex / GPT-5 (/v1/responses) report tokens. Regression guard for jmr.
  const completed = {
    type: "response.completed",
    response: {
      model: "gpt-5.5",
      usage: {
        input_tokens: 1234,
        input_tokens_details: { cached_tokens: 200 },
        output_tokens: 567,
        output_tokens_details: { reasoning_tokens: 100 },
        total_tokens: 1801
      }
    }
  };
  const sse = [
    'data: {"type":"response.output_text.delta","delta":"hello"}',
    `data: ${JSON.stringify(completed)}`,
    ""
  ].join("\n");
  const usage = extractUsageFromSSE("openai-compatible", request, buf(sse));
  assert.equal(usage.inputTokens, 1234);
  assert.equal(usage.outputTokens, 567);
  assert.equal(usage.cachedInputTokens, 200);
  assert.equal(usage.totalTokens, 1801);
  assert.equal(usage.model, "gpt-5.5");
});

test("Responses API non-streaming usage (root usage) is captured", () => {
  const response = {
    object: "response",
    model: "gpt-5.5",
    usage: { input_tokens: 80, output_tokens: 20, total_tokens: 100 }
  };
  const usage = extractUsageFromResponse("openai-compatible", request, buf(response));
  assert.equal(usage.inputTokens, 80);
  assert.equal(usage.outputTokens, 20);
  assert.equal(usage.totalTokens, 100);
});

test("anthropic streaming usage is unaffected", () => {
  const sse = [
    'data: {"type":"message_start","message":{"usage":{"input_tokens":40,"output_tokens":1}}}',
    'data: {"type":"message_delta","usage":{"output_tokens":25}}',
    ""
  ].join("\n");
  const usage = extractUsageFromSSE("anthropic-compatible", buf({ model: "claude" }), buf(sse));
  // Scans from the end: the message_delta carries the final output_tokens.
  assert.equal(usage.outputTokens, 25);
});
