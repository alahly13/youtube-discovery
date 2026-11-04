import "server-only";

import type { StorageBackend } from "./storage-backend";
import { stableStringify } from "./storage-backend";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * Structured Record Store for Namespaced Entities (Playlists, Search History)
 * ──────────────────────────────────────────────────────────────────────────
 * Provides simple indexed document persistence on top of StorageBackend.
 * ═══════════════════════════════════════════════════════════════════════════
 */

export interface IndexEntry {
  id: string;
  updatedAt: string;
  meta?: Record<string, unknown>;
}

export interface IndexDoc {
  version: 1;
  updatedAt: string;
  entries: IndexEntry[];
}

export function recordPathname(namespace: string, id: string): string {
  return `youtube-discovery/v1/${namespace}/records/${encodeURIComponent(id)}.json`;
}

export function indexPathname(namespace: string): string {
  return `youtube-discovery/v1/${namespace}/index.json`;
}

export async function readIndex(backend: StorageBackend, namespace: string): Promise<IndexDoc> {
  const path = indexPathname(namespace);
  try {
    const raw = await backend.getBytes(path);
    const parsed = JSON.parse(raw.toString("utf8"));
    if (parsed && Array.isArray(parsed.entries)) {
      return parsed as IndexDoc;
    }
  } catch {
    // Return empty index if absent
  }
  return { version: 1, updatedAt: new Date().toISOString(), entries: [] };
}

export async function loadRecord<T>(
  backend: StorageBackend,
  namespace: string,
  id: string
): Promise<T | null> {
  const path = recordPathname(namespace, id);
  try {
    const raw = await backend.getBytes(path);
    return JSON.parse(raw.toString("utf8")) as T;
  } catch {
    return null;
  }
}

export async function saveRecord(
  backend: StorageBackend,
  namespace: string,
  id: string,
  record: unknown,
  meta?: Record<string, unknown>
): Promise<void> {
  const recordPath = recordPathname(namespace, id);
  const body = Buffer.from(stableStringify(record), "utf8");
  await backend.putBytes(recordPath, body, {
    allowOverwrite: true,
    contentType: "application/json",
  });

  // Update index
  const indexPath = indexPathname(namespace);
  const now = new Date().toISOString();
  let index: IndexDoc;
  try {
    const raw = await backend.getBytes(indexPath);
    index = JSON.parse(raw.toString("utf8"));
    if (!index || !Array.isArray(index.entries)) {
      index = { version: 1, updatedAt: now, entries: [] };
    }
  } catch {
    index = { version: 1, updatedAt: now, entries: [] };
  }

  const existingIdx = index.entries.findIndex((e) => e.id === id);
  const entry: IndexEntry = { id, updatedAt: now, meta };
  if (existingIdx >= 0) {
    index.entries[existingIdx] = entry;
  } else {
    index.entries.push(entry);
  }
  index.updatedAt = now;

  await backend.putBytes(indexPath, Buffer.from(stableStringify(index), "utf8"), {
    allowOverwrite: true,
    contentType: "application/json",
  });
}

export async function deleteRecord(
  backend: StorageBackend,
  namespace: string,
  id: string
): Promise<boolean> {
  const recordPath = recordPathname(namespace, id);
  await backend.delete(recordPath).catch(() => {});

  // Remove from index
  const indexPath = indexPathname(namespace);
  try {
    const raw = await backend.getBytes(indexPath);
    const index: IndexDoc = JSON.parse(raw.toString("utf8"));
    if (index && Array.isArray(index.entries)) {
      index.entries = index.entries.filter((e) => e.id !== id);
      index.updatedAt = new Date().toISOString();
      await backend.putBytes(indexPath, Buffer.from(stableStringify(index), "utf8"), {
        allowOverwrite: true,
        contentType: "application/json",
      });
      return true;
    }
  } catch {
    // Index missing
  }
  return true;
}

export async function gcStaging(
  backend: StorageBackend,
  maxAgeMs = 48 * 60 * 60 * 1000
): Promise<number> {
  return 0;
}
