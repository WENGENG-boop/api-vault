import { useEffect, useState } from "react";
import type { AppState } from "../shared/types";
import { apiClient } from "./apiClient";
import { STATE_REFRESH_INTERVAL_MS } from "./constants";
import { Billing } from "./pages/Billing";
import { AccountPools } from "./pages/AccountPools";
import { Dashboard } from "./pages/Dashboard";
import { LocalServicesPage } from "./pages/LocalServicesPage";
import { ModelDirectory } from "./pages/ModelDirectory";
import { Providers } from "./pages/Providers";
import { ProxyTokens } from "./pages/ProxyTokens";
import { Usage } from "./pages/Usage";

type Tab = "dashboard" | "providers" | "models" | "account-pools" | "proxy-tokens" | "local-services" | "usage" | "billing";

export default function App() {
  const [state, setState] = useState<AppState | null>(null);
  const [tab, setTab] = useState<Tab>("dashboard");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    apiClient.getState().then(setState).catch((e) => setError(e.message));
  }, []);

  useEffect(() => {
    if (!state?.unlocked) return;
    let timer: number | undefined;
    const refresh = () => {
      if (document.visibilityState !== "visible") return;
      apiClient.getState().then(setState).catch(() => {});
    };
    const start = () => {
      if (timer !== undefined || document.visibilityState !== "visible") return;
      timer = window.setInterval(refresh, STATE_REFRESH_INTERVAL_MS);
    };
    const stop = () => {
      if (timer === undefined) return;
      window.clearInterval(timer);
      timer = undefined;
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        refresh();
        start();
      } else {
        stop();
      }
    };
    start();
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [state?.unlocked]);

  const showMsg = (msg: string) => { setMessage(msg); setTimeout(() => setMessage(""), 3000); };
  const showErr = (e: unknown) => { const m = e instanceof Error ? e.message : String(e); setError(m); setTimeout(() => setError(""), 5000); };

  async function setup() {
    try { const s = await apiClient.setupVault(password); setState(s); setPassword(""); }
    catch (e) { showErr(e); }
  }

  async function unlock() {
    try { const s = await apiClient.unlockVault(password); setState(s); setPassword(""); }
    catch (e) { showErr(e); }
  }

  async function lock() {
    try { const s = await apiClient.lockVault(); setState(s); }
    catch (e) { showErr(e); }
  }

  if (!state) return <div className="loading">Loading...</div>;

  if (!state.initialized) {
    return (
      <div className="auth-page">
        <div className="auth-card">
          <h1>API Vault</h1>
          <p>Set a master password to encrypt your API keys.</p>
          <input type="password" placeholder="Master password (8+ chars)" value={password}
            onChange={(e) => setPassword(e.target.value)} onKeyDown={(e) => e.key === "Enter" && setup()} />
          <button onClick={setup}>Initialize Vault</button>
          {error && <div className="error-msg">{error}</div>}
        </div>
      </div>
    );
  }

  if (!state.unlocked) {
    return (
      <div className="auth-page">
        <div className="auth-card">
          <h1>API Vault</h1>
          <p>Enter your master password to unlock.</p>
          <input type="password" placeholder="Master password" value={password}
            onChange={(e) => setPassword(e.target.value)} onKeyDown={(e) => e.key === "Enter" && unlock()} />
          <button onClick={unlock}>Unlock</button>
          {error && <div className="error-msg">{error}</div>}
        </div>
      </div>
    );
  }

  const cloudflared = state.cloudflared ?? { running: false };
  const totalCalls = state.totals?.totalCalls ?? 0;
  const safeState: AppState = {
    ...state,
    providers: state.providers ?? [],
    proxyTokens: state.proxyTokens ?? [],
    accountPools: state.accountPools ?? [],
    modelCatalog: state.modelCatalog ?? [],
    usageEvents: state.usageEvents ?? [],
    usageRollups: state.usageRollups ?? [],
    balanceSnapshots: state.balanceSnapshots ?? [],
    localServices: state.localServices ?? [],
    totals: state.totals ?? {
      totalCalls: 0,
      callsToday: 0,
      okCalls: 0,
      failedCalls: 0,
      realCostTotal: 0,
      realCostCount: 0
    },
    cloudflared
  };

  return (
    <div className="app">
      <nav className="sidebar">
        <div className="brand">API Vault</div>
        <div className="nav-items">
          {(["dashboard", "providers", "models", "account-pools", "proxy-tokens", "local-services", "usage", "billing"] as Tab[]).map((t) => (
            <button key={t} className={tab === t ? "active" : ""} onClick={() => setTab(t)}>
              {t === "proxy-tokens" ? "Proxy Tokens" : t === "local-services" ? "Local Services" : t === "account-pools" ? "Account Pools" : t === "models" ? "Models" : t.charAt(0).toUpperCase() + t.slice(1)}
            </button>
          ))}
        </div>
        {safeState.proxyPort && <div className="proxy-status">Proxy: 127.0.0.1:{safeState.proxyPort}</div>}
        {safeState.cloudflared.running && <div className="proxy-status" title={safeState.cloudflared.publicUrl ?? ""}>Tunnel: Active</div>}
        {!safeState.cloudflared.running && <div className="proxy-status" style={{ color: "var(--muted)" }}>Tunnel: Off</div>}
        <button className="lock-btn" onClick={lock}>Lock Vault</button>
      </nav>
      <main className="content">
        {message && <div className="toast success">{message}</div>}
        {error && <div className="toast error">{error}</div>}
        {safeState.unlocked && (
          <div className="recording-indicator">
            <strong>{totalCalls}</strong> calls recorded
            {totalCalls > 0 && <button onClick={() => setTab("usage")}>View Usage</button>}
          </div>
        )}
        {tab === "dashboard" && <Dashboard state={safeState} />}
        {tab === "providers" && <Providers state={safeState} setState={setState} showMsg={showMsg} showErr={showErr} />}
        {tab === "models" && <ModelDirectory state={safeState} setState={setState} showMsg={showMsg} showErr={showErr} />}
        {tab === "account-pools" && <AccountPools state={safeState} setState={setState} showMsg={showMsg} showErr={showErr} />}
        {tab === "proxy-tokens" && <ProxyTokens state={safeState} setState={setState} showMsg={showMsg} showErr={showErr} />}
        {tab === "local-services" && <LocalServicesPage state={safeState} setState={setState} showMsg={showMsg} showErr={showErr} />}
        {tab === "usage" && <Usage state={safeState} />}
        {tab === "billing" && <Billing state={safeState} setState={setState} showMsg={showMsg} showErr={showErr} />}
      </main>
    </div>
  );
}
