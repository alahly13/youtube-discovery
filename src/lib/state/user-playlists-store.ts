"use client";

import { authFetch } from "@/lib/client/auth-fetch";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { NormalizedYouTubeDiscoveryItem } from "@/types/youtube";
import type {
  LibraryPlaylistGroup,
  LibraryPlaylistItem,
  LibraryYouTubeKind,
  UserPlaylistIndexEntry,
  UserPlaylistManifest,
} from "@/types/library";
import {
  canonicalYoutubeKey,
  createEntryId,
  emptyPlaylistManifest,
  youtubeEntryId,
} from "@/types/library";
import {
  nextPositionIn,
  toYoutubeSnapshot,
  youtubeKindFromNormalized,
} from "@/lib/playlists/playlist-query";
import {
  getLocalEntities,
  getLocalEntityById,
  getPendingOperations,
  type PendingOperation,
} from "@/lib/storage/indexeddb-store";
import { syncCoordinator } from "@/lib/sync/sync-coordinator";
import { undoRedoService, UNDO_REDO_EVENT } from "@/lib/undo-redo/undo-redo-service";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * User Playlists Store — Local-First IndexedDB + Persistent Undo/Redo
 * ──────────────────────────────────────────────────────────────────────────
 * Architecture (2026 Canonical):
 *   - All local creates, renames, description edits, item additions/removals,
 *     notes, group edits, copies/moves, and drag-and-drop reorders stage
 *     locally in IndexedDB (`entities_user_playlists` / `PLAYLIST` dataset)
 *     alongside Outbox operations (`pending_operations`) and persistent
 *     Undo/Redo command records (`undo_redo_commands`).
 *   - Destructive edits NEVER immediately bypass local staging to wipe cloud
 *     records — changes commit to Cloudflare R2 + Supabase PostgreSQL when the
 *     user invokes `Save to Cloud R2` (`syncCoordinator.saveAll()`).
 *   - Backward-compatible read merge: `fetchIndex` & `fetchPlaylist` inspect
 *     `/api/playlists` read-only for older remote playlists that have not yet
 *     been hydrated locally, never overwriting pending local mutations or
 *     local delete tombstones.
 * ═══════════════════════════════════════════════════════════════════════════
 */

interface RemovedSnapshot {
  playlistId: string;
  items: LibraryPlaylistItem[];
  at: number;
}

interface UserPlaylistsState {
  ownerId: string;
  index: UserPlaylistIndexEntry[];
  indexLoaded: boolean;
  manifests: Record<string, UserPlaylistManifest>;
  activeId: string | null;
  loading: boolean;
  error: string | null;
  lastRemoved: RemovedSnapshot | null;

  setActiveId: (id: string | null) => void;
  reloadFromLocal: () => Promise<void>;
  fetchIndex: () => Promise<void>;
  fetchPlaylist: (id: string) => Promise<UserPlaylistManifest | null>;
  createPlaylist: (name: string, description?: string | null) => Promise<UserPlaylistManifest | null>;
  renamePlaylist: (id: string, name: string) => Promise<boolean>;
  updatePlaylistDescription: (id: string, description: string | null) => Promise<boolean>;
  deletePlaylist: (id: string) => Promise<boolean>;

  addYoutubeItem: (
    playlistId: string,
    item: NormalizedYouTubeDiscoveryItem,
    opts?: { groupId?: string | null; note?: string | null },
  ) => Promise<{ added: boolean; reason?: "duplicate" | "missing" | "error" }>;
  addCustomItem: (
    playlistId: string,
    input: { title: string; note?: string | null; url?: string | null; groupId?: string | null },
  ) => Promise<boolean>;
  updateItemNote: (playlistId: string, entryId: string, note: string | null) => Promise<boolean>;
  updateCustomItem: (
    playlistId: string,
    entryId: string,
    patch: { title?: string; note?: string | null; url?: string | null },
  ) => Promise<boolean>;
  removeItems: (playlistId: string, entryIds: string[]) => Promise<boolean>;
  undoRemove: () => Promise<boolean>;
  copyItemsToPlaylist: (fromId: string, toId: string, entryIds: string[]) => Promise<number>;
  moveItemsToPlaylist: (fromId: string, toId: string, entryIds: string[]) => Promise<number>;
  moveItemsToGroup: (playlistId: string, entryIds: string[], groupId: string | null) => Promise<boolean>;

  createGroup: (playlistId: string, title: string, description?: string | null) => Promise<boolean>;
  renameGroup: (playlistId: string, groupId: string, title: string) => Promise<boolean>;
  updateGroupDescription: (playlistId: string, groupId: string, description: string | null) => Promise<boolean>;
  deleteGroup: (playlistId: string, groupId: string, mode: "keep-items" | "delete-items") => Promise<boolean>;
  moveGroup: (playlistId: string, groupId: string, direction: -1 | 1) => Promise<boolean>;

  moveItem: (playlistId: string, entryId: string, direction: -1 | 1) => Promise<boolean>;
  dropItem: (playlistId: string, entryId: string, toGroupId: string | null, toPosition: number) => Promise<boolean>;

  exportPlaylist: (playlistId: string) => Promise<boolean>;
  clearError: () => void;
}

async function readJson(res: Response): Promise<{ ok: boolean; data: unknown }> {
  try {
    const data: unknown = await res.json();
    return { ok: res.ok, data };
  } catch {
    return { ok: false, data: null };
  }
}

