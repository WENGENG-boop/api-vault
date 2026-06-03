// auth.js — initialize / unlock screen.
import { h, icon } from "./dom.js";
import { store, applyState, set } from "./store.js";
import { api } from "./api.js";
import { field, toast, withBusy } from "./ui.js";

export function renderAuth() {
  const s = store.state;
  const setupMode = !s.initialized;
  let pwd = "", confirm = "", error = "";
  const errBox = h("div", { style: { color: "var(--err)", fontSize: "var(--fz-sm)", minHeight: "16px", marginTop: "var(--s2)" } });

  const submit = async (btn) => {
    error = "";
    if (setupMode && pwd.length < 8) { error = "Master password must be at least 8 characters."; errBox.textContent = error; return; }
    if (setupMode && pwd !== confirm) { error = "Passwords do not match."; errBox.textContent = error; return; }
    errBox.textContent = "";
    try {
      const next = await withBusy(btn, () => setupMode ? api.setupVault(pwd) : api.unlockVault(pwd));
      applyState(next);
      set({ tab: "dashboard", category: "gateway" });
      toast(setupMode ? "Vault initialized" : "Vault unlocked", "ok");
    } catch (e) { errBox.textContent = e.message; }
  };

  const pwdInput = h("input", { type: "password", placeholder: setupMode ? "Create a strong password" : "Enter master password", oninput: (e) => (pwd = e.target.value), onkeydown: (e) => { if (e.key === "Enter" && !setupMode) submit(submitBtn); }, dataset: { focusKey: "auth-pwd" } });
  const confirmInput = h("input", { type: "password", placeholder: "Confirm password", oninput: (e) => (confirm = e.target.value), onkeydown: (e) => { if (e.key === "Enter") submit(submitBtn); } });
  const submitBtn = h("button.btn.primary", { style: { width: "100%", padding: "10px" }, onClick: () => submit(submitBtn) }, setupMode ? "Initialize Vault" : "Unlock");

  return h("div.auth-wrap",
    h("div.auth-card",
      h("div.logo-lg", icon("lock", 22, { w: 2.2 })),
      h("h1", setupMode ? "Set up your vault" : "Unlock vault"),
      h("p.lead", setupMode
        ? "Choose a master password. It encrypts every API key and never leaves this machine."
        : "Enter your master password to decrypt your keys and resume."),
      field("Master password", pwdInput, setupMode ? "Minimum 8 characters" : null),
      setupMode && h("div.mt4", field("Confirm password", confirmInput)),
      errBox,
      h("div.mt4", submitBtn),
      store.mode === "demo" && h("div.auth-demo-hint",
        h("strong", "Demo mode · "), "no backend required — ",
        h("a", { href: "#", onClick: (e) => { e.preventDefault(); pwd = "demo"; confirm = "demo"; pwdInput.value = "demo"; confirmInput.value = "demo"; submit(submitBtn); } }, setupMode ? "initialize instantly" : "unlock instantly"), "."),
      h("p.auth-meta", icon("lock", 12), " End-to-end encrypted · ", store.mode === "demo" ? "Demo data" : (store.baseUrl || "Live backend"))));
}
