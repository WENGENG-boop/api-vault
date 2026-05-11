import type { AddKeyInput, ApiKeyInput, AppState, BalanceTestResult, ProviderInput } from "../shared/types";

export interface CopyResult {
  text: string;
  copied: boolean;
}

export interface ApiVaultClient {
  getState: () => Promise<AppState>;
  setupVault: (password: string) => Promise<AppState>;
  unlockVault: (password: string) => Promise<AppState>;
  lockVault: () => Promise<AppState>;
  saveProviderMeta: (provider: ProviderInput) => Promise<AppState>;
  addKeyWithAutoMerge: (payload: AddKeyInput) => Promise<AppState>;
  addKey: (providerId: string, input: ApiKeyInput) => Promise<AppState>;
  deleteKey: (providerId: string, keyId: string) => Promise<AppState>;
  deleteProvider: (id: string) => Promise<AppState>;
  copyKey: (providerId: string, keyId: string, kind: "api" | "query") => Promise<CopyResult>;
  copyProxyUrl: (providerId: string, keyId: string) => Promise<CopyResult>;
  testBalance: (id: string) => Promise<{ result: BalanceTestResult; state: AppState }>;
}

declare global {
  interface Window {
    apiVault?: ApiVaultClient;
  }
}

export const apiClient: ApiVaultClient = window.apiVault ?? {
  getState: () => request<AppState>("/api/state"),
  setupVault: (password: string) => request<AppState>("/api/vault/setup", {
    method: "POST",
    body: { password }
  }),
  unlockVault: (password: string) => request<AppState>("/api/vault/unlock", {
    method: "POST",
    body: { password }
  }),
  lockVault: () => request<AppState>("/api/vault/lock", { method: "POST" }),
  saveProviderMeta: (provider: ProviderInput) => request<AppState>("/api/providers", {
    method: "POST",
    body: provider
  }),
  addKeyWithAutoMerge: (payload: AddKeyInput) => request<AppState>("/api/providers/add-key", {
    method: "POST",
    body: payload
  }),
  addKey: (providerId: string, input: ApiKeyInput) => request<AppState>(
    `/api/providers/${encodeURIComponent(providerId)}/keys`,
    { method: "POST", body: input }
  ),
  deleteKey: (providerId: string, keyId: string) => request<AppState>(
    `/api/providers/${encodeURIComponent(providerId)}/keys/${encodeURIComponent(keyId)}`,
    { method: "DELETE" }
  ),
  deleteProvider: (id: string) => request<AppState>(`/api/providers/${encodeURIComponent(id)}`, {
    method: "DELETE"
  }),
  copyKey: async (providerId: string, keyId: string, kind: "api" | "query") => {
    const { secret } = await request<{ secret: string }>(
      `/api/providers/${encodeURIComponent(providerId)}/keys/${encodeURIComponent(keyId)}/secret?kind=${kind}`
    );
    return { text: secret, copied: await copyToClipboard(secret) };
  },
  copyProxyUrl: async (providerId: string, keyId: string) => {
    const { url } = await request<{ url: string }>(
      `/api/providers/${encodeURIComponent(providerId)}/keys/${encodeURIComponent(keyId)}/proxy-url`
    );
    return { text: url, copied: await copyToClipboard(url) };
  },
  testBalance: (id: string) => request<{ result: BalanceTestResult; state: AppState }>(
    `/api/providers/${encodeURIComponent(id)}/test-balance`,
    { method: "POST" }
  )
};

export async function copyTextToClipboard(text: string): Promise<CopyResult> {
  return { text, copied: await copyToClipboard(text) };
}

async function request<T>(path: string, options: { method?: string; body?: unknown } = {}): Promise<T> {
  const response = await fetch(path, {
    method: options.method ?? "GET",
    headers: options.body === undefined ? undefined : { "content-type": "application/json" },
    body: options.body === undefined ? undefined : JSON.stringify(options.body)
  });

  const text = await response.text();
  const data = text ? JSON.parse(text) : undefined;
  if (!response.ok) {
    const message = data && typeof data === "object" && "error" in data
      ? String((data as { error: unknown }).error)
      : `Request failed with ${response.status}`;
    throw new Error(message);
  }
  return data as T;
}

async function copyToClipboard(text: string): Promise<boolean> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {}
  }

  if (copyWithTextarea(text)) return true;
  showManualCopyDialog(text);
  return false;
}

function copyWithTextarea(text: string): boolean {
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.readOnly = true;
  textarea.style.position = "fixed";
  textarea.style.top = "0";
  textarea.style.left = "0";
  textarea.style.width = "1px";
  textarea.style.height = "1px";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  textarea.setSelectionRange(0, text.length);
  let copied = false;
  try {
    copied = document.execCommand("copy");
  } catch {
    copied = false;
  }
  textarea.remove();
  return copied;
}

function showManualCopyDialog(text: string): void {
  document.querySelector(".manual-copy-overlay")?.remove();

  const overlay = document.createElement("div");
  overlay.className = "manual-copy-overlay";

  const dialog = document.createElement("div");
  dialog.className = "manual-copy-dialog";

  const title = document.createElement("strong");
  title.textContent = "Clipboard blocked";

  const description = document.createElement("p");
  description.textContent = "Your browser denied clipboard access. The value is selected below; press Ctrl+C to copy it.";

  const textarea = document.createElement("textarea");
  textarea.readOnly = true;
  textarea.value = text;

  const actions = document.createElement("div");
  actions.className = "manual-copy-actions";

  const closeButton = document.createElement("button");
  closeButton.type = "button";
  closeButton.textContent = "Close";
  closeButton.addEventListener("click", () => overlay.remove());

  actions.append(closeButton);
  dialog.append(title, description, textarea, actions);
  overlay.append(dialog);
  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) overlay.remove();
  });
  document.body.appendChild(overlay);
  textarea.focus();
  textarea.select();
}
