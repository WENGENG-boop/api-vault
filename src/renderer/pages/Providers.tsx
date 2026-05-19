import { useEffect, useMemo, useState } from "react";
import type { AddKeyInput, ApiProtocol, AppState, BalanceConfig, ProviderSafe } from "../../shared/types";
import { apiClient, copyTextToClipboard } from "../apiClient";
import { defaultBalanceConfig } from "../constants";
import { UrlTestIndicator, UrlTestStatusLine, type UrlTestStatus } from "../common";
import { aggregateRows, buildAnalyticsRows, compactNumber, globalProxyBaseUrl, statsCost } from "../viewUtils";

interface ProviderKeyForm {
  id?: string;
  name?: string;
  providerName: string;
  keyName: string;
  protocol: ApiProtocol;
  baseUrl: string;
  currency: string;
  apiKey: string;
  queryKey: string;
  balanceConfig: BalanceConfig;
}

interface ProviderMetaForm {
  name: string;
  protocol: ApiProtocol;
  baseUrl: string;
  currency: string;
  balanceConfig: BalanceConfig;
}

export function Providers({ state, setState, showMsg, showErr }: {
  state: AppState; setState: (s: AppState) => void; showMsg: (m: string) => void; showErr: (e: unknown) => void;
}) {
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | undefined>();
  const [form, setForm] = useState<ProviderKeyForm>(emptyForm());
  const [selectedProviderId, setSelectedProviderId] = useState<string | undefined>();
  const [providerEditId, setProviderEditId] = useState<string | undefined>();
  const [providerEditForm, setProviderEditForm] = useState<Partial<ProviderMetaForm>>({});
  const [urlTests, setUrlTests] = useState<Record<string, UrlTestStatus>>({});
  const [formTest, setFormTest] = useState<UrlTestStatus | undefined>();
  const [editTest, setEditTest] = useState<UrlTestStatus | undefined>();
  const selectedProvider = state.providers.find((provider) => provider.id === selectedProviderId);
  const openaiGlobalUrl = globalProxyBaseUrl(state.proxyPort, "openai");
  const anthropicGlobalUrl = globalProxyBaseUrl(state.proxyPort, "anthropic");
  const autoGlobalUrl = globalProxyBaseUrl(state.proxyPort, "auto");
  const allUsageRows = useMemo(() => buildAnalyticsRows(state.usageEvents, state.usageRollups ?? [], "all"), [state.usageEvents, state.usageRollups]);
  const providerTestKey = useMemo(
    () => JSON.stringify(state.providers.map((p) => ({ id: p.id, baseUrl: p.baseUrl, protocol: p.protocol }))),
    [state.providers]
  );

  async function runProviderUrlTest(p: ProviderSafe) {
    setUrlTests((prev) => ({ ...prev, [p.id]: { ...(prev[p.id] ?? { ok: false, latencyMs: 0, checkedAt: "" }), testing: true } }));
    try {
      const result = await apiClient.testUrl({ baseUrl: p.baseUrl, protocol: p.protocol, providerId: p.id });
      setUrlTests((prev) => ({ ...prev, [p.id]: { ...result, testing: false } }));
    } catch (e) {
      setUrlTests((prev) => ({ ...prev, [p.id]: { ok: false, latencyMs: 0, error: e instanceof Error ? e.message : String(e), checkedAt: new Date().toISOString(), testing: false } }));
    }
  }

  useEffect(() => {
    if (state.providers.length === 0) return;
    const run = () => { state.providers.forEach((p) => { runProviderUrlTest(p); }); };
    run();
    const timer = window.setInterval(run, 60_000);
    return () => window.clearInterval(timer);
  }, [providerTestKey]);

  async function testFormUrl() {
    if (!form.baseUrl?.trim()) return;
    setFormTest({ ok: false, latencyMs: 0, checkedAt: "", testing: true });
    try {
      const result = await apiClient.testUrl({ baseUrl: form.baseUrl, protocol: form.protocol, providerId: editId });
      setFormTest({ ...result, testing: false });
    } catch (e) {
      setFormTest({ ok: false, latencyMs: 0, error: e instanceof Error ? e.message : String(e), checkedAt: new Date().toISOString(), testing: false });
    }
  }

  async function testEditUrl(providerId?: string) {
    if (!providerEditForm.baseUrl?.trim()) return;
    setEditTest({ ok: false, latencyMs: 0, checkedAt: "", testing: true });
    try {
      const result = await apiClient.testUrl({ baseUrl: providerEditForm.baseUrl, protocol: providerEditForm.protocol, providerId });
      setEditTest({ ...result, testing: false });
    } catch (e) {
      setEditTest({ ok: false, latencyMs: 0, error: e instanceof Error ? e.message : String(e), checkedAt: new Date().toISOString(), testing: false });
    }
  }

  function emptyForm(): ProviderKeyForm {
    return { providerName: "", keyName: "", protocol: "openai-compatible", baseUrl: "", currency: "USD", apiKey: "", queryKey: "", balanceConfig: { ...defaultBalanceConfig } };
  }

  function startEdit(p: ProviderSafe) {
    setForm({ id: p.id, name: p.name, providerName: p.name, keyName: "", protocol: p.protocol, baseUrl: p.baseUrl, currency: p.currency, apiKey: "", queryKey: "", balanceConfig: { ...p.balanceConfig } });
    setEditId(p.id);
    setProviderEditId(undefined);
    setSelectedProviderId(undefined);
    setShowForm(true);
  }

  function startProviderMetaEdit(p: ProviderSafe) {
    setProviderEditId(p.id);
    setProviderEditForm({
      name: p.name,
      protocol: p.protocol,
      baseUrl: p.baseUrl,
      currency: p.currency,
      balanceConfig: { ...p.balanceConfig }
    });
  }

  async function saveProviderMeta(providerId: string) {
    const provider = state.providers.find((item) => item.id === providerId);
    if (!provider) return;
    try {
      const s = await apiClient.saveProviderMeta({
        id: providerId,
        name: providerEditForm.name ?? provider.name,
        protocol: providerEditForm.protocol ?? provider.protocol,
        baseUrl: providerEditForm.baseUrl ?? provider.baseUrl,
        currency: providerEditForm.currency ?? provider.currency,
        balanceConfig: providerEditForm.balanceConfig ?? provider.balanceConfig
      });
      setState(s);
      setProviderEditId(undefined);
      setProviderEditForm({});
      showMsg("Provider updated");
    } catch (e) { showErr(e); }
  }

  async function save() {
    try {
      const payload: AddKeyInput = {
        providerId: editId,
        providerName: form.providerName || form.name,
        protocol: form.protocol,
        baseUrl: form.baseUrl,
        currency: form.currency,
        balanceConfig: form.balanceConfig,
        keyName: form.keyName || "default",
        apiKey: form.apiKey,
        queryKey: form.queryKey
      };
      const s = await apiClient.addKeyWithAutoMerge(payload);
      setState(s);
      setShowForm(false);
      setForm(emptyForm());
      setEditId(undefined);
      showMsg("API key added");
    } catch (e) { showErr(e); }
  }

  async function remove(id: string) {
    if (!confirm("Delete this provider?")) return;
    try { const s = await apiClient.deleteProvider(id); setState(s); setSelectedProviderId(undefined); showMsg("Deleted"); }
    catch (e) { showErr(e); }
  }

  async function copyKey(providerId: string, keyId: string) {
    try {
      const result = await apiClient.copyKey(providerId, keyId, "api");
      showMsg(result.copied ? "API key copied" : "Clipboard blocked. Press Ctrl+C in the selected box.");
    }
    catch (e) { showErr(e); }
  }

  async function copyProxy(providerId: string) {
    try {
      const result = await apiClient.copyProviderProxyUrl(providerId);
      showMsg(result.copied ? `Copied: ${result.text}` : "Clipboard blocked. Press Ctrl+C in the selected box.");
    }
    catch (e) { showErr(e); }
  }

  async function copyGlobalProxy(gateway: "openai" | "anthropic" | "auto") {
    const url = globalProxyBaseUrl(state.proxyPort, gateway);
    if (!url) {
      showErr("Proxy is not running");
      return;
    }
    try {
      const result = await copyTextToClipboard(url);
      showMsg(result.copied ? `Copied: ${result.text}` : "Clipboard blocked. Press Ctrl+C in the selected box.");
    } catch (e) { showErr(e); }
  }

  async function removeKey(providerId: string, keyId: string) {
    if (!confirm("Delete this API key?")) return;
    try { const s = await apiClient.deleteKey(providerId, keyId); setState(s); showMsg("API key deleted"); }
    catch (e) { showErr(e); }
  }

  return (
    <div className="page">
      <div className="page-header">
        <h2>Providers</h2>
        <button className="btn-primary" onClick={() => { setForm(emptyForm()); setEditId(undefined); setShowForm(true); }}>+ Add Key</button>
      </div>
      <div className="usage-hint">
        Recorded {state.totals.totalCalls} calls. For another app or platform to appear here, use the global API Vault Base URL for its protocol and keep sending the real API key.
      </div>

      <div className="global-proxy-panel">
        <div className="global-proxy-head">
          <div>
            <h3>Global API Vault Base URLs</h3>
            <p>Use one URL per protocol, or use Auto for providers that support both OpenAI and Anthropic request formats.</p>
          </div>
        </div>
        <div className="global-proxy-grid">
          <div className="global-proxy-card">
            <strong>OpenAI-compatible</strong>
            <code>{openaiGlobalUrl ?? "Proxy is not running"}</code>
            <button disabled={!openaiGlobalUrl} onClick={() => copyGlobalProxy("openai")}>Copy OpenAI Base URL</button>
          </div>
          <div className="global-proxy-card">
            <strong>Anthropic-compatible</strong>
            <code>{anthropicGlobalUrl ?? "Proxy is not running"}</code>
            <button disabled={!anthropicGlobalUrl} onClick={() => copyGlobalProxy("anthropic")}>Copy Anthropic Base URL</button>
          </div>
          <div className="global-proxy-card">
            <strong>Auto-compatible</strong>
            <code>{autoGlobalUrl ?? "Proxy is not running"}</code>
            <button disabled={!autoGlobalUrl} onClick={() => copyGlobalProxy("auto")}>Copy Auto Base URL</button>
          </div>
        </div>
        <span className="provider-proxy-note global-proxy-note">
          <strong>if connection, model-list, or model fetch fails, remove the trailing /v1 from this api vault base url and try again.</strong>
        </span>
      </div>

      {showForm && (
        <div className="form-card">
          <h3>{editId ? "Add Key to Provider" : "Add API Key"}</h3>
          <div className="form-grid">
            <label>Provider Name<input value={form.providerName ?? form.name ?? ""} onChange={(e) => setForm({ ...form, providerName: e.target.value })} placeholder="Optional, e.g. OpenAI" /></label>
            <label>Key Name<input value={form.keyName ?? ""} onChange={(e) => setForm({ ...form, keyName: e.target.value })} placeholder="e.g. key1, Cursor, server-prod" /></label>
            <label>Protocol
              <select value={form.protocol} onChange={(e) => setForm({ ...form, protocol: e.target.value as ApiProtocol })}>
                <option value="openai-compatible">OpenAI Compatible</option>
                <option value="anthropic-compatible">Anthropic Compatible</option>
                <option value="openai-anthropic-compatible">OpenAI + Anthropic Compatible</option>
              </select>
            </label>
            <label>Base URL
              <div className="url-input-row">
                <input value={form.baseUrl} onChange={(e) => { setForm({ ...form, baseUrl: e.target.value }); setFormTest(undefined); }} placeholder="https://api.openai.com/v1" />
                <UrlTestIndicator test={formTest} />
                <button type="button" onClick={testFormUrl} disabled={!form.baseUrl?.trim() || formTest?.testing}>Test</button>
              </div>
              {formTest && !formTest.testing && (
                <span className={`url-test-msg ${formTest.ok ? "url-test-msg--ok" : "url-test-msg--fail"}`}>
                  {formTest.ok ? `OK ${formTest.status} - ${formTest.latencyMs}ms` : `Failed: ${formTest.error ?? `HTTP ${formTest.status ?? "?"}`}`}
                </span>
              )}
            </label>
            <label>Currency<input value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })} placeholder="USD" /></label>
            <label>API Key<input type="password" value={form.apiKey ?? ""} onChange={(e) => setForm({ ...form, apiKey: e.target.value })} placeholder={editId ? "(unchanged if empty)" : "sk-..."} /></label>
            <label>Query Key (optional)<input type="password" value={form.queryKey ?? ""} onChange={(e) => setForm({ ...form, queryKey: e.target.value })} placeholder="For billing API if different" /></label>
          </div>
          <details className="balance-config">
            <summary>Balance Sync Config</summary>
            <div className="form-grid">
              <label><input type="checkbox" checked={form.balanceConfig.enabled} onChange={(e) => setForm({ ...form, balanceConfig: { ...form.balanceConfig, enabled: e.target.checked } })} /> Enable balance sync</label>
              <label>Balance URL<input value={form.balanceConfig.url} onChange={(e) => setForm({ ...form, balanceConfig: { ...form.balanceConfig, url: e.target.value } })} placeholder="https://api.example.com/billing" /></label>
              <label>Method
                <select value={form.balanceConfig.method} onChange={(e) => setForm({ ...form, balanceConfig: { ...form.balanceConfig, method: e.target.value as BalanceConfig["method"] } })}>
                  <option value="GET">GET</option>
                  <option value="POST">POST</option>
                </select>
              </label>
              <label>Headers JSON<textarea value={form.balanceConfig.headersJson} onChange={(e) => setForm({ ...form, balanceConfig: { ...form.balanceConfig, headersJson: e.target.value } })} rows={3} /></label>
              <label>Balance JSON Path<input value={form.balanceConfig.balancePath} onChange={(e) => setForm({ ...form, balanceConfig: { ...form.balanceConfig, balancePath: e.target.value } })} placeholder="data.balance" /></label>
              <label>Spent JSON Path<input value={form.balanceConfig.spentPath} onChange={(e) => setForm({ ...form, balanceConfig: { ...form.balanceConfig, spentPath: e.target.value } })} placeholder="data.used" /></label>
              <label>Response Cost Path<input value={form.balanceConfig.responseCostPath} onChange={(e) => setForm({ ...form, balanceConfig: { ...form.balanceConfig, responseCostPath: e.target.value } })} placeholder="usage.cost" /></label>
              <label>Auto-sync interval
                <select value={form.balanceConfig.autoSyncIntervalMs ?? 0} onChange={(e) => setForm({ ...form, balanceConfig: { ...form.balanceConfig, autoSyncIntervalMs: Number(e.target.value) } })}>
                  <option value={0}>Off</option>
                  <option value={60000}>1 min</option>
                  <option value={300000}>5 min</option>
                  <option value={900000}>15 min</option>
                  <option value={1800000}>30 min</option>
                </select>
              </label>
            </div>
          </details>
          <div className="form-actions">
            <button className="btn-primary" onClick={save}>Save</button>
            <button onClick={() => setShowForm(false)}>Cancel</button>
          </div>
        </div>
      )}

      <div className="provider-list provider-list-compact">
        {state.providers.map((p) => {
          const providerRows = allUsageRows.filter((row) => row.providerId === p.id);
          const providerStats = aggregateRows(providerRows);
          return (
            <div
              key={p.id}
              className="provider-card provider-card-compact"
              role="button"
              tabIndex={0}
              onClick={() => setSelectedProviderId(p.id)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  setSelectedProviderId(p.id);
                }
              }}
            >
              <div className="provider-summary-top">
                <div className="provider-summary-name">
                  <strong>{p.name}</strong>
                  <span className="provider-protocol">{p.protocol}</span>
                  <span className="provider-protocol">{p.apiKeys.length} keys</span>
                </div>
                <button
                  type="button"
                  className="provider-open-button"
                  onClick={(event) => { event.stopPropagation(); setSelectedProviderId(p.id); }}
                >
                  Open
                </button>
              </div>
              <div className="provider-url provider-summary-base">
                <UrlTestIndicator test={urlTests[p.id]} />
                <span>{p.baseUrl}</span>
              </div>
              <UrlTestStatusLine test={urlTests[p.id]} />
              <div className="provider-stats provider-summary-stats">
                <span>{providerStats.calls} calls</span>
                <span>{compactNumber(providerStats.totalTokens)} tokens</span>
                <span>{statsCost(providerStats)}</span>
                <span>{providerStats.lastUsedAt ? `Last ${new Date(providerStats.lastUsedAt).toLocaleString()}` : "Not used yet"}</span>
              </div>
              <div className="provider-summary-actions">
                <button
                  type="button"
                  onClick={(event) => { event.stopPropagation(); startEdit(p); }}
                >
                  Add Key
                </button>
              </div>
            </div>
          );
        })}
        {state.providers.length === 0 && <p className="empty">No providers yet. Add one to get started.</p>}
      </div>

      {selectedProvider && (() => {
        const providerRows = allUsageRows.filter((row) => row.providerId === selectedProvider.id);
        const providerStats = aggregateRows(providerRows);
        return (
          <div className="provider-modal-backdrop" onClick={() => setSelectedProviderId(undefined)}>
            <div className="provider-modal" role="dialog" aria-modal="true" aria-label={`${selectedProvider.name} provider details`} onClick={(event) => event.stopPropagation()}>
              <div className="provider-modal-header">
                <div>
                  <div className="provider-header">
                    <strong>{selectedProvider.name}</strong>
                    <span className="provider-protocol">{selectedProvider.protocol}</span>
                    <span className="provider-protocol">{selectedProvider.apiKeys.length} keys</span>
                  </div>
                  <div className="provider-url">
                    <UrlTestIndicator test={urlTests[selectedProvider.id]} />
                    <span>{selectedProvider.baseUrl}</span>
                    <button type="button" className="url-test-retry" onClick={() => runProviderUrlTest(selectedProvider)} disabled={urlTests[selectedProvider.id]?.testing}>Test now</button>
                  </div>
                  <UrlTestStatusLine test={urlTests[selectedProvider.id]} />
                </div>
                <button className="provider-modal-close" onClick={() => setSelectedProviderId(undefined)}>Close</button>
              </div>

              {providerEditId === selectedProvider.id ? (
                <div className="provider-meta-editor">
                  <div className="provider-meta-editor-head">
                    <strong>Edit provider</strong>
                    <span>Update the upstream base URL and supported request format.</span>
                  </div>
                  <div className="provider-meta-grid">
                    <label>Provider Name
                      <input value={providerEditForm.name ?? ""} onChange={(event) => setProviderEditForm({ ...providerEditForm, name: event.target.value })} />
                    </label>
                    <label>Protocol
                      <select value={providerEditForm.protocol ?? "openai-compatible"} onChange={(event) => setProviderEditForm({ ...providerEditForm, protocol: event.target.value as ApiProtocol })}>
                        <option value="openai-compatible">OpenAI Compatible</option>
                        <option value="anthropic-compatible">Anthropic Compatible</option>
                        <option value="openai-anthropic-compatible">OpenAI + Anthropic Compatible</option>
                      </select>
                    </label>
                    <label>Base URL
                      <div className="url-input-row">
                        <input value={providerEditForm.baseUrl ?? ""} onChange={(event) => { setProviderEditForm({ ...providerEditForm, baseUrl: event.target.value }); setEditTest(undefined); }} />
                        <UrlTestIndicator test={editTest} />
                        <button type="button" onClick={() => testEditUrl(selectedProvider?.id)} disabled={!providerEditForm.baseUrl?.trim() || editTest?.testing}>Test</button>
                      </div>
                      {editTest && !editTest.testing && (
                        <span className={`url-test-msg ${editTest.ok ? "url-test-msg--ok" : "url-test-msg--fail"}`}>
                          {editTest.ok ? `OK ${editTest.status} - ${editTest.latencyMs}ms` : `Failed: ${editTest.error ?? `HTTP ${editTest.status ?? "?"}`}`}
                        </span>
                      )}
                    </label>
                    <label>Currency
                      <input value={providerEditForm.currency ?? ""} onChange={(event) => setProviderEditForm({ ...providerEditForm, currency: event.target.value })} />
                    </label>
                  </div>
                  <div className="provider-actions provider-meta-actions">
                    <button className="btn-primary" onClick={() => saveProviderMeta(selectedProvider.id)}>Save Provider</button>
                    <button onClick={() => { setProviderEditId(undefined); setProviderEditForm({}); }}>Cancel</button>
                  </div>
                </div>
              ) : (
                <div className="provider-actions provider-meta-toolbar">
                  <button onClick={() => startProviderMetaEdit(selectedProvider)}>Edit Provider</button>
                </div>
              )}

              <div className="provider-stats provider-modal-stats">
                <span>{providerStats.calls} calls</span>
                <span>{compactNumber(providerStats.totalTokens)} tokens</span>
                <span>{statsCost(providerStats)}</span>
                <span>{providerStats.lastUsedAt ? `Last ${new Date(providerStats.lastUsedAt).toLocaleString()}` : "Not used yet"}</span>
              </div>

              {selectedProvider.proxyBaseUrl && (
                <div className="base-url-pair provider-proxy-block">
                  <div>
                    <span>Original Base URL</span>
                    <code>{selectedProvider.baseUrl}</code>
                  </div>
                  <div className="vault-base-url">
                    <span>Advanced provider URL - compatibility fallback</span>
                    <code>{selectedProvider.proxyBaseUrl}</code>
                  </div>
                  <div className="provider-actions provider-proxy-actions">
                    <button onClick={() => copyProxy(selectedProvider.id)}>Copy Provider URL</button>
                    <span className="provider-proxy-note">
                      <strong>advanced provider-specific url. the global openai/anthropic urls above are recommended for most third-party apps.</strong>
                      <strong>if connection, model-list, or model fetch fails, remove the trailing /v1 from this api vault base url and try again.</strong>
                    </span>
                  </div>
                </div>
              )}

              <div className="key-list provider-modal-keys">
                {selectedProvider.apiKeys.map((key) => {
                  const keyStats = aggregateRows(providerRows.filter((row) => row.apiKeyId === key.id));
                  return (
                    <div key={key.id} className="key-row">
                      <div className="key-main">
                        <strong>{key.name}</strong>
                        <code>{key.keyMasked}</code>
                        {key.hasQueryKey && <span className="key-badge">query key</span>}
                      </div>
                      <div className="key-stats">
                        <span>{keyStats.calls} calls</span>
                        <span>{compactNumber(keyStats.totalTokens)} tokens</span>
                        <span>{statsCost(keyStats)}</span>
                        <span>{key.lastUsedAt ? new Date(key.lastUsedAt).toLocaleString() : "Never used"}</span>
                      </div>
                      <div className="provider-actions">
                        <button onClick={() => copyKey(selectedProvider.id, key.id)}>Copy Key</button>
                        <button className="btn-danger" onClick={() => removeKey(selectedProvider.id, key.id)}>Delete Key</button>
                      </div>
                    </div>
                  );
                })}
                {selectedProvider.apiKeys.length === 0 && <div className="empty-key">No keys under this provider.</div>}
              </div>

              <div className="provider-actions provider-modal-actions">
                <button onClick={() => startEdit(selectedProvider)}>Add Key Here</button>
                <button className="btn-danger" onClick={() => remove(selectedProvider.id)}>Delete Provider</button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}

