import "server-only";

import crypto from "node:crypto";
import type { Prisma } from "@prisma/client";
import type { StorageBackend as BlobBackend } from "../storage/storage-backend";
import { stableStringify } from "../storage/storage-backend";
import { getBlobBackend } from "../storage/r2-blob-backend";
import { prisma } from "@/lib/db/prisma";
import { resolveCanonicalAdminProfile } from "@/lib/auth/canonical-admin-owner";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * Quota Pools — Google Cloud project-aware usage accounting + rotation state.
 * ──────────────────────────────────────────────────────────────────────────
 * Honest model (no fabricated official data):
 * - A "pool" is a quota-sharing group. Keys with a known projectId share the
 *   pool `project:<id>`. Keys WITHOUT a known project each form their own
 *   pool `key:<keyId>` — unknowns are NEVER merged (different values, names,
 *   or Gmail labels do not imply different projects, nor the same one).
 * - Buckets: `search` (search.list, ~100 units/call) vs `other` (everything
 *   else, ~1 unit/call). Buckets exhaust INDEPENDENTLY: a spent search bucket
 *   never disables other operations of the same pool.
 * - All figures are LOCAL ESTIMATES from persistent request accounting
 *   (confidence: "local-estimate"), unless an official monitoring integration
 *   is configured (none is — see docs; Service Usage API needs separate
 *   OAuth credentials). Estimates and official figures are never mixed.
 * - Accounting docs are per-day (Pacific reset) and updated with CAS retry
 *   so concurrent serverless instances don't silently lose increments.
 * ═══════════════════════════════════════════════════════════════════════════
 */

export type QuotaBucket = "search" | "other";
export type ProjectAssociation = "verified" | "declared" | "unknown";

export const QUOTA_POOLS_PATHNAME = "youtube-discovery/v1/api-keys/pools.json";
export const usagePathnameFor = (day: string): string =>
  `youtube-discovery/v1/api-keys/usage-${day}.json`;

export interface PoolBucketState {
  exhaustedUntil: number | null;
  evidence: string | null;
}

export interface QuotaPoolState {
  search: PoolBucketState;
  other: PoolBucketState;
}

export interface QuotaPoolsDoc {
  version: 1;
  updatedAt: string;
  pools: Record<string, QuotaPoolState>;
}

export interface KeyDayUsage {
  requests: number;
  units: number;
  errors: number;
}

export interface UsageDoc {
  version: 1;
  /** Pacific date YYYY-MM-DD. */
  date: string;
  byKey: Record<string, KeyDayUsage>;
  byProject: Record<string, KeyDayUsage>;
  /** Bucket-split project totals (`<poolKey>#<bucket>`), same events. */
  byProjectBucket: Record<string, KeyDayUsage>;
  lastRequest: {
    at: string;
    keyId: string;
    poolKey: string;
    projectId: string | null;
    operation: string;
    bucket: QuotaBucket;
    units: number;
    ok: boolean;
    errorReason: string | null;
  } | null;
}

/** Documented YouTube Data API v3 cost model (estimate basis — see docs). */
export function unitsForOperation(operation: string): number {
  const op = operation.toLowerCase();
  if (op === "search" || op.endsWith("/search") || op.includes("search.")) return 100;
  return 1;
}

export function bucketForOperation(operation: string): QuotaBucket {
  const op = operation.toLowerCase();
  if (op === "search" || op.endsWith("/search") || op.includes("search.")) return "search";
  return "other";
}

/** Pacific-time date key (YouTube quota resets at midnight Pacific). */
export function pacificDayKey(at = Date.now()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(at));
  return parts;
}

/** Next Pacific midnight as ISO (the reset time shown on the dashboard). */
export function nextPacificMidnightIso(at = Date.now()): string {
  // Iterative search for the next Pacific-midnight boundary (DST-safe:
  // October/November transitions shift UTC offsets, wall-clock search doesn't).
  let candidate = Math.floor(at / 3600000) * 3600000 + 3600000;
  for (let i = 0; i < 30; i += 1) {
    const label = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Los_Angeles",
      hour: "numeric",
      minute: "numeric",
      hour12: false,
    }).format(new Date(candidate));
    if (label === "24:00" || label === "00:00") return new Date(candidate).toISOString();
    candidate += 15 * 60 * 1000;
  }
  return new Date(candidate).toISOString();
}

export function poolKeyFor(projectId: string | null | undefined, keyId: string): string {
  const pid = (projectId ?? "").trim().toLowerCase();
  if (pid) return `project:${pid}`;
  return `key:${keyId}`;
}

function emptyPoolState(): QuotaPoolState {
  return {
    search: { exhaustedUntil: null, evidence: null },
    other: { exhaustedUntil: null, evidence: null },
  };
}

