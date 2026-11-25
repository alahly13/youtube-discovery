"use client";

import {
  IDB_STORES,
  createReadWriteTransaction,
  openLocalDatabase,
} from "@/lib/storage/indexeddb-store";

function resolveLocalOwnerId(): string {
  if (typeof window === "undefined") return "__local_default__";
  try {
    return (
      window.localStorage.getItem("yt-discovery-active-owner")?.trim() ||
      "__local_default__"
    );
  } catch {
    return "__local_default__";
  }
}
import { applyYouTubeResultPipeline } from "@/lib/filters/youtube-result-filters";
import type {
  YouTubeManifest,
  YouTubeManifestSummary,
  YouTubeManifestType,
} from "@/types/manifest";
import type {
  NormalizedYouTubeDiscoveryItem,
  YouTubeResultFilters,
} from "@/types/youtube";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * Local-First Temporary Manifest Store — IndexedDB Primary Persistence
 * ──────────────────────────────────────────────────────────────────────────
 * Architecture Classification:
 *   - Class A (Temporary Processing Manifests): Active search results,
 *     channel upload pagination, playlist exploration manifests, checkpoints,
 *     and filter states live locally in IndexedDB (`temp_manifests` inside
 *     `youtube_discovery_local_v1`). They are NEVER uploaded to R2 unless the
 *     user explicitly saves items into Class B durable datasets.
 *   - Class B (Durable Saved Datasets): Stored via Outbox -> `/api/sync/save-all`
 *     -> Cloudflare R2 + PostgreSQL.
 *
 * Vercel Serverless Multi-Instance Fix:
 *   Previously, temporary manifests lived only in Node `globalThis` memory
 *   (`manifest-memory-store.ts`), causing `/manifests`, `/manifests/[id]`,
 *   and `/filter` to fail with 404 across serverless instances and lose state on
 *   page reload. Persisting them locally in IndexedDB keeps processing fast,
 *   private, offline-capable, and free of unnecessary Vercel/R2 load.
 *
 * Future-agent warning:
 *   - Never evict or mutate durable Class-B stores when pruning `temp_manifests`.
 *   - Never mark a manifest `saved: true` before an authoritative commit response.
 * ═══════════════════════════════════════════════════════════════════════════
 */

export const TEMP_MANIFEST_SCHEMA_VERSION = 1;
export const DEFAULT_TEMP_MANIFEST_TTL_MS = 14 * 24 * 60 * 60 * 1000; // 14 days
export const MAX_LOCAL_TEMP_MANIFESTS = 60;

export type TempManifestLifecycleState =
  | "PENDING"
  | "PROCESSING"
  | "COMPLETED"
  | "FAILED"
  | "SYNC_PENDING";

export interface TempManifestCheckpoint {
  pageToken: string | null;
  pagesFetched: number;
  totalItemsCollected: number;
  updatedAt: string;
}

export interface LocalTempManifestRecord {
  manifestId: string;
  schemaVersion: number;
  ownerId: string;
  manifestType: YouTubeManifestType;
  lifecycleState: TempManifestLifecycleState;
  checkpoint: TempManifestCheckpoint;
  saved: boolean;
  manifest: YouTubeManifest;
  createdAt: number;
  updatedAt: number;
  expiresAt: number;
}

// Graceful fallback when IndexedDB is unavailable (e.g., restricted incognito contexts)
const volatileFallbackMap = new Map<string, LocalTempManifestRecord>();

export function deriveManifestLifecycleState(
  manifest: YouTubeManifest,
  explicitState?: TempManifestLifecycleState
): TempManifestLifecycleState {
  if (explicitState) return explicitState;
  switch (manifest.status) {
    case "draft":
      return "PENDING";
    case "running":
    case "stopped":
      return "PROCESSING";
    case "partial":
      return manifest.nextPageToken ? "PROCESSING" : "COMPLETED";
    case "failed":
    case "quota_limited":
    case "provider_limited":
      return "FAILED";
    default:
      return "COMPLETED";
  }
}

