/**
 * ═══════════════════════════════════════════════════════════════════════════
 * Origin Private File System (OPFS) Browser Cache & Staging Store (2026)
 * ───────────────────────────────────────────────────────────────────────────
 * Architecture Role:
 *   - Complements IndexedDB (`indexeddb-store.ts`) for file-oriented local
 *     storage of search history payloads, large search manifests, and local
 *     recovery staging snapshots before / until R2 cloud commit completes.
 *   - NEVER holds permanent server truth — Cloudflare R2 + Supabase PostgreSQL
 *     are authoritative once committed.
 *   - Post-commit local cleanup (`removeOpfsRecordsBatch`) removes ONLY local
 *     browser copies after R2 Worker + SHA-256 + PostgreSQL commit verification
 *     succeeds, and NEVER deletes or mutates any cloud data.
 *
 * Graceful Degradation:
 *   - Safely no-ops (`isOpfsSupported() === false`) in SSR, Node test runners,
 *     or restricted/private browsing modes where OPFS is unavailable; IndexedDB
 *     continues to handle all durable local persistence seamlessly.
 * ═══════════════════════════════════════════════════════════════════════════
 */

export type OpfsDatasetScope =
  | "saved-search-history"
  | "references"
  | "saved-titles-links"
  | "saved-searches"
  | "temp-manifests";

export interface OpfsRecordEnvelope<T = unknown> {
  schemaVersion: 1;
  ownerId: string;
  scope: OpfsDatasetScope;
  recordId: string;
  savedAt: string;
  payload: T;
}

const OPFS_ROOT_DIR = "youtube-discovery-v1";

function sanitizeSegment(raw: string): string {
  const cleaned = String(raw || "default")
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 140);
  return cleaned || "default";
}

function buildRecordFilename(scope: OpfsDatasetScope, recordId: string): string {
  return `${sanitizeSegment(scope)}__${sanitizeSegment(recordId)}.json`;
}

export function isOpfsSupported(): boolean {
  if (typeof window === "undefined" || typeof navigator === "undefined") {
    return false;
  }
  return typeof navigator.storage?.getDirectory === "function";
}

async function getScopeDirectory(
  ownerId: string,
  scope: OpfsDatasetScope,
  create: boolean
): Promise<FileSystemDirectoryHandle | null> {
  if (!isOpfsSupported()) return null;
  try {
    const root = await navigator.storage.getDirectory();
    const appDir = await root.getDirectoryHandle(OPFS_ROOT_DIR, { create });
    const ownerDir = await appDir.getDirectoryHandle(sanitizeSegment(ownerId), { create });
    return await ownerDir.getDirectoryHandle(sanitizeSegment(scope), { create });
  } catch {
    return null;
  }
}

/**
 * Write a structured JSON record into the caller's owner-scoped OPFS partition.
 * Returns `true` when written cleanly, `false` when OPFS is unavailable or denied.
 */
export async function writeOpfsRecord<T>(
  ownerId: string,
  scope: OpfsDatasetScope,
  recordId: string,
  payload: T
): Promise<boolean> {
  if (!ownerId || !recordId || !isOpfsSupported()) return false;
  try {
    const dir = await getScopeDirectory(ownerId, scope, true);
    if (!dir) return false;
    const filename = buildRecordFilename(scope, recordId);
    const fileHandle = await dir.getFileHandle(filename, { create: true });
    if (typeof fileHandle.createWritable !== "function") {
      return false;
    }
    const envelope: OpfsRecordEnvelope<T> = {
      schemaVersion: 1,
      ownerId,
      scope,
      recordId,
      savedAt: new Date().toISOString(),
      payload,
    };
    const writable = await fileHandle.createWritable();
    await writable.write(JSON.stringify(envelope));
    await writable.close();
    return true;
  } catch {
    return false;
  }
}

/**
 * Read a structured JSON record from OPFS if present.
 */
export async function readOpfsRecord<T>(
  ownerId: string,
  scope: OpfsDatasetScope,
  recordId: string
): Promise<T | null> {
  if (!ownerId || !recordId || !isOpfsSupported()) return null;
  try {
    const dir = await getScopeDirectory(ownerId, scope, false);
    if (!dir) return null;
    const filename = buildRecordFilename(scope, recordId);
    const fileHandle = await dir.getFileHandle(filename, { create: false });
    const file = await fileHandle.getFile();
    const text = await file.text();
    const parsed = JSON.parse(text) as OpfsRecordEnvelope<T>;
    return parsed?.payload ?? null;
  } catch {
    return null;
  }
}

/**
 * Remove a single local OPFS record (used ONLY during local browser cleanup
 * after cloud commit verification succeeds; never mutates R2 or PostgreSQL).
 */
export async function removeOpfsRecord(
  ownerId: string,
  scope: OpfsDatasetScope,
  recordId: string
): Promise<boolean> {
  if (!ownerId || !recordId || !isOpfsSupported()) return false;
  try {
    const dir = await getScopeDirectory(ownerId, scope, false);
    if (!dir) return false;
    const filename = buildRecordFilename(scope, recordId);
    await dir.removeEntry(filename);
    return true;
  } catch {
    return false;
  }
}

/**
 * Batch removal of local OPFS records after verified cloud commit.
 */
export async function removeOpfsRecordsBatch(
  ownerId: string,
  scope: OpfsDatasetScope,
  recordIds: string[]
): Promise<number> {
  if (!ownerId || !Array.isArray(recordIds) || recordIds.length === 0 || !isOpfsSupported()) {
    return 0;
  }
  const dir = await getScopeDirectory(ownerId, scope, false);
  if (!dir) return 0;

  let removed = 0;
  for (const id of recordIds) {
    if (!id) continue;
    try {
      await dir.removeEntry(buildRecordFilename(scope, id));
      removed++;
    } catch {
      // Entry may not have an OPFS mirror; ignore cleanly.
    }
  }
  return removed;
}

/**
 * List recordIds currently cached in OPFS under a specific owner & scope.
 */
export async function listOpfsRecordIds(
  ownerId: string,
  scope: OpfsDatasetScope
): Promise<string[]> {
  if (!ownerId || !isOpfsSupported()) return [];
  try {
    const dir = await getScopeDirectory(ownerId, scope, false);
    if (!dir) return [];
    const prefix = `${sanitizeSegment(scope)}__`;
    const result: string[] = [];
    const dirWithEntries = dir as unknown as {
      entries(): AsyncIterable<[string, FileSystemHandle]>;
    };
    for await (const [name, handle] of dirWithEntries.entries()) {
      if (handle?.kind === "file" && typeof name === "string" && name.endsWith(".json")) {
        const bare = name.startsWith(prefix) ? name.slice(prefix.length, -5) : name.slice(0, -5);
        if (bare) result.push(bare);
      }
    }
    return result;
  } catch {
    return [];
  }
}
