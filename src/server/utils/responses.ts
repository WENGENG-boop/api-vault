import type { ServerResponse } from "node:http";
import { toAppError } from "../../main/errors";

export function sendJson(res: ServerResponse, status: number, data: unknown): void {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body)
  });
  res.end(body);
}

export function sendError(res: ServerResponse, error: unknown): void {
  const appError = toAppError(error);
  sendJson(res, appError.statusCode, {
    error: appError.message,
    code: appError.code
  });
}

export function sendText(res: ServerResponse, status: number, text: string): void {
  res.writeHead(status, {
    "content-type": "text/plain; charset=utf-8",
    "content-length": Buffer.byteLength(text)
  });
  res.end(text);
}