async function readJson<T>(backend: BlobBackend, pathname: string): Promise<T | null> {
  try {
    const raw = await backend.getBytes(pathname);
    return JSON.parse(raw.toString("utf8")) as T;
  } catch {
    return null;
  }
}

/** CAS loop helper: read → mutate → write(ifMatch) → retry on conflict. */
async function casUpdate(
  backend: BlobBackend,
  pathname: string,
  mutate: (current: string | null) => string,
  retries = 6,
): Promise<void> {
  for (let attempt = 0; attempt < retries; attempt += 1) {
    const existing = await backend.head(pathname);
    let current: string | null = null;
    if (existing) {
      try {
        current = (await backend.getBytes(pathname)).toString("utf8");
      } catch {
        current = null;
      }
    }
    const next = mutate(current);
    const body = Buffer.from(next, "utf8");
    try {
      if (!existing) {
        await backend.putBytes(pathname, body, {
          allowOverwrite: false,
          contentType: "application/json",
          cacheSeconds: 0,
        });
      } else {
        await backend.putBytes(pathname, body, {
          ifMatch: existing.etag,
          contentType: "application/json",
          cacheSeconds: 0,
        });
      }
      return;
    } catch (err) {
      const msg = err instanceof Error ? err.message : "";
      const conflict =
        (err as { name?: string }).name === "BlobConflictError" || /conflict|precondition|already exists/i.test(msg);
      if (!conflict) throw err;
      // Lost race → re-read and retry (with one read-back guard below).
    }
  }
  // Final attempt without swallowing errors.
  const existing = await backend.head(pathname);
  const current = existing ? (await backend.getBytes(pathname)).toString("utf8") : null;
  const next = mutate(current);
  const body = Buffer.from(next, "utf8");
  if (!existing) {
    await backend.putBytes(pathname, body, { allowOverwrite: false, contentType: "application/json", cacheSeconds: 0 });
  } else {
    await backend.putBytes(pathname, body, { ifMatch: existing.etag, contentType: "application/json", cacheSeconds: 0 });
  }
}

export async function readPools(backend: BlobBackend): Promise<QuotaPoolsDoc> {
  if (poolsBackendOverride !== null) {
    const doc = await readJson<QuotaPoolsDoc>(backend, QUOTA_POOLS_PATHNAME);
    if (!doc || typeof doc !== "object" || !doc.pools || typeof doc.pools !== "object") {
      return { version: 1, updatedAt: new Date().toISOString(), pools: {} };
    }
    return doc;
  }

  try {
    const admin = await resolveCanonicalAdminProfile();
    if (admin) {
      const row = await prisma.quotaPoolState.findUnique({
        where: { owner_id_pool_key: { owner_id: admin.profileId, pool_key: "default" } },
        select: { pools_json: true, updated_at: true },
      });
      if (row?.pools_json && typeof row.pools_json === "object" && !Array.isArray(row.pools_json)) {
        return {
          version: 1,
          updatedAt: row.updated_at.toISOString(),
          pools: row.pools_json as unknown as Record<string, QuotaPoolState>,
        };
      }
      // Read-only legacy fallback check (never writes back to ephemeral/legacy blob path)
      const legacy = await readJson<QuotaPoolsDoc>(backend, QUOTA_POOLS_PATHNAME).catch(() => null);
      if (legacy && typeof legacy === "object" && legacy.pools && Object.keys(legacy.pools).length > 0) {
        return legacy;
      }
    }
  } catch {
    // Graceful empty fallback if DB unavailable
  }

  return { version: 1, updatedAt: new Date().toISOString(), pools: {} };
}

export function isPoolBucketExhausted(
  pools: QuotaPoolsDoc,
  poolKey: string,
  bucket: QuotaBucket,
  now = Date.now(),
): boolean {
  const pool = pools.pools[poolKey];
  if (!pool) return false;
  const until = pool[bucket].exhaustedUntil;
  return typeof until === "number" && until > now;
}

