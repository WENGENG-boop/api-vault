import { mkdirSync, writeFileSync } from "node:fs";
import { basename, resolve, sep } from "node:path";
import { AppError, badRequest } from "../../main/errors";

export function writeAccountPoolAuthFile(authsDirectory: string | undefined, fileName: string | undefined, content: string | undefined) {
  const directory = authsDirectory?.trim();
  if (!directory) throw badRequest("Auths directory is not configured for this account pool", "auths_directory_required");
  const rawName = (fileName ?? "").trim();
  if (!rawName) throw badRequest("Auth file name is required", "auth_file_name_required");
  const safeName = basename(rawName).replace(/[^\w.-]/g, "_");
  if (!safeName.toLowerCase().endsWith(".json")) throw badRequest("Auth file must use a .json extension", "auth_file_extension_required");
  const text = typeof content === "string" ? content : "";
  if (!text.trim()) throw badRequest("Auth file content is required", "auth_file_content_required");

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw badRequest("Auth file content is not valid JSON", "auth_file_invalid_json");
  }

  const dir = resolve(directory);
  const target = resolve(dir, safeName);
  if (target !== dir && !target.startsWith(`${dir}${sep}`)) {
    throw badRequest("Auth file path is outside the configured auths directory", "auth_file_path_invalid");
  }

  try {
    mkdirSync(dir, { recursive: true });
    const normalized = `${JSON.stringify(parsed, null, 2)}\n`;
    writeFileSync(target, normalized, { encoding: "utf8" });
    return {
      fileName: safeName,
      sizeBytes: Buffer.byteLength(normalized),
      written: true
    };
  } catch (error) {
    throw new AppError(`Unable to write auth file: ${(error as Error).message}`, 500, "auth_file_write_failed");
  }
}
