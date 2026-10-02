import "server-only";

import fs from "node:fs/promises";
import path from "node:path";
import type { YouTubeManifest } from "@/types/manifest";
import type {
  YouTubeResultFilters,
  YouTubeSearchResourceSelection,
  YouTubeSearchSettings,
} from "@/types/youtube";
import {
  calculateExpirationTimestamp,
  getSearchStorageTtlHours,
  getSearchStorageTtlMs,
  isSearchExpired,
} from "@/lib/config/search-storage-config";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * Search Storage Archive — Server-side File Archive
 * ──────────────────────────────────────────────────────────────────────────
 * Preserves the COMPLETE search object, including all items and complete
 * `rawJson` data. Every search has its own dedicated record file.
 *
 * A lightweight index file (`index.json`) is maintained for fast listing
 * and client-friendly filtering on the History page without loading huge
 * payloads.
 *
 * Configurable TTL (default 168 hours = 7 days) governs automatic cleanup.
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
  expiresAt: number; // Unix timestamp in ms = searchedAt + TTL_MS
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
  expiresAt: number;
  topThumbnails?: string[];
}

const SEARCHES_DIR = path.join(process.cwd(), "data", "searches");
const INDEX_FILE = path.join(SEARCHES_DIR, "index.json");
const LATEST_FILE = path.join(SEARCHES_DIR, "latest.json");

/**
 * Ensures the search storage archive directory exists.
 */
async function ensureStorageDir(): Promise<void> {
  try {
    await fs.mkdir(SEARCHES_DIR, { recursive: true });
  } catch {
    // Ignore already exists
  }
}

/**
 * Reads the lightweight index, automatically pruning expired search records.
 */
export async function listSearchArchiveIndex(): Promise<StoredSearchMetadata[]> {
  await ensureStorageDir();
  try {
    const raw = await fs.readFile(INDEX_FILE, "utf-8");
    const list = JSON.parse(raw) as StoredSearchMetadata[];
    if (!Array.isArray(list)) return [];

    const now = Date.now();
    const active: StoredSearchMetadata[] = [];
    const expiredIds: string[] = [];

    for (const item of list) {
      if (item.expiresAt && now >= item.expiresAt) {
        expiredIds.push(item.id);
      } else {
        active.push(item);
      }
    }

    // Delete expired search files in background if any found
    if (expiredIds.length > 0) {
      void Promise.allSettled(
        expiredIds.map((id) => fs.unlink(path.join(SEARCHES_DIR, `${id}.json`)).catch(() => {})),
      );
      // Persist pruned index
      await fs.writeFile(INDEX_FILE, JSON.stringify(active, null, 2), "utf-8").catch(() => {});
    }

    return active.sort((a, b) => b.searchedAt - a.searchedAt);
  } catch {
    return [];
  }
}

/**
 * Saves a COMPLETE search record into its own dedicated file and updates the lightweight index.
 * ZERO sanitization or data stripping: complete rawJson and manifest metadata are preserved.
 */
export async function saveSearchToArchive(payload: {
  id?: string;
  query: string;
  resourceSelection: YouTubeSearchResourceSelection;
  settings: YouTubeSearchSettings;
  filters?: YouTubeResultFilters;
  manifest: YouTubeManifest;
}): Promise<StoredSearchRecord> {
  await ensureStorageDir();

  const now = Date.now();
  const expiresAt = calculateExpirationTimestamp(now);
  const id = payload.id || `search-${now}-${Math.random().toString(36).slice(2, 8)}`;
  const title = payload.query.trim();

  // Create complete record with NO fields stripped
  const record: StoredSearchRecord = {
    id,
    title,
    query: payload.query.trim(),
    resourceSelection: payload.resourceSelection,
    settings: { ...payload.settings },
    filters: payload.filters ? { ...payload.filters } : undefined,
    manifest: payload.manifest, // Full manifest including all items and rawJson
    createdAt: new Date(now).toISOString(),
    searchedAt: now,
    expiresAt,
  };

  // 1. Write the full search record file
  const recordFilePath = path.join(SEARCHES_DIR, `${id}.json`);
  await fs.writeFile(recordFilePath, JSON.stringify(record, null, 2), "utf-8");

  // 2. Also update latest.json for instant restoration on search workspace
  await fs.writeFile(LATEST_FILE, JSON.stringify(record, null, 2), "utf-8").catch(() => {});

  // 3. Extract lightweight metadata for index
  const items = payload.manifest.normalizedItems ?? [];
  const videoCount = items.filter((i) => i.itemType === "video" || i.itemType === "shorts_like").length;
  const channelCount = items.filter((i) => i.itemType === "channel").length;
  const playlistCount = items.filter((i) => i.itemType === "playlist").length;
  const topThumbnails = items
    .map((i) => i.thumbnailUrl)
    .filter((t): t is string => Boolean(t))
    .slice(0, 4);

  const metadata: StoredSearchMetadata = {
    id,
    title,
    query: payload.query.trim(),
    resourceSelection: payload.resourceSelection,
    settings: { ...payload.settings },
    itemCount: payload.manifest.itemCount ?? items.length,
    videoCount,
    channelCount,
    playlistCount,
    quotaCostEstimate: payload.manifest.quotaCostEstimate,
    status:
      (payload.manifest.itemCount ?? items.length) === 0
        ? "empty"
        : (["complete", "failed", "partial", "empty"] as const).includes(
              payload.manifest.status as "complete" | "failed" | "partial" | "empty",
            )
          ? (payload.manifest.status as "complete" | "failed" | "partial" | "empty")
          : "complete",
    createdAt: record.createdAt,
    searchedAt: now,
    expiresAt,
    topThumbnails,
  };

  // 4. Update the index file
  try {
    const existingIndex = await listSearchArchiveIndex();
    const updatedIndex = [metadata, ...existingIndex.filter((item) => item.id !== id)];
    await fs.writeFile(INDEX_FILE, JSON.stringify(updatedIndex, null, 2), "utf-8");
  } catch {
    await fs.writeFile(INDEX_FILE, JSON.stringify([metadata], null, 2), "utf-8").catch(() => {});
  }

  return record;
}

