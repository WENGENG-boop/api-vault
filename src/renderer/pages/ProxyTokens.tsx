import { useState } from "react";
import type { AppState, ProxyModelRule, ProxyTokenInput, ProxyTokenSafe } from "../../shared/types";
import { apiClient, copyTextToClipboard } from "../apiClient";

export function ProxyTokens({ state, setState, showMsg, showErr }: {
  state: AppState; setState: (s: AppState) => void; showMsg: (m: string) => void; showErr: (e: unknown) => void;
}) {
  const firstProvider = state.providers[0];
  const [showForm, setShowForm] = useState(false);
  const [editingTokenId, setEditingTokenId] = useState<string | undefined>();
  const [expandedTokenId, setExpandedTokenId] = useState<string | undefined>();
  const [jsonModalTokenId, setJsonModalTokenId] = useState<string | undefined>();
  const [jsonCopied, setJsonCopied] = useState(false);
  const [revealedSecrets, setRevealedSecrets] = useState<Record<string, string>>({});
  const [jsonSecrets, setJsonSecrets] = useState<Record<string, string>>({});
  const [secret, setSecret] = useState("");
  const [ruleEditIndex, setRuleEditIndex] = useState<number | undefined>();
  const [form, setForm] = useState<ProxyTokenInput>({
    name: "remote client",
    enabled: true,
    allowedProviderIds: firstProvider ? [firstProvider.id] : [],
    allowedModels: [],
    allowStreaming: true,
    requestsPerMinute: 60,
    requestsPerDay: 10000,
    expiresAt: ""
  });
  const [rule, setRule] = useState<ProxyModelRule>({
    publicModel: "",
    providerId: firstProvider?.id ?? "",
    apiKeyId: firstProvider?.apiKeys[0]?.id,
    upstreamModel: ""
  });

  function selectedProvider(id: string) {
    return state.providers.find((provider) => provider.id === id);
  }

  function gatewayBaseUrl() {
    if (state.proxyPort) return `http://127.0.0.1:${state.proxyPort}/proxy/v1`;
    const origin = window.location.origin || "http://127.0.0.1:3210";
    return `${origin.replace("localhost", "127.0.0.1")}/proxy/v1`;
  }

  function inferenceModelsFor(token: ProxyTokenSafe) {
    const models = new Map<string, boolean>();
    for (const item of token.allowedModels) {
      const rawName = item.publicModel.trim();
      if (!rawName) continue;
      const supports1m = /\[1m\]/i.test(rawName);
      const name = rawName.replace(/\s*\[1m\]\s*/gi, "").trim();
      if (!name) continue;
      models.set(name, (models.get(name) ?? false) || supports1m);
    }
    return Array.from(models, ([name, supports1m]) => ({ name, supports1m }));
  }

  function buildJsonConfig(token: ProxyTokenSafe, proxyKey: string) {
    return JSON.stringify({
      inferenceProvider: "gateway",
      inferenceGatewayBaseUrl: gatewayBaseUrl(),
      inferenceGatewayApiKey: proxyKey,
      inferenceModels: inferenceModelsFor(token)
    }, null, 2);
  }

  function addRule() {
    if (!rule.publicModel.trim() || !rule.providerId || !rule.upstreamModel.trim()) return;
    const nextRules = [...form.allowedModels];
    if (ruleEditIndex === undefined) {
      nextRules.push(rule);
    } else {
      nextRules[ruleEditIndex] = rule;
    }
    setForm({ ...form, allowedModels: nextRules });
    const provider = selectedProvider(rule.providerId);
    setRule({ publicModel: "", providerId: provider?.id ?? "", apiKeyId: provider?.apiKeys[0]?.id, upstreamModel: "" });
    setRuleEditIndex(undefined);
  }

  function editRule(index: number) {
    const current = form.allowedModels[index];
    if (!current) return;
    setRule({ ...current });
    setRuleEditIndex(index);
  }

  function removeRule(index: number) {
    setForm({ ...form, allowedModels: form.allowedModels.filter((_, i) => i !== index) });
    if (ruleEditIndex === index) setRuleEditIndex(undefined);
  }

  async function create() {
    try {
      const result = await apiClient.createProxyToken(form);
      setState(result.state);
      setSecret(result.secret);
      setEditingTokenId(undefined);
      const copy = await copyTextToClipboard(result.secret);
      showMsg(copy.copied ? "Proxy token created and copied" : "Proxy token created. Clipboard blocked.");
    } catch (e) { showErr(e); }
  }

  async function saveEdit() {
    if (!editingTokenId) return;
    try {
      const next = await apiClient.updateProxyToken(editingTokenId, form);
      setState(next);
      showMsg("Proxy token updated");
      setShowForm(false);
      setEditingTokenId(undefined);
    } catch (e) { showErr(e); }
  }

  async function remove(id: string) {
    if (!confirm("Delete this proxy token?")) return;
    try { const s = await apiClient.deleteProxyToken(id); setState(s); showMsg("Proxy token deleted"); }
    catch (e) { showErr(e); }
  }

  async function regenerate(id: string) {
    try {
      const result = await apiClient.regenerateProxyToken(id);
      setState(result.state);
      setSecret(result.secret);
      setRevealedSecrets((prev) => ({ ...prev, [id]: result.secret }));
      setJsonSecrets((prev) => prev[id] || jsonModalTokenId === id ? { ...prev, [id]: result.secret } : prev);
      const copy = await copyTextToClipboard(result.secret);
      showMsg(copy.copied ? "New proxy token copied" : "New proxy token created. Clipboard blocked.");
    } catch (e) { showErr(e); }
  }

  async function reveal(id: string) {
    if (revealedSecrets[id]) {
      setRevealedSecrets((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
      return;
    }
    try {
      const result = await apiClient.revealProxyToken(id);
      setRevealedSecrets((prev) => ({ ...prev, [id]: result.secret }));
      await copyTextToClipboard(result.secret);
      showMsg("Proxy token shown and copied");
    } catch (e) { showErr(e); }
  }

  async function openJsonConfig(token: ProxyTokenSafe) {
    try {
      if (!jsonSecrets[token.id]) {
        const result = await apiClient.revealProxyToken(token.id);
        setJsonSecrets((prev) => ({ ...prev, [token.id]: result.secret }));
      }
      setJsonCopied(false);
      setJsonModalTokenId(token.id);
    } catch (e) { showErr(e); }
  }

  async function copyJsonConfig(token: ProxyTokenSafe) {
    const proxyKey = jsonSecrets[token.id];
    if (!proxyKey) return;
    const copy = await copyTextToClipboard(buildJsonConfig(token, proxyKey));
    setJsonCopied(copy.copied);
    showMsg(copy.copied ? "JSON config copied" : "JSON config ready. Clipboard blocked.");
  }

  async function toggle(tokenId: string, enabled: boolean) {
    const token = state.proxyTokens.find((item) => item.id === tokenId);
    if (!token) return;
    try {
      const s = await apiClient.updateProxyToken(tokenId, { ...token, enabled });
      setState(s);
      showMsg(enabled ? "Proxy token enabled" : "Proxy token disabled");
    } catch (e) { showErr(e); }
  }

  async function refresh() {
    try {
      const next = await apiClient.getState();
      setState(next);
      showMsg("Proxy tokens refreshed");
    } catch (e) { showErr(e); }
  }

  function beginCreate() {
    const provider = state.providers[0];
    setForm({
      name: "remote client",
      enabled: true,
      allowedProviderIds: provider ? [provider.id] : [],
      allowedModels: [],
      allowStreaming: true,
      requestsPerMinute: 60,
      requestsPerDay: 10000,
      expiresAt: ""
    });
    setRule({
      publicModel: "",
      providerId: provider?.id ?? "",
      apiKeyId: provider?.apiKeys[0]?.id,
      upstreamModel: ""
    });
    setRuleEditIndex(undefined);
    setEditingTokenId(undefined);
    setShowForm(true);
  }

  function beginEdit(tokenId: string) {
    const token = state.proxyTokens.find((item) => item.id === tokenId);
    if (!token) return;
    const fallbackProvider = state.providers.find((p) => token.allowedProviderIds.includes(p.id)) ?? state.providers[0];
    setForm({
      name: token.name,
      enabled: token.enabled,
      allowedProviderIds: token.allowedProviderIds,
      allowedModels: token.allowedModels,
      allowStreaming: token.allowStreaming,
      requestsPerMinute: token.requestsPerMinute,
      requestsPerDay: token.requestsPerDay,
      expiresAt: token.expiresAt ?? ""
    });
    setRule({
      publicModel: "",
      providerId: fallbackProvider?.id ?? "",
      apiKeyId: fallbackProvider?.apiKeys[0]?.id,
      upstreamModel: ""
    });
    setRuleEditIndex(undefined);
    setEditingTokenId(tokenId);
    setShowForm(true);
  }

  const jsonModalToken = state.proxyTokens.find((token) => token.id === jsonModalTokenId);
  const jsonModalText = jsonModalToken && jsonSecrets[jsonModalToken.id]
    ? buildJsonConfig(jsonModalToken, jsonSecrets[jsonModalToken.id])
    : "";

  return (
    <div className="page">
      <div className="page-header proxy-token-page-header">
        <h2>Proxy Tokens</h2>
        <div className="provider-actions">
          <span className="proxy-token-count">{state.proxyTokens.length} active token{state.proxyTokens.length === 1 ? "" : "s"}</span>
          <button onClick={refresh}>Refresh</button>
          <button className="btn-primary" onClick={beginCreate}>+ Add Token</button>
        </div>
      </div>
      <div className="usage-hint proxy-token-hint">
        Use <code>Authorization: Bearer proxy_xxx</code> against <code>/proxy/v1/chat/completions</code>. Real provider keys never leave API Vault.
      </div>
      {showForm && <div className="form-card proxy-token-form">
        <div className="proxy-token-section-head">
          <h3>{editingTokenId ? "Edit Proxy Token" : "Add Proxy Token"}</h3>
          <span>{editingTokenId ? "Update model mapping and limits" : "Add token access for external clients"}</span>
        </div>
        <div className="form-grid">
          <label>Token Name<input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
          <label>Requests / min<input type="number" value={form.requestsPerMinute} onChange={(e) => setForm({ ...form, requestsPerMinute: Number(e.target.value) })} /></label>
          <label>Requests / day<input type="number" value={form.requestsPerDay} onChange={(e) => setForm({ ...form, requestsPerDay: Number(e.target.value) })} /></label>
          <label>Expires at<input type="datetime-local" value={form.expiresAt ?? ""} onChange={(e) => setForm({ ...form, expiresAt: e.target.value })} /></label>
          <label className="proxy-token-toggle"><input type="checkbox" checked={form.allowStreaming} onChange={(e) => setForm({ ...form, allowStreaming: e.target.checked })} /> Allow streaming</label>
        </div>
        <div className="proxy-token-provider-list">
          <strong>Allowed providers</strong>
          {state.providers.map((provider) => (
            <label key={provider.id} className="proxy-token-chip">
              <input type="checkbox" checked={form.allowedProviderIds.includes(provider.id)} onChange={(e) => setForm({
                ...form,
                allowedProviderIds: e.target.checked ? [...form.allowedProviderIds, provider.id] : form.allowedProviderIds.filter((id) => id !== provider.id)
              })} />
              {provider.name}
            </label>
          ))}
        </div>
        <div className="proxy-rule-builder">
          <div className="proxy-token-section-head">
            <h4>Model Mapping</h4>
            <span>Public name -&gt; provider / upstream model</span>
          </div>
          <div className="form-grid">
            <label>Public model<input value={rule.publicModel} onChange={(e) => setRule({ ...rule, publicModel: e.target.value })} placeholder="claude-desktop" /></label>
            <label>Provider<select value={rule.providerId} onChange={(e) => {
              const provider = selectedProvider(e.target.value);
              setRule({ ...rule, providerId: e.target.value, apiKeyId: provider?.apiKeys[0]?.id });
            }}>{state.providers.map((provider) => <option key={provider.id} value={provider.id}>{provider.name}</option>)}</select></label>
            <label>Key<select value={rule.apiKeyId ?? ""} onChange={(e) => setRule({ ...rule, apiKeyId: e.target.value || undefined })}>
              <option value="">First key</option>
              {(selectedProvider(rule.providerId)?.apiKeys ?? []).map((key) => <option key={key.id} value={key.id}>{key.name} {key.keyMasked}</option>)}
            </select></label>
            <label>Upstream model<input value={rule.upstreamModel} onChange={(e) => setRule({ ...rule, upstreamModel: e.target.value })} placeholder="real-model-id" /></label>
          </div>
          <button className="proxy-token-add-rule" onClick={addRule}>{ruleEditIndex === undefined ? "Add model rule" : "Save model rule"}</button>
          <div className="proxy-rule-list">
            {form.allowedModels.map((item, index) => (
              <span key={`${item.publicModel}-${index}`} className="proxy-rule-item">
                <code>{item.publicModel}</code> {"->"} {selectedProvider(item.providerId)?.name ?? item.providerId} / <code>{item.upstreamModel}</code>
                <button onClick={() => editRule(index)}>Edit</button>
                <button onClick={() => removeRule(index)}>Remove</button>
              </span>
            ))}
            {form.allowedModels.length === 0 && <p className="empty">No model mapping rules yet.</p>}
          </div>
        </div>
        <div className="form-actions">
          <button className="btn-primary" onClick={editingTokenId ? saveEdit : create} disabled={state.providers.length === 0}>
            {editingTokenId ? "Save" : "Add Token"}
          </button>
          <button onClick={() => { setShowForm(false); setEditingTokenId(undefined); }}>Cancel</button>
        </div>
        {secret && <div className="secret-once"><strong>Copy this now. It is shown once:</strong><code>{secret}</code></div>}
      </div>}
      <div className="proxy-token-list">
        {state.proxyTokens.map((token) => (
          <div key={token.id} className="proxy-token-card">
            <div className="proxy-token-card-head">
              <strong>{token.name}</strong>
              <span className={`proxy-token-state ${token.enabled ? "enabled" : "disabled"}`}>{token.enabled ? "Enabled" : "Disabled"}</span>
            </div>
            <code className="proxy-token-mask">{token.tokenMasked}</code>
            <div className="proxy-token-meta">
              <span>{token.allowedModels.length} model rules</span>
              <span>{token.requestsPerMinute}/min</span>
              <span>{token.requestsPerDay}/day</span>
              <span>stream {token.allowStreaming ? "on" : "off"}</span>
            </div>
            {expandedTokenId === token.id && (
              <div className="proxy-rule-list">
                {token.allowedModels.map((item, index) => (
                  <span key={`${token.id}-${item.publicModel}-${index}`} className="proxy-rule-item">
                    <code>{item.publicModel}</code> {"->"} {selectedProvider(item.providerId)?.name ?? item.providerId} / <code>{item.upstreamModel}</code>
                  </span>
                ))}
                {token.allowedModels.length === 0 && <p className="empty">No model mapping rules.</p>}
              </div>
            )}
            <div className="provider-actions proxy-token-actions">
              <button onClick={() => setExpandedTokenId(expandedTokenId === token.id ? undefined : token.id)}>
                {expandedTokenId === token.id ? "Hide" : "Show"}
              </button>
              <button onClick={() => beginEdit(token.id)}>Edit Mapping</button>
              <button onClick={() => reveal(token.id)}>{revealedSecrets[token.id] ? "Hide Key" : "Show Key"}</button>
              <button onClick={() => openJsonConfig(token)}>JSON File</button>
              <button onClick={() => toggle(token.id, !token.enabled)}>{token.enabled ? "Disable" : "Enable"}</button>
              <button onClick={() => regenerate(token.id)}>Regenerate</button>
              <button className="btn-danger" onClick={() => remove(token.id)}>Delete</button>
            </div>
            {revealedSecrets[token.id] && (
              <div className="secret-once">
                <strong>Current key:</strong><code>{revealedSecrets[token.id]}</code>
              </div>
            )}
          </div>
        ))}
        {state.proxyTokens.length === 0 && <p className="empty">No proxy tokens yet. Create one before using a public tunnel.</p>}
      </div>
      {jsonModalToken && (
        <div className="proxy-json-modal-backdrop" onClick={() => setJsonModalTokenId(undefined)}>
          <div className="proxy-json-modal" role="dialog" aria-modal="true" aria-label={`${jsonModalToken.name} JSON config`} onClick={(event) => event.stopPropagation()}>
            <div className="proxy-json-modal-header">
              <div>
                <strong>{jsonModalToken.name} JSON File</strong>
                <span>{inferenceModelsFor(jsonModalToken).length} inference model{inferenceModelsFor(jsonModalToken).length === 1 ? "" : "s"}</span>
              </div>
              <div className="proxy-json-modal-actions">
                <button className="btn-primary" onClick={() => copyJsonConfig(jsonModalToken)} disabled={!jsonModalText}>{jsonCopied ? "Copied" : "Copy"}</button>
                <button onClick={() => setJsonModalTokenId(undefined)}>Close</button>
              </div>
            </div>
            <pre className="proxy-json-code">{jsonModalText}</pre>
          </div>
        </div>
      )}
    </div>
  );
}