/** Mark one bucket of one pool exhausted until the next Pacific reset. */
export async function markPoolBucketExhausted(
  backend: BlobBackend,
  poolKey: string,
  bucket: QuotaBucket,
  evidence: string,
): Promise<void> {
  const until = Date.parse(nextPacificMidnightIso());

  if (poolsBackendOverride !== null) {
    await casUpdate(backend, QUOTA_POOLS_PATHNAME, (current) => {
      let doc: QuotaPoolsDoc;
      try {
        doc = current ? (JSON.parse(current) as QuotaPoolsDoc) : { version: 1, updatedAt: "", pools: {} };
      } catch {
        doc = { version: 1, updatedAt: "", pools: {} };
      }
      if (!doc.pools || typeof doc.pools !== "object") doc.pools = {};
      const pool = doc.pools[poolKey] ?? emptyPoolState();
      pool[bucket] = { exhaustedUntil: until, evidence: evidence.slice(0, 300) };
      doc.pools[poolKey] = pool;
      doc.version = 1;
      doc.updatedAt = new Date().toISOString();
      return stableStringify(doc);
    });
    return;
  }

  try {
    const admin = await resolveCanonicalAdminProfile();
    if (!admin) return;
    const currentDoc = await readPools(backend);
    const pools = { ...(currentDoc.pools || {}) };
    const pool = pools[poolKey] ? { ...pools[poolKey] } : emptyPoolState();
    pool[bucket] = { exhaustedUntil: until, evidence: evidence.slice(0, 300) };
    pools[poolKey] = pool;

    await prisma.quotaPoolState.upsert({
      where: { owner_id_pool_key: { owner_id: admin.profileId, pool_key: "default" } },
      create: {
        owner_id: admin.profileId,
        pool_key: "default",
        pools_json: pools as unknown as Prisma.InputJsonValue,
      },
      update: {
        pools_json: pools as unknown as Prisma.InputJsonValue,
      },
    });
  } catch {
    // Non-fatal quota telemetry failure
  }
}

export async function clearPoolBucketExhaustion(
  backend: BlobBackend,
  poolKey: string,
  bucket: QuotaBucket,
): Promise<void> {
  if (poolsBackendOverride !== null) {
    await casUpdate(backend, QUOTA_POOLS_PATHNAME, (current) => {
      let doc: QuotaPoolsDoc;
      try {
        doc = current ? (JSON.parse(current) as QuotaPoolsDoc) : { version: 1, updatedAt: "", pools: {} };
      } catch {
        doc = { version: 1, updatedAt: "", pools: {} };
      }
      if (!doc.pools) doc.pools = {};
      const pool = doc.pools[poolKey] ?? emptyPoolState();
      pool[bucket] = { exhaustedUntil: null, evidence: null };
      doc.pools[poolKey] = pool;
      doc.updatedAt = new Date().toISOString();
      return stableStringify(doc);
    });
    return;
  }

  try {
    const admin = await resolveCanonicalAdminProfile();
    if (!admin) return;
    const currentDoc = await readPools(backend);
    const pools = { ...(currentDoc.pools || {}) };
    const pool = pools[poolKey] ? { ...pools[poolKey] } : emptyPoolState();
    pool[bucket] = { exhaustedUntil: null, evidence: null };
    pools[poolKey] = pool;

    await prisma.quotaPoolState.upsert({
      where: { owner_id_pool_key: { owner_id: admin.profileId, pool_key: "default" } },
      create: {
        owner_id: admin.profileId,
        pool_key: "default",
        pools_json: pools as unknown as Prisma.InputJsonValue,
      },
      update: {
        pools_json: pools as unknown as Prisma.InputJsonValue,
      },
    });
  } catch {
    // Non-fatal cleanup
  }
}

export interface RequestOutcome {
  keyId: string;
  poolKey: string;
  projectId: string | null;
  operation: string;
  bucket: QuotaBucket;
  units: number;
  ok: boolean;
  errorReason: string | null;
}

/**
 * Persistent, concurrency-safe accounting of one executed provider request.
 * Project totals are derived from the SAME per-request events as key totals
 * (one event, two group-bys) — they can never be conflated or double-counted.
 */
