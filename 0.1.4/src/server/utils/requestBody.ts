import type { IncomingMessage } from "node:http";
import { AppError } from "../../main/errors";
import { JSON_BODY_LIMIT_BYTES, readRequestBody } from "../../main/httpUtils";

export async function readJsonBody<T>(req: IncomingMessage): Promise<T> {
  let buffer: Buffer;
  try {
    buffer = await readRequestBody(req, JSON_BODY_LIMIT_BYTES);
  } catch (error) {
    throw new AppError((error as Error).message, 413, "payload_too_large");
  }
  const text = buffer.toString("utf8");
  if (!text) throw new AppError("Request body is required", 400, "body_required");
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new AppError("Invalid JSON body", 400, "invalid_json");
  }
}
