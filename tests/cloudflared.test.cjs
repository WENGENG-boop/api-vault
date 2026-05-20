const test = require("node:test");
const assert = require("node:assert/strict");
const { extractCloudflaredUrl, isValidPublicUrl } = require("../dist-main/main/cloudflared.js");

test("cloudflared url parser supports multiple log formats", () => {
  assert.equal(extractCloudflaredUrl("INF +--------------------------------------------------------------------------------------------+"), null);
  assert.equal(extractCloudflaredUrl("https://abc.trycloudflare.com"), "https://abc.trycloudflare.com");
  assert.equal(extractCloudflaredUrl("route=https://demo.example.com connIndex=0"), "https://demo.example.com");
  assert.equal(isValidPublicUrl("https://demo.example.com"), true);
  assert.equal(isValidPublicUrl("javascript:alert(1)"), false);
});
