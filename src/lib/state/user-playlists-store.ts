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
  youtubeEntryId,
} from "@/types/library";
import {
  nextPositionIn,
  toYoutubeSnapshot,
  youtubeKindFromNormalized,
} from "@/lib/playlists/playlist-query";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * User Playlists Store — client cache + server authority.
 * ──────────────────────────────────────────────────────────────────────────
 * Server (`/api/playlists/*`, disk archive `data/playlists/`) is the
 * authority and the permanent record. This Zustand store is a synchronized
 * cache (also persisted to localStorage so navigation/refresh never loses
 * work while a sync is in flight). Every mutation commits the full manifest
 * with an atomic server write; the server re-sequences positions and returns
 * the canonical manifest which replaces the cache.
 *
 * Undo: the last destructive item removal is retained briefly so the detail
 * page can offer an "Undo" action.
 * ═══════════════════════════════════════════════════════════════════════════
 */

interface RemovedSnapshot {
  playlistId: string;
  items: LibraryPlaylistItem[];
  at: number;
}

interface UserPlaylistsState {
  index: UserPlaylistIndexEntry[];
  indexLoaded: boolean;
  manifests: Record<string, UserPlaylistManifest>;
  activeId: string | null;
  loading: boolean;
  error: string | null;
  lastRemoved: RemovedSnapshot | null;

  setActiveId: (id: string | null) => void;
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
  if (!data || typeof data !== "object" || !("manifest" in data)) return null;
  return (data as { manifest: UserPlaylistManifest }).manifest;
}

