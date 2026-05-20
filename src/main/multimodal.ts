import type { ApiProtocol } from "../shared/types";

type SingleProtocol = Exclude<ApiProtocol, "openai-anthropic-compatible">;

export interface PreparedProxyRequest {
  body: Buffer;
  suffixPath: string;
  targetProtocol: SingleProtocol;
  responseProtocol: SingleProtocol;
  converted: boolean;
}

const DEFAULT_MAX_IMAGE_BYTES = 20 * 1024 * 1024;

export function singleProtocolForProvider(providerProtocol: ApiProtocol, requestedProtocol: SingleProtocol): SingleProtocol {
  return providerProtocol === "openai-anthropic-compatible" ? requestedProtocol : providerProtocol;
}

export async function prepareMultimodalProxyRequest(args: {
  body: Buffer;
  suffixPath: string;
  requestedProtocol: SingleProtocol;
  targetProtocol: SingleProtocol;
  upstreamModel?: string;
}): Promise<PreparedProxyRequest> {
  const parsed = parseObject(args.body);
  if (!parsed) {
    return {
      body: args.body,
      suffixPath: args.suffixPath,
      targetProtocol: args.targetProtocol,
      responseProtocol: args.requestedProtocol,
      converted: false
    };
  }

  if (args.requestedProtocol === args.targetProtocol) {
    const sameProtocol = args.targetProtocol === "anthropic-compatible"
      ? await normalizeAnthropicImages(parsed, args.upstreamModel)
      : replaceTopLevelModel(parsed, args.upstreamModel);
    return {
      body: Buffer.from(JSON.stringify(sameProtocol), "utf8"),
      suffixPath: args.targetProtocol === "anthropic-compatible" && /^\/messages(?:\/|$)/i.test(args.suffixPath)
        ? "/v1/messages"
        : args.suffixPath,
      targetProtocol: args.targetProtocol,
      responseProtocol: args.requestedProtocol,
      converted: false
    };
  }

  if (args.requestedProtocol === "openai-compatible" && args.targetProtocol === "anthropic-compatible") {
    const converted = await openAiChatToAnthropic(parsed, args.upstreamModel);
    return {
      body: Buffer.from(JSON.stringify(converted), "utf8"),
      suffixPath: "/v1/messages",
      targetProtocol: "anthropic-compatible",
      responseProtocol: "openai-compatible",
      converted: true
    };
  }

  const converted = anthropicMessagesToOpenAiChat(parsed, args.upstreamModel);
  return {
    body: Buffer.from(JSON.stringify(converted), "utf8"),
    suffixPath: "/v1/chat/completions",
    targetProtocol: "openai-compatible",
    responseProtocol: "anthropic-compatible",
    converted: true
  };
}

export function convertProxyResponse(body: Buffer, fromProtocol: SingleProtocol, toProtocol: SingleProtocol): Buffer {
  if (fromProtocol === toProtocol || body.length === 0) return body;
  const parsed = parseObject(body);
  if (!parsed) return body;
  const converted = fromProtocol === "anthropic-compatible"
    ? anthropicResponseToOpenAiChat(parsed)
    : openAiChatResponseToAnthropic(parsed);
  return Buffer.from(JSON.stringify(converted), "utf8");
}

async function normalizeAnthropicImages(input: Record<string, unknown>, model?: string): Promise<Record<string, unknown>> {
  const output = replaceTopLevelModel(input, model);
  if (!Array.isArray(output.messages)) return output;
  return {
    ...output,
    messages: await Promise.all(output.messages.map(async (message) => {
      const item = objectValue(message);
      const content = item.content;
      if (!Array.isArray(content)) return item;
      return {
        ...item,
        content: await Promise.all(content.map(async (part) => {
          const block = objectValue(part);
          if (stringValue(block.type) !== "image") return block;
          const source = objectValue(block.source);
          if (stringValue(source.type) !== "url") return block;
          const url = stringValue(source.url);
          return url ? { ...block, source: await imageUrlToBase64Source(url) } : block;
        }))
      };
    }))
  };
}

async function openAiChatToAnthropic(input: Record<string, unknown>, model?: string): Promise<Record<string, unknown>> {
  const output: Record<string, unknown> = {
    model: model ?? stringValue(input.model),
    messages: await Promise.all(arrayValue(input.messages)
      .map((message) => objectValue(message))
      .filter((message) => stringValue(message.role) !== "system")
      .map(openAiMessageToAnthropic))
  };
  copyIfPresent(input, output, ["max_tokens", "temperature", "top_p", "stop", "stream"]);
  if (!output.max_tokens) output.max_tokens = 1024;
  const system = extractOpenAiSystem(input.messages);
  if (system) output.system = system;
  return output;
}

