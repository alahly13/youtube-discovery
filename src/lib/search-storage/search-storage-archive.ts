import "server-only";

import type { BlobBackend } from "../blob/blob-backend";
import { getBlobBackend } from "../blob/backend-factory";
import type { YouTubeManifest } from "@/types/manifest";
import type {
  YouTubeResultFilters,
  YouTubeSearchResourceSelection,
  YouTubeSearchSettings,
} from "@/types/youtube";
import {
  deleteRecord,
  loadRecord,
  readIndex,
  saveRecord,
  type IndexEntry,
} from "../blob/record-store";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * Saved Search History Archive — Private Vercel Blob authoritative store.
 * ──────────────────────────────────────────────────────────────────────────
 * Same exported contract as the previous disk implementation, now backed by
 * `youtube-discovery/v1/saved-history/`:
 *   - every saved search keeps its COMPLETE record (full manifest + rawJson),
 *     auto-chunked with manifest + SHA-256 when larger than 4 MiB,
 *   - one lightweight index for fast History listing (metadata only),
 *   - NO automatic expiration: records persist until the user explicitly
 *     deletes them. `expiresAt` is retained on the type as `number | null`
 *     for compatibility and is ALWAYS null for Blob records (permanent).
 *   - `clearSearchArchive` / per-record delete remain EXPLICIT user actions.
 * ═══════════════════════════════════════════════════════════════════════════
 */

export interface StoredSearchRecord {
  id: string;
  title: string;
  query: string;
  resourceSelection: YouTubeSearchResourceSelection;
  settings: YouTubeSearchSettings;
  filters?: YouTubeResultFilters;
  manifest: YouTubeManifest; // COMPLETE manifest with all items & rawJson preserved!
  createdAt: string; // ISO string
  searchedAt: number; // Unix timestamp in ms
  /** Always null for Blob records: permanent until explicit user deletion. */
  expiresAt: number | null;
}

export interface StoredSearchMetadata {
  id: string;
  title: string;
  query: string;
  resourceSelection: YouTubeSearchResourceSelection;
  settings: Partial<YouTubeSearchSettings>;
  itemCount: number;
  videoCount?: number;
  channelCount?: number;
  playlistCount?: number;
  quotaCostEstimate?: number;
  status: "complete" | "failed" | "partial" | "empty";
  createdAt: string;
  searchedAt: number;
  /** Always null for Blob records: permanent until explicit user deletion. */
  expiresAt: number | null;
  topThumbnails?: string[];
}

const NAMESPACE = "savedHistory" as const;

function backend(): BlobBackend {
  return getBlobBackend();
}

function entryToMetadata(entry: IndexEntry): StoredSearchMetadata | null {
  const m = entry.meta;
  if (!m || typeof m !== "object") return null;
  const r = m as unknown as StoredSearchMetadata;
  if (typeof r.id !== "string" || typeof r.query !== "string") return null;
  return { ...r, expiresAt: null };
}

function buildMetadata(input: {
  id: string;
  title: string;
  query: string;
  resourceSelection: YouTubeSearchResourceSelection;
  settings: YouTubeSearchSettings;
  manifest: YouTubeManifest;
  createdAt: string;
  searchedAt: number;
}): StoredSearchMetadata {
  const items = input.manifest.normalizedItems ?? [];
  const videoCount = items.filter((i) => i.itemType === "video" || i.itemType === "shorts_like").length;
  const channelCount = items.filter((i) => i.itemType === "channel").length;
  const playlistCount = items.filter((i) => i.itemType === "playlist").length;
  const topThumbnails = items
    .map((i) => i.thumbnailUrl)
    .filter((t): t is string => Boolean(t))
    .slice(0, 4);
  return {
    id: input.id,
    title: input.title,
    query: input.query.trim(),
    resourceSelection: input.resourceSelection,
    settings: { ...input.settings },
    itemCount: input.manifest.itemCount ?? items.length,
    videoCount,
    channelCount,
    playlistCount,
    quotaCostEstimate: input.manifest.quotaCostEstimate,
    status:
      (input.manifest.itemCount ?? items.length) === 0
        ? "empty"
        : (["complete", "failed", "partial", "empty"] as const).includes(
              input.manifest.status as "complete" | "failed" | "partial" | "empty",
            )
          ? (input.manifest.status as "complete" | "failed" | "partial" | "empty")
          : "complete",
    createdAt: input.createdAt,
    searchedAt: input.searchedAt,
    expiresAt: null,
    topThumbnails,
  };
}