function asManifest(data: unknown): UserPlaylistManifest | null {
  if (!data || typeof data !== "object") return null;
  const record = "manifest" in data ? (data as { manifest: unknown }).manifest : data;
  if (!record || typeof record !== "object") return null;
  const m = record as Record<string, unknown>;
  if (!m.playlist || typeof m.playlist !== "object") return null;
  return {
    manifestVersion: typeof m.manifestVersion === "number" ? m.manifestVersion : 1,
    type: "youtube-discovery-playlist",
    playlist: m.playlist as UserPlaylistManifest["playlist"],
    groups: Array.isArray(m.groups) ? (m.groups as LibraryPlaylistGroup[]) : [],
    items: Array.isArray(m.items) ? (m.items as LibraryPlaylistItem[]) : [],
  };
}

function manifestToStorageRecord(manifest: UserPlaylistManifest): Record<string, unknown> {
  return {
    ...(manifest as unknown as Record<string, unknown>),
    id: manifest.playlist.id,
    recordId: manifest.playlist.id,
    resourceType: "USER_PLAYLIST",
    resourceId: manifest.playlist.id,
    title: manifest.playlist.name,
    name: manifest.playlist.name,
    description: manifest.playlist.description,
    createdAt: manifest.playlist.createdAt,
    updatedAt: manifest.playlist.updatedAt,
  };
}

