import type { ApiProtocol } from "../shared/types";
import { readNumberPath, readStringPath } from "./jsonPath";

export interface ExtractedUsage {
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
  cachedInputTokens?: number;
  totalTokens?: number;
  realCost?: number;
  currency?: string;
}

export function parseJsonBuffer(buffer: Buffer): unknown | undefined {
  if (buffer.length === 0) return undefined;
  try {
    return JSON.parse(buffer.toString("utf8"));
  } catch {
    return undefined;
  }
}

export function extractRequestModel(requestBody: Buffer): string | undefined {
  const parsed = parseJsonBuffer(requestBody);
  if (parsed && typeof parsed === "object") {
    const model = (parsed as Record<string, unknown>).model;
    if (typeof model === "string") return model;
  }
  return undefined;
}

export function extractUsageFromResponse(
  protocol: ApiProtocol,
  requestBody: Buffer,
  responseBody: Buffer,
  responseCostPath?: string
): ExtractedUsage {
  const response = parseJsonBuffer(responseBody);
  const requestModel = extractRequestModel(requestBody);
  if (!response || typeof response !== "object") {
    return { model: requestModel };
  }

  const root = response as Record<string, unknown>;
  const usage = root.usage && typeof root.usage === "object"
    ? (root.usage as Record<string, unknown>)
    : {};

  const responseModel = typeof root.model === "string" ? root.model : undefined;
  const costPath = responseCostPath?.trim();
  const configuredCost = costPath ? readNumberPath(response, costPath) : undefined;
  const defaultCost = configuredCost ?? readFirstNumber(response, [
    "usage.cost",
    "usage.total_cost",
    "cost",
    "billing.cost",
    "billing.total"
  ]);
  const currency = readFirstString(response, [
    "usage.currency",
    "usage.unit",
    "currency",
    "unit",
    "billing.currency",
    "billing.unit"
  ]);

  if (protocol === "anthropic-compatible") {
    const cacheCreation = numberValue(usage.cache_creation_input_tokens);
    const cacheRead = numberValue(usage.cache_read_input_tokens);
    const inputTokens = numberValue(usage.input_tokens);
    const outputTokens = numberValue(usage.output_tokens);
    const cachedInputTokens = sumDefined(cacheCreation, cacheRead);
    return {
      model: responseModel ?? requestModel,
      inputTokens,
      outputTokens,
      cachedInputTokens,
      totalTokens: sumDefined(inputTokens, outputTokens, cachedInputTokens),
      realCost: defaultCost,
      currency
    };
  }

  const promptDetails = usage.prompt_tokens_details && typeof usage.prompt_tokens_details === "object"
    ? (usage.prompt_tokens_details as Record<string, unknown>)
    : {};
  const inputTokens = numberValue(usage.prompt_tokens ?? usage.input_tokens);
  const outputTokens = numberValue(usage.completion_tokens ?? usage.output_tokens);
  const cachedInputTokens = numberValue(promptDetails.cached_tokens ?? usage.cached_tokens);
  const totalTokens = numberValue(usage.total_tokens) ?? sumDefined(inputTokens, outputTokens);

  return {
    model: responseModel ?? requestModel,
    inputTokens,
    outputTokens,
    cachedInputTokens,
    totalTokens,
    realCost: defaultCost,
    currency
  };
}

function readFirstNumber(value: unknown, paths: string[]): number | undefined {
  for (const path of paths) {
    const result = readNumberPath(value, path);
    if (result !== undefined) return result;
  }
  return undefined;
}

function readFirstString(value: unknown, paths: string[]): string | undefined {
  for (const path of paths) {
    const result = readStringPath(value, path);
    if (result !== undefined) return result;
  }
  return undefined;
}

export function extractUsageFromSSE(
  protocol: ApiProtocol,
  requestBody: Buffer,
  sseBuffer: Buffer,
  responseCostPath?: string
): ExtractedUsage {
  const text = sseBuffer.toString("utf8");
  const lines = text.split("\n");
  let usageJson: Record<string, unknown> | undefined;

  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (!line.startsWith("data:")) continue;
    const payload = line.slice(5).trim();
    if (payload === "[DONE]") continue;
    try {
      const parsed = JSON.parse(payload) as Record<string, unknown>;
      if (parsed.usage && typeof parsed.usage === "object") {
        usageJson = parsed;
        break;
      }
    } catch {}
  }

  if (!usageJson) {
    return { model: extractRequestModel(requestBody) };
  }

  const responseBuffer = Buffer.from(JSON.stringify(usageJson), "utf8");
  return extractUsageFromResponse(protocol, requestBody, responseBuffer, responseCostPath);
}

function numberValue(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  return undefined;
}

function sumDefined(...values: Array<number | undefined>): number | undefined {
  const present = values.filter((value): value is number => value !== undefined);
  if (present.length === 0) return undefined;
  return present.reduce((total, value) => total + value, 0);
}