/** Lists saved searches, newest first. No expiry sweep — records are permanent. */
export async function listSearchArchiveIndex(): Promise<StoredSearchMetadata[]> {
  const index = await readIndex(backend(), NAMESPACE);
  return index.entries
    .map(entryToMetadata)
    .filter((e): e is StoredSearchMetadata => e !== null)
    .sort((a, b) => b.searchedAt - a.searchedAt);
}

/**
 * Saves a COMPLETE search record (idempotent by id: retries with the same id
 * update rather than duplicate). Reports success only after read-back.
 */
export async function saveSearchToArchive(payload: {
  id?: string;
  query: string;
  resourceSelection: YouTubeSearchResourceSelection;
  settings: YouTubeSearchSettings;
  filters?: YouTubeResultFilters;
  manifest: YouTubeManifest;
  title?: string;
}): Promise<StoredSearchRecord> {
  const now = Date.now();
  const id = payload.id || `search-${now}-${Math.random().toString(36).slice(2, 8)}`;
  const record: StoredSearchRecord = {
    id,
    title: (payload.title ?? payload.query).trim(),
    query: payload.query.trim(),
    resourceSelection: payload.resourceSelection,
    settings: { ...payload.settings },
    filters: payload.filters ? { ...payload.filters } : undefined,
    manifest: payload.manifest,
    createdAt: new Date(now).toISOString(),
    searchedAt: now,
    expiresAt: null,
  };
  const metadata = buildMetadata({ ...record });
  await saveRecord(backend(), NAMESPACE, id, record, {
    ...(metadata as unknown as Record<string, unknown>),
  });
  return record;
}

/** Retrieves the full record by ID. Null when missing or unreadable. */
export async function getSearchFromArchive(id: string): Promise<StoredSearchRecord | null> {
  try {
    const record = await loadRecord<StoredSearchRecord>(backend(), NAMESPACE, id);
    if (!record || record.id !== id || !record.manifest) return null;
    return { ...record, expiresAt: null };
  } catch {
    return null;
  }
}

/** Most recently saved record (index-ordered; no latest.json pointer needed). */
export async function getLatestSearchFromArchive(): Promise<StoredSearchRecord | null> {
  const items = await listSearchArchiveIndex();
  if (items.length === 0) return null;
  // Walk newest-first; skip any entry whose payload is unreadable.
  for (const meta of items) {
    const full = await getSearchFromArchive(meta.id);
    if (full) return full;
  }
  return null;
}

/** Explicit user deletion: removes the record and all its chunks. */
export async function deleteSearchFromArchive(id: string): Promise<boolean> {
  return deleteRecord(backend(), NAMESPACE, id);
}

/** Explicit user action: removes EVERYTHING in saved-history (verified). */
export async function clearSearchArchive(): Promise<void> {
  const index = await readIndex(backend(), NAMESPACE);
  for (const entry of index.entries) {
    await deleteRecord(backend(), NAMESPACE, entry.id).catch(() => {});
  }
}

/**
 * Retention compatibility shim: Blob records never expire, so there is
 * nothing to prune. Kept so existing callers need no changes.
 */
export async function cleanupExpiredSearches(): Promise<number> {
  const index = await readIndex(backend(), NAMESPACE);
  return index.entries.length;
}

/** TTL metadata for client telemetry: Blob history is permanent. */
export function getArchiveTtlInfo() {
  return {
    ttlHours: null as number | null,
    ttlMs: null as number | null,
    permanent: true as const,
  };
}
