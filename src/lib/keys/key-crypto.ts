import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * Managed API Key Encryption — AES-256-GCM, server-side only.
 * ──────────────────────────────────────────────────────────────────────────
 * - Key material comes ONLY from `API_KEYS_ENCRYPTION_KEY` (never from the
 *   Blob token, session secret, or any NEXT_PUBLIC_* variable). Accepted
 *   encodings: base64 (44 chars → 32 bytes), hex (64 chars → 32 bytes), or a
 *   raw 32-character string (32 UTF-8 bytes). Anything else is rejected and
 *   key SAVES ARE REFUSED rather than stored in plaintext.
 * - AES-256-GCM provides confidentiality + integrity (auth tag). Each value
 *   gets a fresh 12-byte IV. Stored bundle: {v:1, iv, data} (base64url).
 * - Decryption happens only in trusted server code (key resolution). Masked
 *   values (last 4 chars) are the only thing that ever leaves the server.
 * - BACK UP API_KEYS_ENCRYPTION_KEY SECURELY: losing or changing it makes
 *   previously encrypted keys permanently unrecoverable (by design).
 * ═══════════════════════════════════════════════════════════════════════════
 */

const ALGO = "aes-256-gcm";
const IV_LEN = 12;

export interface EncryptedBundle {
  v: 1;
  iv: string;
  data: string;
}

export function loadKeyEncryptionKey(): Buffer {
  const raw = process.env.API_KEYS_ENCRYPTION_KEY;
  if (!raw || raw.trim().length === 0) {
    throw new Error(
      "API_KEYS_ENCRYPTION_KEY is not configured. Managed API keys cannot be saved without encryption.",
    );
  }
  const value = raw.trim();
  // base64 → 32 bytes
  if (/^[A-Za-z0-9+/=_-]{40,48}$/.test(value)) {
    try {
      const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
      const buf = Buffer.from(normalized, "base64");
      if (buf.length === 32) return buf;
    } catch {
      // fall through to error
    }
  }
  // hex → 32 bytes
  if (/^[0-9a-fA-F]{64}$/.test(value)) {
    return Buffer.from(value, "hex");
  }
  // raw 32-byte string
  if (Buffer.byteLength(value, "utf8") === 32) {
    return Buffer.from(value, "utf8");
  }
  throw new Error(
    "API_KEYS_ENCRYPTION_KEY must decode to exactly 32 bytes (base64, hex, or 32 characters). Managed API keys cannot be saved.",
  );
}

/** True when encryption is available (never throws, never logs the key). */
export function isKeyEncryptionAvailable(): boolean {
  try {
    const key = loadKeyEncryptionKey();
    return key.length === 32;
  } catch {
    return false;
  }
}

export function encryptApiKey(plaintext: string, key?: Buffer): EncryptedBundle {
  const encKey = key ?? loadKeyEncryptionKey();
  if (encKey.length !== 32) throw new Error("Invalid encryption key length");
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, encKey, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  // Append the 16-byte GCM auth tag so tampering is detected on decrypt.
  const combined = Buffer.concat([ciphertext, tag]);
  return { v: 1, iv: iv.toString("base64url"), data: combined.toString("base64url") };
}

export function decryptApiKey(bundle: EncryptedBundle, key?: Buffer): string {
  const encKey = key ?? loadKeyEncryptionKey();
  if (encKey.length !== 32) throw new Error("Invalid encryption key length");
  if (!bundle || bundle.v !== 1 || typeof bundle.iv !== "string" || typeof bundle.data !== "string") {
    throw new Error("Invalid encrypted key bundle");
  }
  const iv = Buffer.from(bundle.iv, "base64url");
  const combined = Buffer.from(bundle.data, "base64url");
  if (iv.length !== IV_LEN || combined.length < 17) {
    throw new Error("Invalid encrypted key bundle");
  }
  const tag = combined.subarray(combined.length - 16);
  const ciphertext = combined.subarray(0, combined.length - 16);
  const decipher = createDecipheriv(ALGO, encKey, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}

/** Last-four display mask. The ONLY key-derived string allowed client-side. */
export function maskStoredKey(plaintext: string): string {
  const t = (plaintext ?? "").trim();
  if (t.length <= 4) return "••••";
  return `••••${t.slice(-4)}`;
}
