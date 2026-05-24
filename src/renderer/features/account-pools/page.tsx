import { useState } from "react";
import type { AccountPool, AccountPoolKind, AppState } from "../../../shared/types";
import { apiClient } from "../../shared/api";

interface AccountPoolForm {
  id?: string;
  name: string;
  kind: AccountPoolKind;
  baseUrl: string;
  apiKey: string;
  managementUrl: string;
  managementSecret: string;
  authsDirectory: string;
  notes: string;
  createProvider: boolean;
}

interface AuthUploadDraft {
  fileName: string;
  content: string;
}

export function AccountPools({ state, setState, showMsg, showErr }: {
  state: AppState; setState: (s: AppState) => void; showMsg: (m: string) => void; showErr: (e: unknown) => void;
}) {
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<AccountPoolForm>(emptyForm());
  const [testing, setTesting] = useState<Record<string, boolean>>({});
  const [syncing, setSyncing] = useState<Record<string, boolean>>({});
  const [importing, setImporting] = useState<Record<string, boolean>>({});
  const [uploading, setUploading] = useState<Record<string, boolean>>({});
  const [authUploads, setAuthUploads] = useState<Record<string, AuthUploadDraft>>({});
  const [selectedTokenIds, setSelectedTokenIds] = useState<Record<string, string>>({});

  function emptyForm(): AccountPoolForm {
    return {
      name: "",
      kind: "cpa",
      baseUrl: "",
      apiKey: "",
      managementUrl: "",
      managementSecret: "",
      authsDirectory: "",
      notes: "",
      createProvider: true
    };
  }

  function startCreate() {
    setForm(emptyForm());
    setShowForm(true);
  }

  function startEdit(pool: AccountPool) {
    setForm({
      id: pool.id,
      name: pool.name,
      kind: pool.kind,
      baseUrl: pool.baseUrl,
      apiKey: "",
      managementUrl: pool.managementUrl ?? "",
      managementSecret: "",
      authsDirectory: pool.authsDirectory ?? "",
      notes: pool.notes ?? "",
      createProvider: false
    });
    setShowForm(true);
  }

  async function save() {
    try {
      const next = await apiClient.saveAccountPool({
        id: form.id,
        name: form.name,
        kind: form.kind,
        baseUrl: form.baseUrl,
        apiKey: form.apiKey,
        managementUrl: form.managementUrl,
        managementSecret: form.managementSecret,
        authsDirectory: form.authsDirectory,
        notes: form.notes,
        createProvider: form.createProvider
      });
      setState(next);
      setShowForm(false);
      setForm(emptyForm());
      showMsg(form.id ? "Account pool updated" : "Account pool saved");
    } catch (e) {
      showErr(e);
    }
  }

  async function remove(pool: AccountPool) {
    if (!confirm("Delete this account pool? Linked providers and proxy token mappings are kept.")) return;
    try {
      const next = await apiClient.deleteAccountPool(pool.id);
      setState(next);
      showMsg("Account pool deleted");
    } catch (e) {
      showErr(e);
    }
  }

  async function testPool(pool: AccountPool) {
    setTesting((prev) => ({ ...prev, [pool.id]: true }));
    try {
      const { result, state: next } = await apiClient.testAccountPool(pool.id);
      setState(next);
      showMsg(result.ok ? `Connection OK: ${result.modelNames.length} models` : `Connection failed: ${result.error ?? "unknown error"}`);
    } catch (e) {
      showErr(e);
    } finally {
      setTesting((prev) => ({ ...prev, [pool.id]: false }));
    }
  }

  async function syncModels(pool: AccountPool) {
    setSyncing((prev) => ({ ...prev, [pool.id]: true }));
    try {
      const { result, state: next } = await apiClient.syncAccountPoolModels(pool.id);
      setState(next);
      showMsg(result.ok ? `Synced ${result.modelNames.length} models` : `Sync failed: ${result.error ?? "unknown error"}`);
    } catch (e) {
      showErr(e);
    } finally {
      setSyncing((prev) => ({ ...prev, [pool.id]: false }));
    }
  }

  async function createProvider(pool: AccountPool) {
    try {
      const next = await apiClient.createAccountPoolProvider(pool.id);
      setState(next);
      showMsg("Provider created");
    } catch (e) {
      showErr(e);
    }
  }

  async function importModels(pool: AccountPool) {
    const proxyTokenId = selectedTokenIds[pool.id] || state.proxyTokens[0]?.id;
    if (!proxyTokenId) {
      showErr("Create a Proxy Token before importing models");
      return;
    }
    setImporting((prev) => ({ ...prev, [pool.id]: true }));
    try {
      const { result, state: next } = await apiClient.importAccountPoolModelsToProxyToken(pool.id, { proxyTokenId });
      setState(next);
      showMsg(`Imported ${result.importedCount} models${result.replacedCount ? `, replaced ${result.replacedCount}` : ""}`);
    } catch (e) {
      showErr(e);
    } finally {
      setImporting((prev) => ({ ...prev, [pool.id]: false }));
    }
  }

  async function selectAuthFile(pool: AccountPool, file: File | undefined) {
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      showErr("Auth JSON file is larger than 2 MB");
      return;
    }
    try {
      const content = await file.text();
      setAuthUploads((prev) => ({ ...prev, [pool.id]: { fileName: file.name, content } }));
    } catch (e) {
      showErr(e);
    }
  }

  async function uploadAuth(pool: AccountPool) {
    const draft = authUploads[pool.id];
    if (!draft) {
      showErr("Select an auth JSON file first");
      return;
    }
    setUploading((prev) => ({ ...prev, [pool.id]: true }));
    try {
      const { result } = await apiClient.uploadAccountPoolAuth(pool.id, draft);
      showMsg(`Auth file uploaded: ${result.fileName}. Restart ${poolKindLabel(pool.kind)} if it does not auto-load auth files.`);
      setAuthUploads((prev) => {
        const next = { ...prev };
        delete next[pool.id];
        return next;
      });
    } catch (e) {
      showErr(e);
    } finally {
      setUploading((prev) => ({ ...prev, [pool.id]: false }));
    }
  }

  function linkedProvider(pool: AccountPool) {
    return pool.providerId ? state.providers.find((provider) => provider.id === pool.providerId) : undefined;
  }

  return (
    <div className="page account-pools-page">
      <div className="page-header">
        <h2>Account Pools</h2>
        <button className="btn-primary" onClick={startCreate}>+ Add Account Pool</button>
      </div>

      <div className="usage-hint">
        Add a CPA / CLIProxyAPI backend, sync its OpenAI-compatible models, create a linked provider, then import those models into a Proxy Token.
      </div>

      {showForm && (
        <div className="form-card account-pool-form">
          <h3>{form.id ? "Edit Account Pool" : `Add ${poolKindLabel(form.kind)} Account Pool`}</h3>
          <div className="form-grid">
            <label>Backend Type
              <select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value as AccountPoolKind })}>
                <option value="cpa">CPA / CLIProxyAPI</option>
              </select>
            </label>
            <label>Name
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder={`${poolKindLabel(form.kind)} Account Pool`} />
            </label>
            <label>{poolKindLabel(form.kind)} Base URL
              <input value={form.baseUrl} onChange={(e) => setForm({ ...form, baseUrl: e.target.value })} placeholder={baseUrlPlaceholder(form.kind)} />
            </label>
            <label>Proxy API Key
              <input type="password" value={form.apiKey} onChange={(e) => setForm({ ...form, apiKey: e.target.value })} placeholder={form.id ? "Leave blank to keep current key" : `${poolKindLabel(form.kind)} proxy API key`} />
            </label>
            <label>Management URL
              <input value={form.managementUrl} onChange={(e) => setForm({ ...form, managementUrl: e.target.value })} placeholder="Optional management API URL" />
            </label>
            <label>Management Secret
              <input type="password" value={form.managementSecret} onChange={(e) => setForm({ ...form, managementSecret: e.target.value })} placeholder={form.id ? "Leave blank to keep current secret" : "Optional management secret"} />
            </label>
            <label>Auths Directory
              <input value={form.authsDirectory} onChange={(e) => setForm({ ...form, authsDirectory: e.target.value })} placeholder="Optional CPA auths mount path" />
            </label>
            <label>Notes
              <textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={2} />
            </label>
            <label className="proxy-token-toggle">
              <input type="checkbox" checked={form.createProvider} onChange={(e) => setForm({ ...form, createProvider: e.target.checked })} />
              Create Provider
            </label>
          </div>
          <div className="form-actions">
            <button className="btn-primary" onClick={save} disabled={!form.name.trim() || !form.baseUrl.trim()}>
              Save
            </button>
            <button onClick={() => setShowForm(false)}>Cancel</button>
          </div>
        </div>
      )}

      <div className="provider-list account-pool-list">
        {state.accountPools.map((pool) => {
          const provider = linkedProvider(pool);
          const selectedTokenId = selectedTokenIds[pool.id] || state.proxyTokens[0]?.id || "";
          const isAvailable = pool.status === "available";
          const isUnavailable = pool.status === "unavailable";
          return (
            <div key={pool.id} className="provider-card account-pool-card">
              <div className="account-pool-card-head">
                <div className="provider-summary-name">
                  <strong>{pool.name}</strong>
                  <span className="provider-protocol">{poolKindLabel(pool.kind)}</span>
                  <span className={`account-pool-status ${isAvailable ? "available" : isUnavailable ? "unavailable" : "unknown"}`}>
                    {pool.status}
                  </span>
                </div>
                <button type="button" onClick={() => startEdit(pool)}>Edit</button>
              </div>

              <div className="provider-url provider-summary-base">
                <span className={`connection-status-dot ${testing[pool.id] || syncing[pool.id] ? "testing" : isAvailable ? "ok" : isUnavailable ? "fail" : "idle"}`} />
                <span>{pool.baseUrl}</span>
              </div>

              <div className="account-pool-meta">
                <span>{pool.modelNames.length} models</span>
                {pool.hasApiKey && <span>Key: {pool.apiKeyMasked ?? "configured"}</span>}
                {pool.modelsStatus && <span>/v1/models: HTTP {pool.modelsStatus}</span>}
                {pool.rootStatus && <span>Root: HTTP {pool.rootStatus}</span>}
                {pool.latencyMs !== undefined && <span>{pool.latencyMs}ms</span>}
                {pool.lastCheckedAt && <span>Checked {new Date(pool.lastCheckedAt).toLocaleString()}</span>}
              </div>

              {pool.lastError && <div className="url-test-status url-test-status--fail">Failed: {pool.lastError}</div>}

              <div className="account-pool-provider-line">
                <span>Linked provider</span>
                <strong>{provider ? provider.name : "Not created"}</strong>
                {provider && <code>{provider.baseUrl}</code>}
              </div>

              <div className="account-pool-models">
                {pool.modelNames.slice(0, 18).map((model) => <code key={model}>{model}</code>)}
                {pool.modelNames.length > 18 && <span>+{pool.modelNames.length - 18} more</span>}
                {pool.modelNames.length === 0 && <span className="empty">No synced models yet.</span>}
              </div>

              <div className="account-pool-import-row">
                <select value={selectedTokenId} onChange={(e) => setSelectedTokenIds({ ...selectedTokenIds, [pool.id]: e.target.value })}>
                  <option value="">Select Proxy Token</option>
                  {state.proxyTokens.map((token) => <option key={token.id} value={token.id}>{token.name}</option>)}
                </select>
                <button onClick={() => importModels(pool)} disabled={!pool.providerId || pool.modelNames.length === 0 || !selectedTokenId || importing[pool.id]}>
                  {importing[pool.id] ? "Importing..." : "Import Models"}
                </button>
              </div>

              {pool.kind === "cpa" && (
                <div className="account-pool-upload-row">
                  <div>
                    <span>Auth file</span>
                    <strong>{authUploads[pool.id]?.fileName ?? (pool.authsDirectory ? "No file selected" : "Configure auths directory first")}</strong>
                  </div>
                  <input type="file" accept="application/json,.json" onChange={(event) => selectAuthFile(pool, event.target.files?.[0])} />
                  <button onClick={() => uploadAuth(pool)} disabled={!pool.authsDirectory || !authUploads[pool.id] || uploading[pool.id]}>
                    {uploading[pool.id] ? "Uploading..." : "Upload Auth"}
                  </button>
                </div>
              )}

              <div className="provider-actions account-pool-actions">
                <button onClick={() => testPool(pool)} disabled={testing[pool.id]}>{testing[pool.id] ? "Testing..." : "Test"}</button>
                <button onClick={() => syncModels(pool)} disabled={syncing[pool.id]}>{syncing[pool.id] ? "Syncing..." : "Sync Models"}</button>
                <button onClick={() => createProvider(pool)}>{pool.providerId ? "Update Provider" : "Create Provider"}</button>
                <button className="btn-danger" onClick={() => remove(pool)}>Delete</button>
              </div>
            </div>
          );
        })}
        {state.accountPools.length === 0 && !showForm && <p className="empty">No account pools configured.</p>}
      </div>
    </div>
  );
}

function poolKindLabel(kind: AccountPoolKind): string {
  return "CPA";
}

function baseUrlPlaceholder(kind: AccountPoolKind): string {
  return "http://127.0.0.1:8317";
}
