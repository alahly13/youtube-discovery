"use client";

import { Check, FolderPlus, ListPlus, Loader2, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { NormalizedYouTubeDiscoveryItem } from "@/types/youtube";
import { canonicalYoutubeKey } from "@/types/library";
import { youtubeKindFromNormalized } from "@/lib/playlists/playlist-query";
import { useUserPlaylistsStore } from "@/lib/state/user-playlists-store";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * Add-to-Playlist Dialog — reachable from search results, saved rows, and
 * playlist detail pages without leaving the current page.
 * ──────────────────────────────────────────────────────────────────────────
 * Lists every user playlist with membership state for the current item,
 * allows inline creation, and prevents duplicate membership per playlist
 * while freely allowing the same entity in different playlists.
 * ═══════════════════════════════════════════════════════════════════════════
 */

export function AddToPlaylistDialog({
  item,
  open,
  onClose,
}: {
  item: NormalizedYouTubeDiscoveryItem | null;
  open: boolean;
  onClose: () => void;
}) {
  const index = useUserPlaylistsStore((s) => s.index);
  const manifests = useUserPlaylistsStore((s) => s.manifests);
  const fetchIndex = useUserPlaylistsStore((s) => s.fetchIndex);
  const fetchPlaylist = useUserPlaylistsStore((s) => s.fetchPlaylist);
  const addYoutubeItem = useUserPlaylistsStore((s) => s.addYoutubeItem);
  const createPlaylist = useUserPlaylistsStore((s) => s.createPlaylist);

  const [newName, setNewName] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  /* eslint-disable react-hooks/set-state-in-effect -- open-triggered dialog reset + playlist refresh */
  useEffect(() => {
    if (open) {
      setNotice(null);
      setNewName("");
      void fetchIndex();
    }
  }, [open, fetchIndex]);
  /* eslint-enable react-hooks/set-state-in-effect */

  // Membership per playlist for this exact entity (video≡shorts identity).
  const membership = useMemo(() => {
    if (!item) return new Map<string, boolean>();
    const kind = youtubeKindFromNormalized(item);
    const key = canonicalYoutubeKey(kind, item.platformItemId);
    const map = new Map<string, boolean>();
    for (const entry of index) {
      const manifest = manifests[entry.id];
      if (!manifest) {
        map.set(entry.id, false);
        continue;
      }
      map.set(
        entry.id,
        manifest.items.some(
          (i) =>
            i.kind === "youtube" &&
            canonicalYoutubeKey(i.youtubeKind, i.snapshot.platformItemId) === key,
        ),
      );
    }
    return map;
  }, [index, manifests, item]);

  // Lazily hydrate uncached manifests so membership ticks are accurate.
  useEffect(() => {
    if (!open) return;
    const missing = index
      .filter((e) => !manifests[e.id])
      .slice(0, 12)
      .map((e) => e.id);
    if (missing.length > 0) {
      void Promise.allSettled(missing.map((id) => fetchPlaylist(id)));
    }
  }, [open, index, manifests, fetchPlaylist]);

  if (!open || !item) return null;

  const handleToggle = async (playlistId: string, alreadyIn: boolean) => {
    if (alreadyIn || busyId) return;
    setBusyId(playlistId);
    const result = await addYoutubeItem(playlistId, item);
    setBusyId(null);
    if (result.added) {
      setNotice(`Saved to “${index.find((e) => e.id === playlistId)?.name ?? "playlist"}”.`);
    } else if (result.reason === "duplicate") {
      setNotice("Already in that playlist — duplicates are prevented.");
    } else {
      setNotice("Could not save. Please retry.");
    }
  };

  const handleCreate = async () => {
    const name = newName.trim();
    if (!name || creating) return;
    setCreating(true);
    const manifest = await createPlaylist(name);
    if (manifest && item) {
      await addYoutubeItem(manifest.playlist.id, item);
    }
    setCreating(false);
    setNewName("");
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs"
      role="dialog"
      aria-modal="true"
      aria-label={`Add “${item.title}” to playlist`}
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-xl border border-border bg-surface p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-1 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="font-mono text-[11px] uppercase tracking-wider text-muted">
              Add to Playlist
            </p>
            <h3 className="truncate text-sm font-semibold text-foreground" title={item.title}>
              {item.title}
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close add to playlist"
            className="rounded-lg p-1.5 text-muted hover:bg-surface-muted hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {notice && (
          <p className="mb-3 rounded-lg border border-primary/30 bg-primary-soft px-3 py-2 text-xs text-primary">
            {notice}
          </p>
        )}

        <div className="max-h-64 space-y-1.5 overflow-y-auto pr-1">
          {index.length === 0 ? (
            <p className="rounded-lg border border-dashed border-border p-4 text-center text-xs text-muted">
              No playlists yet — create your first one below.
            </p>
          ) : (
            index.map((entry) => {
              const inList = membership.get(entry.id) ?? false;
              const busy = busyId === entry.id;
              return (
                <button
                  key={entry.id}
                  type="button"
                  disabled={inList || busy}
                  onClick={() => void handleToggle(entry.id, inList)}
                  className={`flex w-full items-center justify-between gap-3 rounded-lg border px-3 py-2 text-left text-sm transition ${
                    inList
                      ? "border-success/30 bg-success/5 text-muted"
                      : "border-border bg-surface-muted/30 text-foreground hover:border-primary/40"
                  }`}
                >
                  <span className="min-w-0">
                    <span className="block truncate text-xs font-medium">{entry.name}</span>
                    <span className="text-[11px] text-muted">{entry.itemCount} items</span>
                  </span>
                  {busy ? (
                    <Loader2 className="h-4 w-4 animate-spin text-muted" />
                  ) : inList ? (
                    <Badge tone="success" className="text-[10px]">
                      <Check className="h-3 w-3" /> Saved
                    </Badge>
                  ) : (
                    <ListPlus className="h-4 w-4 shrink-0 text-muted" />
                  )}
                </button>
              );
            })
          )}
        </div>

        <div className="mt-4 border-t border-border/60 pt-3">
          <div className="flex gap-2">
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void handleCreate();
              }}
              placeholder="+ Create new playlist"
              aria-label="New playlist name"
              className="h-9 min-w-0 flex-1 rounded-lg border border-border bg-surface px-3 text-xs focus:outline-none focus:ring-2 focus:ring-[var(--ring)]"
            />
            <Button
              variant="primary"
              className="h-9 px-3 text-xs"
              disabled={!newName.trim() || creating}
              onClick={() => void handleCreate()}
            >
              {creating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FolderPlus className="h-3.5 w-3.5" />}
              Create
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
