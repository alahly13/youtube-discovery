import "server-only";

import fs from "node:fs/promises";
import path from "node:path";
import type { BlobBackend } from "../blob/blob-backend";
import { loadRecord, readIndex, saveRecord } from "../blob/record-store";
import { recordPathname } from "../blob/blob-paths";
import { toIndexEntry } from "../playlists/playlist-archive";
import type { UserPlaylistManifest } from "@/types/library";
import { userPlaylistManifestSchema } from "../validation/library-schemas";
import type { StoredSearchRecord } from "../search-storage/search-storage-archive";
import {
  importManagedKeys,
  legacyPlainKeyToStored,
  type StoredManagedKey,
} from "../platforms/youtube/youtube-api-keys";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * Disk → Blob Migration — one-time, idempotent, verified, resumable.
 * ──────────────────────────────────────────────────────────────────────────
 * Imports the three in-scope categories from their legacy disk locations:
 *   data/playlists/*.json   → youtube-discovery/v1/playlists/
 *   data/searches/<id>.json → youtube-discovery/v1/saved-history/
 *   data/keys/api-keys.json → youtube-discovery/v1/api-keys/state.json (encrypted)
 * - Stable IDs make every import idempotent: re-running skips records that
 *   already exist in Blob (no duplicates), and resumes after interruption.
 * - Large records flow through the standard chunked saveRecord() path.
 * - Every imported record is read back from Blob and compared before it
 *   counts as imported. Failures are reported per record — never silent.
 * - Original disk files are LEFT IN PLACE (never deleted by migration).
 * - Browser-local data (Zustand savedSearches titles) migrates through the
 *   client→server migration endpoint in small batches (see
 *   /api/admin/migrate); only in-scope records are accepted.
 * ═══════════════════════════════════════════════════════════════════════════
 */

export interface MigrationCounts {
  imported: number;
  skipped: number;
  failed: number;
  errors: Array<{ id: string; error: string }>;
}

function newCounts(): MigrationCounts {
  return { imported: 0, skipped: 0, failed: 0, errors: [] };
}

async function listJsonFiles(dir: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(dir);
    return entries.filter((f) => f.endsWith(".json") && f !== "index.json" && f !== "latest.json");
  } catch {
    return [];
  }
}

export async function migratePlaylistsFromDisk(backend: BlobBackend): Promise<MigrationCounts> {
  const counts = newCounts();
  const dir = path.join(process.cwd(), "data", "playlists");
  const existing = await readIndex(backend, "playlists").catch(() => ({ entries: [] as never[] }));
  const known = new Set((existing.entries as Array<{ id: string }>).map((e) => e.id));
  for (const file of await listJsonFiles(dir)) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(await fs.readFile(path.join(dir, file), "utf-8"));
    } catch {
      counts.failed += 1;
      counts.errors.push({ id: file, error: "Unreadable disk file" });
      continue;
    }
    const check = userPlaylistManifestSchema.safeParse(parsed);
    if (!check.success) {
      counts.failed += 1;
      counts.errors.push({ id: file, error: "Disk manifest failed validation" });
      continue;
    }
    const manifest = check.data as unknown as UserPlaylistManifest;
    if (known.has(manifest.playlist.id)) {
      counts.skipped += 1;
      continue;
    }
    try {
      const indexEntry = toIndexEntry(manifest, recordPathname("playlists", manifest.playlist.id));
      await saveRecord(backend, "playlists", manifest.playlist.id, manifest, {
        ...(indexEntry as unknown as Record<string, unknown>),
      });
      const back = await loadRecord<UserPlaylistManifest>(backend, "playlists", manifest.playlist.id);
      if (back.playlist.id !== manifest.playlist.id || back.items.length !== manifest.items.length) {
        throw new Error("Read-back mismatch");
      }
      known.add(manifest.playlist.id);
      counts.imported += 1;
    } catch (err) {
      counts.failed += 1;
      counts.errors.push({ id: manifest.playlist.id, error: err instanceof Error ? err.message : "Import failed" });
    }
  }
  return counts;
}

