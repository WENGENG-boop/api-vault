import type { AddKeyInput, ApiKeyInput, AppState, BalanceTestResult, CloudflaredStatus, LocalService, ProviderInput } from "../shared/types";

import type { ProxyTokenInput } from "../shared/types";
import type { AccountPool, AccountPoolImportResult, AccountPoolInput, AccountPoolTestResult, AccountPoolUploadAuthResult, ProviderModel, ProviderModelInput, ProviderModelSyncResult } from "../shared/types";

export interface CopyResult {
  text: string;
  copied: boolean;
}

export interface UrlTestResult {
  ok: boolean;
  status?: number;
  latencyMs: number;
  error?: string;
  checkedAt: string;
  modelNames?: string[];
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
  copyProviderProxyUrl: (providerId: string) => Promise<CopyResult>;
  testBalance: (id: string) => Promise<{ result: BalanceTestResult; state: AppState }>;
  createProxyToken: (input: ProxyTokenInput) => Promise<{ secret: string; state: AppState }>;
  updateProxyToken: (id: string, input: ProxyTokenInput) => Promise<AppState>;
  deleteProxyToken: (id: string) => Promise<AppState>;
  revealProxyToken: (id: string) => Promise<{ secret: string }>;
  regenerateProxyToken: (id: string) => Promise<{ secret: string; state: AppState }>;
  testUrl: (input: { baseUrl: string; protocol?: string; providerId?: string; isLocal?: boolean; type?: string; apiKey?: string }) => Promise<UrlTestResult>;
  getAccountPools: () => Promise<AccountPool[]>;
  saveAccountPool: (input: AccountPoolInput & { createProvider?: boolean }) => Promise<AppState>;
  deleteAccountPool: (id: string) => Promise<AppState>;
  createAccountPoolProvider: (id: string) => Promise<AppState>;
  testAccountPool: (id: string) => Promise<{ result: AccountPoolTestResult; state: AppState }>;
  syncAccountPoolModels: (id: string) => Promise<{ result: AccountPoolTestResult; state: AppState }>;
  importAccountPoolModelsToProxyToken: (id: string, input: { proxyTokenId: string; modelNames?: string[] }) => Promise<{ result: AccountPoolImportResult; state: AppState }>;
  uploadAccountPoolAuth: (id: string, input: { fileName: string; content: string }) => Promise<{ result: AccountPoolUploadAuthResult; state: AppState }>;
  getModelCatalog: () => Promise<ProviderModel[]>;
  syncProviderModels: (providerId: string) => Promise<{ result: ProviderModelSyncResult; state: AppState }>;
  saveProviderModel: (input: ProviderModelInput) => Promise<AppState>;
  updateProviderModel: (id: string, input: ProviderModelInput) => Promise<AppState>;
  deleteProviderModel: (id: string) => Promise<AppState>;
  getCloudflaredStatus: () => Promise<CloudflaredStatus>;
  startCloudflared: () => Promise<CloudflaredStatus>;
  stopCloudflared: () => Promise<CloudflaredStatus>;
  getLocalServices: () => Promise<LocalService[]>;
  saveLocalService: (input: Partial<LocalService> & { name: string; baseUrl: string; apiKey?: string }) => Promise<AppState>;
  deleteLocalService: (id: string) => Promise<AppState>;
  testLocalService: (id: string) => Promise<UrlTestResult & { serviceStatus?: string }>;
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
  copyProviderProxyUrl: async (providerId: string) => {
    const { url } = await request<{ url: string }>(
      `/api/providers/${encodeURIComponent(providerId)}/proxy-url`
    );
    return { text: url, copied: await copyToClipboard(url) };
  },
  testBalance: (id: string) => request<{ result: BalanceTestResult; state: AppState }>(
    `/api/providers/${encodeURIComponent(id)}/test-balance`,
    { method: "POST" }
  ),
  createProxyToken: async (input: ProxyTokenInput) => {
    const result = await request<{ secret: string; state: AppState }>("/api/proxy-tokens", {
      method: "POST",
      body: input
    });
    return result;
  },
  updateProxyToken: (id: string, input: ProxyTokenInput) => request<AppState>(`/api/proxy-tokens/${encodeURIComponent(id)}`, {
    method: "POST",
    body: input
  }),
  deleteProxyToken: (id: string) => request<AppState>(`/api/proxy-tokens/${encodeURIComponent(id)}`, { method: "DELETE" }),
  revealProxyToken: (id: string) => request<{ secret: string }>(`/api/proxy-tokens/${encodeURIComponent(id)}/secret`),
  regenerateProxyToken: async (id: string) => {
    const result = await request<{ secret: string; state: AppState }>(`/api/proxy-tokens/${encodeURIComponent(id)}/regenerate`, {
      method: "POST"
    });
    return result;
  },
  testUrl: (input: { baseUrl: string; protocol?: string; providerId?: string; isLocal?: boolean; type?: string; apiKey?: string }) =>
    request<UrlTestResult>("/api/test-url", { method: "POST", body: input }),
  getAccountPools: () => request<AccountPool[]>("/api/account-pools"),
  saveAccountPool: async (input) => {
    const { state } = await request<{ state: AppState }>("/api/account-pools", {
      method: "POST",
      body: input
    });
    return state;
  },
  deleteAccountPool: (id) => request<AppState>(`/api/account-pools/${encodeURIComponent(id)}`, { method: "DELETE" }),
  createAccountPoolProvider: async (id) => {
    const { state } = await request<{ state: AppState }>(
      `/api/account-pools/${encodeURIComponent(id)}/create-provider`,
      { method: "POST" }
    );
    return state;
  },
  testAccountPool: (id) => request<{ result: AccountPoolTestResult; state: AppState }>(
    `/api/account-pools/${encodeURIComponent(id)}/test`,
    { method: "POST" }
  ),
  syncAccountPoolModels: (id) => request<{ result: AccountPoolTestResult; state: AppState }>(
    `/api/account-pools/${encodeURIComponent(id)}/sync-models`,
    { method: "POST" }
  ),
  importAccountPoolModelsToProxyToken: (id, input) => request<{ result: AccountPoolImportResult; state: AppState }>(
    `/api/account-pools/${encodeURIComponent(id)}/import-models-to-proxy-token`,
    { method: "POST", body: input }
  ),
  uploadAccountPoolAuth: (id, input) => request<{ result: AccountPoolUploadAuthResult; state: AppState }>(
    `/api/account-pools/${encodeURIComponent(id)}/upload-auth`,
    { method: "POST", body: input }
  ),
  getModelCatalog: () => request<ProviderModel[]>("/api/model-catalog"),
  syncProviderModels: (providerId) => request<{ result: ProviderModelSyncResult; state: AppState }>(
    `/api/model-catalog/sync-provider/${encodeURIComponent(providerId)}`,
    { method: "POST" }
  ),
  saveProviderModel: async (input) => {
    const { state } = await request<{ state: AppState }>("/api/model-catalog/manual", {
      method: "POST",
      body: input
    });
    return state;
  },
  updateProviderModel: async (id, input) => {
    const { state } = await request<{ state: AppState }>(`/api/model-catalog/${encodeURIComponent(id)}`, {
      method: "POST",
      body: input
    });
    return state;
  },
  deleteProviderModel: (id) => request<AppState>(`/api/model-catalog/${encodeURIComponent(id)}`, { method: "DELETE" }),
  getCloudflaredStatus: () => request<CloudflaredStatus>("/api/cloudflared/status"),
  startCloudflared: () => request<CloudflaredStatus>("/api/cloudflared/start", { method: "POST" }),
  stopCloudflared: () => request<CloudflaredStatus>("/api/cloudflared/stop", { method: "POST" }),
  getLocalServices: () => request<LocalService[]>("/api/local-services"),
  saveLocalService: async (input) => {
    const { state } = await request<{ state: AppState }>("/api/local-services", { method: "POST", body: input });
    return state;
  },
  deleteLocalService: (id) => request<AppState>(`/api/local-services/${encodeURIComponent(id)}`, { method: "DELETE" }),
  testLocalService: (id) => request<UrlTestResult & { serviceStatus?: string }>(`/api/local-services/${encodeURIComponent(id)}/test`, { method: "POST" })
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
