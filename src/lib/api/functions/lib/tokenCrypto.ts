import crypto from "node:crypto";
import { describeDatabase } from "@/core/db/target";
import { ServiceError } from "../services/errors";
import { logger } from "./logger";

const CIPHER = "aes-256-gcm";
const PREFIX = "enc:";

function getKey(): Buffer {
  const raw = process.env.SETTINGS_ENCRYPTION_KEY ?? process.env.ENCRYPTION_KEY;
  if (!raw) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("SETTINGS_ENCRYPTION_KEY environment variable is required in production");
    }
    // The fallback is a constant in this file — anyone with the code can
    // decrypt what it protects. Fine for a throwaway local Postgres; refused
    // for the shared database, where store tokens would sit beside real
    // accounts and the deployed app (with the real key) could not read them.
    if (!describeDatabase(process.env.DATABASE_URL).isLocal) {
      throw new ServiceError(
        "unavailable",
        "Connecting a store needs SETTINGS_ENCRYPTION_KEY on this machine (the same value the deployment uses). Nothing was saved.",
      );
    }
    return crypto.createHash("sha256").update("dev-insecure-key-change-me").digest();
  }
  return crypto.createHash("sha256").update(raw).digest();
}

export function encryptToken(plaintext: string): string {
  const key = getKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(CIPHER, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${PREFIX}${iv.toString("hex")}:${authTag.toString("hex")}:${encrypted.toString("hex")}`;
}

export function decryptToken(stored: string): string {
  if (!stored.startsWith(PREFIX)) {
    return stored;
  }
  const key = getKey();
  const inner = stored.slice(PREFIX.length);
  const parts = inner.split(":");
  if (parts.length !== 3) throw new Error("Invalid encrypted token format");
  const [ivHex, authTagHex, ciphertextHex] = parts;
  const iv = Buffer.from(ivHex, "hex");
  const authTag = Buffer.from(authTagHex, "hex");
  const ciphertext = Buffer.from(ciphertextHex, "hex");
  const decipher = crypto.createDecipheriv(CIPHER, key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}

export function isEncrypted(stored: string): boolean {
  return stored.startsWith(PREFIX);
}

export function assertEncryptionKeyInProduction(): void {
  const key = process.env.SETTINGS_ENCRYPTION_KEY ?? process.env.ENCRYPTION_KEY;
  if (!key) {
    if (process.env.NODE_ENV === "production") {
      throw new Error(
        "SETTINGS_ENCRYPTION_KEY must be set in production. Generate one with: openssl rand -hex 32",
      );
    } else {
      logger.warn(
        describeDatabase(process.env.DATABASE_URL).isLocal
          ? "SETTINGS_ENCRYPTION_KEY is not set — using the insecure dev fallback key (local database only)."
          : "SETTINGS_ENCRYPTION_KEY is not set — store tokens cannot be encrypted or read against the shared database until it is.",
      );
    }
    return;
  }
  if (process.env.NODE_ENV === "production") {
    if (!/^[0-9a-fA-F]{32,}$/.test(key) && key.length < 32) {
      throw new Error(
        "SETTINGS_ENCRYPTION_KEY is too short or not a valid hex string. " +
          "Generate a strong key with: openssl rand -hex 32",
      );
    }
  }
}