/** PUTs the full manifest; returns the canonical server copy on success. */
async function commitManifest(
  manifest: UserPlaylistManifest,
): Promise<UserPlaylistManifest | null> {
  const res = await authFetch(`/api/playlists/${encodeURIComponent(manifest.playlist.id)}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(manifest),
  });
  const { ok, data } = await readJson(res);
  if (!ok) return null;
  return asManifest(data);
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
  const items = [...manifest.items];
  for (const arr of byContainer.values()) {
    arr.sort((a, b) => a.position - b.position).forEach((it, idx) => {
      const target = items.find((x) => x.entryId === it.entryId);
      if (target) target.position = idx;
    });
  }
  return { ...manifest, groups: groups.map((g, i) => ({ ...g, position: i })), items };
}

export const useUserPlaylistsStore = create<UserPlaylistsState>()(
  persist(
    (set, get) => ({
      index: [],
      indexLoaded: false,
      manifests: {},
      activeId: null,
      loading: false,
      error: null,
      lastRemoved: null,

      setActiveId: (id) => set({ activeId: id }),
      clearError: () => set({ error: null }),

      fetchIndex: async () => {
        set({ loading: true, error: null });
        try {
          const res = await authFetch("/api/playlists");
          const { ok, data } = await readJson(res);
          if (!ok || !data || typeof data !== "object" || !("playlists" in data)) {
            throw new Error("Failed to load playlists");
          }
          const playlists = (data as { playlists: UserPlaylistIndexEntry[] }).playlists;
          set({ index: playlists, indexLoaded: true, loading: false });
        } catch (err) {
          set({
            loading: false,
            error: err instanceof Error ? err.message : "Failed to load playlists",
          });
        }
      },

      fetchPlaylist: async (id) => {
        set({ loading: true, error: null });
        try {
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
          const res = await authFetch("/api/playlists", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ name, description }),
          });
          const { ok, data } = await readJson(res);
          if (!ok) throw new Error("Failed to create playlist");
          const manifest = asManifest(data);
          if (!manifest) throw new Error("Invalid server response");
          set((s) => ({
            manifests: { ...s.manifests, [manifest.playlist.id]: manifest },
            loading: false,
          }));
          await get().fetchIndex();
          return manifest;
        } catch (err) {
          set({
            loading: false,
            error: err instanceof Error ? err.message : "Failed to create playlist",
          });
          return null;
        }
      },

      renamePlaylist: async (id, name) => {
        try {
          const res = await authFetch(`/api/playlists/${encodeURIComponent(id)}`, {
            method: "PUT",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ name }),
          });
          const { ok, data } = await readJson(res);
          if (!ok) return false;
          const manifest = asManifest(data);
          if (manifest) {
            set((s) => ({ manifests: { ...s.manifests, [id]: manifest } }));
          }
          await get().fetchIndex();
          return true;
        } catch {
          return false;
        }
      },

      updatePlaylistDescription: async (id, description) => {
        try {
          const res = await authFetch(`/api/playlists/${encodeURIComponent(id)}`, {
            method: "PUT",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ description }),
          });
          const { ok, data } = await readJson(res);
          if (!ok) return false;
          const manifest = asManifest(data);
          if (manifest) {
            set((s) => ({ manifests: { ...s.manifests, [id]: manifest } }));
          }
          await get().fetchIndex();
          return true;
        } catch {
          return false;
        }
      },

      deletePlaylist: async (id) => {
        try {
          const res = await authFetch(`/api/playlists/${encodeURIComponent(id)}`, {
            method: "DELETE",
          });
          if (!res.ok) return false;
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
        } catch {
          return false;
        }
      },

      addYoutubeItem: async (playlistId, item, opts) => {
        const current =
          get().manifests[playlistId] ?? (await get().fetchPlaylist(playlistId));
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
        const groupExists =
          groupId === null || current.groups.some((g) => g.id === groupId);
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
        // Snapshot the complete display metadata so the playlist survives
        // search-record expiry with zero YouTube API calls. rawJson is
        // intentionally NOT stored (bulk + no playlist UI need).
        const next = withTouched({
          ...current,
          items: [...current.items, entry],
        });
        const saved = await commitManifest(resequence(next));
        if (!saved) {
          set({ error: "Could not save to playlist. Please retry." });
          return { added: false, reason: "error" };
        }
        set((s) => ({ manifests: { ...s.manifests, [playlistId]: saved } }));
        await get().fetchIndex();
        return { added: true };
      },

      addCustomItem: async (playlistId, input) => {
        const title = input.title.trim();
        if (!title) return false;
        const current =
          get().manifests[playlistId] ?? (await get().fetchPlaylist(playlistId));
        if (!current) return false;
        const groupId = input.groupId ?? null;
        const groupExists =
          groupId === null || current.groups.some((g) => g.id === groupId);
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
        const saved = await commitManifest(
          resequence(withTouched({ ...current, items: [...current.items, entry] })),
        );
        if (!saved) return false;
        set((s) => ({ manifests: { ...s.manifests, [playlistId]: saved } }));
        await get().fetchIndex();
        return true;
      },

      updateItemNote: async (playlistId, entryId, note) => {
        const current = get().manifests[playlistId];
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
        const saved = await commitManifest(next);
        if (!saved) return false;
        set((s) => ({ manifests: { ...s.manifests, [playlistId]: saved } }));
        return true;
      },

      updateCustomItem: async (playlistId, entryId, patch) => {
        const current = get().manifests[playlistId];
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
        const saved = await commitManifest(next);
        if (!saved) return false;
        set((s) => ({ manifests: { ...s.manifests, [playlistId]: saved } }));
        await get().fetchIndex();
        return true;
      },

      removeItems: async (playlistId, entryIds) => {
        const current = get().manifests[playlistId];
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
        // Keep a brief snapshot for Undo before committing.
        set({ lastRemoved: { playlistId, items: removed, at: Date.now() } });
        const saved = await commitManifest(next);
        if (!saved) {
          set({ lastRemoved: null });
          return false;
        }
        set((s) => ({ manifests: { ...s.manifests, [playlistId]: saved } }));
        await get().fetchIndex();
        return true;
      },

      undoRemove: async () => {
        const snap = get().lastRemoved;
        if (!snap) return false;
        const current =
          get().manifests[snap.playlistId] ??
          (await get().fetchPlaylist(snap.playlistId));
        if (!current) return false;
        const existing = new Set(current.items.map((i) => i.entryId));
        const restored = snap.items.filter((i) => !existing.has(i.entryId));
        if (restored.length === 0) {
          set({ lastRemoved: null });
          return false;
        }
        const next = resequence(
          withTouched({ ...current, items: [...current.items, ...restored] }),
        );
        const saved = await commitManifest(next);
        set({ lastRemoved: null });
        if (!saved) return false;
        set((s) => ({ manifests: { ...s.manifests, [snap.playlistId]: saved } }));
        await get().fetchIndex();
        return true;
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
            if (targetKeys.has(key)) continue; // no duplicate membership
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
        const saved = await commitManifest(
          resequence(withTouched({ ...target, items: [...target.items, ...copies] })),
        );
        if (!saved) return 0;
        set((s) => ({ manifests: { ...s.manifests, [toId]: saved } }));
        await get().fetchIndex();
        return copies.length;
      },

      moveItemsToPlaylist: async (fromId, toId, entryIds) => {
        const copied = await get().copyItemsToPlaylist(fromId, toId, entryIds);
        if (copied === 0) return 0;
        // Removal from the source never deletes the global saved entity and
        // never touches other playlists — membership is independent.
        await get().removeItems(fromId, entryIds);
        set({ lastRemoved: null }); // a move is not an accidental removal
        return copied;
      },

      moveItemsToGroup: async (playlistId, entryIds, groupId) => {
        const current = get().manifests[playlistId];
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
        const saved = await commitManifest(resequence(withTouched({ ...current, items })));
        if (!saved) return false;
        set((s) => ({ manifests: { ...s.manifests, [playlistId]: saved } }));
        return true;
      },

      createGroup: async (playlistId, title, description = null) => {
        const clean = title.trim();
        if (!clean) return false;
        const current = get().manifests[playlistId];
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
        const saved = await commitManifest(
          withTouched({ ...current, groups: [...current.groups, group] }),
        );
        if (!saved) return false;
        set((s) => ({ manifests: { ...s.manifests, [playlistId]: saved } }));
        await get().fetchIndex();
        return true;
      },

      renameGroup: async (playlistId, groupId, title) => {
        const clean = title.trim();
        if (!clean) return false;
        const current = get().manifests[playlistId];
        if (!current) return false;
        const now = new Date().toISOString();
        const saved = await commitManifest(
          withTouched({
            ...current,
            groups: current.groups.map((g) =>
              g.id === groupId ? { ...g, title: clean.slice(0, 200), updatedAt: now } : g,
            ),
          }),
        );
        if (!saved) return false;
        set((s) => ({ manifests: { ...s.manifests, [playlistId]: saved } }));
        return true;
      },

      updateGroupDescription: async (playlistId, groupId, description) => {
        const current = get().manifests[playlistId];
        if (!current) return false;
        const now = new Date().toISOString();
        const saved = await commitManifest(
          withTouched({
            ...current,
            groups: current.groups.map((g) =>
              g.id === groupId
                ? { ...g, description: description?.trim() ? description.trim() : null, updatedAt: now }
                : g,
            ),
          }),
        );
        if (!saved) return false;
        set((s) => ({ manifests: { ...s.manifests, [playlistId]: saved } }));
        return true;
      },

      deleteGroup: async (playlistId, groupId, mode) => {
        const current = get().manifests[playlistId];
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
        if (removed.length > 0) {
          set({ lastRemoved: { playlistId, items: removed, at: Date.now() } });
        }
        const next = resequence(
          withTouched({
            ...current,
            groups: current.groups.filter((g) => g.id !== groupId),
            items,
          }),
        );
        const saved = await commitManifest(next);
        if (!saved) {
          set({ lastRemoved: null });
          return false;
        }
        set((s) => ({ manifests: { ...s.manifests, [playlistId]: saved } }));
        await get().fetchIndex();
        return true;
      },

      moveGroup: async (playlistId, groupId, direction) => {
        const current = get().manifests[playlistId];
        if (!current) return false;
        const ordered = [...current.groups].sort((a, b) => a.position - b.position);
        const idx = ordered.findIndex((g) => g.id === groupId);
        const swapWith = idx + direction;
        if (idx < 0 || swapWith < 0 || swapWith >= ordered.length) return false;
        const [moving] = ordered.splice(idx, 1);
        ordered.splice(swapWith, 0, moving);
        const groups = ordered.map((g, i) => ({ ...g, position: i }));
        const saved = await commitManifest(withTouched({ ...current, groups }));
        if (!saved) return false;
        set((s) => ({ manifests: { ...s.manifests, [playlistId]: saved } }));
        return true;
      },

      moveItem: async (playlistId, entryId, direction) => {
        const current = get().manifests[playlistId];
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
        const saved = await commitManifest(withTouched({ ...current, items }));
        if (!saved) return false;
        set((s) => ({ manifests: { ...s.manifests, [playlistId]: saved } }));
        return true;
      },

      dropItem: async (playlistId, entryId, toGroupId, toPosition) => {
        const current = get().manifests[playlistId];
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
        const saved = await commitManifest(
          resequence(withTouched({ ...current, items })),
        );
        if (!saved) return false;
        set((s) => ({ manifests: { ...s.manifests, [playlistId]: saved } }));
        await get().fetchIndex();
        return true;
      },

      exportPlaylist: async (playlistId) => {
        const current =
          get().manifests[playlistId] ?? (await get().fetchPlaylist(playlistId));
        if (!current) return false;
        try {
          // Re-read from disk so the export reflects the latest persisted
          // state rather than a possibly stale in-memory copy.
          const res = await authFetch(`/api/playlists/${encodeURIComponent(playlistId)}`);
          const { ok, data } = await readJson(res);
          const fresh = ok ? asManifest(data) : null;
          const manifest = fresh ?? current;
          const blob = new Blob([JSON.stringify(manifest, null, 2)], {
            type: "application/json",
          });
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          const safe = manifest.playlist.name
            .toLowerCase()
            .replace(/[^a-z0-9]+/gi, "-")
            .replace(/-+/g, "-")
            .replace(/^-|-$/g, "")
            .slice(0, 48);
          a.href = url;
          a.download = `${safe || "playlist"}-export-${manifest.playlist.id.slice(-6)}.json`;
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
        index: state.index,
        manifests: state.manifests,
        activeId: state.activeId,
      }),
    },
  ),
);

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
