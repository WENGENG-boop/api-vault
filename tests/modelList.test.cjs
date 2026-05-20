const test = require("node:test");
const assert = require("node:assert/strict");
const { extractModelNamesFromJson } = require("../dist-main/main/modelList.js");

test("model list parser supports common provider response shapes", () => {
  assert.deepEqual(extractModelNamesFromJson({
    data: [{ id: "gpt-4o" }, { id: "claude-sonnet-4-20250514" }]
  }), ["gpt-4o", "claude-sonnet-4-20250514"]);

  assert.deepEqual(extractModelNamesFromJson({
    models: [{ name: "models/gemini-2.5-pro" }, { name: "models/gemini-2.5-flash" }]
  }), ["gemini-2.5-pro", "gemini-2.5-flash"]);

  assert.deepEqual(extractModelNamesFromJson({
    models: {
      claude: [{ modelId: "claude-opus-4.1" }],
      codex: [{ model: "gpt-5.1-codex" }],
      grok: ["grok-4"],
      "deepseek-chat": { context_length: 128000 }
    }
  }), ["claude-opus-4.1", "gpt-5.1-codex", "grok-4", "deepseek-chat"]);
});
