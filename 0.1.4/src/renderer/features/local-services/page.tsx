import { useEffect, useMemo, useState } from "react";
import type { AppState, CloudflaredStatus, LocalServiceProtocol } from "../../../shared/types";
import { apiClient } from "../../shared/api";

export function LocalServicesPage({ state, setState, showMsg, showErr }: {
  state: AppState; setState: (s: AppState) => void; showMsg: (m: string) => void; showErr: (e: unknown) => void;
}) {
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: "", baseUrl: "", type: "unknown" as string, notes: "", apiKey: "" });
  const [cfTestResult, setCfTestResult] = useState<{ ok?: boolean; status?: number; latencyMs?: number; error?: string; modelNames?: string[]; testing?: boolean }>({});
  const [cfStatus, setCfStatus] = useState<CloudflaredStatus>(state.cloudflared);
  const [cfLogs, setCfLogs] = useState<string[]>([]);
  const [copyTip, setCopyTip] = useState("");
  const [tunnelConfig, setTunnelConfig] = useState({ targetPort: "", protocol: "http", hostname: "", noAutoUpdate: false });
  const [cfLoading, setCfLoading] = useState(false);
  const [serviceTests, setServiceTests] = useState<Record<string, { ok?: boolean; latencyMs?: number; error?: string; modelNames?: string[]; testing?: boolean }>>({});

  useEffect(() => {
    Promise.all([apiClient.getCloudflaredStatus(), apiClient.getCloudflaredLogs(50)])
      .then(([status, logs]) => {
        setCfStatus(status);
        setCfLogs((logs.logs ?? []).slice(-5).map((l) => `${l.ts} ${l.message}`));
        if (logs.config) {
          setTunnelConfig({
            targetPort: logs.config.targetPort ? String(logs.config.targetPort) : "",
            protocol: logs.config.protocol ?? "http",
            hostname: logs.config.hostname ?? "",
            noAutoUpdate: Boolean(logs.config.noAutoUpdate)
          });
        }
      }).catch(() => {});
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
      const result = await apiClient.startCloudflared({
        targetPort: tunnelConfig.targetPort.trim() ? Number(tunnelConfig.targetPort) : undefined,
        protocol: tunnelConfig.protocol === "https" ? "https" : "http",
        hostname: tunnelConfig.hostname.trim() || undefined,
        noAutoUpdate: tunnelConfig.noAutoUpdate
      });
      setCfStatus(result.status);
      setCfLogs((result.logs ?? []).slice(-5).map((l) => `${l.ts} ${l.message}`));
      if (result.ok && result.status.publicUrl) showMsg(`Tunnel: ${result.status.publicUrl}`);
      else showErr(result.message);
    } catch (e) { showErr(e); }
    finally { setCfLoading(false); }
  }

  async function stopTunnel() {
    setCfLoading(true);
    try {
      const result = await apiClient.stopCloudflared();
      setCfStatus(result.status);
    } catch (e) { showErr(e); }
    finally { setCfLoading(false); }
  }

  async function copyUrl(value: string) {
    const result = await navigator.clipboard.writeText(value).then(() => true).catch(() => false);
    setCopyTip(result ? "Copied" : "Copy failed");
    setTimeout(() => setCopyTip(""), 1500);
  }

  const phase = cfStatus.phase ?? (cfStatus.running ? "running" : "idle");
  const actionBusy = phase === "starting" || phase === "stopping" || cfLoading;
  const publicUrl = cfStatus.publicUrl || state.cloudflared.publicUrl;
  const canStart = !actionBusy && !cfStatus.running;
  const canStop = !actionBusy && cfStatus.running;
  const latestError = cfStatus.error;
  const latestLogSummary = useMemo(() => cfLogs.slice(-3), [cfLogs]);

  return (
    <div className="page">
      <div className="page-header">
        <h2>Local Services</h2>
        <div className="page-header-actions">
          {cfStatus.running ? (
            <button className="btn-danger" onClick={stopTunnel} disabled={!canStop}>{actionBusy ? "Stopping..." : "Stop Tunnel"}</button>
          ) : (
            <button className="btn-primary" onClick={startTunnel} disabled={!canStart}>{actionBusy ? "Starting..." : "Start Cloudflared Tunnel"}</button>
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
            <button onClick={() => copyUrl(publicUrl)}>Copy</button>
            {copyTip && <span>{copyTip}</span>}
          </div>
          <p className="cloudflared-panel-hint">
            Use the public URL to access local services from external devices or tools.
            Append <code>/api/proxy/local/:serviceId/v1</code> for a specific service.
          </p>
        </div>
      )}
      {latestError && (
        <details style={{ marginBottom: 12 }}>
          <summary>Technical details</summary>
          <pre style={{ whiteSpace: "pre-wrap" }}>{latestError}</pre>
          {latestLogSummary.map((line) => <div key={line}><code>{line}</code></div>)}
        </details>
      )}
      {!cfStatus.running && (
        <div className="cloudflared-panel cloudflared-panel-muted">
          <div className="cloudflared-panel-head">
            <span className="connection-status-dot idle" />
            <strong>Public access is not enabled</strong>
          </div>
          <p className="cloudflared-panel-hint">Start Cloudflared Tunnel to generate public proxy URLs for local services.</p>
          <div className="form-grid" style={{ marginTop: 8 }}>
            <label>Target Port
              <input value={tunnelConfig.targetPort} onChange={(e) => setTunnelConfig((v) => ({ ...v, targetPort: e.target.value }))} placeholder={`default: proxyPort ${state.proxyPort ?? 3210}`} />
            </label>
            <label>Protocol
              <select value={tunnelConfig.protocol} onChange={(e) => setTunnelConfig((v) => ({ ...v, protocol: e.target.value }))}>
                <option value="http">http</option>
                <option value="https">https</option>
              </select>
            </label>
            <label>Hostname (optional)
              <input value={tunnelConfig.hostname} onChange={(e) => setTunnelConfig((v) => ({ ...v, hostname: e.target.value }))} placeholder="your.domain.com" />
            </label>
            <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input type="checkbox" checked={tunnelConfig.noAutoUpdate} onChange={(e) => setTunnelConfig((v) => ({ ...v, noAutoUpdate: e.target.checked }))} />
              noAutoUpdate
            </label>
          </div>
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

