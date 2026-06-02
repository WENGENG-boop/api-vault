import { useState, type ReactNode } from "react";
import type { AppState } from "../../shared/types";
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

  const [collapsed, setCollapsed] = useState(() => {
    if (typeof window === "undefined") return false;
    return localStorage.getItem("sidebar-collapsed") === "true";
  });

  const handleToggleCollapse = () => {
    const nextValue = !collapsed;
    setCollapsed(nextValue);
    localStorage.setItem("sidebar-collapsed", String(nextValue));
  };

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

      </header>

      <div className="main-container">
        <nav className={`sidebar ${collapsed ? "collapsed" : ""}`}>
          <div className="sidebar-toggle-wrap">
            <button
              type="button"
              className="sidebar-toggle-btn"
              onClick={handleToggleCollapse}
              aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
              aria-expanded={!collapsed}
              title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            >
              {collapsed ? (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="5" y1="12" x2="19" y2="12"></line>
                  <polyline points="12 5 19 12 12 19"></polyline>
                </svg>
              ) : (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="19" y1="12" x2="5" y2="12"></line>
                  <polyline points="12 19 5 12 12 5"></polyline>
                </svg>
              )}
            </button>
          </div>

          <div className="nav-items">
            {sidebarTabs.map((item) => (
              <button 
                key={item} 
                className={tab === item ? "active" : ""} 
                onClick={() => onTabChange(item)}
                title={collapsed ? tabLabel(item) : undefined}
              >
                {tabIcon(item)}
                <span>{tabLabel(item)}</span>
              </button>
            ))}
          </div>
          <div className="sidebar-status">
            {collapsed ? (
              <div className="sidebar-status-badges collapsed-badges">
                {state.proxyPort && (
                  <div className="sidebar-status-badge-collapsed proxy" title={`Proxy: 127.0.0.1:${state.proxyPort}`}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="2" y="2" width="20" height="8" rx="2" ry="2" />
                      <rect x="2" y="14" width="20" height="8" rx="2" ry="2" />
                      <line x1="6" y1="6" x2="6.01" y2="6" />
                      <line x1="6" y1="18" x2="6.01" y2="18" />
                    </svg>
                  </div>
                )}
                <div
                  className={`sidebar-status-badge-collapsed tunnel ${state.cloudflared.running ? "tunnel-active" : "tunnel-off"}`}
                  title={state.cloudflared.running ? `Tunnel: Active${state.cloudflared.publicUrl ? ` (${state.cloudflared.publicUrl})` : ""}` : "Tunnel: Off"}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M17.5 19A3.5 3.5 0 0 0 21 15.5c0-2.79-2.54-4.5-5-4.5-.47 0-.89.09-1.3.26A7 7 0 1 0 4 15.5A3.5 3.5 0 0 0 7.5 19z" />
                  </svg>
                </div>
              </div>
            ) : (
              <div className="sidebar-status-badges">
                {state.proxyPort && (
                  <div className="sidebar-status-badge" title={`Proxy: 127.0.0.1:${state.proxyPort}`}>
                    Proxy: 127.0.0.1:{state.proxyPort}
                  </div>
                )}
                {state.cloudflared.running ? (
                  <div className="sidebar-status-badge tunnel-active" title={state.cloudflared.publicUrl ?? ""}>
                    Tunnel: Active
                  </div>
                ) : (
                  <div className="sidebar-status-badge tunnel-off">
                    Tunnel: Off
                  </div>
                )}
              </div>
            )}
            <button type="button" className="sidebar-lock-btn" onClick={onLock} title={collapsed ? "Lock Vault" : undefined}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
                <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
              </svg>
              <span>Lock Vault</span>
            </button>
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
