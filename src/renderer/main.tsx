import React from "react";
import ReactDOM from "react-dom/client";

const mount = async () => {
  const rootEl = document.getElementById("root");
  if (!rootEl) return;
  const root = ReactDOM.createRoot(rootEl);

  const { default: App } = await import("./app/App");
  await import("./styles.css");
  root.render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
};

mount();

