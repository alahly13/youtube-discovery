import "server-only";

import type { BlobBackend } from "../blob/blob-backend";
import { getBlobBackend } from "../blob/backend-factory";
import { stableStringify } from "../blob/record-format";

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
  const doc = await readJson<QuotaPoolsDoc>(backend, QUOTA_POOLS_PATHNAME);
  if (!doc || typeof doc !== "object" || !doc.pools || typeof doc.pools !== "object") {
    return { version: 1, updatedAt: new Date().toISOString(), pools: {} };
  }
  return doc;
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
}

export async function clearPoolBucketExhaustion(
  backend: BlobBackend,
  poolKey: string,
  bucket: QuotaBucket,
): Promise<void> {
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
  await casUpdate(backend, usagePathnameFor(day), (current) => {
    const blank = (): UsageDoc => ({ version: 1, date: day, byKey: {}, byProject: {}, byProjectBucket: {}, lastRequest: null });
    let doc: UsageDoc;
    try {
      doc = current ? (JSON.parse(current) as UsageDoc) : blank();
    } catch {
      doc = blank();
    }
    if (!doc.byKey) doc.byKey = {};
    if (!doc.byProject) doc.byProject = {};
    if (!doc.byProjectBucket) doc.byProjectBucket = {};
    const key = doc.byKey[outcome.keyId] ?? { requests: 0, units: 0, errors: 0 };
    key.requests += 1;
    key.units += outcome.units;
    if (!outcome.ok) key.errors += 1;
    doc.byKey[outcome.keyId] = key;
    const proj = doc.byProject[outcome.poolKey] ?? { requests: 0, units: 0, errors: 0 };
    proj.requests += 1;
    proj.units += outcome.units;
    if (!outcome.ok) proj.errors += 1;
    doc.byProject[outcome.poolKey] = proj;
    const bucketKey = `${outcome.poolKey}#${outcome.bucket}`;
    const bucketed = doc.byProjectBucket[bucketKey] ?? { requests: 0, units: 0, errors: 0 };
    bucketed.requests += 1;
    bucketed.units += outcome.units;
    if (!outcome.ok) bucketed.errors += 1;
    doc.byProjectBucket[bucketKey] = bucketed;
    doc.lastRequest = {
      at: new Date().toISOString(),
      keyId: outcome.keyId,
      poolKey: outcome.poolKey,
      projectId: outcome.projectId,
      operation: outcome.operation,
      bucket: outcome.bucket,
      units: outcome.units,
      ok: outcome.ok,
      errorReason: outcome.errorReason,
    };
    doc.date = day;
    return stableStringify(doc);
  });
}

export async function readTodayUsage(backend: BlobBackend): Promise<UsageDoc> {
  const day = pacificDayKey();
  const doc = await readJson<UsageDoc>(backend, usagePathnameFor(day));
  if (doc && doc.date === day) return doc;
  return { version: 1, date: day, byKey: {}, byProject: {}, byProjectBucket: {}, lastRequest: null };
}

export function defaultBackend(): BlobBackend {
  return poolsBackendOverride ?? getBlobBackend();
}

/** Test seam: unit tests inject MemoryBlobBackend; routes never call this. */
let poolsBackendOverride: BlobBackend | null = null;
export function setPoolsBackendForTests(backend: BlobBackend | null): void {
  poolsBackendOverride = backend;
}
