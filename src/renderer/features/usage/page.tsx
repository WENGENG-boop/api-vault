import { useEffect, useMemo, useState } from "react";
import type { AppState, UsageEvent } from "../../../shared/types";
import { USAGE_PAGE_SIZE, USAGE_MAX_PAGES } from "../../shared/config";
import { Button, EmptyState, PageHeader, StatusPill } from "../../shared/components";
import { compactNumber, formatMoney, formatUsageDateTime, gatewayLabel } from "../../shared/utils";

export function Usage({ state }: { state: AppState }) {
  const [filter, setFilter] = useState("");
  const [providerId, setProviderId] = useState("all");
  const [apiKeyId, setApiKeyId] = useState("all");
  const [page, setPage] = useState(1);
  const [selectedEventId, setSelectedEventId] = useState<string | undefined>();
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
        usageErrorText(e).toLowerCase().includes(lower) ||
        String(e.status).includes(lower))
    );
  }, [apiKeyId, filter, providerId, state.usageEvents]);

  const totalCost = useMemo(() => filtered.reduce((sum, e) => sum + (e.realCost ?? 0), 0), [filtered]);
  const pageCount = Math.max(1, Math.min(USAGE_MAX_PAGES, Math.ceil(filtered.length / USAGE_PAGE_SIZE)));
  const currentPage = Math.min(page, pageCount);
  const paged = useMemo(() => {
    const start = (currentPage - 1) * USAGE_PAGE_SIZE;
    return filtered.slice(start, start + USAGE_PAGE_SIZE);
  }, [currentPage, filtered]);
  const pageStart = filtered.length === 0 ? 0 : (currentPage - 1) * USAGE_PAGE_SIZE + 1;
  const pageEnd = Math.min(currentPage * USAGE_PAGE_SIZE, filtered.length);
  const failedCount = useMemo(() => filtered.filter((event) => !event.ok).length, [filtered]);
  const selectedEvent = useMemo(() => state.usageEvents.find((event) => event.id === selectedEventId), [selectedEventId, state.usageEvents]);

  useEffect(() => { setPage(1); }, [apiKeyId, filter, providerId]);
  useEffect(() => { setPage((value) => Math.min(value, pageCount)); }, [pageCount]);
  useEffect(() => {
    if (selectedEventId && !filtered.some((event) => event.id === selectedEventId)) setSelectedEventId(undefined);
  }, [filtered, selectedEventId]);

  return (
    <div className="page">
      <PageHeader
        title="Usage Log"
        description="Filter recent gateway calls, then open a row to inspect routing, token, cost, latency, and error details."
        actions={
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
        }
      />
      {failedCount > 0 && <div className="usage-alert"><StatusPill tone="fail">{failedCount} failed</StatusPill><span>Open failed rows to inspect upstream status and error text.</span></div>}
      {totalCost > 0 && <div className="cost-summary">Total cost (filtered): {formatMoney(totalCost)}</div>}
      {filtered.length > 0 && (
        <div className="usage-pagination">
          <span>showing {pageStart}-{pageEnd} of {filtered.length} logs</span>
          <div>
            <button type="button" disabled={currentPage === 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>Prev</button>
            {pageWindow(currentPage, pageCount).map((item, index) => (
              item === "gap"
                ? <span key={`gap-${index}`} className="usage-page-gap">...</span>
                : <button type="button" key={item} className={item === currentPage ? "active" : ""} onClick={() => setPage(item)}>{item}</button>
            ))}
            <button type="button" disabled={currentPage === pageCount} onClick={() => setPage((value) => Math.min(pageCount, value + 1))}>Next</button>
          </div>
        </div>
      )}
      <UsageTable events={paged} selectedEventId={selectedEventId} onSelect={setSelectedEventId} />
      {selectedEvent && <UsageEventDetails event={selectedEvent} onClose={() => setSelectedEventId(undefined)} />}
      {filtered.length === 0 && <EmptyState title="No usage events yet" description={`${state.providers.length} providers are configured; make API calls through a copied proxy URL to see records here.`} />}
    </div>
  );
}



