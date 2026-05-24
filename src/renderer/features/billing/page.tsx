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
    <div className="page billing-page-container">
      <div className="page-header">
        <div className="page-header-copy">
          <h2>Billing & Budgets</h2>
          <p>Monitor quota limits, credit balances, and usage billing syncs for your active upstream providers.</p>
        </div>
      </div>

      <div className="billing-grid">
        {state.providers.map((p) => {
          const snapshots = state.balanceSnapshots.filter((s) => s.providerId === p.id);
          const latest = snapshots[0];
          
          let spentPercent = 0;
          let showProgress = false;
          if (latest && latest.ok && latest.spent !== undefined && latest.granted !== undefined && latest.granted > 0) {
            spentPercent = Math.min(100, (latest.spent / latest.granted) * 100);
            showProgress = true;
          }

          return (
            <div key={p.id} className="billing-card">
              <div className="billing-header">
                <div className="provider-info">
                  <span className="provider-badge-pill">Provider</span>
                  <h3>{p.name}</h3>
                </div>
                <button 
                  type="button"
                  className="btn-secondary"
                  disabled={syncing === p.id} 
                  onClick={() => syncBalance(p.id)}
                >
                  {syncing === p.id ? "Syncing..." : "Sync Balance"}
                </button>
              </div>

              {latest ? (
                <div className="billing-content-area">
                  {latest.ok ? (
                    <>
                      <div className="balance-highlight-section">
                        <span className="balance-sec-label">Available Balance</span>
                        <div className="balance-large-value">
                          {latest.unlimitedQuota ? "Unlimited Quota" : formatBalanceValue(latest.balance ?? 0, latest.currency)}
                        </div>
                      </div>

                      {showProgress && (
                        <div className="quota-progress-section">
                          <div className="quota-progress-labels">
                            <span>Quota Utilization</span>
                            <strong>{spentPercent.toFixed(1)}% Used</strong>
                          </div>
                          <div className="quota-progress-bar-bg">
                            <div 
                              className={`quota-progress-bar-fill ${spentPercent > 85 ? "danger" : spentPercent > 65 ? "warning" : "primary"}`}
                              style={{ width: `${spentPercent}%` }}
                            />
                          </div>
                        </div>
                      )}

                      <div className="billing-breakdown-details">
                        {latest.spent !== undefined && (
                          <div className="breakdown-row">
                            <span>Total Spent</span>
                            <strong>{formatBalanceValue(latest.spent, latest.currency)}</strong>
                          </div>
                        )}
                        {latest.granted !== undefined && (
                          <div className="breakdown-row">
                            <span>Total Granted</span>
                            <strong>{formatBalanceValue(latest.granted, latest.currency)}</strong>
                          </div>
                        )}
                        {latest.tokenName && (
                          <div className="breakdown-row">
                            <span>API Token Used</span>
                            <code className="token-name-badge">{latest.tokenName}</code>
                          </div>
                        )}
                      </div>

                      <div className="billing-footer-timestamp">
                        Last checked: {new Date(latest.checkedAt).toLocaleString()}
                      </div>
                    </>
                  ) : (
                    <div className="billing-error-banner">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                        <circle cx="12" cy="12" r="10"></circle>
                        <line x1="12" y1="8" x2="12" y2="12"></line>
                        <line x1="12" y1="16" x2="12.01" y2="16"></line>
                      </svg>
                      <span>Error: {latest.error}</span>
                    </div>
                  )}
                </div>
              ) : (
                <div className="billing-content-area empty-billing">
                  <p>No balance data has been fetched yet. Click "Sync Balance" to load billing data.</p>
                </div>
              )}

              {snapshots.length > 1 && (
                <details className="billing-history-details">
                  <summary>
                    <span>Historical Check Syncs</span>
                    <span className="history-count-badge">{snapshots.length} syncs</span>
                  </summary>
                  <div className="billing-history-list">
                    {snapshots.slice(0, 10).map((s) => (
                      <div key={s.id} className={`history-sync-row ${s.ok ? "ok" : "error"}`}>
                        <span className="sync-time">{new Date(s.checkedAt).toLocaleString()}</span>
                        <span className="sync-summary-text">
                          {s.ok ? formatBalanceSummary(s) : s.error}
                        </span>
                      </div>
                    ))}
                  </div>
                </details>
              )}
            </div>
          );
        })}
        
        {state.providers.length === 0 && (
          <div className="empty-billing-state-container">
            <p>Add a provider API key first to view and sync billing information.</p>
          </div>
        )}
      </div>
    </div>
  );
}