async function openAiMessageToAnthropic(message: unknown): Promise<Record<string, unknown>> {
  const item = objectValue(message);
  const role = stringValue(item.role) === "assistant" ? "assistant" : "user";
  const content = item.content;
  if (typeof content === "string") return { role, content };
  const parts = await Promise.all(arrayValue(content).map(openAiPartToAnthropic));
  return { role, content: parts.filter(Boolean) };
}

async function openAiPartToAnthropic(part: unknown): Promise<Record<string, unknown> | undefined> {
  const item = objectValue(part);
  const type = stringValue(item.type);
  if (type === "text") return { type: "text", text: stringValue(item.text) };
  if (type === "image_url") {
    const imageUrl = objectValue(item.image_url);
    const url = stringValue(imageUrl.url);
    if (!url) return undefined;
    const image = await imageUrlToBase64Source(url);
    return { type: "image", source: image };
  }
  return undefined;
}

function anthropicMessagesToOpenAiChat(input: Record<string, unknown>, model?: string): Record<string, unknown> {
  const output: Record<string, unknown> = {
    model: model ?? stringValue(input.model),
    messages: arrayValue(input.messages).map(anthropicMessageToOpenAi)
  };
  copyIfPresent(input, output, ["temperature", "top_p", "stop", "stream"]);
  if (input.max_tokens !== undefined) output.max_tokens = input.max_tokens;
  if (input.system) {
    output.messages = [{ role: "system", content: stringifyContent(input.system) }, ...(output.messages as unknown[])];
  }
  return output;
}

function anthropicMessageToOpenAi(message: unknown): Record<string, unknown> {
  const item = objectValue(message);
  const role = stringValue(item.role) === "assistant" ? "assistant" : "user";
  const content = item.content;
  if (typeof content === "string") return { role, content };
  const parts = arrayValue(content).map(anthropicPartToOpenAi).filter(Boolean);
  return { role, content: parts };
}

function anthropicPartToOpenAi(part: unknown): Record<string, unknown> | undefined {
  const item = objectValue(part);
  const type = stringValue(item.type);
  if (type === "text") return { type: "text", text: stringValue(item.text) };
  if (type === "image") {
    const source = objectValue(item.source);
    const sourceType = stringValue(source.type);
    if (sourceType === "url") {
      const url = stringValue(source.url);
      return url ? { type: "image_url", image_url: { url } } : undefined;
    }
    if (sourceType === "base64") {
      const mediaType = stringValue(source.media_type) || "image/png";
      const data = stringValue(source.data);
      return data ? { type: "image_url", image_url: { url: `data:${mediaType};base64,${data}` } } : undefined;
    }
  }
  return undefined;
}

