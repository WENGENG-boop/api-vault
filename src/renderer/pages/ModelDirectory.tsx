import { useMemo, useState } from "react";
import type { AppState, ModelCapability, ProviderModel, ProviderModelInput } from "../../shared/types";
import { apiClient, copyTextToClipboard } from "../apiClient";
import { aggregateRows, buildAnalyticsRows, formatMoney } from "../viewUtils";

const CAPABILITIES: Array<{ id: ModelCapability; label: string }> = [
  { id: "text", label: "Text" },
  { id: "vision", label: "Vision" },
  { id: "tool", label: "Tools" },
  { id: "long-context", label: "Long Context" },
  { id: "reasoning", label: "Reasoning" }
];

interface ModelDraft {
  providerId: string;
  modelId: string;
  displayName: string;
  aliases: string;
  capabilities: ModelCapability[];
  inputPrice: string;
  outputPrice: string;
  contextWindow: string;
}

export function ModelDirectory({ state, setState, showMsg, showErr }: {
  state: AppState; setState: (s: AppState) => void; showMsg: (m: string) => void; showErr: (e: unknown) => void;
}) {
  const [query, setQuery] = useState("");
  const [providerFilter, setProviderFilter] = useState("all");
  const [capabilityFilter, setCapabilityFilter] = useState<ModelCapability | "all">("all");
  const [expandedKey, setExpandedKey] = useState<string | undefined>();
  const [syncingProviderId, setSyncingProviderId] = useState<string | undefined>();
  const [showManualForm, setShowManualForm] = useState(false);
  const [editingId, setEditingId] = useState<string | undefined>();
  const [draft, setDraft] = useState<ModelDraft>(emptyDraft(state.providers[0]?.id ?? ""));

  const rows = useMemo(() => buildAnalyticsRows(state.usageEvents, state.usageRollups ?? [], "all"), [state.usageEvents, state.usageRollups]);
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return state.modelCatalog.filter((model) => {
      if (providerFilter !== "all" && model.providerId !== providerFilter) return false;
      if (capabilityFilter !== "all" && !model.capabilities.includes(capabilityFilter)) return false;
      if (!needle) return true;
      return modelSearchText(model).includes(needle);
    });
  }, [state.modelCatalog, query, providerFilter, capabilityFilter]);

  const groups = useMemo(() => {
    const map = new Map<string, ProviderModel[]>();
    for (const model of filtered) {
      const key = groupKey(model);
      const list = map.get(key) ?? [];
      list.push(model);
      map.set(key, list);
    }
    return Array.from(map.entries())
      .map(([key, models]) => ({ key, models: models.sort((a, b) => a.providerName.localeCompare(b.providerName)) }))
      .sort((a, b) => a.key.localeCompare(b.key));
  }, [filtered]);

  function emptyDraft(providerId: string): ModelDraft {
    return {
      providerId,
      modelId: "",
      displayName: "",
      aliases: "",
      capabilities: ["text"],
      inputPrice: "",
      outputPrice: "",
      contextWindow: ""
    };
  }

  async function syncProvider(providerId: string) {
    setSyncingProviderId(providerId);
    try {
      const { result, state: next } = await apiClient.syncProviderModels(providerId);
      setState(next);
      showMsg(result.ok ? `Synced ${result.syncedCount} models from ${result.providerName}` : `Sync failed: ${result.error ?? "unknown error"}`);
    } catch (e) {
      showErr(e);
    } finally {
      setSyncingProviderId(undefined);
    }
  }

  async function copyModelId(model: ProviderModel) {
    const result = await copyTextToClipboard(model.modelId);
    showMsg(result.copied ? `Copied ${model.modelId}` : "Clipboard blocked. Press Ctrl+C in the selected box.");
  }

  function startManual() {
    setEditingId(undefined);
    setDraft(emptyDraft(state.providers[0]?.id ?? ""));
    setShowManualForm(true);
  }

  function startEdit(model: ProviderModel) {
    setEditingId(model.id);
    setDraft({
      providerId: model.providerId,
      modelId: model.modelId,
      displayName: model.displayName ?? "",
      aliases: model.aliases.join(", "),
      capabilities: model.capabilities.length ? model.capabilities : ["text"],
      inputPrice: model.inputPrice === undefined ? "" : String(model.inputPrice),
      outputPrice: model.outputPrice === undefined ? "" : String(model.outputPrice),
      contextWindow: model.contextWindow === undefined ? "" : String(model.contextWindow)
    });
    setShowManualForm(true);
  }

  async function saveDraft() {
    const input: ProviderModelInput = {
      providerId: draft.providerId,
      modelId: draft.modelId,
      displayName: draft.displayName,
      aliases: draft.aliases.split(",").map((item) => item.trim()).filter(Boolean),
      capabilities: draft.capabilities,
      inputPrice: draft.inputPrice ? Number(draft.inputPrice) : undefined,
      outputPrice: draft.outputPrice ? Number(draft.outputPrice) : undefined,
      contextWindow: draft.contextWindow ? Number(draft.contextWindow) : undefined,
      source: "manual"
    };
    try {
      const next = editingId
        ? await apiClient.updateProviderModel(editingId, input)
        : await apiClient.saveProviderModel(input);
      setState(next);
      setShowManualForm(false);
      setEditingId(undefined);
      showMsg(editingId ? "Model updated" : "Model added");
    } catch (e) {
      showErr(e);
    }
  }

  async function removeModel(model: ProviderModel) {
    if (!confirm(`Delete ${model.modelId} from the model directory?`)) return;
    try {
      const next = await apiClient.deleteProviderModel(model.id);
      setState(next);
      showMsg("Model removed");
    } catch (e) {
      showErr(e);
    }
  }

  function toggleCapability(capability: ModelCapability) {
    const exists = draft.capabilities.includes(capability);
    setDraft({
      ...draft,
      capabilities: exists
        ? draft.capabilities.filter((item) => item !== capability)
        : [...draft.capabilities, capability]
    });
  }

  return (
    <div className="page model-directory-page">
      <div className="page-header">
        <h2>Model Directory</h2>
        <div className="page-header-actions">
          <button onClick={startManual}>+ Add Manual Model</button>
        </div>
      </div>

      <div className="model-directory-toolbar">
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search model ID, alias, or provider" />
        <select value={providerFilter} onChange={(event) => setProviderFilter(event.target.value)}>
          <option value="all">All Providers</option>
          {state.providers.map((provider) => <option key={provider.id} value={provider.id}>{provider.name}</option>)}
        </select>
        <select value={capabilityFilter} onChange={(event) => setCapabilityFilter(event.target.value as ModelCapability | "all")}>
          <option value="all">All Capabilities</option>
          {CAPABILITIES.map((capability) => <option key={capability.id} value={capability.id}>{capability.label}</option>)}
        </select>
      </div>

      <div className="model-sync-strip">
        <strong>Sync models</strong>
        {state.providers.map((provider) => (
          <button key={provider.id} onClick={() => syncProvider(provider.id)} disabled={syncingProviderId !== undefined}>
            {syncingProviderId === provider.id ? "Syncing..." : provider.name}
          </button>
        ))}
      </div>

      {showManualForm && (
        <div className="form-card model-edit-form">
          <h3>{editingId ? "Edit Model" : "Add Manual Model"}</h3>
          <div className="form-grid">
            <label>Provider
              <select value={draft.providerId} onChange={(event) => setDraft({ ...draft, providerId: event.target.value })}>
                {state.providers.map((provider) => <option key={provider.id} value={provider.id}>{provider.name}</option>)}
              </select>
            </label>
            <label>Model ID
              <input value={draft.modelId} onChange={(event) => setDraft({ ...draft, modelId: event.target.value })} placeholder="claude-sonnet-4-20250514" />
            </label>
            <label>Display Name
              <input value={draft.displayName} onChange={(event) => setDraft({ ...draft, displayName: event.target.value })} placeholder="Claude Sonnet 4" />
            </label>
            <label>Aliases
              <input value={draft.aliases} onChange={(event) => setDraft({ ...draft, aliases: event.target.value })} placeholder="sonnet 4, claude 4 sonnet" />
            </label>
            <label>Input Price
              <input type="number" min="0" step="0.000001" value={draft.inputPrice} onChange={(event) => setDraft({ ...draft, inputPrice: event.target.value })} />
            </label>
            <label>Output Price
              <input type="number" min="0" step="0.000001" value={draft.outputPrice} onChange={(event) => setDraft({ ...draft, outputPrice: event.target.value })} />
            </label>
            <label>Context Window
              <input type="number" min="0" value={draft.contextWindow} onChange={(event) => setDraft({ ...draft, contextWindow: event.target.value })} />
            </label>
          </div>
          <div className="model-capability-editor">
            {CAPABILITIES.map((capability) => (
              <label key={capability.id}>
                <input type="checkbox" checked={draft.capabilities.includes(capability.id)} onChange={() => toggleCapability(capability.id)} />
                {capability.label}
              </label>
            ))}
          </div>
          <div className="form-actions">
            <button className="btn-primary" onClick={saveDraft} disabled={!draft.providerId || !draft.modelId.trim()}>Save</button>
            <button onClick={() => setShowManualForm(false)}>Cancel</button>
          </div>
        </div>
      )}

      <div className="model-directory-summary">
        <span>{state.modelCatalog.length} provider models</span>
        <span>{groups.length} grouped names</span>
        <span>{state.modelCatalog.filter((model) => model.source === "manual").length} manual</span>
      </div>

      <div className="model-group-list">
        {groups.map((group) => {
          const expanded = expandedKey === group.key;
          const groupStats = aggregateRows(group.models.flatMap((model) => usageRowsForModel(rows, model)));
          const capabilityList = Array.from(new Set(group.models.flatMap((model) => model.capabilities)));
          return (
            <div key={group.key} className="model-group-card">
              <button className="model-group-head" onClick={() => setExpandedKey(expanded ? undefined : group.key)}>
                <div>
                  <strong>{group.key}</strong>
                  <span>{group.models.length} provider{group.models.length === 1 ? "" : "s"}</span>
                </div>
                <div className="model-group-stats">
                  <span>{groupStats.calls} calls</span>
                  <span>{successRate(groupStats.calls, groupStats.calls - failedCallsForModels(rows, group.models))}</span>
                  <span>{groupStats.costCount ? formatMoney(groupStats.cost, groupStats.currency) : "No cost"}</span>
                </div>
              </button>
              <div className="model-capability-row">
                {capabilityList.map((capability) => <span key={capability}>{capabilityLabel(capability)}</span>)}
              </div>
              {expanded && (
                <div className="model-provider-variants">
                  {group.models.map((model) => {
                    const stats = aggregateRows(usageRowsForModel(rows, model));
                    const failed = failedCallsForModels(rows, [model]);
                    return (
                      <div key={model.id} className="model-provider-row">
                        <div className="model-provider-main">
                          <strong>{model.providerName}</strong>
                          <code>{model.modelId}</code>
                          {model.aliases.length > 0 && <small>{model.aliases.join(", ")}</small>}
                        </div>
                        <div className="model-provider-meta">
                          <span>{model.source}</span>
                          {model.contextWindow !== undefined && <span>{model.contextWindow.toLocaleString()} ctx</span>}
                          {model.inputPrice !== undefined && <span>in {model.inputPrice}</span>}
                          {model.outputPrice !== undefined && <span>out {model.outputPrice}</span>}
                          {model.lastSeenAt && <span>seen {new Date(model.lastSeenAt).toLocaleDateString()}</span>}
                        </div>
                        <div className="model-provider-stats">
                          <span>{stats.calls} calls</span>
                          <span>{successRate(stats.calls, stats.calls - failed)}</span>
                          <span>{stats.calls ? `${Math.round(averageLatency(state, model))}ms avg` : "No latency"}</span>
                        </div>
                        <div className="provider-actions">
                          <button onClick={() => copyModelId(model)}>Copy ID</button>
                          <button onClick={() => startEdit(model)}>Edit</button>
                          <button className="btn-danger" onClick={() => removeModel(model)}>Delete</button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
        {groups.length === 0 && <p className="empty">No models in the directory yet. Sync a provider or add a manual model.</p>}
      </div>
    </div>
  );
}

function groupKey(model: ProviderModel): string {
  return model.displayName?.trim()
    || model.canonicalModelId?.trim()
    || model.aliases[0]
    || model.modelId;
}

function modelSearchText(model: ProviderModel): string {
  return [
    model.providerName,
    model.modelId,
    model.displayName,
    model.canonicalModelId,
    ...model.aliases,
    ...model.capabilities
  ].filter(Boolean).join(" ").toLowerCase();
}

function usageRowsForModel(rows: ReturnType<typeof buildAnalyticsRows>, model: ProviderModel) {
  const accepted = new Set([model.modelId, model.displayName, model.canonicalModelId, ...model.aliases].filter(Boolean));
  return rows.filter((row) => row.providerId === model.providerId && row.model && accepted.has(row.model));
}

function failedCallsForModels(rows: ReturnType<typeof buildAnalyticsRows>, models: ProviderModel[]): number {
  let failed = 0;
  for (const model of models) {
    for (const row of usageRowsForModel(rows, model)) {
      failed += row.failedCalls;
    }
  }
  return failed;
}

function averageLatency(state: AppState, model: ProviderModel): number {
  const accepted = new Set([model.modelId, model.displayName, model.canonicalModelId, ...model.aliases].filter(Boolean));
  const events = state.usageEvents.filter((event) => event.providerId === model.providerId && event.model && accepted.has(event.model));
  if (events.length === 0) return 0;
  return events.reduce((sum, event) => sum + event.latencyMs, 0) / events.length;
}

function successRate(calls: number, okCalls: number): string {
  if (calls <= 0) return "No calls";
  return `${Math.round((okCalls / calls) * 100)}% ok`;
}

function capabilityLabel(capability: ModelCapability): string {
  return CAPABILITIES.find((item) => item.id === capability)?.label ?? capability;
}