function toRecord(
  manifest: YouTubeManifest,
  options?: {
    ownerId?: string;
    lifecycleState?: TempManifestLifecycleState;
    saved?: boolean;
    ttlMs?: number;
    existingCreatedAt?: number;
  }
): LocalTempManifestRecord {
  const now = Date.now();
  const ownerId = options?.ownerId || resolveLocalOwnerId();
  const ttlMs = Math.max(60_000, options?.ttlMs ?? DEFAULT_TEMP_MANIFEST_TTL_MS);
  const createdMs =
    options?.existingCreatedAt ??
    (Number.isFinite(Date.parse(manifest.createdAt)) ? Date.parse(manifest.createdAt) : now);

  return {
    manifestId: manifest.manifestId,
    schemaVersion: TEMP_MANIFEST_SCHEMA_VERSION,
    ownerId,
    manifestType: manifest.manifestType,
    lifecycleState: deriveManifestLifecycleState(manifest, options?.lifecycleState),
    checkpoint: {
      pageToken: manifest.nextPageToken ?? null,
      pagesFetched: manifest.pagesFetched ?? 1,
      totalItemsCollected: manifest.totalItemsCollected ?? manifest.itemCount ?? 0,
      updatedAt: manifest.collectedAt || new Date(now).toISOString(),
    },
    saved: options?.saved ?? Boolean(manifest.saved),
    manifest: {
      ...manifest,
      saved: options?.saved ?? Boolean(manifest.saved),
    },
    createdAt: createdMs,
    updatedAt: now,
    expiresAt: now + ttlMs,
  };
}

function isQuotaExceededError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { name?: string; code?: number };
  return (
    e.name === "QuotaExceededError" ||
    e.name === "NS_ERROR_DOM_QUOTA_REACHED" ||
    e.code === 22 ||
    e.code === 1014
  );
}

/**
 * Migrate any legacy localStorage workspace manifest/lastSearch snapshots once
 * into IndexedDB so reloading users retain seamless continuity.
 */
let legacyBackfillAttempted = false;
async function ensureLegacyLocalManifestsMigrated(): Promise<void> {
  if (legacyBackfillAttempted || typeof window === "undefined") return;
  legacyBackfillAttempted = true;

  try {
    const raw = window.localStorage.getItem("youtube-discovery-workspace");
    if (!raw) return;
    const parsed = JSON.parse(raw) as {
      state?: {
        currentManifest?: YouTubeManifest | null;
        lastSearch?: { manifest?: YouTubeManifest | null } | null;
      };
    };
    const candidates: YouTubeManifest[] = [];
    if (parsed?.state?.currentManifest?.manifestId) {
      candidates.push(parsed.state.currentManifest);
    }
    if (parsed?.state?.lastSearch?.manifest?.manifestId) {
      candidates.push(parsed.state.lastSearch.manifest);
    }
    if (candidates.length === 0) return;

    const db = await openLocalDatabase();
    for (const m of candidates) {
      const existing = await readRecordDirect(db, m.manifestId);
      if (!existing) {
        const rec = toRecord(m);
        await writeRecordDirect(db, rec);
      }
    }
  } catch {
    // Non-fatal: legacy migration must never interrupt normal reading
  }
}

async function readRecordDirect(
  db: IDBDatabase,
  manifestId: string
): Promise<LocalTempManifestRecord | null> {
  if (!db.objectStoreNames.contains(IDB_STORES.TEMP_MANIFESTS)) {
    return volatileFallbackMap.get(manifestId) ?? null;
  }
  return new Promise((resolve, reject) => {
    const tx = db.transaction([IDB_STORES.TEMP_MANIFESTS], "readonly");
    const req = tx.objectStore(IDB_STORES.TEMP_MANIFESTS).get(manifestId);
    req.onsuccess = () => resolve((req.result as LocalTempManifestRecord) || null);
    req.onerror = () => reject(req.error || new Error("Failed reading local temp manifest."));
  });
}