function deriveIndexEntry(manifest: UserPlaylistManifest): UserPlaylistIndexEntry {
  const thumbnails: string[] = [];
  let videos = 0;
  let shorts = 0;
  let youtubePlaylists = 0;
  let channels = 0;
  let custom = 0;

  for (const item of manifest.items) {
    if (item.kind === "custom") {
      custom += 1;
    } else {
      if (item.snapshot.thumbnailUrl && !thumbnails.includes(item.snapshot.thumbnailUrl) && thumbnails.length < 4) {
        thumbnails.push(item.snapshot.thumbnailUrl);
      }
      switch (item.youtubeKind) {
        case "shorts":
          shorts += 1;
          break;
        case "youtube_playlist":
          youtubePlaylists += 1;
          break;
        case "channel":
          channels += 1;
          break;
        default:
          videos += 1;
          break;
      }
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
    manifestFile: `playlist-${manifest.playlist.id}.json`,
    thumbnails,
    counts: { videos, shorts, youtubePlaylists, channels, custom },
  };
}

function withTouched(manifest: UserPlaylistManifest): UserPlaylistManifest {
  return {
    ...manifest,
    playlist: { ...manifest.playlist, updatedAt: new Date().toISOString() },
  };
}

function resequence(manifest: UserPlaylistManifest): UserPlaylistManifest {
  const groups = [...manifest.groups].sort((a, b) => a.position - b.position);
  const byContainer = new Map<string, LibraryPlaylistItem[]>();
  for (const item of manifest.items) {
    const key = item.groupId ?? "";
    const arr = byContainer.get(key) ?? [];
    arr.push(item);
    byContainer.set(key, arr);
  }
  const items = manifest.items.map((it) => ({ ...it }));
  for (const arr of byContainer.values()) {
    arr.sort((a, b) => a.position - b.position).forEach((it, idx) => {
      const target = items.find((x) => x.entryId === it.entryId);
      if (target) target.position = idx;
    });
  }
  return { ...manifest, groups: groups.map((g, i) => ({ ...g, position: i })), items };
}

function resolveActiveOwner(): string | null {
  const fromCoord = syncCoordinator.getOwnerId()?.trim();
  if (fromCoord && fromCoord !== "asdy-admin") return fromCoord;
  if (typeof localStorage !== "undefined") {
    try {
      const stored = localStorage.getItem("yt_discovery_owner_id_v1")?.trim();
      if (stored && stored !== "asdy-admin") return stored;
    } catch {
      // Ignore storage access failures
    }
  }
  return null;
}

/**
 * Resolves pending deletes & local playlists from IndexedDB cleanly so Zustand
 * matches persisted browser state after edits, reloads, hydration, or Undo/Redo.
 */
async function readLocalPlaylistSnapshot(ownerId: string): Promise<{
  manifests: Record<string, UserPlaylistManifest>;
  index: UserPlaylistIndexEntry[];
  deletedIds: Set<string>;
}> {
  const [rawEntities, pendingOps] = await Promise.all([
    getLocalEntities<Record<string, unknown>>(ownerId, "PLAYLIST").catch(() => []),
    getPendingOperations(ownerId).catch((): PendingOperation[] => []),
  ]);

  const deletedIds = new Set<string>();
  const opsByEntity = new Map<string, PendingOperation>();
  for (const op of pendingOps) {
    if (op.datasetType !== "PLAYLIST") continue;
    opsByEntity.set(op.entityId, op);
  }
  for (const [id, op] of opsByEntity.entries()) {
    if (op.operationType === "DELETE") deletedIds.add(id);
  }

  const manifests: Record<string, UserPlaylistManifest> = {};
  const index: UserPlaylistIndexEntry[] = [];

  for (const raw of rawEntities) {
    const manifest = asManifest(raw);
    if (!manifest) continue;
    const pid = manifest.playlist.id;
    if (deletedIds.has(pid)) continue;
    manifests[pid] = manifest;
    index.push(deriveIndexEntry(manifest));
  }

  // Also ensure outbox UPSERTs not yet materialized are reflected cleanly
  for (const [id, op] of opsByEntity.entries()) {
    if (op.operationType === "DELETE" || manifests[id]) continue;
    const m = asManifest(op.payload);
    if (m) {
      manifests[m.playlist.id] = m;
      index.push(deriveIndexEntry(m));
    }
  }

  return { manifests, index, deletedIds };
}

async function applyLocalPlaylistCommand(params: {
  playlistId: string;
  beforeManifest: UserPlaylistManifest | null;
  afterManifest: UserPlaylistManifest | null;
  commandType: string;
  label: string;
  coalesceKey?: string;
}): Promise<boolean> {
  const ownerId = resolveActiveOwner();
  if (!ownerId) {
    throw new Error("AUTHENTICATION_REQUIRED: Sign in to persist playlist changes locally and to Cloud R2.");
  }

  const idbBefore =
    (await undoRedoService.captureBeforeState(ownerId, "PLAYLIST", params.playlistId)) ??
    (params.beforeManifest ? manifestToStorageRecord(params.beforeManifest) : null);

  await undoRedoService.executeMutation({
    ownerId,
    scope: "PLAYLIST",
    datasetType: "PLAYLIST",
    commandType: params.commandType,
    label: params.label,
    coalesceKey: params.coalesceKey,
    changes: [
      {
        datasetType: "PLAYLIST",
        entityId: params.playlistId,
        beforeState: idbBefore,
        afterState: params.afterManifest ? manifestToStorageRecord(params.afterManifest) : null,
      },
    ],
  });

  await syncCoordinator.refreshSummary();
  return true;
}

export const useUserPlaylistsStore = create<UserPlaylistsState>()(
  persist(
    (set, get) => ({
      ownerId: "",
      index: [],
      indexLoaded: false,
      manifests: {},
      activeId: null,
      loading: false,
      error: null,
      lastRemoved: null,

      setActiveId: (id) => set({ activeId: id }),
      clearError: () => set({ error: null }),

      reloadFromLocal: async () => {
        const ownerId = resolveActiveOwner();
        if (!ownerId) return;
        try {
          const { manifests, index } = await readLocalPlaylistSnapshot(ownerId);
          set((s) => {
            // Preserve non-tombstoned server-seeded manifests if IndexedDB has no PLAYIST rows yet
            const mergedManifests = { ...manifests };
            const seenIds = new Set(index.map((e) => e.id));
            const mergedIndex = [...index];

            // Keep previously fetched remote playlists ONLY if the owner matches & IndexedDB didn't already replace them
            if (s.ownerId === ownerId && Object.keys(manifests).length === 0) {
              for (const entry of s.index) {
                if (!seenIds.has(entry.id) && s.manifests[entry.id]) {
                  mergedManifests[entry.id] = s.manifests[entry.id];
                  mergedIndex.push(entry);
                  seenIds.add(entry.id);
                }
              }
            }

            return {
              ownerId,
              manifests: mergedManifests,
              index: mergedIndex,
              indexLoaded: true,
            };
          });
        } catch (err) {
          console.warn("[user-playlists-store] Failed to reload from IndexedDB:", err);
        }
      },

      fetchIndex: async () => {
        set({ loading: true, error: null });
        const ownerId = resolveActiveOwner();
        try {
          const localSnap = ownerId
            ? await readLocalPlaylistSnapshot(ownerId)
            : { manifests: {}, index: [], deletedIds: new Set<string>() };

          let remoteEntries: UserPlaylistIndexEntry[] = [];
          try {
            const res = await authFetch("/api/playlists");
            const { ok, data } = await readJson(res);
            if (ok && data && typeof data === "object" && "playlists" in data) {
              remoteEntries = (data as { playlists: UserPlaylistIndexEntry[] }).playlists;
            }
          } catch {
            // Offline: IndexedDB state remains authoritative locally
          }

          const mergedManifests = { ...localSnap.manifests };
          const byId = new Map<string, UserPlaylistIndexEntry>();
          const aliasKeyToLocalId = new Map<string, string>();
          for (const e of localSnap.index) {
            byId.set(e.id, e);
            aliasKeyToLocalId.set(
              `${e.name.trim().toLowerCase()}::${e.createdAt.slice(0, 19)}`,
              e.id
            );
          }
          for (const remote of remoteEntries) {
            if (localSnap.deletedIds.has(remote.id)) continue;
            const isLegacyUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
              remote.id
            );
            const aliasKey = `${remote.name.trim().toLowerCase()}::${remote.createdAt.slice(0, 19)}`;
            const canonicalId = (isLegacyUuid && aliasKeyToLocalId.get(aliasKey)) || remote.id;
            if (localSnap.deletedIds.has(canonicalId)) continue;
            if (!byId.has(canonicalId)) {
              byId.set(canonicalId, { ...remote, id: canonicalId });
            }
          }

          set({
            ownerId: ownerId || "",
            index: Array.from(byId.values()),
            manifests: mergedManifests,
            indexLoaded: true,
            loading: false,
          });
        } catch (err) {
          set({
            loading: false,
            error: err instanceof Error ? err.message : "Failed to load playlists",
          });
        }
      },

      fetchPlaylist: async (id) => {
        set({ loading: true, error: null });
        const ownerId = resolveActiveOwner();
        try {
          if (ownerId) {
            const pendingOps = await getPendingOperations(ownerId).catch(() => []);
            const hasDeleteTombstone = pendingOps.some(
              (op) => op.datasetType === "PLAYLIST" && op.entityId === id && op.operationType === "DELETE"
            );
            if (hasDeleteTombstone) {
              set({ loading: false, error: "Playlist deleted locally (pending Cloud sync)." });
              return null;
            }

            const localRec = await getLocalEntityById(ownerId, "PLAYLIST", id).catch(() => null);
            const localManifest = asManifest(localRec);
            if (localManifest) {
              set((s) => ({
                ownerId,
                manifests: { ...s.manifests, [id]: localManifest },
                loading: false,
              }));
              return localManifest;
            }
          }

          // Fallback to server read if not yet hydrated in IndexedDB
          const res = await authFetch(`/api/playlists/${encodeURIComponent(id)}`);
          const { ok, data } = await readJson(res);
          if (!ok) {
            const msg =
              data && typeof data === "object" && "error" in data
                ? String((data as { error: unknown }).error)
                : "Playlist not found or unreadable";
            throw new Error(msg);
          }
          const manifest = asManifest(data);
          if (!manifest) throw new Error("Playlist manifest unreadable");
          set((s) => ({
            ownerId: ownerId || s.ownerId,
            manifests: { ...s.manifests, [id]: manifest },
            loading: false,
          }));
          return manifest;
        } catch (err) {
          set({
            loading: false,
            error: err instanceof Error ? err.message : "Failed to load playlist",
          });
          return null;
        }
      },

      createPlaylist: async (name, description = null) => {
        set({ loading: true, error: null });
        try {
          const cleanName = name.trim();
          if (!cleanName) throw new Error("Playlist name is required");
          const manifest = emptyPlaylistManifest(
            cleanName,
            description?.trim() ? description.trim() : null
          );

          await applyLocalPlaylistCommand({
            playlistId: manifest.playlist.id,
            beforeManifest: null,
            afterManifest: manifest,
            commandType: "CREATE_PLAYLIST",
            label: `Create playlist "${manifest.playlist.name}"`,
          });

          const entry = deriveIndexEntry(manifest);
          set((s) => ({
            manifests: { ...s.manifests, [manifest.playlist.id]: manifest },
            index: [entry, ...s.index.filter((e) => e.id !== manifest.playlist.id)],
            loading: false,
          }));
          return manifest;
        } catch (err) {
          set({
            loading: false,
            error: err instanceof Error ? err.message : "Failed to create playlist locally",
          });
          return null;
        }
      },

      renamePlaylist: async (id, name) => {
        const cleanName = name.trim();
        if (!cleanName) return false;
        const current = get().manifests[id] ?? (await get().fetchPlaylist(id));
        if (!current) return false;

        try {
          const next = withTouched({
            ...current,
            playlist: { ...current.playlist, name: cleanName },
          });
          await applyLocalPlaylistCommand({
            playlistId: id,
            beforeManifest: current,
            afterManifest: next,
            commandType: "RENAME_PLAYLIST",
            label: `Rename playlist to "${cleanName}"`,
            coalesceKey: `rename-pl:${id}`,
          });
          const entry = deriveIndexEntry(next);
          set((s) => ({
            manifests: { ...s.manifests, [id]: next },
            index: s.index.map((e) => (e.id === id ? entry : e)),
          }));
          return true;
        } catch (err) {
          set({ error: err instanceof Error ? err.message : "Rename failed" });
          return false;
        }
      },

      updatePlaylistDescription: async (id, description) => {
        const current = get().manifests[id] ?? (await get().fetchPlaylist(id));
        if (!current) return false;
        try {
          const next = withTouched({
            ...current,
            playlist: {
              ...current.playlist,
              description: description?.trim() ? description.trim() : null,
            },
          });
          await applyLocalPlaylistCommand({
            playlistId: id,
            beforeManifest: current,
            afterManifest: next,
            commandType: "UPDATE_PLAYLIST_DESCRIPTION",
            label: `Edit description on "${current.playlist.name}"`,
            coalesceKey: `desc-pl:${id}`,
          });
          const entry = deriveIndexEntry(next);
          set((s) => ({
            manifests: { ...s.manifests, [id]: next },
            index: s.index.map((e) => (e.id === id ? entry : e)),
          }));
          return true;
        } catch (err) {
          set({ error: err instanceof Error ? err.message : "Description update failed" });
          return false;
        }
      },

      deletePlaylist: async (id) => {
        const current = get().manifests[id] ?? (await get().fetchPlaylist(id));
        if (!current) return false;
        try {
          await applyLocalPlaylistCommand({
            playlistId: id,
            beforeManifest: current,
            afterManifest: null,
            commandType: "DELETE_PLAYLIST",
            label: `Delete playlist "${current.playlist.name}"`,
          });
          set((s) => {
            const manifests = { ...s.manifests };
            delete manifests[id];
            return {
              manifests,
              index: s.index.filter((e) => e.id !== id),
              activeId: s.activeId === id ? null : s.activeId,
            };
          });
          return true;
        } catch (err) {
          set({ error: err instanceof Error ? err.message : "Delete failed" });
          return false;
        }
      },

      addYoutubeItem: async (playlistId, item, opts) => {
        const current = get().manifests[playlistId] ?? (await get().fetchPlaylist(playlistId));
        if (!current) return { added: false, reason: "missing" };
        const youtubeKind: LibraryYouTubeKind = youtubeKindFromNormalized(item);
        const key = canonicalYoutubeKey(youtubeKind, item.platformItemId);
        const duplicate = current.items.some(
          (i) =>
            i.kind === "youtube" &&
            canonicalYoutubeKey(i.youtubeKind, i.snapshot.platformItemId) === key,
        );
        if (duplicate) return { added: false, reason: "duplicate" };

        const groupId = opts?.groupId ?? null;
        const groupExists = groupId === null || current.groups.some((g) => g.id === groupId);
        const now = new Date().toISOString();
        const converted = toYoutubeSnapshot(item);
        const entry: LibraryPlaylistItem = {
          entryId: youtubeEntryId(youtubeKind, item.platformItemId),
          position: nextPositionIn(current, groupExists ? groupId : null),
          groupId: groupExists ? groupId : null,
          addedAt: now,
          updatedAt: now,
          note: opts?.note?.trim() ? opts.note.trim() : null,
          kind: "youtube",
          youtubeKind: converted.youtubeKind,
          snapshot: converted.snapshot,
        };
        const next = resequence(withTouched({ ...current, items: [...current.items, entry] }));

        try {
          await applyLocalPlaylistCommand({
            playlistId,
            beforeManifest: current,
            afterManifest: next,
            commandType: "ADD_PLAYLIST_ITEM",
            label: `Add "${item.title.slice(0, 40)}" to ${current.playlist.name}`,
          });
          const indexEntry = deriveIndexEntry(next);
          set((s) => ({
            manifests: { ...s.manifests, [playlistId]: next },
            index: s.index.some((e) => e.id === playlistId)
              ? s.index.map((e) => (e.id === playlistId ? indexEntry : e))
              : [indexEntry, ...s.index],
          }));
          return { added: true };
        } catch {
          set({ error: "Could not stage item in local playlist store. Please retry." });
          return { added: false, reason: "error" };
        }
      },

      addCustomItem: async (playlistId, input) => {
        const title = input.title.trim();
        if (!title) return false;
        const current = get().manifests[playlistId] ?? (await get().fetchPlaylist(playlistId));
        if (!current) return false;

        const groupId = input.groupId ?? null;
        const groupExists = groupId === null || current.groups.some((g) => g.id === groupId);
        const now = new Date().toISOString();
        const entry: LibraryPlaylistItem = {
          entryId: createEntryId("custom"),
          position: nextPositionIn(current, groupExists ? groupId : null),
          groupId: groupExists ? groupId : null,
          addedAt: now,
          updatedAt: now,
          note: null,
          kind: "custom",
          title,
          customNote: input.note?.trim() ? input.note.trim() : null,
          url: input.url?.trim() ? input.url.trim() : null,
        };
        const next = resequence(withTouched({ ...current, items: [...current.items, entry] }));

        try {
          await applyLocalPlaylistCommand({
            playlistId,
            beforeManifest: current,
            afterManifest: next,
            commandType: "ADD_CUSTOM_PLAYLIST_ITEM",
            label: `Add custom entry "${title.slice(0, 40)}"`,
          });
          const indexEntry = deriveIndexEntry(next);
          set((s) => ({
            manifests: { ...s.manifests, [playlistId]: next },
            index: s.index.map((e) => (e.id === playlistId ? indexEntry : e)),
          }));
          return true;
        } catch {
          return false;
        }
      },

      updateItemNote: async (playlistId, entryId, note) => {
        const current = get().manifests[playlistId] ?? (await get().fetchPlaylist(playlistId));
        if (!current) return false;
        const now = new Date().toISOString();
        const next: UserPlaylistManifest = {
          ...withTouched(current),
          items: current.items.map((i) =>
            i.entryId === entryId
              ? { ...i, note: note?.trim() ? note.trim() : null, updatedAt: now }
              : i,
          ),
        };
        try {
          await applyLocalPlaylistCommand({
            playlistId,
            beforeManifest: current,
            afterManifest: next,
            commandType: "EDIT_PLAYLIST_ITEM_NOTE",
            label: "Edit playlist item note",
            coalesceKey: `note:${playlistId}:${entryId}`,
          });
          set((s) => ({ manifests: { ...s.manifests, [playlistId]: next } }));
          return true;
        } catch {
          return false;
        }
      },

      updateCustomItem: async (playlistId, entryId, patch) => {
        const current = get().manifests[playlistId] ?? (await get().fetchPlaylist(playlistId));
        if (!current) return false;
        const now = new Date().toISOString();
        const next: UserPlaylistManifest = {
          ...withTouched(current),
          items: current.items.map((i) => {
            if (i.entryId !== entryId || i.kind !== "custom") return i;
            return {
              ...i,
              title: patch.title?.trim() ? patch.title.trim() : i.title,
              customNote:
                patch.note !== undefined
                  ? patch.note?.trim()
                    ? patch.note.trim()
                    : null
                  : i.customNote,
              url:
                patch.url !== undefined
                  ? patch.url?.trim()
                    ? patch.url.trim()
                    : null
                  : i.url,
              updatedAt: now,
            };
          }),
        };
        try {
          await applyLocalPlaylistCommand({
            playlistId,
            beforeManifest: current,
            afterManifest: next,
            commandType: "EDIT_CUSTOM_PLAYLIST_ITEM",
            label: "Edit custom playlist entry",
            coalesceKey: `custom:${playlistId}:${entryId}`,
          });
          const indexEntry = deriveIndexEntry(next);
          set((s) => ({
            manifests: { ...s.manifests, [playlistId]: next },
            index: s.index.map((e) => (e.id === playlistId ? indexEntry : e)),
          }));
          return true;
        } catch {
          return false;
        }
      },

      removeItems: async (playlistId, entryIds) => {
        const current = get().manifests[playlistId] ?? (await get().fetchPlaylist(playlistId));
        if (!current) return false;
        const condemned = new Set(entryIds);
        const removed = current.items.filter((i) => condemned.has(i.entryId));
        if (removed.length === 0) return false;

        const next = resequence(
          withTouched({
            ...current,
            items: current.items.filter((i) => !condemned.has(i.entryId)),
          }),
        );

        try {
          await applyLocalPlaylistCommand({
            playlistId,
            beforeManifest: current,
            afterManifest: next,
            commandType: "REMOVE_PLAYLIST_ITEMS",
            label: `Remove ${removed.length} item${removed.length === 1 ? "" : "s"} from ${current.playlist.name}`,
          });
          const indexEntry = deriveIndexEntry(next);
          set((s) => ({
            lastRemoved: { playlistId, items: removed, at: Date.now() },
            manifests: { ...s.manifests, [playlistId]: next },
            index: s.index.map((e) => (e.id === playlistId ? indexEntry : e)),
          }));
          return true;
        } catch {
          return false;
        }
      },

      undoRemove: async () => {
        const ownerId = resolveActiveOwner();
        if (ownerId) {
          const res = await undoRedoService.undo(ownerId, ["PLAYLIST"]);
          if (res.ok) {
            await get().reloadFromLocal();
            set({ lastRemoved: null });
            return true;
          }
        }
        return false;
      },

      copyItemsToPlaylist: async (fromId, toId, entryIds) => {
        if (fromId === toId) return 0;
        const source = get().manifests[fromId] ?? (await get().fetchPlaylist(fromId));
        const target = get().manifests[toId] ?? (await get().fetchPlaylist(toId));
        if (!source || !target) return 0;

        const wanted = new Set(entryIds);
        const now = new Date().toISOString();
        const targetKeys = new Set(
          target.items.flatMap((i) =>
            i.kind === "youtube"
              ? [canonicalYoutubeKey(i.youtubeKind, i.snapshot.platformItemId)]
              : [],
          ),
        );
        const copies: LibraryPlaylistItem[] = [];
        for (const item of source.items) {
          if (!wanted.has(item.entryId)) continue;
          if (item.kind === "youtube") {
            const key = canonicalYoutubeKey(item.youtubeKind, item.snapshot.platformItemId);
            if (targetKeys.has(key)) continue;
            targetKeys.add(key);
            copies.push({
              ...item,
              entryId: youtubeEntryId(item.youtubeKind, item.snapshot.platformItemId),
              groupId: null,
              position: 0,
              addedAt: now,
              updatedAt: now,
            });
          } else {
            copies.push({
              ...item,
              entryId: createEntryId("custom"),
              groupId: null,
              position: 0,
              addedAt: now,
              updatedAt: now,
            });
          }
        }
        if (copies.length === 0) return 0;
        const base = nextPositionIn(target, null);
        copies.forEach((c, i) => {
          c.position = base + i;
        });
        const next = resequence(withTouched({ ...target, items: [...target.items, ...copies] }));

        try {
          await applyLocalPlaylistCommand({
            playlistId: toId,
            beforeManifest: target,
            afterManifest: next,
            commandType: "COPY_ITEMS_TO_PLAYLIST",
            label: `Copy ${copies.length} item(s) into ${target.playlist.name}`,
          });
          const indexEntry = deriveIndexEntry(next);
          set((s) => ({
            manifests: { ...s.manifests, [toId]: next },
            index: s.index.map((e) => (e.id === toId ? indexEntry : e)),
          }));
          return copies.length;
        } catch {
          return 0;
        }
      },

      moveItemsToPlaylist: async (fromId, toId, entryIds) => {
        if (fromId === toId) return 0;
        const ownerId = resolveActiveOwner();
        if (!ownerId) return 0;

        const source = get().manifests[fromId] ?? (await get().fetchPlaylist(fromId));
        const target = get().manifests[toId] ?? (await get().fetchPlaylist(toId));
        if (!source || !target) return 0;

        const wanted = new Set(entryIds);
        const now = new Date().toISOString();
        const targetKeys = new Set(
          target.items.flatMap((i) =>
            i.kind === "youtube"
              ? [canonicalYoutubeKey(i.youtubeKind, i.snapshot.platformItemId)]
              : [],
          ),
        );
        const copies: LibraryPlaylistItem[] = [];
        for (const item of source.items) {
          if (!wanted.has(item.entryId)) continue;
          if (item.kind === "youtube") {
            const key = canonicalYoutubeKey(item.youtubeKind, item.snapshot.platformItemId);
            if (targetKeys.has(key)) continue;
            targetKeys.add(key);
            copies.push({
              ...item,
              entryId: youtubeEntryId(item.youtubeKind, item.snapshot.platformItemId),
              groupId: null,
              position: 0,
              addedAt: now,
              updatedAt: now,
            });
          } else {
            copies.push({
              ...item,
              entryId: createEntryId("custom"),
              groupId: null,
              position: 0,
              addedAt: now,
              updatedAt: now,
            });
          }
        }
        if (copies.length === 0) return 0;
        const base = nextPositionIn(target, null);
        copies.forEach((c, i) => {
          c.position = base + i;
        });

        const nextTarget = resequence(withTouched({ ...target, items: [...target.items, ...copies] }));
        const nextSource = resequence(
          withTouched({ ...source, items: source.items.filter((i) => !wanted.has(i.entryId)) }),
        );

        try {
          const [beforeSrc, beforeTgt] = await Promise.all([
            undoRedoService.captureBeforeState(ownerId, "PLAYLIST", fromId),
            undoRedoService.captureBeforeState(ownerId, "PLAYLIST", toId),
          ]);
          await undoRedoService.executeMutation({
            ownerId,
            scope: "PLAYLIST",
            datasetType: "PLAYLIST",
            commandType: "MOVE_ITEMS_BETWEEN_PLAYLISTS",
            label: `Move ${copies.length} item(s) to ${target.playlist.name}`,
            changes: [
              {
                datasetType: "PLAYLIST",
                entityId: fromId,
                beforeState: beforeSrc ?? manifestToStorageRecord(source),
                afterState: manifestToStorageRecord(nextSource),
              },
              {
                datasetType: "PLAYLIST",
                entityId: toId,
                beforeState: beforeTgt ?? manifestToStorageRecord(target),
                afterState: manifestToStorageRecord(nextTarget),
              },
            ],
          });
          await syncCoordinator.refreshSummary();
          const srcEntry = deriveIndexEntry(nextSource);
          const tgtEntry = deriveIndexEntry(nextTarget);
          set((s) => ({
            lastRemoved: null,
            manifests: { ...s.manifests, [fromId]: nextSource, [toId]: nextTarget },
            index: s.index.map((e) => (e.id === fromId ? srcEntry : e.id === toId ? tgtEntry : e)),
          }));
          return copies.length;
        } catch {
          return 0;
        }
      },

      moveItemsToGroup: async (playlistId, entryIds, groupId) => {
        const current = get().manifests[playlistId] ?? (await get().fetchPlaylist(playlistId));
        if (!current) return false;
        if (groupId !== null && !current.groups.some((g) => g.id === groupId)) return false;

        const moving = new Set(entryIds);
        const now = new Date().toISOString();
        const base = nextPositionIn(
          { ...current, items: current.items.filter((i) => !moving.has(i.entryId)) },
          groupId,
        );
        let slot = base;
        const items = current.items.map((i) =>
          moving.has(i.entryId) ? { ...i, groupId, position: slot++, updatedAt: now } : i,
        );
        const next = resequence(withTouched({ ...current, items }));
        try {
          await applyLocalPlaylistCommand({
            playlistId,
            beforeManifest: current,
            afterManifest: next,
            commandType: "MOVE_ITEMS_TO_GROUP",
            label: `Move ${entryIds.length} item(s) between sections`,
          });
          set((s) => ({ manifests: { ...s.manifests, [playlistId]: next } }));
          return true;
        } catch {
          return false;
        }
      },

      createGroup: async (playlistId, title, description = null) => {
        const clean = title.trim();
        if (!clean) return false;
        const current = get().manifests[playlistId] ?? (await get().fetchPlaylist(playlistId));
        if (!current) return false;
        const now = new Date().toISOString();
        const group: LibraryPlaylistGroup = {
          id: createEntryId("grp"),
          title: clean.slice(0, 200),
          description: description?.trim() ? description.trim() : null,
          position: current.groups.length,
          createdAt: now,
          updatedAt: now,
        };
        const next = withTouched({ ...current, groups: [...current.groups, group] });
        try {
          await applyLocalPlaylistCommand({
            playlistId,
            beforeManifest: current,
            afterManifest: next,
            commandType: "CREATE_GROUP",
            label: `Create section "${group.title}"`,
          });
          const indexEntry = deriveIndexEntry(next);
          set((s) => ({
            manifests: { ...s.manifests, [playlistId]: next },
            index: s.index.map((e) => (e.id === playlistId ? indexEntry : e)),
          }));
          return true;
        } catch {
          return false;
        }
      },

      renameGroup: async (playlistId, groupId, title) => {
        const clean = title.trim();
        if (!clean) return false;
        const current = get().manifests[playlistId] ?? (await get().fetchPlaylist(playlistId));
        if (!current) return false;
        const now = new Date().toISOString();
        const next = withTouched({
          ...current,
          groups: current.groups.map((g) =>
            g.id === groupId ? { ...g, title: clean.slice(0, 200), updatedAt: now } : g,
          ),
        });
        try {
          await applyLocalPlaylistCommand({
            playlistId,
            beforeManifest: current,
            afterManifest: next,
            commandType: "RENAME_GROUP",
            label: `Rename section to "${clean.slice(0, 40)}"`,
            coalesceKey: `rename-grp:${playlistId}:${groupId}`,
          });
          set((s) => ({ manifests: { ...s.manifests, [playlistId]: next } }));
          return true;
        } catch {
          return false;
        }
      },

      updateGroupDescription: async (playlistId, groupId, description) => {
        const current = get().manifests[playlistId] ?? (await get().fetchPlaylist(playlistId));
        if (!current) return false;
        const now = new Date().toISOString();
        const next = withTouched({
          ...current,
          groups: current.groups.map((g) =>
            g.id === groupId
              ? { ...g, description: description?.trim() ? description.trim() : null, updatedAt: now }
              : g,
          ),
        });
        try {
          await applyLocalPlaylistCommand({
            playlistId,
            beforeManifest: current,
            afterManifest: next,
            commandType: "UPDATE_GROUP_DESCRIPTION",
            label: "Edit section description",
            coalesceKey: `desc-grp:${playlistId}:${groupId}`,
          });
          set((s) => ({ manifests: { ...s.manifests, [playlistId]: next } }));
          return true;
        } catch {
          return false;
        }
      },

      deleteGroup: async (playlistId, groupId, mode) => {
        const current = get().manifests[playlistId] ?? (await get().fetchPlaylist(playlistId));
        if (!current) return false;
        const now = new Date().toISOString();
        const items =
          mode === "delete-items"
            ? current.items.filter((i) => i.groupId !== groupId)
            : current.items.map((i) =>
                i.groupId === groupId ? { ...i, groupId: null, updatedAt: now } : i,
              );
        const removed =
          mode === "delete-items"
            ? current.items.filter((i) => i.groupId === groupId)
            : [];
        const next = resequence(
          withTouched({
            ...current,
            groups: current.groups.filter((g) => g.id !== groupId),
            items,
          }),
        );

        try {
          await applyLocalPlaylistCommand({
            playlistId,
            beforeManifest: current,
            afterManifest: next,
            commandType: "DELETE_GROUP",
            label: `Delete section (${mode === "delete-items" ? "with items" : "keep items"})`,
          });
          const indexEntry = deriveIndexEntry(next);
          set((s) => ({
            lastRemoved: removed.length > 0 ? { playlistId, items: removed, at: Date.now() } : s.lastRemoved,
            manifests: { ...s.manifests, [playlistId]: next },
            index: s.index.map((e) => (e.id === playlistId ? indexEntry : e)),
          }));
          return true;
        } catch {
          return false;
        }
      },

      moveGroup: async (playlistId, groupId, direction) => {
        const current = get().manifests[playlistId] ?? (await get().fetchPlaylist(playlistId));
        if (!current) return false;
        const ordered = [...current.groups].sort((a, b) => a.position - b.position);
        const idx = ordered.findIndex((g) => g.id === groupId);
        const swapWith = idx + direction;
        if (idx < 0 || swapWith < 0 || swapWith >= ordered.length) return false;
        const [moving] = ordered.splice(idx, 1);
        ordered.splice(swapWith, 0, moving);
        const groups = ordered.map((g, i) => ({ ...g, position: i }));
        const next = withTouched({ ...current, groups });
        try {
          await applyLocalPlaylistCommand({
            playlistId,
            beforeManifest: current,
            afterManifest: next,
            commandType: "REORDER_GROUPS",
            label: "Reorder playlist section",
          });
          set((s) => ({ manifests: { ...s.manifests, [playlistId]: next } }));
          return true;
        } catch {
          return false;
        }
      },

      moveItem: async (playlistId, entryId, direction) => {
        const current = get().manifests[playlistId] ?? (await get().fetchPlaylist(playlistId));
        if (!current) return false;
        const item = current.items.find((i) => i.entryId === entryId);
        if (!item) return false;
        const siblings = current.items
          .filter((i) => (i.groupId ?? null) === (item.groupId ?? null))
          .sort((a, b) => a.position - b.position);
        const idx = siblings.findIndex((i) => i.entryId === entryId);
        const swapWith = idx + direction;
        if (idx < 0 || swapWith < 0 || swapWith >= siblings.length) return false;
        const now = new Date().toISOString();
        const ids = siblings.map((i) => i.entryId);
        [ids[idx], ids[swapWith]] = [ids[swapWith], ids[idx]];
        const order = new Map(ids.map((id, i) => [id, i]));
        const items = current.items.map((i) =>
          order.has(i.entryId)
            ? { ...i, position: order.get(i.entryId) ?? i.position, updatedAt: now }
            : i,
        );
        const next = withTouched({ ...current, items });
        try {
          await applyLocalPlaylistCommand({
            playlistId,
            beforeManifest: current,
            afterManifest: next,
            commandType: "REORDER_PLAYLIST_ITEM",
            label: "Reorder playlist item",
          });
          set((s) => ({ manifests: { ...s.manifests, [playlistId]: next } }));
          return true;
        } catch {
          return false;
        }
      },

      dropItem: async (playlistId, entryId, toGroupId, toPosition) => {
        const current = get().manifests[playlistId] ?? (await get().fetchPlaylist(playlistId));
        if (!current) return false;
        const item = current.items.find((i) => i.entryId === entryId);
        if (!item) return false;
        if (toGroupId !== null && !current.groups.some((g) => g.id === toGroupId)) return false;

        const now = new Date().toISOString();
        const siblings = current.items
          .filter(
            (i) =>
              (i.groupId ?? null) === (toGroupId ?? null) && i.entryId !== entryId,
          )
          .sort((a, b) => a.position - b.position);
        const clamped = Math.max(0, Math.min(toPosition, siblings.length));
        siblings.splice(clamped, 0, { ...item, groupId: toGroupId });
        const order = new Map(siblings.map((i, idx) => [i.entryId, idx]));
        const items = current.items.map((i) =>
          order.has(i.entryId)
            ? {
                ...i,
                groupId: toGroupId,
                position: order.get(i.entryId) ?? i.position,
                updatedAt: now,
              }
            : i,
        );
        const next = resequence(withTouched({ ...current, items }));

        try {
          await applyLocalPlaylistCommand({
            playlistId,
            beforeManifest: current,
            afterManifest: next,
            commandType: "DROP_PLAYLIST_ITEM",
            label: "Drag & drop reorder playlist item",
          });
          const indexEntry = deriveIndexEntry(next);
          set((s) => ({
            manifests: { ...s.manifests, [playlistId]: next },
            index: s.index.map((e) => (e.id === playlistId ? indexEntry : e)),
          }));
          return true;
        } catch {
          return false;
        }
      },

      exportPlaylist: async (playlistId) => {
        const current =
          get().manifests[playlistId] ?? (await get().fetchPlaylist(playlistId));
        if (!current) return false;
        try {
          const blob = new Blob([JSON.stringify(current, null, 2)], {
            type: "application/json",
          });
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          const safe = current.playlist.name
            .toLowerCase()
            .replace(/[^a-z0-9]+/gi, "-")
            .replace(/-+/g, "-")
            .replace(/^-|-$/g, "")
            .slice(0, 48);
          a.href = url;
          a.download = `${safe || "playlist"}-export-${current.playlist.id.slice(-6)}.json`;
          document.body.appendChild(a);
          a.click();
          a.remove();
          URL.revokeObjectURL(url);
          return true;
        } catch {
          return false;
        }
      },
    }),
    {
      name: "youtube-discovery-user-playlists",
      partialize: (state) => ({
        ownerId: state.ownerId,
        index: state.index,
        manifests: state.manifests,
        activeId: state.activeId,
      }),
    },
  ),
);

if (typeof window !== "undefined") {
  const syncStoreFromIndexedDb = () => {
    void useUserPlaylistsStore.getState().reloadFromLocal();
  };
  window.addEventListener(UNDO_REDO_EVENT, syncStoreFromIndexedDb);
  window.addEventListener("yt-discovery-hydration-changed", syncStoreFromIndexedDb);
  window.addEventListener("yt-discovery-owner-changed", syncStoreFromIndexedDb);
}

/**
 * All canonical YouTube keys referenced by every cached playlist — used by
 * the Saved hub to flag standalone items not yet placed in any playlist.
 */
export function collectPlaylistKeys(
  manifests: Record<string, UserPlaylistManifest>,
): Set<string> {
  const keys = new Set<string>();
  for (const m of Object.values(manifests)) {
    for (const item of m.items) {
      if (item.kind === "youtube") {
        keys.add(canonicalYoutubeKey(item.youtubeKind, item.snapshot.platformItemId));
      }
    }
  }
  return keys;
}