/**
 * Retrieves the full search record by ID from the archive.
 * Returns null if missing or expired.
 */
export async function getSearchFromArchive(id: string): Promise<StoredSearchRecord | null> {
  await ensureStorageDir();
  const filePath = path.join(SEARCHES_DIR, `${id}.json`);

  try {
    const raw = await fs.readFile(filePath, "utf-8");
    const record = JSON.parse(raw) as StoredSearchRecord;

    if (isSearchExpired(record.searchedAt, record.expiresAt)) {
      // Auto-cleanup expired record
      await fs.unlink(filePath).catch(() => {});
      return null;
    }

    return record;
  } catch {
    return null;
  }
}

/**
 * Retrieves the latest search record from the archive.
 * Returns null if missing or expired.
 */
export async function getLatestSearchFromArchive(): Promise<StoredSearchRecord | null> {
  await ensureStorageDir();

  // Try reading latest.json first
  try {
    const raw = await fs.readFile(LATEST_FILE, "utf-8");
    const record = JSON.parse(raw) as StoredSearchRecord;

    if (!isSearchExpired(record.searchedAt, record.expiresAt)) {
      return record;
    }
  } catch {
    // Fall back to scanning the index
  }

  const index = await listSearchArchiveIndex();
  if (index.length === 0) return null;

  for (const meta of index) {
    const full = await getSearchFromArchive(meta.id);
    if (full) {
      // Update latest.json
      await fs.writeFile(LATEST_FILE, JSON.stringify(full, null, 2), "utf-8").catch(() => {});
      return full;
    }
  }

  return null;
}

/**
 * Deletes a search record from disk and updates the index.
 */
export async function deleteSearchFromArchive(id: string): Promise<boolean> {
  await ensureStorageDir();
  try {
    await fs.unlink(path.join(SEARCHES_DIR, `${id}.json`)).catch(() => {});
    const index = await listSearchArchiveIndex();
    const updated = index.filter((item) => item.id !== id);
    await fs.writeFile(INDEX_FILE, JSON.stringify(updated, null, 2), "utf-8");
    return true;
  } catch {
    return false;
  }
}

/**
 * Clears all stored search records and the index from the archive.
 */
export async function clearSearchArchive(): Promise<void> {
  await ensureStorageDir();
  try {
    const files = await fs.readdir(SEARCHES_DIR);
    await Promise.allSettled(
      files.map((file) => fs.unlink(path.join(SEARCHES_DIR, file)).catch(() => {})),
    );
  } catch {
    // Ignore error
  }
}

/**
 * Prunes expired search files from disk based on configured TTL.
 */
export async function cleanupExpiredSearches(): Promise<number> {
  await ensureStorageDir();
  const index = await listSearchArchiveIndex();
  // listSearchArchiveIndex already prunes expired entries and unlinks their files
  return index.length;
}

/**
 * Exposes active TTL metadata for client telemetry.
 */
export function getArchiveTtlInfo() {
  return {
    ttlHours: getSearchStorageTtlHours(),
    ttlMs: getSearchStorageTtlMs(),
  };
}