async function readAllRecordsDirect(db: IDBDatabase): Promise<LocalTempManifestRecord[]> {
  if (!db.objectStoreNames.contains(IDB_STORES.TEMP_MANIFESTS)) {
    return Array.from(volatileFallbackMap.values());
  }
  return new Promise((resolve, reject) => {
    const tx = db.transaction([IDB_STORES.TEMP_MANIFESTS], "readonly");
    const req = tx.objectStore(IDB_STORES.TEMP_MANIFESTS).getAll();
    req.onsuccess = () => resolve((req.result as LocalTempManifestRecord[]) || []);
    req.onerror = () => reject(req.error || new Error("Failed listing local temp manifests."));
  });
}

async function writeRecordDirect(
  db: IDBDatabase,
  record: LocalTempManifestRecord
): Promise<void> {
  if (!db.objectStoreNames.contains(IDB_STORES.TEMP_MANIFESTS)) {
    volatileFallbackMap.set(record.manifestId, record);
    return;
  }
  return new Promise((resolve, reject) => {
    const tx = createReadWriteTransaction(db, [IDB_STORES.TEMP_MANIFESTS]);
    tx.objectStore(IDB_STORES.TEMP_MANIFESTS).put(record);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error("Failed persisting local temp manifest."));
  });
}

async function pruneOldestTempManifests(
  db: IDBDatabase,
  keepAtMost: number
): Promise<void> {
  if (!db.objectStoreNames.contains(IDB_STORES.TEMP_MANIFESTS)) return;
  const all = await readAllRecordsDirect(db);
  const now = Date.now();
  const expired = all.filter((r) => r.expiresAt <= now && !r.saved);
  const unsavedOverflow = all
    .filter((r) => r.expiresAt > now && !r.saved)
    .sort((a, b) => a.updatedAt - b.updatedAt);

  const toDeleteIds = new Set<string>(expired.map((r) => r.manifestId));
  const remainingCount = all.length - toDeleteIds.size;
  if (remainingCount > keepAtMost) {
    const excess = remainingCount - keepAtMost;
    for (const r of unsavedOverflow.slice(0, excess)) {
      toDeleteIds.add(r.manifestId);
    }
  }

  if (toDeleteIds.size === 0) return;

  await new Promise<void>((resolve, reject) => {
    const tx = createReadWriteTransaction(db, [IDB_STORES.TEMP_MANIFESTS]);
    const store = tx.objectStore(IDB_STORES.TEMP_MANIFESTS);
    for (const id of toDeleteIds) {
      store.delete(id);
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error("Failed pruning temp manifests."));
  });
}

/**
 * Persist or checkpoint a Class-A temporary processing manifest in IndexedDB.
 * Safe for repeated pagination updates (zero Vercel/R2 load).
 */
export async function persistTempManifestLocally(
  manifest: YouTubeManifest,
  options?: {
    ownerId?: string;
    lifecycleState?: TempManifestLifecycleState;
    saved?: boolean;
    ttlMs?: number;
  }
): Promise<LocalTempManifestRecord> {
  let existingCreatedAt: number | undefined;
  let existingSaved = false;

  if (typeof window === "undefined") {
    const rec = toRecord(manifest, options);
    volatileFallbackMap.set(rec.manifestId, rec);
    return rec;
  }

  try {
    const db = await openLocalDatabase();
    const existing = await readRecordDirect(db, manifest.manifestId).catch(() => null);
    if (existing) {
      existingCreatedAt = existing.createdAt;
      existingSaved = existing.saved;
    }

    const record = toRecord(manifest, {
      ...options,
      saved: options?.saved ?? (existingSaved || Boolean(manifest.saved)),
      existingCreatedAt,
    });
    volatileFallbackMap.set(record.manifestId, record);

    try {
      await writeRecordDirect(db, record);
      void pruneOldestTempManifests(db, MAX_LOCAL_TEMP_MANIFESTS).catch(() => {});
    } catch (err) {
      if (isQuotaExceededError(err)) {
        // Free space by pruning only transient unsaved temp manifests; never touch durable datasets.
        await pruneOldestTempManifests(db, 10);
        await writeRecordDirect(db, record);
      } else {
        throw err;
      }
    }

    return record;
  } catch {
    const rec = toRecord(manifest, options);
    volatileFallbackMap.set(rec.manifestId, rec);
    return rec;
  }
}

