import crypto from "node:crypto";
import { prisma } from "@/lib/db/prisma";
import type { BlobBackend } from "../storage/storage-backend";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * Distributed Login Rate Limiter — PostgreSQL Primary (Multi-Instance Safe)
 * ──────────────────────────────────────────────────────────────────────────
 * Stores brute-force login throttle buckets in `login_rate_limits` inside
 * Supabase PostgreSQL instead of legacy `asdy/admin/ratelimit/*.json` blobs
 * (which failed Worker owner checks and fell back to ephemeral Vercel disk).
 * Keeps an in-process fallback ONLY if PostgreSQL is unreachable/unconfigured
 * in isolated unit tests.
 * ═══════════════════════════════════════════════════════════════════════════
 */

export function rateLimitPathname(ipHash: string): string {
  return `asdy/admin/ratelimit/${ipHash}.json`;
}

export const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;
export const RATE_LIMIT_MAX_ATTEMPTS = 10;

interface RateEntry {
  count: number;
  windowStart: number;
  blockedUntil?: number;
}

const memoryMirror = new Map<string, RateEntry>();

export function hashIp(ip: string): string {
  return crypto.createHash("sha256").update(`yd:ratelimit:${ip}`).digest("hex").slice(0, 24);
}

export function clientIpFromHeaders(headers: Headers): string {
  const fwd = headers.get("x-forwarded-for");
  if (fwd) {
    const first = fwd.split(",")[0]?.trim();
    if (first) return first;
  }
  return headers.get("x-real-ip")?.trim() || "unknown";
}

function toResult(entry: RateEntry | undefined, now: number): { allowed: boolean; retryAfterSeconds?: number } {
  if (!entry) return { allowed: true };
  if (entry.blockedUntil && entry.blockedUntil > now) {
    return { allowed: false, retryAfterSeconds: Math.ceil((entry.blockedUntil - now) / 1000) };
  }
  if (now - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
    return { allowed: true };
  }
  if (entry.count >= RATE_LIMIT_MAX_ATTEMPTS) {
    return { allowed: false, retryAfterSeconds: Math.ceil((entry.windowStart + RATE_LIMIT_WINDOW_MS - now) / 1000) };
  }
  return { allowed: true };
}

export async function checkLoginRateLimit(
  _backend: BlobBackend,
  ipHash: string
): Promise<{ allowed: boolean; retryAfterSeconds?: number }> {
  const now = Date.now();
  try {
    const row = await prisma.loginRateLimit.findUnique({
      where: { ip_hash: ipHash },
    });
    if (!row) return { allowed: true };
    const entry: RateEntry = {
      count: row.attempt_count,
      windowStart: row.window_start.getTime(),
      blockedUntil: row.blocked_until ? row.blocked_until.getTime() : undefined,
    };
    memoryMirror.set(ipHash, entry);
    return toResult(entry, now);
  } catch {
    return toResult(memoryMirror.get(ipHash), now);
  }
}

export async function recordLoginAttempt(_backend: BlobBackend, ipHash: string): Promise<void> {
  const now = Date.now();
  try {
    const existing = await prisma.loginRateLimit.findUnique({
      where: { ip_hash: ipHash },
    });
    const inWindow = existing && now - existing.window_start.getTime() <= RATE_LIMIT_WINDOW_MS;
    const nextCount = inWindow ? existing.attempt_count + 1 : 1;
    const windowStart = inWindow ? existing.window_start : new Date(now);
    const blockedUntil =
      nextCount >= RATE_LIMIT_MAX_ATTEMPTS ? new Date(now + RATE_LIMIT_WINDOW_MS) : null;

    await prisma.loginRateLimit.upsert({
      where: { ip_hash: ipHash },
      create: {
        ip_hash: ipHash,
        attempt_count: nextCount,
        window_start: windowStart,
        blocked_until: blockedUntil,
      },
      update: {
        attempt_count: nextCount,
        window_start: windowStart,
        blocked_until: blockedUntil,
      },
    });
    memoryMirror.set(ipHash, {
      count: nextCount,
      windowStart: windowStart.getTime(),
      blockedUntil: blockedUntil?.getTime(),
    });
  } catch {
    const cur = memoryMirror.get(ipHash);
    const inWindow = cur && now - cur.windowStart <= RATE_LIMIT_WINDOW_MS;
    const nextCount = inWindow ? cur.count + 1 : 1;
    memoryMirror.set(ipHash, {
      count: nextCount,
      windowStart: inWindow ? cur.windowStart : now,
      blockedUntil: nextCount >= RATE_LIMIT_MAX_ATTEMPTS ? now + RATE_LIMIT_WINDOW_MS : undefined,
    });
  }
}

export async function clearLoginAttempts(_backend: BlobBackend, ipHash: string): Promise<void> {
  memoryMirror.delete(ipHash);
  try {
    await prisma.loginRateLimit.deleteMany({
      where: { ip_hash: ipHash },
    });
  } catch {
    // Non-fatal cleanup
  }
}