export async function migrateSearchesFromDisk(backend: BlobBackend): Promise<MigrationCounts> {
  const counts = newCounts();
  const dir = path.join(process.cwd(), "data", "searches");
  const existing = await readIndex(backend, "savedHistory").catch(() => ({ entries: [] as never[] }));
  const known = new Set((existing.entries as Array<{ id: string }>).map((e) => e.id));
  for (const file of await listJsonFiles(dir)) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(await fs.readFile(path.join(dir, file), "utf-8"));
    } catch {
      counts.failed += 1;
      counts.errors.push({ id: file, error: "Unreadable disk file" });
      continue;
    }
    const rec = parsed as Partial<StoredSearchRecord>;
    if (!rec || typeof rec.id !== "string" || !rec.manifest || typeof rec.query !== "string") {
      counts.failed += 1;
      counts.errors.push({ id: file, error: "Disk search record incomplete" });
      continue;
    }
    if (known.has(rec.id)) {
      counts.skipped += 1;
      continue;
    }
    try {
      const normalized: StoredSearchRecord = {
        id: rec.id,
        title: (typeof rec.title === "string" ? rec.title : rec.query).trim(),
        query: rec.query.trim(),
        resourceSelection: rec.resourceSelection ?? "ALL",
        settings: (rec.settings ?? {}) as StoredSearchRecord["settings"],
        filters: rec.filters,
        manifest: rec.manifest,
        createdAt: typeof rec.createdAt === "string" ? rec.createdAt : new Date().toISOString(),
        searchedAt: typeof rec.searchedAt === "number" ? rec.searchedAt : Date.now(),
        expiresAt: null,
      };
      const items = normalized.manifest.normalizedItems ?? [];
      const meta = {
        id: normalized.id,
        title: normalized.title,
        query: normalized.query,
        resourceSelection: normalized.resourceSelection,
        settings: normalized.settings,
        itemCount: normalized.manifest.itemCount ?? items.length,
        createdAt: normalized.createdAt,
        searchedAt: normalized.searchedAt,
        expiresAt: null,
        status: "complete" as const,
      };
      await saveRecord(backend, "savedHistory", normalized.id, normalized, {
        ...(meta as unknown as Record<string, unknown>),
      });
      const back = await loadRecord<StoredSearchRecord>(backend, "savedHistory", normalized.id);
      if (back.id !== normalized.id) throw new Error("Read-back mismatch");
      known.add(normalized.id);
      counts.imported += 1;
    } catch (err) {
      counts.failed += 1;
      counts.errors.push({ id: rec.id, error: err instanceof Error ? err.message : "Import failed" });
    }
  }
  return counts;
}

export async function migrateKeysFromDisk(): Promise<MigrationCounts> {
  const counts = newCounts();
  const file = path.join(process.cwd(), "data", "keys", "api-keys.json");
  let parsed: unknown;
  try {
    parsed = JSON.parse(await fs.readFile(file, "utf-8"));
  } catch {
    return counts; // No legacy keys to migrate — not an error.
  }
  const data = parsed as { activeKeyId?: string; customKeys?: Array<{ id: string; label: string; apiKey: string; addedAt: string; lastUsed?: string }> };
  if (!Array.isArray(data.customKeys) || data.customKeys.length === 0) return counts;
  const stored: StoredManagedKey[] = [];
  for (const legacy of data.customKeys) {
    if (!legacy || typeof legacy.id !== "string" || typeof legacy.apiKey !== "string" || !legacy.apiKey.trim()) {
      counts.failed += 1;
      counts.errors.push({ id: typeof legacy?.id === "string" ? legacy.id : "unknown", error: "Legacy key incomplete" });
      continue;
    }
    try {
      stored.push(legacyPlainKeyToStored({ ...legacy, label: legacy.label ?? "Migrated key" }, stored.length));
    } catch (err) {
      counts.failed += 1;
      counts.errors.push({ id: legacy.id, error: err instanceof Error ? err.message : "Encryption unavailable" });
    }
  }
  if (stored.length > 0) {
    try {
      const added = await importManagedKeys(stored, typeof data.activeKeyId === "string" ? data.activeKeyId : null);
      counts.imported = added;
      counts.skipped = stored.length - added;
    } catch (err) {
      counts.failed += stored.length;
      counts.imported = 0;
      counts.errors.push({ id: "key-store", error: err instanceof Error ? err.message : "Key import failed" });
    }
  }
  return counts;
}

export interface FullMigrationReport {
  playlists: MigrationCounts;
  searches: MigrationCounts;
  keys: MigrationCounts;
}

export async function migrateAllFromDisk(backend: BlobBackend): Promise<FullMigrationReport> {
  // Keys first (independent), then playlists + searches. Each stage is
  // idempotent, so interruption anywhere is safe to resume.
  const [keys, playlists, searches] = await Promise.all([
    migrateKeysFromDisk(),
    migratePlaylistsFromDisk(backend),
    migrateSearchesFromDisk(backend),
  ]);
  return { playlists, searches, keys };
}
