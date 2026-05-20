import { useEffect, useMemo, useState } from "react";
import type { AppState, UsageEvent } from "../../../shared/types";
import { USAGE_PAGE_SIZE } from "../../shared/config";
import { compactNumber, formatMoney, formatUsageDateTime, gatewayLabel } from "../../shared/utils";

export function Usage({ state }: { state: AppState }) {
  const [filter, setFilter] = useState("");
  const [providerId, setProviderId] = useState("all");
  const [apiKeyId, setApiKeyId] = useState("all");
  const [page, setPage] = useState(1);
  const keyOptions = useMemo(() => {
    const providers = providerId === "all"
      ? state.providers
      : state.providers.filter((provider) => provider.id === providerId);
    return providers.flatMap((provider) => provider.apiKeys.map((key) => ({
      id: key.id,
      label: `${provider.name} / ${key.name}`
    })));
  }, [providerId, state.providers]);
  const filtered = useMemo(() => {
    const lower = filter.toLowerCase();
    return state.usageEvents.filter((e) =>
      (providerId === "all" || e.providerId === providerId) &&
      (apiKeyId === "all" || e.apiKeyId === apiKeyId) &&
      (!filter ||
        (e.model ?? "").toLowerCase().includes(lower) ||
        e.providerName.toLowerCase().includes(lower) ||
        (e.apiKeyName ?? e.apiKeyMasked ?? "").toLowerCase().includes(lower) ||
        (e.proxyTokenName ?? "").toLowerCase().includes(lower) ||
        (e.baseUrl ?? "").toLowerCase().includes(lower) ||
        (e.gatewayBaseUrl ?? "").toLowerCase().includes(lower) ||
        gatewayLabel(e).toLowerCase().includes(lower) ||
        (e.error ?? "").toLowerCase().includes(lower) ||
        String(e.status).includes(lower))
    );
  }, [apiKeyId, filter, providerId, state.usageEvents]);

  const totalCost = useMemo(() => filtered.reduce((sum, e) => sum + (e.realCost ?? 0), 0), [filtered]);
  const pageCount = Math.max(1, Math.min(10, Math.ceil(filtered.length / USAGE_PAGE_SIZE)));
  const currentPage = Math.min(page, pageCount);
  const paged = useMemo(() => {
    const start = (currentPage - 1) * USAGE_PAGE_SIZE;
    return filtered.slice(start, start + USAGE_PAGE_SIZE);
  }, [currentPage, filtered]);
  const pageStart = filtered.length === 0 ? 0 : (currentPage - 1) * USAGE_PAGE_SIZE + 1;
  const pageEnd = Math.min(currentPage * USAGE_PAGE_SIZE, filtered.length);

  useEffect(() => { setPage(1); }, [apiKeyId, filter, providerId]);
  useEffect(() => { setPage((value) => Math.min(value, pageCount)); }, [pageCount]);

  return (
    <div className="page">
      <div className="page-header">
        <h2>Usage Log</h2>
        <div className="usage-filters">
          <select value={providerId} onChange={(e) => { setProviderId(e.target.value); setApiKeyId("all"); }}>
            <option value="all">All providers</option>
            {state.providers.map((provider) => <option key={provider.id} value={provider.id}>{provider.name}</option>)}
          </select>
          <select value={apiKeyId} onChange={(e) => setApiKeyId(e.target.value)}>
            <option value="all">All keys</option>
            {keyOptions.map((key) => <option key={key.id} value={key.id}>{key.label}</option>)}
          </select>
          <input className="filter-input" placeholder="Filter model, gateway, base URL, status, error..." value={filter} onChange={(e) => setFilter(e.target.value)} />
        </div>
      </div>
      {totalCost > 0 && <div className="cost-summary">Total cost (filtered): {formatMoney(totalCost)}</div>}
      {filtered.length > 0 && (
        <div className="usage-pagination">
          <span>showing {pageStart}-{pageEnd} of {filtered.length} logs</span>
          <div>
            <button disabled={currentPage === 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>Prev</button>
            {Array.from({ length: pageCount }, (_, index) => index + 1).map((item) => (
              <button key={item} className={item === currentPage ? "active" : ""} onClick={() => setPage(item)}>{item}</button>
            ))}
            <button disabled={currentPage === pageCount} onClick={() => setPage((value) => Math.min(pageCount, value + 1))}>Next</button>
          </div>
        </div>
      )}
      <UsageTable events={paged} />
      {filtered.length === 0 && <p className="empty">No usage events yet. {state.providers.length} providers are configured; make API calls through a copied proxy URL to see records here.</p>}
    </div>
  );
}



function UsageTable({ events }: { events: UsageEvent[] }) {
  return (
    <div className="table-wrap">
      <table className="usage-table">
        <thead>
          <tr>
            <th>Time</th>
            <th>Provider</th>
            <th>Base URL</th>
            <th>Gateway</th>
            <th>Key</th>
            <th>Model</th>
            <th>Status</th>
            <th>Input</th>
            <th>Output</th>
            <th>Cost</th>
            <th>Latency</th>
            <th>Error</th>
          </tr>
        </thead>
        <tbody>
          {events.map((e) => (
            <tr key={e.id} className={e.ok ? "" : "row-error"}>
              <td>{formatUsageDateTime(e.startedAt)}</td>
              <td>{e.providerName}</td>
              <td><code>{e.baseUrl ?? "-"}</code></td>
              <td><span className="gateway-pill" title={e.gatewayBaseUrl ?? ""}>{gatewayLabel(e)}</span></td>
              <td>{e.apiKeyName ?? e.apiKeyMasked ?? "-"}</td>
              <td>{e.model ?? "-"}</td>
              <td><span className={`status ${e.ok ? "ok" : "fail"}`}>{e.ok ? "success" : "failed"} {e.status}</span></td>
              <td>{e.inputTokens !== undefined ? compactNumber(e.inputTokens) : "-"}</td>
              <td>{e.outputTokens !== undefined ? compactNumber(e.outputTokens) : "-"}</td>
              <td>{e.realCost !== undefined ? formatMoney(e.realCost, e.currency) : "Not returned"}</td>
              <td>{e.latencyMs}ms</td>
              <td>{e.error ?? ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}













