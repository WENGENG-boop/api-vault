import type { AccountPoolTestResult } from "../shared/types";
import { extractModelNamesFromJson } from "./modelList";

interface CpaConnectorInput {
  baseUrl: string;
  apiKey?: string;
  timeoutMs?: number;
}

interface ProbeStatus {
  status?: number;
  error?: string;
}

interface ModelProbe extends ProbeStatus {
  modelNames: string[];
}

const DEFAULT_TIMEOUT_MS = 10_000;

export async function testCpaConnection(input: CpaConnectorInput): Promise<AccountPoolTestResult> {
  const checkedAt = new Date().toISOString();
  const startMs = Date.now();
  let rootUrl: string;
  let modelsUrl: string;
  try {
    rootUrl = cpaRootUrl(input.baseUrl);
    modelsUrl = cpaModelsUrl(input.baseUrl);
  } catch {
    return {
      ok: false,
      latencyMs: 0,
      checkedAt,
      modelNames: [],
      error: "Invalid CPA base URL"
    };
  }

  const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const [root, models] = await Promise.all([
    probeStatus(rootUrl, input.apiKey, timeoutMs),
    probeModels(modelsUrl, input.apiKey, timeoutMs)
  ]);
  const latencyMs = Date.now() - startMs;
  const status = models.status ?? root.status;

  if (models.error) {
    return {
      ok: false,
      status,
      rootStatus: root.status,
      modelsStatus: models.status,
      latencyMs,
      checkedAt,
      modelNames: [],
      error: models.error
    };
  }

  if (models.modelNames.length === 0) {
    return {
      ok: false,
      status,
      rootStatus: root.status,
      modelsStatus: models.status,
      latencyMs,
      checkedAt,
      modelNames: [],
      error: "Model list is empty"
    };
  }

  return {
    ok: true,
    status,
    rootStatus: root.status,
    modelsStatus: models.status,
    latencyMs,
    checkedAt,
    modelNames: models.modelNames
  };
}

export function cpaModelsUrl(baseUrl: string): string {
  const normalized = normalizeBaseUrl(baseUrl);
  const url = new URL(normalized);
  if (/(^|\/)v\d+$/i.test(url.pathname)) {
    return `${normalized}/models`;
  }
  return `${normalized}/v1/models`;
}

export function cpaRootUrl(baseUrl: string): string {
  const normalized = normalizeBaseUrl(baseUrl);
  return normalized.replace(/\/v\d+$/i, "");
}

export function cpaProviderBaseUrl(baseUrl: string): string {
  const normalized = normalizeBaseUrl(baseUrl);
  if (/(^|\/)v\d+$/i.test(new URL(normalized).pathname)) return normalized;
  return `${normalized}/v1`;
}

async function probeStatus(url: string, apiKey: string | undefined, timeoutMs: number): Promise<ProbeStatus> {
  try {
    const response = await fetch(url, {
      method: "GET",
      headers: buildHeaders(apiKey),
      signal: AbortSignal.timeout(timeoutMs)
    });
    return { status: response.status };
  } catch (error) {
    return { error: connectionError(error, timeoutMs) };
  }
}

async function probeModels(url: string, apiKey: string | undefined, timeoutMs: number): Promise<ModelProbe> {
  try {
    const response = await fetch(url, {
      method: "GET",
      headers: buildHeaders(apiKey),
      signal: AbortSignal.timeout(timeoutMs)
    });
    if (!response.ok) {
      return {
        status: response.status,
        modelNames: [],
        error: `HTTP ${response.status}${statusLabel(response.status)} from /v1/models`
      };
    }

    let json: unknown;
    try {
      json = await response.json();
    } catch {
      return {
        status: response.status,
        modelNames: [],
        error: "Models response is not valid JSON"
      };
    }

    return {
      status: response.status,
      modelNames: extractModelNamesFromJson(json)
    };
  } catch (error) {
    return {
      modelNames: [],
      error: connectionError(error, timeoutMs)
    };
  }
}

function normalizeBaseUrl(value: string): string {
  const url = new URL(value.trim());
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Invalid protocol");
  }
  url.hash = "";
  url.search = "";
  return url.toString().replace(/\/$/, "");
}

function buildHeaders(apiKey: string | undefined): Headers {
  const headers = new Headers({ accept: "application/json" });
  const trimmed = apiKey?.trim();
  if (trimmed) headers.set("authorization", `Bearer ${trimmed}`);
  return headers;
}

function connectionError(error: unknown, timeoutMs: number): string {
  const name = (error as Error).name;
  if (name === "AbortError" || name === "TimeoutError") return `Timeout (${timeoutMs / 1000}s)`;
  const message = (error as Error).message;
  return message ? `Connection failed: ${message}` : "Connection failed";
}

function statusLabel(status: number): string {
  if (status === 401) return " Unauthorized";
  if (status === 403) return " Forbidden";
  if (status === 404) return " Not Found";
  return "";
}
