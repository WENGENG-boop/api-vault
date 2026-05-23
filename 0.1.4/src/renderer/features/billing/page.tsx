import { useState } from "react";
import type { AppState } from "../../../shared/types";
import { apiClient } from "../../shared/api";
import { formatBalanceSummary, formatBalanceValue } from "../../shared/utils";

export function Billing({ state, setState, showMsg, showErr }: {
  state: AppState; setState: (s: AppState) => void; showMsg: (m: string) => void; showErr: (e: unknown) => void;
}) {
  const [syncing, setSyncing] = useState<string | null>(null);

  async function syncBalance(id: string) {
    setSyncing(id);
    try {
      const { result, state: newState } = await apiClient.testBalance(id);
      setState(newState);
      if (result.snapshot.ok) showMsg("Balance synced");
      else showErr(result.snapshot.error ?? "Sync failed");
    } catch (e) { showErr(e); }
    finally { setSyncing(null); }
  }

  return (
    <div className="page">
      <h2>Billing & Balance</h2>
      {state.providers.map((p) => {
        const snapshots = state.balanceSnapshots.filter((s) => s.providerId === p.id);
        const latest = snapshots[0];
        return (
          <div key={p.id} className="billing-card">
            <div className="billing-header">
              <strong>{p.name}</strong>
              <button disabled={syncing === p.id} onClick={() => syncBalance(p.id)}>
                {syncing === p.id ? "Syncing..." : "Sync Now"}
              </button>
            </div>
            {latest ? (
              <div className="billing-data">
                {latest.ok ? (
                  <>
                    {latest.unlimitedQuota && <div>Balance: <strong>Unlimited quota</strong></div>}
                    {!latest.unlimitedQuota && latest.balance !== undefined && <div>Balance: <strong>{formatBalanceValue(latest.balance, latest.currency)}</strong></div>}
                    {latest.spent !== undefined && <div>Spent: <strong>{formatBalanceValue(latest.spent, latest.currency)}</strong></div>}
                    {latest.granted !== undefined && <div>Granted: <strong>{formatBalanceValue(latest.granted, latest.currency)}</strong></div>}
                    {latest.tokenName && <div>Token: <strong>{latest.tokenName}</strong></div>}
                    <div className="billing-time">Last checked: {new Date(latest.checkedAt).toLocaleString()}</div>
                  </>
                ) : (
                  <div className="billing-error">Error: {latest.error}</div>
                )}
              </div>
            ) : (
              <div className="billing-data muted">No balance data. Click "Sync Now" to fetch.</div>
            )}
            {snapshots.length > 1 && (
              <details>
                <summary>History ({snapshots.length} records)</summary>
                <div className="billing-history">
                  {snapshots.slice(0, 20).map((s) => (
                    <div key={s.id} className={`history-row ${s.ok ? "" : "error"}`}>
                      <span>{new Date(s.checkedAt).toLocaleString()}</span>
                      {s.ok ? (
                        <span>{formatBalanceSummary(s)}</span>
                      ) : (
                        <span className="text-error">{s.error}</span>
                      )}
                    </div>
                  ))}
                </div>
              </details>
            )}
          </div>
        );
      })}
      {state.providers.length === 0 && <p className="empty">Add a provider first to sync billing data.</p>}
    </div>
  );
}

