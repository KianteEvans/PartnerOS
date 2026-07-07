import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";

/**
 * Symmetric secret vault for data that must be stored reversibly (OAuth refresh
 * tokens). AES-256-GCM (authenticated) — a tampered ciphertext fails to decrypt
 * rather than returning garbage. The key is derived from SESSION_JWT_SECRET via
 * HKDF with a fixed, purpose-specific info string, so there is no extra secret to
 * configure and this key can never collide with the session-signing use of the
 * same root secret. Rotating SESSION_JWT_SECRET invalidates stored ciphertexts
 * (holders must reconnect) — an acceptable trade for one fewer required env var.
 *
 * Reads process.env.SESSION_JWT_SECRET directly (not @/env) so this low-level
 * primitive stays free of the full env-validation import and is unit-testable;
 * env.ts still guarantees the secret is present and >=32 chars at real boot.
 */

const ALGO = "aes-256-gcm";
const IV_LEN = 12;
const TAG_LEN = 16;

let cachedKey: Buffer | null = null;

function vaultKey(): Buffer {
  if (cachedKey) return cachedKey;
  const secret = process.env.SESSION_JWT_SECRET ?? "";
  if (secret.length < 32) {
    throw new Error("SESSION_JWT_SECRET is required to derive the encryption key");
  }
  const derived = hkdfSync(
    "sha256",
    Buffer.from(secret, "utf8"),
    Buffer.from("bd-calendar-vault"),
    Buffer.from("bd-calendar-token-v1"),
    32,
  );
  cachedKey = Buffer.from(derived);
  return cachedKey;
}

/** Encrypt UTF-8 plaintext → base64(iv ++ authTag ++ ciphertext). */
export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, vaultKey(), iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString("base64");
}

/** Decrypt a payload produced by encryptSecret. Throws on tamper / wrong key. */
export function decryptSecret(payload: string): string {
  const buf = Buffer.from(payload, "base64");
  if (buf.length < IV_LEN + TAG_LEN) throw new Error("Ciphertext too short");
  const iv = buf.subarray(0, IV_LEN);
  const tag = buf.subarray(IV_LEN, IV_LEN + TAG_LEN);
  const enc = buf.subarray(IV_LEN + TAG_LEN);
  const decipher = createDecipheriv(ALGO, vaultKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString("utf8");
}
