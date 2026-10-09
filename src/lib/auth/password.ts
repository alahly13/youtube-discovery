import { randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import type * as crypto from "node:crypto";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * Password Hashing — scrypt (memory-hard KDF, Node built-in, no native deps).
 * ──────────────────────────────────────────────────────────────────────────
 * Rationale (documented choice): Argon2id would require a native binding
 * (`argon2` package), which adds cold-start cost and build risk on serverless
 * runtimes. scrypt with N=16384, r=8, p=1 is a memory-hard, OWASP-recognized
 * password KDF available in every Node.js runtime including Vercel's, with
 * identical behavior locally and in production. Stored format carries its own
 * parameters so they can be raised later without breaking existing hashes.
 *
 * Stored format: scrypt$v1$n=<N>$r=<r>$p=<p>$<salt-b64url>$<hash-b64url>
 * NEVER store or log plaintext passwords. Verification is constant-time.
 * ═══════════════════════════════════════════════════════════════════════════
 */

const scryptAsync = (
  password: crypto.BinaryLike,
  salt: crypto.BinaryLike,
  keylen: number,
  options: crypto.ScryptOptions,
): Promise<Buffer> =>
  new Promise((resolve, reject) => {
    scryptCb(password, salt, keylen, options, (err, derived) => {
      if (err) reject(err);
      else resolve(derived as Buffer);
    });
  });

export const SCRYPT_N = 16384;
export const SCRYPT_R = 8;
export const SCRYPT_P = 1;
export const SCRYPT_KEYLEN = 64;
export const SCRYPT_SALTLEN = 16;

export const USERNAME_MIN = 3;
export const USERNAME_MAX = 32;
export const PASSWORD_MIN = 12;
export const PASSWORD_MAX = 256;

const USERNAME_RE = /^[a-zA-Z0-9._-]{3,32}$/;

export function validateUsername(username: string): string {
  const clean = username.trim();
  if (!USERNAME_RE.test(clean)) {
    throw new Error(
      "Username must be 3–32 characters: letters, digits, dot, underscore, or hyphen.",
    );
  }
  return clean;
}

export function validateNewPassword(password: string): void {
  if (typeof password !== "string" || password.length < PASSWORD_MIN) {
    throw new Error(`New password must be at least ${PASSWORD_MIN} characters.`);
  }
  if (password.length > PASSWORD_MAX) {
    throw new Error("New password is too long.");
  }
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SCRYPT_SALTLEN);
  const derived = (await scryptAsync(password, salt, SCRYPT_KEYLEN, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
  })) as Buffer;
  const b64 = (b: Buffer) => b.toString("base64url");
  return `scrypt$v1$n=${SCRYPT_N}$r=${SCRYPT_R}$p=${SCRYPT_P}$${b64(salt)}$${b64(derived)}`;
}

/** Constant-time password verification. Returns false (never throws) for bad input. */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  try {
    if (typeof password !== "string" || typeof stored !== "string") return false;
    const m = /^scrypt\$v1\$n=(\d+)\$r=(\d+)\$p=(\d+)\$([A-Za-z0-9_-]+)\$([A-Za-z0-9_-]+)$/.exec(stored);
    if (!m) return false;
    const n = Number(m[1]);
    const r = Number(m[2]);
    const p = Number(m[3]);
    // Refuse absurd parameters (DoS guard) before spending CPU.
    if (n > 1 << 20 || r > 32 || p > 8) return false;
    const salt = Buffer.from(m[4], "base64url");
    const expected = Buffer.from(m[5], "base64url");
    if (salt.length === 0 || expected.length === 0) return false;
    const derived = (await scryptAsync(password, salt, expected.length, {
      N: n,
      r,
      p,
    })) as Buffer;
    if (derived.length !== expected.length) return false;
    return timingSafeEqual(derived, expected);
  } catch {
    return false;
  }
}
