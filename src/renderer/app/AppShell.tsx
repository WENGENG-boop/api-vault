import { type ReactNode, useMemo } from "react";
import type { AppState } from "../../shared/types";
import type { AppTab } from "./types";

type TabCategory = "gateway" | "access" | "analytics";

interface NavItem {
  id: AppTab;
  label: string;
  category: TabCategory;
  description: string;
}

const navItems: NavItem[] = [
  { id: "dashboard", label: "Dashboard", category: "gateway", description: "Actions, usage, connectivity" },
  { id: "providers", label: "Providers", category: "gateway", description: "Upstreams and keys" },
  { id: "account-pools", label: "Account Pools", category: "gateway", description: "CPA / CLIProxyAPI" },
  { id: "local-services", label: "Local Services", category: "gateway", description: "Local APIs and tunnel" },
  { id: "proxy-tokens", label: "Proxy Tokens", category: "access", description: "Client tokens and limits" },
  { id: "models", label: "Models", category: "access", description: "Catalog and mappings" },
  { id: "status", label: "Status", category: "analytics", description: "Health and latency" },
  { id: "usage", label: "Usage", category: "analytics", description: "Request log" },
  { id: "billing", label: "Billing", category: "analytics", description: "Balances and quotas" }
];

const categoryLabels: Record<TabCategory, string> = {
  gateway: "Gateway",
  access: "Access Control",
  analytics: "Analytics & Billing"
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
  const activeItem = navItems.find((item) => item.id === tab) ?? navItems[0];
  const totalCalls = state.totals?.totalCalls ?? 0;
  const failedCalls = state.totals?.failedCalls ?? 0;
  const enabledTokens = state.proxyTokens.filter((token) => token.enabled).length;
  const healthyProviders = state.providers.filter((provider) => provider.status === "available").length;
  const navGroups = useMemo(
    () => (Object.keys(categoryLabels) as TabCategory[]).map((category) => ({
      category,
      items: navItems.filter((item) => item.category === category)
    })),
    []
  );

  return (
    <div className="console-shell">
      <aside className="console-rail" aria-label="Primary navigation">
        <button type="button" className="console-brand" onClick={() => onTabChange("dashboard")}>
          <span className="console-brand-mark">AV</span>
          <span className="console-brand-copy">
            <strong>API Vault</strong>
            <small>Local control plane</small>
          </span>
        </button>

        <nav className="console-nav">
          {navGroups.map((group) => (
            <section key={group.category} className="console-nav-group">
              <div className="console-nav-group-title">{categoryLabels[group.category]}</div>
              {group.items.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={`console-nav-item ${tab === item.id ? "active" : ""}`}
                  onClick={() => onTabChange(item.id)}
                >
                  <span className="console-nav-icon">{tabIcon(item.id)}</span>
                  <span className="console-nav-copy">
                    <strong>{item.label}</strong>
                    <small>{item.description}</small>
                  </span>
                </button>
              ))}
            </section>
          ))}
        </nav>

        <div className="console-rail-footer">
          <RuntimeLine label="Proxy" value={state.proxyPort ? `127.0.0.1:${state.proxyPort}` : "offline"} tone={state.proxyPort ? "ok" : "warn"} />
          <RuntimeLine label="Tunnel" value={state.cloudflared.running ? state.cloudflared.publicUrl ?? "active" : "off"} tone={state.cloudflared.running ? "ok" : "neutral"} />
          <button type="button" className="console-lock" onClick={onLock}>Lock Vault</button>
        </div>
      </aside>

      <div className="console-main">
        <header className="console-topbar">
          <div className="console-title-block">
            <span>{categoryLabels[activeItem.category]}</span>
            <h1>{activeItem.label}</h1>
          </div>
          <div className="console-kpis" aria-label="Runtime summary">
            <Kpi label="Providers" value={`${healthyProviders}/${state.providers.length}`} tone={state.providers.length > 0 && healthyProviders === state.providers.length ? "ok" : "neutral"} />
            <Kpi label="Tokens" value={`${enabledTokens}/${state.proxyTokens.length}`} tone={enabledTokens > 0 ? "ok" : "neutral"} />
            <Kpi label="Models" value={String(state.modelCatalog.length)} tone={state.modelCatalog.length > 0 ? "ok" : "neutral"} />
            <Kpi label="Calls" value={String(totalCalls)} tone={failedCalls > 0 ? "warn" : "neutral"} />
          </div>
        </header>

        {(message || error) && (
          <div className="console-alert-stack" aria-live="polite">
            {message && <div className="console-alert success">{message}</div>}
            {error && <div className="console-alert error">{error}</div>}
          </div>
        )}

        <main className="console-workspace">{children}</main>
      </div>
    </div>
  );
}

function RuntimeLine({ label, value, tone }: { label: string; value: string; tone: "ok" | "warn" | "neutral" }) {
  return (
    <div className={`runtime-line runtime-line--${tone}`}>
      <span>{label}</span>
      <strong title={value}>{value}</strong>
    </div>
  );
}

function Kpi({ label, value, tone }: { label: string; value: string; tone: "ok" | "warn" | "neutral" }) {
  return (
    <div className={`console-kpi console-kpi--${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function tabIcon(tab: AppTab): string {
  if (tab === "dashboard") return "D";
  if (tab === "providers") return "P";
  if (tab === "account-pools") return "A";
  if (tab === "local-services") return "L";
  if (tab === "proxy-tokens") return "T";
  if (tab === "models") return "M";
  if (tab === "status") return "S";
  if (tab === "usage") return "U";
  return "B";
}