function anthropicResponseToOpenAiChat(input: Record<string, unknown>): Record<string, unknown> {
  const usage = objectValue(input.usage);
  const inputTokens = numberValue(usage.input_tokens);
  const outputTokens = numberValue(usage.output_tokens);
  const messageContent = arrayValue(input.content)
    .map((part) => objectValue(part))
    .filter((part) => stringValue(part.type) === "text")
    .map((part) => stringValue(part.text))
    .filter(Boolean)
    .join("\n");
  return {
    id: stringValue(input.id) || `chatcmpl-${Date.now()}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: stringValue(input.model),
    choices: [{
      index: 0,
      message: { role: "assistant", content: messageContent },
      finish_reason: mapAnthropicStopReason(stringValue(input.stop_reason))
    }],
    usage: {
      prompt_tokens: inputTokens,
      completion_tokens: outputTokens,
      total_tokens: sumNumbers(inputTokens, outputTokens)
    }
  };
}

function openAiChatResponseToAnthropic(input: Record<string, unknown>): Record<string, unknown> {
  const choice = objectValue(arrayValue(input.choices)[0]);
  const message = objectValue(choice.message);
  const usage = objectValue(input.usage);
  return {
    id: stringValue(input.id) || `msg_${Date.now()}`,
    type: "message",
    role: "assistant",
    model: stringValue(input.model),
    content: [{ type: "text", text: stringifyContent(message.content) }],
    stop_reason: mapOpenAiFinishReason(stringValue(choice.finish_reason)),
    usage: {
      input_tokens: numberValue(usage.prompt_tokens ?? usage.input_tokens),
      output_tokens: numberValue(usage.completion_tokens ?? usage.output_tokens)
    }
  };
}

async function imageUrlToBase64Source(url: string): Promise<Record<string, string>> {
  const dataUrlMatch = url.match(/^data:([^;,]+);base64,(.+)$/i);
  if (dataUrlMatch) {
    return { type: "base64", media_type: dataUrlMatch[1], data: dataUrlMatch[2] };
  }
  if (!/^https?:\/\//i.test(url)) {
    throw new Error("Image URL must be http, https, or a base64 data URL");
  }
  const response = await fetch(url, { signal: AbortSignal.timeout(imageFetchTimeoutMs()) });
  if (!response.ok) throw new Error(`Image URL fetch failed with HTTP ${response.status}`);
  const contentType = response.headers.get("content-type")?.split(";")[0]?.trim() || mediaTypeFromUrl(url);
  if (!contentType.startsWith("image/")) throw new Error(`Image URL returned non-image content-type: ${contentType}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length > maxImageBytes()) throw new Error(`Image URL is too large (${buffer.length} bytes)`);
  return { type: "base64", media_type: contentType, data: buffer.toString("base64") };
}

function extractOpenAiSystem(messages: unknown): string | undefined {
  const text = arrayValue(messages)
    .map((message) => objectValue(message))
    .filter((message) => stringValue(message.role) === "system")
    .map((message) => stringifyContent(message.content))
    .filter(Boolean)
    .join("\n");
  return text || undefined;
}

function replaceTopLevelModel(input: Record<string, unknown>, model?: string): Record<string, unknown> {
  if (!model || typeof input.model !== "string") return input;
  return { ...input, model };
}

function copyIfPresent(input: Record<string, unknown>, output: Record<string, unknown>, keys: string[]): void {
  for (const key of keys) {
    if (input[key] !== undefined) output[key] = input[key];
  }
}

function parseObject(buffer: Buffer): Record<string, unknown> | undefined {
  try {
    return objectOrUndefined(JSON.parse(buffer.toString("utf8")));
  } catch {
    return undefined;
  }
}

function objectOrUndefined(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function objectValue(value: unknown): Record<string, unknown> {
  return objectOrUndefined(value) ?? {};
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function stringifyContent(value: unknown): string {
  if (typeof value === "string") return value;
  return arrayValue(value)
    .map((part) => {
      const item = objectValue(part);
      return stringValue(item.type) === "text" ? stringValue(item.text) : "";
    })
    .filter(Boolean)
    .join("\n");
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function sumNumbers(...values: Array<number | undefined>): number | undefined {
  const present = values.filter((value): value is number => value !== undefined);
  return present.length > 0 ? present.reduce((total, value) => total + value, 0) : undefined;
}

function mapAnthropicStopReason(reason: string): string | null {
  if (reason === "end_turn") return "stop";
  if (reason === "max_tokens") return "length";
  if (reason === "stop_sequence") return "stop";
  if (reason === "tool_use") return "tool_calls";
  return reason || null;
}

function mapOpenAiFinishReason(reason: string): string | null {
  if (reason === "stop") return "end_turn";
  if (reason === "length") return "max_tokens";
  if (reason === "tool_calls") return "tool_use";
  return reason || null;
}

function mediaTypeFromUrl(url: string): string {
  const pathname = new URL(url).pathname.toLowerCase();
  if (pathname.endsWith(".jpg") || pathname.endsWith(".jpeg")) return "image/jpeg";
  if (pathname.endsWith(".webp")) return "image/webp";
  if (pathname.endsWith(".gif")) return "image/gif";
  return "image/png";
}

function maxImageBytes(): number {
  const value = Number(process.env.API_VAULT_MAX_IMAGE_BYTES || DEFAULT_MAX_IMAGE_BYTES);
  return Number.isFinite(value) && value > 0 ? value : DEFAULT_MAX_IMAGE_BYTES;
}

function imageFetchTimeoutMs(): number {
  const value = Number(process.env.API_VAULT_IMAGE_FETCH_TIMEOUT_MS || 15_000);
  return Number.isFinite(value) && value > 0 ? value : 15_000;
}
