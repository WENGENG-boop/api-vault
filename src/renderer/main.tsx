import React from "react";
import ReactDOM from "react-dom/client";

if (!localStorage.getItem("api_vault_ui_version")) {
  localStorage.setItem("api_vault_ui_version", "modern");
}

const uiVersion = localStorage.getItem("api_vault_ui_version");

const mount = async () => {
  const rootEl = document.getElementById("root");
  if (!rootEl) return;
  const root = ReactDOM.createRoot(rootEl);

  if (uiVersion === "legacy") {
    const { default: App } = await import("../renderer-legacy/app/App");
    await import("../renderer-legacy/styles.css");
    root.render(
      <React.StrictMode>
        <App />
      </React.StrictMode>
    );
  } else {
    const { default: App } = await import("./app/App");
    await import("./styles.css");
    root.render(
      <React.StrictMode>
        <App />
      </React.StrictMode>
    );
  }
};

mount();