export async function getLocalTempManifestRecord(
  manifestId: string
): Promise<LocalTempManifestRecord | null> {
  if (!manifestId) return null;
  if (typeof window === "undefined") {
    return volatileFallbackMap.get(manifestId) ?? null;
  }

  await ensureLegacyLocalManifestsMigrated();

  try {
    const db = await openLocalDatabase();
    const found = await readRecordDirect(db, manifestId);
    if (found) {
      volatileFallbackMap.set(manifestId, found);
      return found;
    }
  } catch {
    // Graceful fallback when IDB unavailable
  }

  return volatileFallbackMap.get(manifestId) ?? null;
}

export async function getLocalTempManifest(
  manifestId: string
): Promise<YouTubeManifest | null> {
  const rec = await getLocalTempManifestRecord(manifestId);
  return rec?.manifest ?? null;
}

export async function listLocalTempManifests(options?: {
  ownerId?: string;
}): Promise<YouTubeManifestSummary[]> {
  if (typeof window === "undefined") {
    return Array.from(volatileFallbackMap.values())
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map(toSummary);
  }

  await ensureLegacyLocalManifestsMigrated();

  const records = new Map<string, LocalTempManifestRecord>();
  for (const r of volatileFallbackMap.values()) {
    records.set(r.manifestId, r);
  }

  try {
    const db = await openLocalDatabase();
    const idbRecords = await readAllRecordsDirect(db);
    const activeOwner = options?.ownerId ?? resolveLocalOwnerId();
    for (const r of idbRecords) {
      // Include current owner records and unscoped local records seamlessly
      if (!activeOwner || r.ownerId === activeOwner || r.ownerId === "__local_default__") {
        records.set(r.manifestId, r);
      }
    }
  } catch {
    // Graceful fallback
  }

  return Array.from(records.values())
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .map(toSummary);
}

export async function deleteLocalTempManifest(manifestId: string): Promise<void> {
  volatileFallbackMap.delete(manifestId);
  if (typeof window === "undefined") return;
  try {
    const db = await openLocalDatabase();
    if (!db.objectStoreNames.contains(IDB_STORES.TEMP_MANIFESTS)) return;
    await new Promise<void>((resolve, reject) => {
      const tx = createReadWriteTransaction(db, [IDB_STORES.TEMP_MANIFESTS]);
      tx.objectStore(IDB_STORES.TEMP_MANIFESTS).delete(manifestId);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error("Failed deleting temp manifest."));
    });
  } catch {
    // Non-fatal cache cleanup
  }
}

/**
 * Mark local manifest lifecycle / saved confirmation strictly after authoritative commit succeeds.
 */
export async function markTempManifestSyncState(
  manifestId: string,
  lifecycleState: TempManifestLifecycleState,
  saved: boolean
): Promise<LocalTempManifestRecord | null> {
  const current = await getLocalTempManifestRecord(manifestId);
  if (!current) return null;
  return persistTempManifestLocally(
    {
      ...current.manifest,
      saved,
    },
    {
      ownerId: current.ownerId,
      lifecycleState,
      saved,
    }
  );
}

/**
 * Client-side local filtering over a stored YouTubeManifest (zero Vercel requests).
 */
export function filterLocalTempManifest(
  manifest: YouTubeManifest,
  filters: YouTubeResultFilters
): { items: NormalizedYouTubeDiscoveryItem[]; count: number } {
  const sourceItems = manifest.normalizedItems ?? manifest.items ?? [];
  const items = applyYouTubeResultPipeline(sourceItems, filters);
  return { items, count: items.length };
}

function toSummary(record: LocalTempManifestRecord): YouTubeManifestSummary {
  const m = record.manifest;
  return {
    manifestId: m.manifestId,
    manifestType: m.manifestType,
    title: m.title,
    status: m.status,
    itemCount: m.itemCount,
    quotaCostEstimate: m.quotaCostEstimate,
    collectedAt: m.collectedAt,
    saved: record.saved || Boolean(m.saved),
  };
}
