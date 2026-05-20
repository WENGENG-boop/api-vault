const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createApiServer } = require("../dist-main/server/server.js");
const { ProxyServer } = require("../dist-main/main/proxy.js");
const { VaultStore } = require("../dist-main/main/store.js");

class FakeCloudflaredManager {
  constructor() { this.phase = "idle"; }
  getStatus() { return { running: this.phase === "running", phase: this.phase }; }
  getLogs() { return [{ ts: new Date().toISOString(), level: "info", stream: "system", message: "ok" }]; }
  async start() { this.phase = "running"; return { ok: true, code: "OK", status: this.getStatus(), logs: this.getLogs() }; }
  async stop() { this.phase = "idle"; return { ok: true, code: "OK", status: this.getStatus() }; }
}

async function listen(server) { await new Promise((r) => server.listen(0, "127.0.0.1", r)); return server.address().port; }
async function close(server) { if (server.listening) await new Promise((r) => server.close(r)); }

test("cloudflared routes return structured response", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "api-vault-cloudflared-http-"));
  const store = new VaultStore(path.join(tempDir, "vault.json"));
  store.setup("pass-123456");
  const proxy = new ProxyServer(store);
  await proxy.start();
  const cloudflared = new FakeCloudflaredManager();
  const api = createApiServer({ store, proxy, cloudflared });
  const port = await listen(api);
  const base = `http://127.0.0.1:${port}`;

  try {
    let res = await fetch(`${base}/api/cloudflared/status`);
    let data = await res.json();
    assert.equal(data.ok, true);
    assert.equal(data.status.phase, "idle");

    res = await fetch(`${base}/api/cloudflared/start`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({}) });
    data = await res.json();
    assert.equal(data.ok, true);
    assert.equal(data.status.running, true);

    res = await fetch(`${base}/api/cloudflared/logs?limit=10`);
    data = await res.json();
    assert.equal(data.ok, true);
    assert.equal(Array.isArray(data.logs), true);

    res = await fetch(`${base}/api/cloudflared/stop`, { method: "POST" });
    data = await res.json();
    assert.equal(data.ok, true);
    assert.equal(data.status.running, false);
  } finally {
    proxy.stop();
    await close(api);
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
