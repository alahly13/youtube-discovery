import "server-only";

import { createHash } from "node:crypto";
import type { BlobBackend } from "../blob/blob-backend";
import { rateLimitPathname } from "../blob/blob-paths";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * Login Rate Limiting — Blob-backed sliding window (shared across instances).
 * ──────────────────────────────────────────────────────────────────────────
 * Serverless instances do not share memory, so attempt counters live in Blob
 * (`admin/ratelimit/<ipHash>.json`). An in-memory mirror absorbs Blob
 * outages WITHOUT becoming the sole mechanism: when Blob is unreachable the
 * limiter still throttles per-instance (fail-safe), and every login attempt
 * still requires full password verification.
 *
 * Policy: max 10 attempts per 15-minute window per IP hash. IPs are hashed
 * (SHA-256 + server salt) so the store never holds raw client IPs.
 * ═══════════════════════════════════════════════════════════════════════════
 */

export const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;
export const RATE_LIMIT_MAX_ATTEMPTS = 10;

interface RateLimitState {
  windowStart: number;
  attempts: number[];
}

const memoryMirror = new Map<string, RateLimitState>();

function serverSalt(): string {
  // Stable per-process salt is enough: the hash only needs to be
  // non-reversible in the store, not globally consistent.
  return process.env.ADMIN_SESSION_SECRET?.slice(0, 16) ?? "youtube-discovery";
}

export function hashIp(ip: string): string {
  return createHash("sha256").update(`${serverSalt()}|${ip}`).digest("hex").slice(0, 32);
}

export function clientIpFromHeaders(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]?.trim() || "unknown";
  return headers.get("x-real-ip")?.trim() || "unknown";
}

function prune(state: RateLimitState, now: number): RateLimitState {
  const cutoff = now - RATE_LIMIT_WINDOW_MS;
  const attempts = state.attempts.filter((t) => t > cutoff);
  const windowStart = attempts.length > 0 ? Math.min(...attempts) : now;
  return { windowStart, attempts };
}

export async function checkLoginRateLimit(
  backend: BlobBackend,
  ipHash: string,
): Promise<{ allowed: boolean; retryAfterSeconds: number }> {
  const now = Date.now();
  let state: RateLimitState = { windowStart: now, attempts: [] };
  try {
    const raw = await backend.getBytes(rateLimitPathname(ipHash));
    const parsed = JSON.parse(raw.toString("utf8")) as Partial<RateLimitState>;
    if (parsed && Array.isArray(parsed.attempts)) {
      state = prune({ windowStart: typeof parsed.windowStart === "number" ? parsed.windowStart : now, attempts: parsed.attempts.filter((t) => typeof t === "number") }, now);
    }
  } catch {
    const mirrored = memoryMirror.get(ipHash);
    if (mirrored) state = prune(mirrored, now);
  }
  if (state.attempts.length >= RATE_LIMIT_MAX_ATTEMPTS) {
    const oldest = Math.min(...state.attempts);
    const retryAfterSeconds = Math.max(1, Math.ceil((oldest + RATE_LIMIT_WINDOW_MS - now) / 1000));
    return { allowed: false, retryAfterSeconds };
  }
  return { allowed: true, retryAfterSeconds: 0 };
}

export async function recordLoginAttempt(backend: BlobBackend, ipHash: string): Promise<void> {
  const now = Date.now();
  let state: RateLimitState = { windowStart: now, attempts: [] };
  try {
    const raw = await backend.getBytes(rateLimitPathname(ipHash));
    const parsed = JSON.parse(raw.toString("utf8")) as Partial<RateLimitState>;
    if (parsed && Array.isArray(parsed.attempts)) {
      state = prune({ windowStart: now, attempts: parsed.attempts.filter((t) => typeof t === "number") }, now);
    }
  } catch {
    const mirrored = memoryMirror.get(ipHash);
    if (mirrored) state = prune(mirrored, now);
  }
  state.attempts.push(now);
  memoryMirror.set(ipHash, state);
  try {
    await backend.putBytes(rateLimitPathname(ipHash), Buffer.from(JSON.stringify(state), "utf8"), {
      contentType: "application/json",
      cacheSeconds: 0,
    });
  } catch {
    // Mirror already updated; Blob outage must not break login availability.
  }
}

export async function clearLoginAttempts(backend: BlobBackend, ipHash: string): Promise<void> {
  memoryMirror.delete(ipHash);
  try {
    await backend.delete(rateLimitPathname(ipHash));
  } catch {
    // Best effort.
  }
}
