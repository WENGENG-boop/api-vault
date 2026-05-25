import { withAppStateDefaults } from "../../shared/appState";
import { apiClient } from "../shared/api";
import { Billing } from "../features/billing";
import { AccountPools } from "../features/account-pools";
import { Dashboard } from "../features/dashboard";
import { LocalServicesPage } from "../features/local-services";
import { ModelDirectory } from "../features/models";
import { Providers } from "../features/providers";
import { ProxyTokens } from "../features/proxy-tokens";
import { StatusPage } from "../features/status";
import { Usage } from "../features/usage";
import { AuthScreen } from "./AuthScreen";
import { AppShell } from "./AppShell";
import { useAppState } from "./useAppState";
import type { AppTab } from "./types";
import { useState } from "react";

export default function App() {
  const { state, setState, error, setError } = useAppState();
  const [tab, setTab] = useState<AppTab>("dashboard");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");

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
    return <AuthScreen mode="setup" password={password} error={error} onPasswordChange={setPassword} onSubmit={setup} />;
  }

  if (!state.unlocked) {
    return <AuthScreen mode="unlock" password={password} error={error} onPasswordChange={setPassword} onSubmit={unlock} />;
  }

  const safeState = withAppStateDefaults(state);

  return (
    <AppShell state={safeState} tab={tab} message={message} error={error} onTabChange={setTab} onLock={lock}>
      {tab === "dashboard" && <Dashboard state={safeState} setState={setState} onNavigate={setTab} />}
      {tab === "providers" && <Providers state={safeState} setState={setState} showMsg={showMsg} showErr={showErr} />}
      {tab === "status" && <StatusPage state={safeState} />}
      {tab === "models" && <ModelDirectory state={safeState} setState={setState} showMsg={showMsg} showErr={showErr} />}
      {tab === "account-pools" && <AccountPools state={safeState} setState={setState} showMsg={showMsg} showErr={showErr} />}
      {tab === "proxy-tokens" && <ProxyTokens state={safeState} setState={setState} showMsg={showMsg} showErr={showErr} />}
      {tab === "local-services" && <LocalServicesPage state={safeState} setState={setState} showMsg={showMsg} showErr={showErr} />}
      {tab === "usage" && <Usage state={safeState} />}
      {tab === "billing" && <Billing state={safeState} setState={setState} showMsg={showMsg} showErr={showErr} />}
    </AppShell>
  );
}