function UsageTable({ events, selectedEventId, onSelect }: { events: UsageEvent[]; selectedEventId?: string; onSelect: (id: string) => void }) {
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
            <tr key={e.id} className={`${e.ok ? "" : "row-error"} ${selectedEventId === e.id ? "row-selected" : ""}`} onClick={() => onSelect(e.id)} tabIndex={0} onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onSelect(e.id);
              }
            }}>
              <td>{formatUsageDateTime(e.startedAt)}</td>
              <td>{e.providerName}</td>
              <td><code>{e.baseUrl ?? "-"}</code></td>
              <td><span className="gateway-pill" title={e.gatewayBaseUrl ?? ""}>{gatewayLabel(e)}</span></td>
              <td>{e.apiKeyName ?? e.apiKeyMasked ?? "-"}</td>
              <td>{e.model ?? "-"}</td>
              <td><StatusPill tone={e.ok ? "ok" : "fail"}>{e.ok ? "success" : "failed"} {e.status}</StatusPill></td>
              <td>{e.inputTokens !== undefined ? compactNumber(e.inputTokens) : "-"}</td>
              <td>{e.outputTokens !== undefined ? compactNumber(e.outputTokens) : "-"}</td>
              <td>{e.realCost !== undefined ? formatMoney(e.realCost, e.currency) : "Not returned"}</td>
              <td>{e.latencyMs}ms</td>
              <td>{usageErrorText(e)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function UsageEventDetails({ event, onClose }: { event: UsageEvent; onClose: () => void }) {
  const totalTokens = event.totalTokens ?? ((event.inputTokens ?? 0) + (event.outputTokens ?? 0) + (event.cachedInputTokens ?? 0));
  return (
    <aside className={`usage-detail-panel ${event.ok ? "" : "usage-detail-panel--fail"}`} aria-label="Usage event details">
      <div className="usage-detail-head">
        <div>
          <StatusPill tone={event.ok ? "ok" : "fail"}>{event.ok ? "success" : "failed"} {event.status}</StatusPill>
          <h3>{event.model ?? "Unknown model"}</h3>
          <p>{formatUsageDateTime(event.startedAt)}</p>
        </div>
        <Button onClick={onClose}>Close</Button>
      </div>
      <div className="usage-detail-grid">
        <DetailItem label="Provider" value={event.providerName} />
        <DetailItem label="Base URL" value={event.baseUrl ?? "-"} code />
        <DetailItem label="Gateway" value={gatewayLabel(event)} />
        <DetailItem label="Gateway URL" value={event.gatewayBaseUrl ?? "-"} code />
        <DetailItem label="Model" value={event.model ?? "-"} code />
        <DetailItem label="Key" value={event.apiKeyName ?? event.apiKeyMasked ?? "-"} />
        <DetailItem label="Proxy Token" value={event.proxyTokenName ?? "-"} />
        <DetailItem label="Status" value={`${event.ok ? "success" : "failed"} ${event.status}`} />
        <DetailItem label="Tokens" value={`${compactNumber(totalTokens)} total, ${event.inputTokens !== undefined ? compactNumber(event.inputTokens) : "-"} input, ${event.outputTokens !== undefined ? compactNumber(event.outputTokens) : "-"} output`} />
        <DetailItem label="Cost" value={event.realCost !== undefined ? formatMoney(event.realCost, event.currency) : "Not returned"} />
        <DetailItem label="Latency" value={`${event.latencyMs}ms`} />
        <DetailItem label="Endpoint" value={`${event.method} ${event.path}`} code />
      </div>
      {!event.ok && (
        <div className="usage-detail-error">
          <strong>Error</strong>
          <pre>{usageErrorText(event) || "No error text recorded"}</pre>
        </div>
      )}
    </aside>
  );
}

function usageErrorText(event: UsageEvent): string {
  return event.error ?? event.errorMessage ?? "";
}

// Compact pager: first/last pages plus a window around the current page, with
// "gap" markers where pages are skipped. Avoids rendering dozens of buttons.
function pageWindow(current: number, total: number, span = 1): Array<number | "gap"> {
  if (total <= 7) return Array.from({ length: total }, (_, index) => index + 1);
  const pages = new Set<number>([1, total, current]);
  for (let offset = 1; offset <= span; offset++) {
    if (current - offset >= 1) pages.add(current - offset);
    if (current + offset <= total) pages.add(current + offset);
  }
  const sorted = Array.from(pages).sort((a, b) => a - b);
  const result: Array<number | "gap"> = [];
  let previous = 0;
  for (const page of sorted) {
    if (previous && page - previous > 1) result.push("gap");
    result.push(page);
    previous = page;
  }
  return result;
}

function DetailItem({ label, value, code = false }: { label: string; value: string; code?: boolean }) {
  return (
    <div className="usage-detail-item">
      <span>{label}</span>
      {code ? <code>{value}</code> : <strong>{value}</strong>}
    </div>
  );
}