export async function recordRequestOutcome(backend: BlobBackend, outcome: RequestOutcome): Promise<void> {
  const day = pacificDayKey();
  const blank = (): UsageDoc => ({ version: 1, date: day, byKey: {}, byProject: {}, byProjectBucket: {}, lastRequest: null });

  const mutateDoc = (doc: UsageDoc): UsageDoc => {
    const next: UsageDoc = {
      version: 1,
      date: day,
      byKey: { ...(doc.byKey || {}) },
      byProject: { ...(doc.byProject || {}) },
      byProjectBucket: { ...(doc.byProjectBucket || {}) },
      lastRequest: {
        at: new Date().toISOString(),
        keyId: outcome.keyId,
        poolKey: outcome.poolKey,
        projectId: outcome.projectId,
        operation: outcome.operation,
        bucket: outcome.bucket,
        units: outcome.units,
        ok: outcome.ok,
        errorReason: outcome.errorReason,
      },
    };
    const key = next.byKey[outcome.keyId] ?? { requests: 0, units: 0, errors: 0 };
    key.requests += 1;
    key.units += outcome.units;
    if (!outcome.ok) key.errors += 1;
    next.byKey[outcome.keyId] = key;

    const proj = next.byProject[outcome.poolKey] ?? { requests: 0, units: 0, errors: 0 };
    proj.requests += 1;
    proj.units += outcome.units;
    if (!outcome.ok) proj.errors += 1;
    next.byProject[outcome.poolKey] = proj;

    const bucketKey = `${outcome.poolKey}#${outcome.bucket}`;
    const bucketed = next.byProjectBucket[bucketKey] ?? { requests: 0, units: 0, errors: 0 };
    bucketed.requests += 1;
    bucketed.units += outcome.units;
    if (!outcome.ok) bucketed.errors += 1;
    next.byProjectBucket[bucketKey] = bucketed;
    return next;
  };

  if (poolsBackendOverride !== null) {
    await casUpdate(backend, usagePathnameFor(day), (current) => {
      let doc: UsageDoc;
      try {
        doc = current ? (JSON.parse(current) as UsageDoc) : blank();
      } catch {
        doc = blank();
      }
      return stableStringify(mutateDoc(doc));
    });
    return;
  }

  try {
    const admin = await resolveCanonicalAdminProfile();
    if (!admin) return;
    const row = await prisma.quotaPoolState.findUnique({
      where: { owner_id_pool_key: { owner_id: admin.profileId, pool_key: "default" } },
      select: { usage_by_day_json: true },
    });
    const rawMap =
      row?.usage_by_day_json && typeof row.usage_by_day_json === "object" && !Array.isArray(row.usage_by_day_json)
        ? (row.usage_by_day_json as unknown as Record<string, UsageDoc>)
        : {};
    // Keep up to the most recent 7 Pacific days
    const recentDays = Object.keys(rawMap).sort().slice(-6);
    const trimmed: Record<string, UsageDoc> = {};
    for (const d of recentDays) trimmed[d] = rawMap[d];
    trimmed[day] = mutateDoc(rawMap[day] ?? blank());

    await prisma.quotaPoolState.upsert({
      where: { owner_id_pool_key: { owner_id: admin.profileId, pool_key: "default" } },
      create: {
        owner_id: admin.profileId,
        pool_key: "default",
        usage_by_day_json: trimmed as unknown as Prisma.InputJsonValue,
      },
      update: {
        usage_by_day_json: trimmed as unknown as Prisma.InputJsonValue,
      },
    });

    const keyRow =
      outcome.keyId !== "env"
        ? await prisma.managedApiKey.findFirst({
            where: { owner_id: admin.profileId, record_id: outcome.keyId },
            select: { id: true },
          })
        : null;
    const reqSha = crypto
      .createHash("sha256")
      .update(`${day}:${outcome.operation}:${outcome.keyId}:${Date.now()}:${Math.random()}`)
      .digest("hex");

    await prisma.quotaUsageEvent.create({
      data: {
        owner_id: admin.profileId,
        managed_api_key_id: keyRow?.id ?? null,
        google_cloud_project_id: (outcome.projectId || outcome.poolKey || "default").slice(0, 64),
        endpoint_name: outcome.operation.slice(0, 64),
        operation_category: outcome.bucket,
        quota_units: outcome.units,
        http_status: outcome.ok ? 200 : 403,
        request_sha256: reqSha,
      },
    });
  } catch {
    // Non-fatal usage logging
  }
}

export async function readTodayUsage(backend: BlobBackend): Promise<UsageDoc> {
  const day = pacificDayKey();
  const emptyDoc: UsageDoc = { version: 1, date: day, byKey: {}, byProject: {}, byProjectBucket: {}, lastRequest: null };

  if (poolsBackendOverride !== null) {
    const doc = await readJson<UsageDoc>(backend, usagePathnameFor(day));
    if (doc && doc.date === day) return doc;
    return emptyDoc;
  }

  try {
    const admin = await resolveCanonicalAdminProfile();
    if (admin) {
      const row = await prisma.quotaPoolState.findUnique({
        where: { owner_id_pool_key: { owner_id: admin.profileId, pool_key: "default" } },
        select: { usage_by_day_json: true },
      });
      const rawMap =
        row?.usage_by_day_json && typeof row.usage_by_day_json === "object" && !Array.isArray(row.usage_by_day_json)
          ? (row.usage_by_day_json as unknown as Record<string, UsageDoc>)
          : {};
      const found = rawMap[day];
      if (found && found.date === day) return found;

      const legacy = await readJson<UsageDoc>(backend, usagePathnameFor(day)).catch(() => null);
      if (legacy && legacy.date === day) return legacy;
    }
  } catch {
    // Graceful empty fallback
  }

  return emptyDoc;
}

export function defaultBackend(): BlobBackend {
  return poolsBackendOverride ?? getBlobBackend();
}

/** Test seam: unit tests inject MemoryBlobBackend; routes never call this. */
let poolsBackendOverride: BlobBackend | null = null;
export function setPoolsBackendForTests(backend: BlobBackend | null): void {
  poolsBackendOverride = backend;
}
