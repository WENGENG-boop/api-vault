import { randomBytes, scryptSync, createCipheriv, createDecipheriv } from "node:crypto";

export interface EncryptedText {
  iv: string;
  tag: string;
  ciphertext: string;
}

export interface VaultHeader {
  salt: string;
  verifier: EncryptedText;
  kdf?: ScryptKdfConfig;
}

export interface ScryptKdfConfig {
  name: "scrypt";
  N: number;
  r: number;
  p: number;
  maxmem: number;
}

const VERIFIER_TEXT = "api-vault-demo-verifier";
const LEGACY_KDF: ScryptKdfConfig = { name: "scrypt", N: 16384, r: 8, p: 1, maxmem: 32 * 1024 * 1024 };
const CURRENT_KDF: ScryptKdfConfig = { name: "scrypt", N: 65536, r: 8, p: 1, maxmem: 128 * 1024 * 1024 };

export function createVaultHeader(password: string): { header: VaultHeader; key: Buffer } {
  const salt = randomBytes(16).toString("base64");
  const key = deriveKey(password, salt, CURRENT_KDF);
  return {
    header: {
      salt,
      verifier: encryptString(key, VERIFIER_TEXT),
      kdf: CURRENT_KDF
    },
    key
  };
}

export function unlockVaultHeader(password: string, header: VaultHeader): Buffer {
  const key = deriveKey(password, header.salt, normalizeKdfConfig(header.kdf));
  const verifier = decryptString(key, header.verifier);
  if (verifier !== VERIFIER_TEXT) {
    throw new Error("Invalid master password");
  }
  return key;
}

export function deriveKey(password: string, salt: string, kdf = CURRENT_KDF): Buffer {
  if (!password || password.length < 8) {
    throw new Error("Master password must be at least 8 characters");
  }
  return scryptSync(password, Buffer.from(salt, "base64"), 32, {
    N: kdf.N,
    r: kdf.r,
    p: kdf.p,
    maxmem: kdf.maxmem
  });
}

function normalizeKdfConfig(value: ScryptKdfConfig | undefined): ScryptKdfConfig {
  if (!value || value.name !== "scrypt") return LEGACY_KDF;
  return {
    name: "scrypt",
    N: value.N || LEGACY_KDF.N,
    r: value.r || LEGACY_KDF.r,
    p: value.p || LEGACY_KDF.p,
    maxmem: value.maxmem || LEGACY_KDF.maxmem
  };
}

export function encryptString(key: Buffer, plaintext: string): EncryptedText {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    iv: iv.toString("base64"),
    tag: tag.toString("base64"),
    ciphertext: ciphertext.toString("base64")
  };
}

export function decryptString(key: Buffer, encrypted: EncryptedText): string {
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(encrypted.iv, "base64"));
  decipher.setAuthTag(Buffer.from(encrypted.tag, "base64"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(encrypted.ciphertext, "base64")),
    decipher.final()
  ]);
  return plaintext.toString("utf8");
}
