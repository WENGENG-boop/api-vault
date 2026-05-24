import type { AppState } from "../../shared/types";
import type { ReactNode } from "react";
import type { AppTab } from "./types";

const tabs: AppTab[] = ["dashboard", "providers", "status", "models", "account-pools", "proxy-tokens", "local-services", "usage", "billing"];

interface AppShellProps {
  state: AppState;
  tab: AppTab;
  message: string;
  error: string;
  onTabChange: (tab: AppTab) => void;
  onLock: () => void;
  children: ReactNode;
}

export function AppShell({ state, tab, message, error, onTabChange, onLock, children }: AppShellProps) {
  const totalCalls = state.totals?.totalCalls ?? 0;
  return (
    <div className="app">
      <nav className="sidebar">
        <div className="brand">API Vault</div>
        <div className="nav-items">
          {tabs.map((item) => (
            <button key={item} className={tab === item ? "active" : ""} onClick={() => onTabChange(item)}>
              {tabLabel(item)}
            </button>
          ))}
        </div>
        {state.proxyPort && <div className="proxy-status">Proxy: 127.0.0.1:{state.proxyPort}</div>}
        {state.cloudflared.running && <div className="proxy-status" title={state.cloudflared.publicUrl ?? ""}>Tunnel: Active</div>}
        {!state.cloudflared.running && <div className="proxy-status" style={{ color: "var(--muted)" }}>Tunnel: Off</div>}
        <button className="lock-btn" onClick={onLock}>Lock Vault</button>
      </nav>
      <main className="content">
        {message && <div className="toast success">{message}</div>}
        {error && <div className="toast error">{error}</div>}
        {state.unlocked && (
          <div className="recording-indicator">
            <strong>{totalCalls}</strong> calls recorded
            {totalCalls > 0 && <button onClick={() => onTabChange("usage")}>View Usage</button>}
          </div>
        )}
        {children}
      </main>
    </div>
  );
}

function tabLabel(tab: AppTab): string {
  if (tab === "proxy-tokens") return "Proxy Tokens";
  if (tab === "local-services") return "Local Services";
  if (tab === "account-pools") return "Account Pools";
  if (tab === "models") return "Models";
  if (tab === "status") return "Status";
  return tab.charAt(0).toUpperCase() + tab.slice(1);
}
