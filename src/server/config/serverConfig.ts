import { resolve } from "node:path";

export const DEFAULT_PORT = Number(process.env.PORT || 3210);
export const LISTEN_HOST = process.env.BIND_HOST || process.env.HOST || (process.env.API_VAULT_DOCKER === "1" ? "0.0.0.0" : "127.0.0.1");
export const DIST_DIR = resolve(process.env.API_VAULT_DIST_DIR?.trim() || resolve(process.cwd(), "out"));
export const DATA_PATH = resolve(process.env.API_VAULT_DATA_PATH?.trim() || resolve(process.cwd(), ".api-vault", "vault.json"));
