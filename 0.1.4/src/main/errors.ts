export class AppError extends Error {
  constructor(
    message: string,
    public readonly statusCode = 500,
    public readonly code = "internal_error"
  ) {
    super(message);
    this.name = "AppError";
  }
}

export function badRequest(message: string, code = "bad_request"): AppError {
  return new AppError(message, 400, code);
}

export function unauthorized(message: string, code = "unauthorized"): AppError {
  return new AppError(message, 401, code);
}

export function notFound(message: string, code = "not_found"): AppError {
  return new AppError(message, 404, code);
}

export function conflict(message: string, code = "conflict"): AppError {
  return new AppError(message, 409, code);
}

export function locked(message: string, code = "vault_locked"): AppError {
  return new AppError(message, 423, code);
}

export function payloadTooLarge(message: string, code = "payload_too_large"): AppError {
  return new AppError(message, 413, code);
}

export function serviceUnavailable(message: string, code = "service_unavailable"): AppError {
  return new AppError(message, 503, code);
}

export function toAppError(error: unknown): AppError {
  if (error instanceof AppError) return error;
  const message = String((error as Error)?.message ?? error);

  if (message === "Vault is locked") return locked(message);
  if (message === "Invalid master password") return unauthorized(message, "invalid_master_password");
  if (message === "Vault is already initialized") return conflict(message, "vault_initialized");
  if (message === "Vault is not initialized") return badRequest(message, "vault_not_initialized");
  if (message === "Provider not found") return notFound(message, "provider_not_found");
  if (message === "Secret is not configured") return notFound(message, "secret_not_configured");
  if (message === "Proxy is not running") return serviceUnavailable(message, "proxy_offline");
  if (message === "Request body is too large") return payloadTooLarge(message);
  if (message === "Invalid JSON body") return badRequest(message, "invalid_json");
  if (message === "API key is required") return badRequest(message, "api_key_required");
  if (message === "Provider name is required") return badRequest(message, "provider_name_required");
  if (message.includes("Invalid URL")) return badRequest(message, "invalid_url");
  if (message.includes("Unsupported protocol")) return badRequest(message, "unsupported_protocol");
  if (message.includes("Unsupported balance method")) return badRequest(message, "unsupported_balance_method");

  return new AppError(message);
}
