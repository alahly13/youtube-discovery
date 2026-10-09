import "server-only";

import type { BlobBackend } from "../blob/blob-backend";
import { getBlobBackend } from "../blob/backend-factory";
import { recordPathname } from "../blob/blob-paths";
import { deleteRecord, loadRecord, readIndex, saveRecord } from "../blob/record-store";
import type {
  LibraryPlaylistItem,
  UserPlaylistIndexEntry,
  UserPlaylistManifest,
} from "@/types/library";
import {
  USER_PLAYLIST_MANIFEST_TYPE,
  USER_PLAYLIST_MANIFEST_VERSION,
} from "@/types/library";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * User Playlist Archive — Private Vercel Blob authoritative store.
 * ──────────────────────────────────────────────────────────────────────────
 * Same exported contract as the previous disk implementation, now backed by
 * `youtube-discovery/v1/playlists/` in the private Blob store:
 *   - one logical record per playlist (auto-chunked when large),
 *   - one lightweight index (metadata only — never full contents),
 *   - versioned optimistic-concurrency index updates,
 *   - read-back verification before any success is reported.
 *
 * Retention: PERMANENT until explicit user deletion. No TTL, no expiry
 * sweep, no dependency on SEARCH_STORAGE_TTL_HOURS.
 * `manifestFile` on index entries now carries the Blob record pathname
 * (stable reference for support/debugging, never a browser URL).
 * ═══════════════════════════════════════════════════════════════════════════
 */

const NAMESPACE = "playlists" as const;

function backend(): BlobBackend {
  return getBlobBackend();
}

function sanitizeManifest(input: UserPlaylistManifest): UserPlaylistManifest {
  const groups = [...(input.groups ?? [])]
    .filter((g) => g && typeof g.id === "string" && typeof g.title === "string")
    .sort((a, b) => a.position - b.position)
    .map((g, i) => ({ ...g, position: i }));
  const groupIds = new Set(groups.map((g) => g.id));
  const items = [...(input.items ?? [])]
    .filter((it) => it && typeof it.entryId === "string")
    .map((it) => ({
      ...it,
      groupId: it.groupId && groupIds.has(it.groupId) ? it.groupId : null,
    }));
  const byContainer = new Map<string, LibraryPlaylistItem[]>();
  for (const it of items) {
    const key = it.groupId ?? "__ungrouped__";
    const arr = byContainer.get(key) ?? [];
    arr.push(it);
    byContainer.set(key, arr);
  }
  for (const arr of byContainer.values()) {
    arr
      .sort((a, b) => a.position - b.position)
      .forEach((it, idx) => {
        it.position = idx;
      });
  }
  return {
    manifestVersion: USER_PLAYLIST_MANIFEST_VERSION,
    type: USER_PLAYLIST_MANIFEST_TYPE,
    playlist: {
      id: input.playlist.id,
      name: input.playlist.name,
      description: input.playlist.description ?? null,
      createdAt: input.playlist.createdAt,
      updatedAt: input.playlist.updatedAt,
    },
    groups,
    items,
  };
}

export function toIndexEntry(
  manifest: UserPlaylistManifest,
  manifestFile: string,
): UserPlaylistIndexEntry {
  const counts = { videos: 0, shorts: 0, youtubePlaylists: 0, channels: 0, custom: 0 };
  const thumbnails: string[] = [];
  for (const item of manifest.items) {
    if (item.kind === "custom") {
      counts.custom += 1;
      continue;
    }
    if (item.youtubeKind === "video") counts.videos += 1;
    else if (item.youtubeKind === "shorts") counts.shorts += 1;
    else if (item.youtubeKind === "youtube_playlist") counts.youtubePlaylists += 1;
    else counts.channels += 1;
    const thumb = item.snapshot.thumbnailUrl;
    if (thumb && thumbnails.length < 4 && !thumbnails.includes(thumb)) {
      thumbnails.push(thumb);
    }
  }
  return {
    id: manifest.playlist.id,
    name: manifest.playlist.name,
    description: manifest.playlist.description,
    createdAt: manifest.playlist.createdAt,
    updatedAt: manifest.playlist.updatedAt,
    itemCount: manifest.items.length,
    groupCount: manifest.groups.length,
    manifestFile,
    thumbnails,
    counts,
  };
}

function entryToIndexEntry(entry: { id: string; meta?: Record<string, unknown> }): UserPlaylistIndexEntry | null {
  const m = entry.meta;
  if (!m || typeof m !== "object") return null;
  const r = m as unknown as UserPlaylistIndexEntry;
  if (typeof r.id !== "string" || typeof r.name !== "string") return null;
  return r;
}

export async function listUserPlaylists(): Promise<UserPlaylistIndexEntry[]> {
  const index = await readIndex(backend(), NAMESPACE);
  const entries = index.entries
    .map(entryToIndexEntry)
    .filter((e): e is UserPlaylistIndexEntry => e !== null);
  return entries.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function readUserPlaylist(
  id: string,
): Promise<{ manifest: UserPlaylistManifest; manifestFile: string } | null> {
  const index = await readIndex(backend(), NAMESPACE);
  const entry = index.entries.find((e) => e.id === id);
  if (!entry) return null;
  try {
    const parsed = await loadRecord<UserPlaylistManifest>(backend(), NAMESPACE, id);
    if (
      !parsed ||
      parsed.type !== USER_PLAYLIST_MANIFEST_TYPE ||
      !parsed.playlist ||
      parsed.playlist.id !== id ||
      !Array.isArray(parsed.items) ||
      !Array.isArray(parsed.groups)
    ) {
      return null;
    }
    return { manifest: parsed, manifestFile: recordPathname(NAMESPACE, id) };
  } catch {
    return null;
  }
}

export async function playlistExists(id: string): Promise<boolean> {
  const index = await readIndex(backend(), NAMESPACE);
  return index.entries.some((e) => e.id === id);
}

export async function createUserPlaylist(
  manifest: UserPlaylistManifest,
): Promise<{ manifest: UserPlaylistManifest; manifestFile: string }> {
  const clean = sanitizeManifest(manifest);
  const indexEntry = toIndexEntry(clean, recordPathname(NAMESPACE, clean.playlist.id));
  await saveRecord(backend(), NAMESPACE, clean.playlist.id, clean, {
    ...(indexEntry as unknown as Record<string, unknown>),
  });
  return { manifest: clean, manifestFile: recordPathname(NAMESPACE, clean.playlist.id) };
}

export async function replaceUserPlaylist(
  id: string,
  manifest: UserPlaylistManifest,
): Promise<{ manifest: UserPlaylistManifest; manifestFile: string } | null> {
  if (!(await playlistExists(id))) return null;
  const clean = sanitizeManifest({ ...manifest, playlist: { ...manifest.playlist, id } });
  const indexEntry = toIndexEntry(clean, recordPathname(NAMESPACE, id));
  await saveRecord(backend(), NAMESPACE, id, clean, {
    ...(indexEntry as unknown as Record<string, unknown>),
  });
  return { manifest: clean, manifestFile: recordPathname(NAMESPACE, id) };
}

export async function deleteUserPlaylist(id: string): Promise<boolean> {
  return deleteRecord(backend(), NAMESPACE, id);
}
