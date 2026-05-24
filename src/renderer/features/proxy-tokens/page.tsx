import { useRef, useState } from "react";
import type { AppState, ProxyModelRule, ProxyTokenInput, ProxyTokenSafe } from "../../../shared/types";
import { apiClient, copyTextToClipboard } from "../../shared/api";
import { Button, EmptyState, PageHeader, StatusPill, confirmAction } from "../../shared/components";

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
  const [poolImportId, setPoolImportId] = useState("");
  const [providerModelTests, setProviderModelTests] = useState<Record<string, { testing?: boolean; ok?: boolean; error?: string; modelNames: string[]; checkedAt?: string }>>({});
  const formRef = useRef<HTMLDivElement | null>(null);
  const ruleEditorRef = useRef<HTMLDivElement | null>(null);
  const publicModelInputRef = useRef<HTMLInputElement | null>(null);
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

  function upstreamModelOptions(providerId: string): string[] {
    const catalogModels = state.modelCatalog
      .filter((model) => model.providerId === providerId)
      .flatMap((model) => [model.modelId, model.displayName, model.canonicalModelId, ...model.aliases]);
    const poolModels = state.accountPools
      .filter((pool) => pool.providerId === providerId)
      .flatMap((pool) => pool.modelNames);
    return Array.from(new Set([...catalogModels, ...poolModels].filter((item): item is string => Boolean(item?.trim())))).sort();
  }

  function providerModelOptions(providerId: string): string[] {
    const testedModels = providerModelTests[providerId]?.modelNames ?? [];
    const baseOptions = testedModels.length > 0 ? testedModels : upstreamModelOptions(providerId);
    return Array.from(new Set([...baseOptions, rule.providerId === providerId ? rule.upstreamModel : ""].filter((item) => item.trim()))).sort();
  }

  async function testProviderModels(providerId = rule.providerId) {
    const provider = selectedProvider(providerId);
    if (!provider) {
      showErr("Select a provider before testing models");
      return;
    }
    setProviderModelTests((prev) => ({
      ...prev,
      [providerId]: { ...(prev[providerId] ?? { modelNames: [] }), testing: true }
    }));
    try {
      const result = await apiClient.testUrl({ baseUrl: provider.baseUrl, protocol: provider.protocol, providerId: provider.id });
      const modelNames = result.modelNames ?? [];
      setProviderModelTests((prev) => ({
        ...prev,
        [providerId]: { testing: false, ok: result.ok, error: result.error, modelNames, checkedAt: result.checkedAt }
      }));
      if (modelNames.length > 0) {
        setRule((current) => current.providerId === providerId
          ? { ...current, upstreamModel: modelNames.includes(current.upstreamModel) ? current.upstreamModel : modelNames[0] }
          : current);
        showMsg(`Loaded ${modelNames.length} models from ${provider.name}`);
      } else {
        showMsg(result.ok ? `Provider test passed, but no model list was returned by ${provider.name}` : `Provider test failed: ${result.error ?? "unknown error"}`);
      }
    } catch (e) {
      setProviderModelTests((prev) => ({
        ...prev,
        [providerId]: { testing: false, ok: false, error: e instanceof Error ? e.message : String(e), modelNames: prev[providerId]?.modelNames ?? [], checkedAt: new Date().toISOString() }
      }));
      showErr(e);
    }
  }

  function providerKeyLabel(providerId: string, apiKeyId?: string) {
    const provider = selectedProvider(providerId);
    const key = provider?.apiKeys.find((item) => item.id === apiKeyId);
    return key ? `${key.name} ${key.keyMasked}` : "First key";
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
    window.setTimeout(() => {
      ruleEditorRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
      publicModelInputRef.current?.focus();
      publicModelInputRef.current?.select();
    }, 0);
  }

  function cancelRuleEdit() {
    const provider = selectedProvider(rule.providerId) ?? state.providers[0];
    setRule({
      publicModel: "",
      providerId: provider?.id ?? "",
      apiKeyId: provider?.apiKeys[0]?.id,
      upstreamModel: ""
    });
    setRuleEditIndex(undefined);
  }

  function removeRule(index: number) {
    if (!confirmAction("Remove this model mapping rule?")) return;
    setForm({ ...form, allowedModels: form.allowedModels.filter((_, i) => i !== index) });
    if (ruleEditIndex === index) setRuleEditIndex(undefined);
  }

  function upsertImportedRules(rules: ProxyModelRule[]) {
    const byPublicModel = new Map(form.allowedModels.map((item) => [item.publicModel, item]));
    for (const item of rules) byPublicModel.set(item.publicModel, item);
    setForm({ ...form, allowedModels: Array.from(byPublicModel.values()) });
  }

  function importProviderRules() {
    const providerIds = form.allowedProviderIds.length ? form.allowedProviderIds : state.providers.map((provider) => provider.id);
    const rules = state.modelCatalog
      .filter((model) => providerIds.includes(model.providerId))
      .map((model) => ({
        publicModel: model.displayName?.trim() || model.canonicalModelId?.trim() || model.modelId,
        providerId: model.providerId,
        apiKeyId: selectedProvider(model.providerId)?.apiKeys[0]?.id,
        upstreamModel: model.modelId
      }));
    if (!rules.length) {
      showErr("No provider models available. Sync the Model Directory first or add a rule manually.");
      return;
    }
    upsertImportedRules(rules);
    showMsg(`Imported ${rules.length} provider model rules`);
  }

  function importPoolRules() {
    const pool = state.accountPools.find((item) => item.id === poolImportId);
    if (!pool?.providerId || pool.modelNames.length === 0) {
      showErr("Select an account pool with a linked provider and synced models");
      return;
    }
    const rules = pool.modelNames.map((model) => ({
      publicModel: model,
      providerId: pool.providerId!,
      apiKeyId: selectedProvider(pool.providerId!)?.apiKeys[0]?.id,
      upstreamModel: model
    }));
    upsertImportedRules(rules);
    showMsg(`Imported ${rules.length} account pool model rules`);
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
    if (!confirmAction("Delete this proxy token?")) return;
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
    window.setTimeout(() => formRef.current?.scrollIntoView({ block: "start", behavior: "smooth" }), 0);
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
    window.setTimeout(() => formRef.current?.scrollIntoView({ block: "start", behavior: "smooth" }), 0);
  }

  const jsonModalToken = state.proxyTokens.find((token) => token.id === jsonModalTokenId);
  const jsonModalText = jsonModalToken && jsonSecrets[jsonModalToken.id]
    ? buildJsonConfig(jsonModalToken, jsonSecrets[jsonModalToken.id])
    : "";

  return (
    <div className="page">
      <PageHeader
        title="Proxy Tokens"
        description={<>Use <code>Authorization: Bearer proxy_xxx</code> against <code>/proxy/v1/chat/completions</code>. Real provider keys never leave API Vault.</>}
        actions={
          <>
            <span className="proxy-token-count">{state.proxyTokens.length} token{state.proxyTokens.length === 1 ? "" : "s"}</span>
            <Button onClick={refresh}>Refresh</Button>
            <Button variant="primary" onClick={beginCreate}>Add Token</Button>
          </>
        }
      />
      <div className="usage-hint proxy-token-hint">
        Model mappings define the public model names clients see and the upstream provider model each name reaches.
      </div>
      {showForm && <div className="form-card proxy-token-form" ref={formRef}>
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
        <div className="proxy-rule-builder" ref={ruleEditorRef}>
          <div className="proxy-token-section-head">
            <h4>{ruleEditIndex === undefined ? "Model Mapping" : `Editing mapping #${ruleEditIndex + 1}`}</h4>
            <span>{ruleEditIndex === undefined ? "Public model -> provider / upstream model / key" : "Change the fields below, then save or cancel this rule edit."}</span>
          </div>
          <div className="proxy-rule-imports">
            <Button onClick={importProviderRules} disabled={state.modelCatalog.length === 0}>Import provider models</Button>
            <select value={poolImportId} onChange={(event) => setPoolImportId(event.target.value)}>
              <option value="">Select account pool</option>
              {state.accountPools.map((pool) => <option key={pool.id} value={pool.id}>{pool.name} ({pool.modelNames.length})</option>)}
            </select>
            <Button onClick={importPoolRules} disabled={!poolImportId}>Import pool models</Button>
          </div>
          <div className="form-grid">
            <label>Public model<input ref={publicModelInputRef} value={rule.publicModel} onChange={(e) => setRule({ ...rule, publicModel: e.target.value })} placeholder="claude-desktop" /></label>
            <label>Provider<select value={rule.providerId} onChange={(e) => {
              const provider = selectedProvider(e.target.value);
              const options = providerModelTests[e.target.value]?.modelNames.length
                ? providerModelTests[e.target.value].modelNames
                : upstreamModelOptions(e.target.value);
              setRule({ ...rule, providerId: e.target.value, apiKeyId: provider?.apiKeys[0]?.id, upstreamModel: options[0] ?? rule.upstreamModel });
            }}>{state.providers.map((provider) => <option key={provider.id} value={provider.id}>{provider.name}</option>)}</select></label>
            <label>Key<select value={rule.apiKeyId ?? ""} onChange={(e) => setRule({ ...rule, apiKeyId: e.target.value || undefined })}>
              <option value="">First key</option>
              {(selectedProvider(rule.providerId)?.apiKeys ?? []).map((key) => <option key={key.id} value={key.id}>{key.name} {key.keyMasked}</option>)}
            </select></label>
            <label>Upstream model
              <select value={rule.upstreamModel} onChange={(e) => setRule({ ...rule, upstreamModel: e.target.value })} disabled={!rule.providerId || providerModelOptions(rule.providerId).length === 0}>
                <option value="">{rule.providerId ? "Select upstream model" : "Select provider first"}</option>
                {providerModelOptions(rule.providerId).map((model) => <option key={model} value={model}>{model}</option>)}
              </select>
            </label>
          </div>
          <div className="proxy-model-test-row">
            <Button onClick={() => testProviderModels()} disabled={!rule.providerId || providerModelTests[rule.providerId]?.testing}>
              {providerModelTests[rule.providerId]?.testing ? "Testing models..." : "Test provider models"}
            </Button>
            <span>
              {providerModelTests[rule.providerId]?.modelNames.length
                ? `${providerModelTests[rule.providerId].modelNames.length} models from latest provider test`
                : upstreamModelOptions(rule.providerId).length
                ? `${upstreamModelOptions(rule.providerId).length} fallback models from Model Directory / account pools`
                : "No model options yet. Test the selected provider or sync the Model Directory."}
            </span>
            {providerModelTests[rule.providerId]?.error && <em>{providerModelTests[rule.providerId].error}</em>}
          </div>
          <div className="proxy-rule-editor-actions">
            <Button className="proxy-token-add-rule" onClick={addRule} disabled={!rule.publicModel.trim() || !rule.providerId || !rule.upstreamModel.trim()}>
              {ruleEditIndex === undefined ? "Add model rule" : "Save model rule"}
            </Button>
            {ruleEditIndex !== undefined && <Button onClick={cancelRuleEdit}>Cancel rule edit</Button>}
          </div>
          <div className="proxy-rule-list">
            {form.allowedModels.map((item, index) => (
              <div key={`${item.publicModel}-${index}`} className={`proxy-rule-row ${ruleEditIndex === index ? "proxy-rule-row-editing" : ""}`}>
                <code>{item.publicModel}</code>
                <span>{selectedProvider(item.providerId)?.name ?? item.providerId}</span>
                <code>{item.upstreamModel}</code>
                <span>{providerKeyLabel(item.providerId, item.apiKeyId)}</span>
                <StatusPill tone={selectedProvider(item.providerId) ? "ok" : "fail"}>{selectedProvider(item.providerId) ? "ready" : "missing provider"}</StatusPill>
                <button type="button" onClick={() => editRule(index)}>{ruleEditIndex === index ? "Editing" : "Edit"}</button>
                <button type="button" className="danger-link" onClick={() => removeRule(index)}>Remove</button>
              </div>
            ))}
            {form.allowedModels.length === 0 && <EmptyState title="No model mapping rules yet" description="Add one manually or import from the Model Directory/account pool." />}
          </div>
        </div>
        <div className="form-actions">
          <button type="button" className="btn-primary" onClick={editingTokenId ? saveEdit : create} disabled={state.providers.length === 0}>
            {editingTokenId ? "Save" : "Add Token"}
          </button>
          <button type="button" onClick={() => { setShowForm(false); setEditingTokenId(undefined); }}>Cancel</button>
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
                  <div key={`${token.id}-${item.publicModel}-${index}`} className="proxy-rule-row proxy-rule-row-readonly">
                    <code>{item.publicModel}</code>
                    <span>{selectedProvider(item.providerId)?.name ?? item.providerId}</span>
                    <code>{item.upstreamModel}</code>
                    <span>{providerKeyLabel(item.providerId, item.apiKeyId)}</span>
                    <StatusPill tone={token.enabled && selectedProvider(item.providerId) ? "ok" : "neutral"}>{token.enabled ? "enabled" : "disabled"}</StatusPill>
                  </div>
                ))}
                {token.allowedModels.length === 0 && <p className="empty">No model mapping rules.</p>}
              </div>
            )}
            <div className="provider-actions proxy-token-actions">
              <button type="button" onClick={() => setExpandedTokenId(expandedTokenId === token.id ? undefined : token.id)}>
                {expandedTokenId === token.id ? "Hide" : "Show"}
              </button>
              <button type="button" onClick={() => beginEdit(token.id)}>Edit Mapping</button>
              <button type="button" onClick={() => reveal(token.id)}>{revealedSecrets[token.id] ? "Hide Key" : "Show Key"}</button>
              <button type="button" onClick={() => openJsonConfig(token)}>JSON File</button>
              <button type="button" onClick={() => toggle(token.id, !token.enabled)}>{token.enabled ? "Disable" : "Enable"}</button>
              <button type="button" onClick={() => regenerate(token.id)}>Regenerate</button>
              <button type="button" className="btn-danger" onClick={() => remove(token.id)}>Delete</button>
            </div>
            {revealedSecrets[token.id] && (
              <div className="secret-once">
                <strong>Current key:</strong><code>{revealedSecrets[token.id]}</code>
              </div>
            )}
          </div>
        ))}
        {state.proxyTokens.length === 0 && <EmptyState title="No proxy tokens yet" description="Create one before using the public proxy or tunnel." action={<Button variant="primary" onClick={beginCreate}>Add Token</Button>} />}
      </div>
      {jsonModalToken && (
        <div className="proxy-json-modal-backdrop" onClick={() => setJsonModalTokenId(undefined)}>
          <div className="proxy-json-modal" role="dialog" aria-modal="true" aria-label={`${jsonModalToken.name} JSON config`} onClick={(event) => event.stopPropagation()}>
            <div className="proxy-json-modal-header">
              <div>
                <strong>{jsonModalToken.name} JSON config</strong>
                <span>Paste this into clients that support gateway inference settings. It includes the proxy base URL, proxy token, and mapped public models.</span>
              </div>
              <div className="proxy-json-modal-actions">
                <button type="button" className="btn-primary" onClick={() => copyJsonConfig(jsonModalToken)} disabled={!jsonModalText}>{jsonCopied ? "Copied" : "Copy"}</button>
                <button type="button" onClick={() => setJsonModalTokenId(undefined)}>Close</button>
              </div>
            </div>
            <pre className="proxy-json-code">{jsonModalText}</pre>
          </div>
        </div>
      )}
    </div>
  );
}

