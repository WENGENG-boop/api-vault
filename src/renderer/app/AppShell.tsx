import type { AppState } from "../../shared/types";
import type { ReactNode } from "react";
import type { AppTab } from "./types";

type TabCategory = "gateway" | "access" | "analytics";

const categoryTabs: Record<TabCategory, AppTab[]> = {
  gateway: ["dashboard", "providers", "account-pools", "local-services"],
  access: ["proxy-tokens", "models"],
  analytics: ["status", "usage", "billing"]
};

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

  // Determine active category from current tab
  let activeCategory: TabCategory = "gateway";
  if (categoryTabs.access.includes(tab)) {
    activeCategory = "access";
  } else if (categoryTabs.analytics.includes(tab)) {
    activeCategory = "analytics";
  }

  const handleCategoryChange = (category: TabCategory) => {
    onTabChange(categoryTabs[category][0]);
  };

  const sidebarTabs = categoryTabs[activeCategory];

  return (
    <div className="app">
      <header className="top-bar">
        <div className="brand" onClick={() => onTabChange("dashboard")}>API Vault</div>
        
        <nav className="top-nav">
          <button 
            type="button"
            className={`top-nav-btn ${activeCategory === "gateway" ? "active" : ""}`} 
            onClick={() => handleCategoryChange("gateway")}
          >
            Gateway
          </button>
          <button 
            type="button"
            className={`top-nav-btn ${activeCategory === "access" ? "active" : ""}`} 
            onClick={() => handleCategoryChange("access")}
          >
            Access Control
          </button>
          <button 
            type="button"
            className={`top-nav-btn ${activeCategory === "analytics" ? "active" : ""}`} 
            onClick={() => handleCategoryChange("analytics")}
          >
            Analytics & Billing
          </button>
        </nav>

        <div className="top-tools">
          {state.proxyPort && <span className="top-status-badge">Proxy: 127.0.0.1:{state.proxyPort}</span>}
          {state.cloudflared.running ? (
            <span className="top-status-badge tunnel-active" title={state.cloudflared.publicUrl ?? ""}>Tunnel: Active</span>
          ) : (
            <span className="top-status-badge tunnel-off">Tunnel: Off</span>
          )}
          <button type="button" className="lock-btn" onClick={onLock}>Lock Vault</button>
          <button
            type="button"
            className="legacy-btn"
            onClick={() => {
              localStorage.setItem("api_vault_ui_version", "legacy");
              window.location.reload();
            }}
          >
            💾 Legacy UI
          </button>
        </div>
      </header>

      <div className="main-container">
        <nav className="sidebar">
          <div className="nav-items">
            {sidebarTabs.map((item) => (
              <button key={item} className={tab === item ? "active" : ""} onClick={() => onTabChange(item)}>
                {tabIcon(item)}
                <span>{tabLabel(item)}</span>
              </button>
            ))}
          </div>
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
    </div>
  );
}

function tabIcon(tab: AppTab) {
  const stroke = "currentColor";
  const size = 16;
  if (tab === "dashboard") {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={stroke} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
        <rect x="3" y="3" width="7" height="9"></rect>
        <rect x="14" y="3" width="7" height="5"></rect>
        <rect x="14" y="12" width="7" height="9"></rect>
        <rect x="3" y="16" width="7" height="5"></rect>
      </svg>
    );
  }
  if (tab === "providers") {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={stroke} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
        <path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z"></path>
      </svg>
    );
  }
  if (tab === "status") {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={stroke} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
        <path d="M22 12h-4l-3 9L9 3l-3 9H2"></path>
      </svg>
    );
  }
  if (tab === "models") {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={stroke} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
        <polygon points="12 2 2 7 12 12 22 7 12 2"></polygon>
        <polyline points="2 17 12 22 22 17"></polyline>
        <polyline points="2 12 12 17 22 12"></polyline>
      </svg>
    );
  }
  if (tab === "account-pools") {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={stroke} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
        <ellipse cx="12" cy="5" rx="9" ry="3"></ellipse>
        <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"></path>
        <path d="M3 12c0 1.66 4 3 9 3s9-1.34 9-3"></path>
      </svg>
    );
  }
  if (tab === "proxy-tokens") {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={stroke} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
        <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"></path>
      </svg>
    );
  }
  if (tab === "local-services") {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={stroke} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
        <rect x="2" y="3" width="20" height="14" rx="2" ry="2"></rect>
        <line x1="8" y1="21" x2="16" y2="21"></line>
        <line x1="12" y1="17" x2="12" y2="21"></line>
      </svg>
    );
  }
  if (tab === "usage") {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={stroke} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
        <line x1="18" y1="20" x2="18" y2="10"></line>
        <line x1="12" y1="20" x2="12" y2="4"></line>
        <line x1="6" y1="20" x2="6" y2="14"></line>
      </svg>
    );
  }
  if (tab === "billing") {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={stroke} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
        <rect x="1" y="4" width="22" height="16" rx="2" ry="2"></rect>
        <line x1="1" y1="10" x2="23" y2="10"></line>
      </svg>
    );
  }
  return null;
}

function tabLabel(tab: AppTab): string {
  if (tab === "proxy-tokens") return "Proxy Tokens";
  if (tab === "local-services") return "Local Services";
  if (tab === "account-pools") return "Account Pools";
  if (tab === "models") return "Models";
  if (tab === "status") return "Status";
  return tab.charAt(0).toUpperCase() + tab.slice(1);
}
