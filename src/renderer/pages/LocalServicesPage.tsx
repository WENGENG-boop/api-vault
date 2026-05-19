import { useEffect, useState } from "react";
import type { AppState, CloudflaredStatus, LocalServiceProtocol } from "../../shared/types";
import { apiClient } from "../apiClient";

export function LocalServicesPage({ state, setState, showMsg, showErr }: {
  state: AppState; setState: (s: AppState) => void; showMsg: (m: string) => void; showErr: (e: unknown) => void;
}) {
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: "", baseUrl: "", type: "unknown" as string, notes: "", apiKey: "" });
  const [cfTestResult, setCfTestResult] = useState<{ ok?: boolean; status?: number; latencyMs?: number; error?: string; modelNames?: string[]; testing?: boolean }>({});
  const [cfStatus, setCfStatus] = useState<CloudflaredStatus>(state.cloudflared);
  const [cfLoading, setCfLoading] = useState(false);
  const [serviceTests, setServiceTests] = useState<Record<string, { ok?: boolean; latencyMs?: number; error?: string; modelNames?: string[]; testing?: boolean }>>({});

  useEffect(() => {
    apiClient.getCloudflaredStatus().then(setCfStatus).catch(() => {});
  }, []);

  async function testUrl() {
    if (!form.baseUrl.trim()) return;
    setCfTestResult({ testing: true });
    try {
      const protocol = form.type === "anthropic-compatible" ? "anthropic-compatible" : "openai-compatible";
      const result = await apiClient.testUrl({ baseUrl: form.baseUrl, protocol, isLocal: true, type: form.type, apiKey: form.apiKey });
      setCfTestResult({ ...result, testing: false });
    } catch (e) {
      setCfTestResult({ ok: false, error: e instanceof Error ? e.message : String(e), testing: false });
    }
  }

  async function save() {
    if (!form.name.trim() || !form.baseUrl.trim()) return;
    try {
      const s = await apiClient.saveLocalService({
        name: form.name,
        baseUrl: form.baseUrl,
        type: form.type as LocalServiceProtocol,
        notes: form.notes,
        apiKey: form.apiKey
      });
      setState(s);
      setShowForm(false);
      setForm({ name: "", baseUrl: "", type: "unknown", notes: "", apiKey: "" });
      showMsg("Local service added");
    } catch (e) { showErr(e); }
  }

  async function remove(id: string) {
    if (!confirm("Delete this local service?")) return;
    try { const s = await apiClient.deleteLocalService(id); setState(s); showMsg("Deleted"); }
    catch (e) { showErr(e); }
  }

  async function testService(id: string) {
    setServiceTests((prev) => ({ ...prev, [id]: { testing: true } }));
    try {
      const result = await apiClient.testLocalService(id);
      setServiceTests((prev) => ({ ...prev, [id]: { ...result, testing: false } }));
      const s = await apiClient.getState();
      setState(s);
    } catch (e) {
      setServiceTests((prev) => ({ ...prev, [id]: { ok: false, error: e instanceof Error ? e.message : String(e), testing: false } }));
    }
  }

  async function startTunnel() {
    setCfLoading(true);
    try {
      const status = await apiClient.startCloudflared();
      setCfStatus(status);
      if (status.publicUrl) showMsg(`Tunnel: ${status.publicUrl}`);
      else if (status.error) showErr(status.error);
    } catch (e) { showErr(e); }
    finally { setCfLoading(false); }
  }

  async function stopTunnel() {
    setCfLoading(true);
    try {
      await apiClient.stopCloudflared();
      setCfStatus({ running: false });
    } catch (e) { showErr(e); }
    finally { setCfLoading(false); }
  }

  const publicUrl = cfStatus.publicUrl || state.cloudflared.publicUrl;

  return (
    <div className="page">
      <div className="page-header">
        <h2>Local Services</h2>
        <div className="page-header-actions">
          {cfStatus.running ? (
            <button className="btn-danger" onClick={stopTunnel} disabled={cfLoading}>{cfLoading ? "Stopping..." : "Stop Tunnel"}</button>
          ) : (
            <button className="btn-primary" onClick={startTunnel} disabled={cfLoading}>{cfLoading ? "Starting..." : "Start Cloudflared Tunnel"}</button>
          )}
          <button className="btn-primary" onClick={() => { setShowForm(true); setCfTestResult({}); }}>+ Add Local Service</button>
        </div>
      </div>

      {cfStatus.error && <div className="toast error" style={{ position: "static", marginBottom: 12 }}>{cfStatus.error}</div>}
      {cfStatus.missingBinary && cfStatus.installUrl && (
        <div className="cloudflared-panel cloudflared-panel-muted" style={{ marginBottom: 12 }}>
          <div className="cloudflared-panel-head">
            <span className="connection-status-dot fail" />
            <strong>Cloudflared not installed</strong>
          </div>
          <p className="cloudflared-panel-hint">Install Cloudflared, then return here and click Start Cloudflared Tunnel again.</p>
          <div className="provider-actions" style={{ marginTop: 8 }}>
            <a className="btn-primary" href={cfStatus.installUrl} target="_blank" rel="noreferrer">Download Cloudflared</a>
          </div>
        </div>
      )}
      {cfStatus.running && publicUrl && (
        <div className="cloudflared-panel">
          <div className="cloudflared-panel-head">
            <span className="connection-status-dot ok" />
            <strong>Cloudflared Tunnel Active</strong>
          </div>
          <div className="cloudflared-panel-url">
            <span>Public URL:</span>
            <code>{publicUrl}</code>
          </div>
          <p className="cloudflared-panel-hint">
            Use the public URL to access local services from external devices or tools.
            Append <code>/api/proxy/local/:serviceId/v1</code> for a specific service.
          </p>
        </div>
      )}
      {!cfStatus.running && (
        <div className="cloudflared-panel cloudflared-panel-muted">
          <div className="cloudflared-panel-head">
            <span className="connection-status-dot idle" />
            <strong>Public access is not enabled</strong>
          </div>
          <p className="cloudflared-panel-hint">Start Cloudflared Tunnel to generate public proxy URLs for local services.</p>
        </div>
      )}

      {showForm && (
        <div className="form-card">
          <h3>Add Local Service</h3>
          <div className="form-grid">
            <label>Service Name<input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. My Local LLM" /></label>
            <label>Base URL
              <div className="url-input-row">
                <input value={form.baseUrl} onChange={(e) => { setForm({ ...form, baseUrl: e.target.value }); setCfTestResult({}); }} placeholder="http://127.0.0.1:8045/v1" />
                <button type="button" onClick={testUrl} disabled={!form.baseUrl.trim() || cfTestResult.testing}>Test</button>
              </div>
              {cfTestResult.testing && <span className="url-test-msg url-test-msg--testing">Testing...</span>}
              {!cfTestResult.testing && cfTestResult.ok !== undefined && (
                <span className={`url-test-msg ${cfTestResult.ok ? "url-test-msg--ok" : "url-test-msg--fail"}`}>
                  {cfTestResult.ok
                    ? `OK ${cfTestResult.status} - ${cfTestResult.latencyMs}ms${cfTestResult.modelNames?.length ? ` - ${cfTestResult.modelNames.length} models` : ""}`
                    : `Failed: ${cfTestResult.error ?? `HTTP ${cfTestResult.status}`}`}
                </span>
              )}
            </label>
            <label>Type
              <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
                <option value="unknown">Unknown</option>
                <option value="openai-compatible">OpenAI Compatible</option>
                <option value="anthropic-compatible">Anthropic Compatible</option>
                <option value="custom">Custom</option>
              </select>
            </label>
            <label>API Key (optional)
              <input type="password" value={form.apiKey} onChange={(e) => setForm({ ...form, apiKey: e.target.value })} placeholder="sk-... or service key" />
            </label>
            <label>Notes<textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={2} placeholder="Optional notes" /></label>
          </div>
          <div className="form-actions">
            <button className="btn-primary" onClick={save}>Save</button>
            <button onClick={() => setShowForm(false)}>Cancel</button>
          </div>
        </div>
      )}

      <div className="provider-list provider-list-compact">
        {state.localServices.map((service) => {
          const test = serviceTests[service.id];
          const publicAccessUrl = publicUrl ? `${publicUrl}/api/proxy/local/${service.id}/v1` : undefined;
          return (
            <div key={service.id} className="provider-card provider-card-compact">
              <div className="provider-summary-top">
                <div className="provider-summary-name">
                  <strong>{service.name}</strong>
                  <span className="provider-protocol provider-local-badge">Local</span>
                  <span className="provider-protocol">{service.type}</span>
                </div>
              </div>
              <div className="provider-url provider-summary-base">
                <span className={`connection-status-dot ${test?.testing ? "testing" : service.status === "available" ? "ok" : service.status === "unavailable" ? "fail" : "idle"}`} />
                <span>{service.baseUrl}</span>
              </div>
              {test?.testing && <div className="url-test-status url-test-status--testing">Testing...</div>}
              {!test?.testing && test?.ok !== undefined && (
                <div className={`url-test-status ${test.ok ? "url-test-status--ok" : "url-test-status--fail"}`}>
                  {test.ok ? `OK - ${test.latencyMs}ms${test.modelNames?.length ? ` - ${test.modelNames.length} models` : ""}` : `Failed: ${test.error}`}
                </div>
              )}
              {!test?.testing && test?.ok === undefined && service.status === "available" && (
                <div className="url-test-status url-test-status--ok">Available - {service.latencyMs}ms</div>
              )}
              {!test?.testing && test?.ok === undefined && service.status === "unavailable" && (
                <div className="url-test-status url-test-status--fail">Unavailable</div>
              )}
              <div className="provider-stats provider-summary-stats">
                {service.latencyMs !== undefined && <span>{service.latencyMs}ms latency</span>}
                {service.lastCheckedAt && <span>Last checked: {new Date(service.lastCheckedAt).toLocaleString()}</span>}
                {service.hasApiKey && <span>Key: {service.keyMasked ?? "configured"}</span>}
              </div>
              {publicAccessUrl && (
                <div className="local-routing-url" style={{ marginTop: 8 }}>
                  <span>Public proxy access:</span>
                  <code>{publicAccessUrl}</code>
                </div>
              )}
              <div className="provider-actions" style={{ marginTop: 8 }}>
                <button onClick={() => testService(service.id)} disabled={test?.testing}>Test Connection</button>
                <button className="btn-danger" onClick={() => remove(service.id)}>Delete</button>
              </div>
            </div>
          );
        })}
        {state.localServices.length === 0 && !showForm && <p className="empty">No local services configured. Add one to track usage of local API services.</p>}
      </div>
    </div>
  );
}

