import "server-only";

import { randomBytes } from "node:crypto";
import { SESSION_COOKIE_NAME } from "./cookies";
import type { BlobBackend } from "../blob/blob-backend";
import { adminSessionPathname, BLOB_NAMESPACES } from "../blob/blob-paths";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * Admin Sessions — opaque server-side sessions in Blob (shared, stateless).
 * ──────────────────────────────────────────────────────────────────────────
 * - Opaque 256-bit random session ids; the session RECORD lives in Blob
 *   (`admin/sessions/<sid>.json`) so every serverless instance validates
 *   identically. Nothing auth-relevant is stored in localStorage/IndexedDB.
 * - Fixed duration from login (ADMIN_SESSION_TTL_SECONDS, default 604800 =
 *   7 days). Expiry is enforced server-side on every validation, not just by
 *   cookie Max-Age. Reducing the TTL env var shortens validation for
 *   existing sessions too (min(stored expiry, issuedAt + current max)).
 * - Credential changes bump account.authVersion → all older sessions fail
 *   validation even before their blobs are deleted (defense in depth;
 *   changeCredentials callers also revoke all session blobs).
 * - Cookie: HttpOnly, Secure in production, SameSite=Lax, Path=/.
 * ═══════════════════════════════════════════════════════════════════════════
 */

export { SESSION_COOKIE_NAME };
export const DEFAULT_SESSION_TTL_SECONDS = 604800;
export const MIN_SESSION_TTL_SECONDS = 300;
export const MAX_SESSION_TTL_SECONDS = 30 * 24 * 3600;

export interface AdminSession {
  sid: string;
  createdAt: number;
  expiresAt: number;
  authVersion: number;
}

/** Parse + clamp the configured TTL. Invalid → default (documented). */
export function getSessionTtlSeconds(): number {
  const raw = process.env.ADMIN_SESSION_TTL_SECONDS?.trim();
  if (!raw) return DEFAULT_SESSION_TTL_SECONDS;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < MIN_SESSION_TTL_SECONDS || parsed > MAX_SESSION_TTL_SECONDS) {
    return DEFAULT_SESSION_TTL_SECONDS;
  }
  return parsed;
}

export function isSecureCookie(): boolean {
  return process.env.NODE_ENV === "production";
}

export function buildSessionCookie(sid: string, maxAgeSeconds: number): string {
  const parts = [
    `${SESSION_COOKIE_NAME}=${sid}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${maxAgeSeconds}`,
  ];
  if (isSecureCookie()) parts.push("Secure");
  return parts.join("; ");
}

export function clearSessionCookie(): string {
  const parts = [`${SESSION_COOKIE_NAME}=`, "Path=/", "HttpOnly", "SameSite=Lax", "Max-Age=0"];
  if (isSecureCookie()) parts.push("Secure");
  return parts.join("; ");
}

export function readSessionId(cookieHeader: string | null): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const idx = part.indexOf("=");
    if (idx < 0) continue;
    if (part.slice(0, idx).trim() === SESSION_COOKIE_NAME) {
      const value = part.slice(idx + 1).trim();
      if (/^[A-Za-z0-9_-]{20,128}$/.test(value)) return value;
      return null;
    }
  }
  return null;
}

export async function createSession(
  backend: BlobBackend,
  authVersion: number,
): Promise<{ sid: string; session: AdminSession }> {
  const ttl = getSessionTtlSeconds();
  const now = Date.now();
  const sid = randomBytes(32).toString("base64url");
  const session: AdminSession = {
    sid,
    createdAt: now,
    expiresAt: now + ttl * 1000,
    authVersion,
  };
  await backend.putBytes(adminSessionPathname(sid), Buffer.from(JSON.stringify(session), "utf8"), {
    allowOverwrite: false,
    contentType: "application/json",
    cacheSeconds: 0,
  });
  return { sid, session };
}

export interface SessionValidation {
  valid: boolean;
  session?: AdminSession;
  reason?: "missing" | "expired" | "revoked" | "stale-auth-version";
}

/**
 * Full server-side validation: existence, fixed-window expiry (also
 * re-clamped against the CURRENT configured TTL), and authVersion.
 */
export async function validateSession(
  backend: BlobBackend,
  sid: string | null,
  currentAuthVersion: number,
): Promise<SessionValidation> {
  if (!sid) return { valid: false, reason: "missing" };
  let session: AdminSession | null = null;
  try {
    const raw = await backend.getBytes(adminSessionPathname(sid));
    const parsed = JSON.parse(raw.toString("utf8")) as Partial<AdminSession>;
    if (
      typeof parsed.createdAt !== "number" ||
      typeof parsed.expiresAt !== "number" ||
      typeof parsed.authVersion !== "number" ||
      parsed.sid !== sid
    ) {
      return { valid: false, reason: "revoked" };
    }
    session = parsed as AdminSession;
  } catch {
    return { valid: false, reason: "revoked" };
  }
  const now = Date.now();
  // Enforce the CURRENT configured maximum age as well: shrinking the TTL
  // env var shortens already-issued sessions.
  const maxAgeMs = getSessionTtlSeconds() * 1000;
  if (now >= session.expiresAt || now - session.createdAt >= maxAgeMs) {
    return { valid: false, reason: "expired" };
  }
  if (session.authVersion !== currentAuthVersion) {
    return { valid: false, reason: "stale-auth-version" };
  }
  return { valid: true, session };
}

export async function revokeSession(backend: BlobBackend, sid: string): Promise<void> {
  await backend.delete(adminSessionPathname(sid)).catch(() => {});
}

/** Delete every session blob (used after credential changes). */
export async function revokeAllSessions(backend: BlobBackend): Promise<number> {
  const listed = await backend.list(`${BLOB_NAMESPACES.admin}/sessions/`).catch(() => []);
  let count = 0;
  for (const obj of listed) {
    await backend.delete(obj.pathname).catch(() => {});
    count += 1;
  }
  return count;
}
