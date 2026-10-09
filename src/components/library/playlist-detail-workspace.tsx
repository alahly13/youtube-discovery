"use client";

import {
  ArrowDown,
  ArrowUp,
  Check,
  ChevronDown,
  ChevronRight,
  Download,
  ExternalLink,
  FolderPlus,
  GripVertical,
  Layers,
  ListPlus,
  Pencil,
  Plus,
  Search,
  StickyNote,
  Trash2,
  Undo2,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/saved/saved-library-workspace";
import {
  createLocalSearcher,
  searchRanked,
  toSearchDoc,
  type LocalSearcher,
} from "@/lib/search/local-search";
import type {
  LibraryContentFilter,
  LibraryPlaylistItem,
  LibrarySortMode,
  UserPlaylistManifest,
} from "@/types/library";
import { libraryItemTitle } from "@/types/library";
import {
  applyItemFilters,
  type PublishedPreset,
} from "@/lib/playlists/playlist-query";
import { useUserPlaylistsStore } from "@/lib/state/user-playlists-store";
import { formatCount, formatDate, formatDuration } from "@/lib/utils/format";

/* ═══════════════════════════════════════════════════════════════════════════
   Playlist Detail Workspace — /saved/[playlistId]
   ──────────────────────────────────────────────────────────────────────────
   Search, filter, order, group, annotate, and export ONE user playlist.
   All controls run on the stored manifest — zero YouTube API calls.

   Ordering honesty: `manual` is the only mode that mirrors stored
   positions. Drag-and-drop and Move Up/Down are enabled only in manual mode
   with no active search/filters, so a drop can never silently scramble
   hidden items. Other sorts are transient views.
   ═══════════════════════════════════════════════════════════════════════════ */

const SORT_OPTIONS: Array<{ value: LibrarySortMode; label: string }> = [
  { value: "manual", label: "Custom manual order" },
  { value: "views_desc", label: "Most views first" },
  { value: "views_asc", label: "Fewest views first" },
  { value: "published_desc", label: "Newest published first" },
  { value: "published_asc", label: "Oldest published first" },
  { value: "added_desc", label: "Recently added to playlist" },
  { value: "added_asc", label: "Oldest added to playlist" },
  { value: "title_az", label: "Title A–Z" },
  { value: "title_za", label: "Title Z–A" },
  { value: "updated_desc", label: "Recently updated" },
  { value: "duration_desc", label: "Longest duration" },
  { value: "duration_asc", label: "Shortest duration" },
];

const TYPE_FILTERS: Array<{ value: LibraryContentFilter; label: string }> = [
  { value: "all", label: "All" },
  { value: "videos", label: "Videos" },
  { value: "shorts", label: "Shorts" },
  { value: "youtube_playlists", label: "YouTube Playlists" },
  { value: "channels", label: "Channels" },
  { value: "custom", label: "Custom / Notes" },
];

export function PlaylistDetailWorkspace({ playlistId }: { playlistId: string }) {
  const manifests = useUserPlaylistsStore((s) => s.manifests);
  const index = useUserPlaylistsStore((s) => s.index);
  const fetchPlaylist = useUserPlaylistsStore((s) => s.fetchPlaylist);
  const storeError = useUserPlaylistsStore((s) => s.error);
  const clearError = useUserPlaylistsStore((s) => s.clearError);

  const manifest: UserPlaylistManifest | undefined = manifests[playlistId];
  const [notFound, setNotFound] = useState(false);
  const [loading, setLoading] = useState(!manifest);

  /* eslint-disable react-hooks/set-state-in-effect -- Mount-only manifest fetch for the open playlist */
  useEffect(() => {
    let cancelled = false;
    if (!manifests[playlistId]) {
      setLoading(true);
      void fetchPlaylist(playlistId).then((m) => {
        if (!cancelled) {
          setLoading(false);
          if (!m) setNotFound(true);
        }
      });
    } else {
      setLoading(false);
    }
    return () => {
      cancelled = true;
    };
  }, [playlistId, manifests, fetchPlaylist]);
  /* eslint-enable react-hooks/set-state-in-effect */

  useEffect(() => {
    clearError();
  }, [playlistId, clearError]);

  if (loading) {
    return (
      <Card>
        <p className="py-10 text-center text-sm text-muted">Loading playlist manifest…</p>
      </Card>
    );
  }
  if (notFound || !manifest) {
    return (
      <Card>
        <div className="flex flex-col items-center gap-3 py-10 text-center">
          <StickyNote className="h-10 w-10 text-muted/40" />
          <p className="text-sm font-medium text-foreground">Playlist not found or unreadable</p>
          <p className="max-w-md text-xs text-muted">
            {storeError ??
              "The manifest file may be missing or corrupted. Other playlists are unaffected — this failure is isolated to one record."}
          </p>
        </div>
      </Card>
    );
  }
  return <DetailBody manifest={manifest} allPlaylists={index} />;
}

function DetailBody({
  manifest,
  allPlaylists,
}: {
  manifest: UserPlaylistManifest;
  allPlaylists: Array<{ id: string; name: string }>;
}) {
  const id = manifest.playlist.id;
  const renamePlaylist = useUserPlaylistsStore((s) => s.renamePlaylist);
  const updatePlaylistDescription = useUserPlaylistsStore((s) => s.updatePlaylistDescription);
  const deletePlaylist = useUserPlaylistsStore((s) => s.deletePlaylist);
  const exportPlaylist = useUserPlaylistsStore((s) => s.exportPlaylist);
  const lastRemoved = useUserPlaylistsStore((s) => s.lastRemoved);
  const undoRemove = useUserPlaylistsStore((s) => s.undoRemove);
  const removeItems = useUserPlaylistsStore((s) => s.removeItems);
  const moveItem = useUserPlaylistsStore((s) => s.moveItem);
  const dropItem = useUserPlaylistsStore((s) => s.dropItem);
  const moveItemsToGroup = useUserPlaylistsStore((s) => s.moveItemsToGroup);
  const copyItemsToPlaylist = useUserPlaylistsStore((s) => s.copyItemsToPlaylist);
  const moveItemsToPlaylist = useUserPlaylistsStore((s) => s.moveItemsToPlaylist);
  const createGroup = useUserPlaylistsStore((s) => s.createGroup);
  const renameGroup = useUserPlaylistsStore((s) => s.renameGroup);
  const updateGroupDescription = useUserPlaylistsStore((s) => s.updateGroupDescription);
  const deleteGroup = useUserPlaylistsStore((s) => s.deleteGroup);
  const moveGroup = useUserPlaylistsStore((s) => s.moveGroup);
  const updateItemNote = useUserPlaylistsStore((s) => s.updateItemNote);
  const updateCustomItem = useUserPlaylistsStore((s) => s.updateCustomItem);
  const addCustomItem = useUserPlaylistsStore((s) => s.addCustomItem);

  /* ── Header editing ── */
  const [editingName, setEditingName] = useState(false);
  const [nameValue, setNameValue] = useState(manifest.playlist.name);
  const [editingDesc, setEditingDesc] = useState(false);
  const [descValue, setDescValue] = useState(manifest.playlist.description ?? "");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleted, setDeleted] = useState(false);

  /* ── Search / filter / sort ── */
  const [query, setQuery] = useState("");
  const [contentFilter, setContentFilter] = useState<LibraryContentFilter>("all");
  const [sort, setSort] = useState<LibrarySortMode>("manual");
  const [preset, setPreset] = useState<PublishedPreset>("all");
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");
  const [minViews, setMinViews] = useState("");
  const [maxViews, setMaxViews] = useState("");

  /* ── Selection + groups UI ── */
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [showCustomForm, setShowCustomForm] = useState(false);
  const [showGroupForm, setShowGroupForm] = useState(false);
  const [bulkTarget, setBulkTarget] = useState("");
  const [notice, setNotice] = useState<string | null>(null);

  const groupNameOf = (groupId: string | null) =>
    groupId ? (manifest.groups.find((g) => g.id === groupId)?.title ?? "Unknown section") : "Ungrouped";

  /* Shared FlexSearch over entry titles, names, descriptions, notes, and
     group titles — index rebuilt only when the manifest changes. */
  const searchDocs = useMemo(
    () =>
      manifest.items.map((item) =>
        item.kind === "custom"
          ? toSearchDoc(item.entryId, item.title, groupNameOf(item.groupId), [
              item.customNote,
              item.note,
              item.url,
            ])
          : toSearchDoc(
              item.entryId,
              item.snapshot.title,
              item.snapshot.channelTitle ?? groupNameOf(item.groupId),
              [
                item.snapshot.description,
                groupNameOf(item.groupId),
                item.note,
                item.snapshot.platformItemId,
              ],
            ),
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [manifest],
  );
  const searcher: LocalSearcher | null = useMemo(
    () => (searchDocs.length > 0 ? createLocalSearcher(searchDocs) : null),
    [searchDocs],
  );
  const textMatched = useMemo(
    () => searchRanked(manifest.items, searchDocs, searcher, query),
    [manifest.items, searchDocs, searcher, query],
  );

  const viewItems = useMemo(() => {
    const min = minViews.trim() === "" ? null : Number(minViews);
    const max = maxViews.trim() === "" ? null : Number(maxViews);
    return applyItemFilters(query.trim() ? textMatched : manifest.items, {
      query,
      contentFilter,
      publishedPreset: preset,
      customStart: customStart || null,
      customEnd: customEnd || null,
      minViews: min !== null && Number.isFinite(min) ? min : null,
      maxViews: max !== null && Number.isFinite(max) ? max : null,
      sort,
    });
  }, [manifest.items, textMatched, query, contentFilter, preset, customStart, customEnd, minViews, maxViews, sort]);

  const filtersActive =
    query.trim() !== "" ||
    contentFilter !== "all" ||
    preset !== "all" ||
    minViews.trim() !== "" ||
    maxViews.trim() !== "";
  const reorderAllowed = sort === "manual" && !filtersActive;
  const visibleIds = useMemo(() => new Set(viewItems.map((i) => i.entryId)), [viewItems]);

  const orderedGroups = useMemo(
    () => [...manifest.groups].sort((a, b) => a.position - b.position),
    [manifest.groups],
  );
  const ungrouped = useMemo(
    () => viewItems.filter((i) => i.groupId === null),
    [viewItems],
  );
  const groupedCount = viewItems.filter((i) => i.groupId !== null).length;

  const counts = useMemo(() => {
    const c = { videos: 0, shorts: 0, yt: 0, channels: 0, custom: 0 };
    for (const i of manifest.items) {
      if (i.kind === "custom") c.custom += 1;
      else if (i.youtubeKind === "video") c.videos += 1;
      else if (i.youtubeKind === "shorts") c.shorts += 1;
      else if (i.youtubeKind === "youtube_playlist") c.yt += 1;
      else c.channels += 1;
    }
    return c;
  }, [manifest.items]);

  const toggleSelect = (entryId: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(entryId)) next.delete(entryId);
      else next.add(entryId);
      return next;
    });
  };

  const flash = (msg: string) => {
    setNotice(msg);
    setTimeout(() => setNotice(null), 4000);
  };

  const handleBulkRemove = async () => {
    const ids = [...selected].filter((entryId) => visibleIds.has(entryId));
    if (ids.length === 0) return;
    await removeItems(id, ids);
    setSelected(new Set());
  };

  const handleBulkGroup = async (groupId: string | null) => {
    const ids = [...selected].filter((entryId) => visibleIds.has(entryId));
    if (ids.length === 0) return;
    await moveItemsToGroup(id, ids, groupId);
    setSelected(new Set());
  };

  const handleBulkCopy = async () => {
    if (!bulkTarget || bulkTarget === id) return;
    const ids = [...selected].filter((entryId) => visibleIds.has(entryId));
    const n = await copyItemsToPlaylist(id, bulkTarget, ids);
    flash(n > 0 ? `Copied ${n} item${n === 1 ? "" : "s"}.` : "Nothing copied (already present).");
    setSelected(new Set());
  };

  const handleBulkMove = async () => {
    if (!bulkTarget || bulkTarget === id) return;
    const ids = [...selected].filter((entryId) => visibleIds.has(entryId));
    const n = await moveItemsToPlaylist(id, bulkTarget, ids);
    flash(n > 0 ? `Moved ${n} item${n === 1 ? "" : "s"}.` : "Nothing moved.");
    setSelected(new Set());
  };

  const handleCreateGroupFromSelection = async () => {
    const ids = [...selected].filter((entryId) => visibleIds.has(entryId));
    if (ids.length < 2) {
      flash("Select at least two items to form a section.");
      return;
    }
    const title = `Section ${orderedGroups.length + 1}`;
    const ok = await createGroup(id, title);
    if (!ok) return;
    const fresh = useUserPlaylistsStore.getState().manifests[id];
    const created = fresh?.groups.find((g) => g.title === title);
    if (created) {
      await moveItemsToGroup(id, ids, created.id);
    }
    setSelected(new Set());
  };

  const handleDropOnItem = async (targetEntryId: string) => {
    if (!draggingId || draggingId === targetEntryId || !reorderAllowed) return;
    const target = manifest.items.find((i) => i.entryId === targetEntryId);
    const dragged = manifest.items.find((i) => i.entryId === draggingId);
    if (!target || !dragged) return;
    if ((target.groupId ?? null) !== (dragged.groupId ?? null)) {
      // Cross-group drop: append into the target's group at target position.
      const siblings = manifest.items
        .filter((i) => (i.groupId ?? null) === (target.groupId ?? null) && i.entryId !== draggingId)
        .sort((a, b) => a.position - b.position);
      const at = siblings.findIndex((i) => i.entryId === targetEntryId);
      await dropItem(id, draggingId, target.groupId, at < 0 ? siblings.length : at);
    } else {
      const siblings = manifest.items
        .filter((i) => (i.groupId ?? null) === (target.groupId ?? null))
        .sort((a, b) => a.position - b.position);
      const from = siblings.findIndex((i) => i.entryId === draggingId);
      const to = siblings.findIndex((i) => i.entryId === targetEntryId);
      if (from >= 0 && to >= 0 && from !== to) {
        await dropItem(id, draggingId, target.groupId, to);
      }
    }
    setDraggingId(null);
  };

  const handleDropOnContainer = async (groupId: string | null) => {
    if (!draggingId || !reorderAllowed) return;
    const dragged = manifest.items.find((i) => i.entryId === draggingId);
    if (!dragged) return;
    if ((dragged.groupId ?? null) === (groupId ?? null)) {
      setDraggingId(null);
      return;
    }
    const siblings = manifest.items
      .filter((i) => (i.groupId ?? null) === (groupId ?? null))
      .sort((a, b) => a.position - b.position);
    await dropItem(id, draggingId, groupId, siblings.length);
    setDraggingId(null);
  };

  if (deleted) {
    return (
      <Card>
        <p className="py-8 text-center text-sm text-muted">
          Playlist deleted.{" "}
          <Link href="/saved" className="text-primary hover:underline">
            Back to Saved Library
          </Link>
        </p>
      </Card>
    );
  }

  const rowProps = {
    selected,
    toggleSelect,
    draggingId,
    setDraggingId,
    reorderAllowed,
    onDropOnItem: handleDropOnItem,
    onMove: (entryId: string, dir: -1 | 1) => void moveItem(id, entryId, dir),
    onRemove: (entryId: string) => void removeItems(id, [entryId]),
    onNote: (entryId: string, note: string | null) => void updateItemNote(id, entryId, note),
    onCustomEdit: (
      entryId: string,
      patch: { title?: string; note?: string | null; url?: string | null },
    ) => void updateCustomItem(id, entryId, patch),
    groupNameOf,
    sort,
  };

  return (
    <div className="space-y-5">
      {/* ── Header ── */}
      <Card>
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              {editingName ? (
                <span className="flex gap-2">
                  <input
                    value={nameValue}
                    onChange={(e) => setNameValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        const v = nameValue.trim();
                        if (v) {
                          void renamePlaylist(id, v).then(() => setEditingName(false));
                        }
                      }
                      if (e.key === "Escape") {
                        setNameValue(manifest.playlist.name);
                        setEditingName(false);
                      }
                    }}
                    aria-label="Playlist name"
                    className="h-9 min-w-0 flex-1 rounded-lg border border-border bg-surface px-3 text-sm"
                  />
                  <Button
                    variant="primary"
                    className="h-9 px-3 text-xs"
                    onClick={() => {
                      const v = nameValue.trim();
                      if (v) void renamePlaylist(id, v).then(() => setEditingName(false));
                    }}
                  >
                    <Check className="h-3.5 w-3.5" /> Save
                  </Button>
                </span>
              ) : (
                <span className="flex items-center gap-2">
                  <h2 className="truncate text-lg font-semibold text-foreground">{manifest.playlist.name}</h2>
                  <button
                    type="button"
                    onClick={() => {
                      setNameValue(manifest.playlist.name);
                      setEditingName(true);
                    }}
                    className="rounded-md p-1.5 text-muted hover:bg-surface-muted hover:text-foreground"
                    title="Rename playlist"
                    aria-label="Rename playlist"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                </span>
              )}
              {editingDesc ? (
                <span className="mt-2 flex gap-2">
                  <input
                    value={descValue}
                    onChange={(e) => setDescValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        void updatePlaylistDescription(id, descValue.trim() || null).then(() =>
                          setEditingDesc(false),
                        );
                      }
                      if (e.key === "Escape") {
                        setDescValue(manifest.playlist.description ?? "");
                        setEditingDesc(false);
                      }
                    }}
                    placeholder="Playlist description / general notes…"
                    aria-label="Playlist description"
                    className="h-9 min-w-0 flex-1 rounded-lg border border-border bg-surface px-3 text-xs"
                  />
                  <Button
                    variant="primary"
                    className="h-9 px-3 text-xs"
                    onClick={() =>
                      void updatePlaylistDescription(id, descValue.trim() || null).then(() =>
                        setEditingDesc(false),
                      )
                    }
                  >
                    <Check className="h-3.5 w-3.5" /> Save
                  </Button>
                </span>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    setDescValue(manifest.playlist.description ?? "");
                    setEditingDesc(true);
                  }}
                  className="mt-1 block max-w-full truncate text-left text-xs text-muted hover:text-foreground"
                  title="Edit description"
                >
                  {manifest.playlist.description || "Add a description or general notes…"}
                </button>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <Button variant="secondary" className="h-9 gap-1.5 px-3 text-xs" onClick={() => void exportPlaylist(id)}>
                <Download className="h-3.5 w-3.5" /> Export
              </Button>
              <Button variant="danger" className="h-9 gap-1.5 px-3 text-xs" onClick={() => setConfirmDelete(true)}>
                <Trash2 className="h-3.5 w-3.5" /> Delete
              </Button>
            </div>
          </div>
          <div className="flex flex-wrap gap-1.5 text-xs">
            <Badge tone="primary">{manifest.items.length} items</Badge>
            <Badge>{manifest.groups.length} sections</Badge>
            {counts.videos > 0 && <Badge>{counts.videos} videos</Badge>}
            {counts.shorts > 0 && <Badge>⚡ {counts.shorts} Shorts</Badge>}
            {counts.yt > 0 && <Badge>{counts.yt} YouTube playlists</Badge>}
            {counts.channels > 0 && <Badge>{counts.channels} channels</Badge>}
            {counts.custom > 0 && <Badge>{counts.custom} custom</Badge>}
            <span className="text-muted">Updated {formatDate(manifest.playlist.updatedAt)}</span>
          </div>
        </div>
      </Card>

      {notice && (
        <p className="rounded-lg border border-primary/30 bg-primary-soft px-3 py-2 text-xs text-primary">
          {notice}
        </p>
      )}

      {/* ── Toolbar ── */}
      <Card>
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-2 md:flex-row">
            <div className="relative min-w-0 flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search this playlist — titles, channels, notes, sections…"
                aria-label="Search inside playlist"
                className="h-10 w-full rounded-lg border border-border bg-surface pl-9 pr-8 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--ring)]"
              />
              {query && (
                <button
                  type="button"
                  onClick={() => setQuery("")}
                  aria-label="Clear playlist search"
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted hover:text-foreground"
                >
                  ×
                </button>
              )}
            </div>
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as LibrarySortMode)}
              aria-label="Sort playlist items"
              className="h-10 rounded-lg border border-border bg-surface px-2.5 text-xs"
            >
              {SORT_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="flex gap-1" role="group" aria-label="Filter by content type">
              {TYPE_FILTERS.map((t) => (
                <button
                  key={t.value}
                  type="button"
                  onClick={() => setContentFilter(t.value)}
                  aria-pressed={contentFilter === t.value}
                  className={`rounded-lg px-2.5 py-1.5 text-xs font-medium transition ${
                    contentFilter === t.value
                      ? "bg-primary text-white"
                      : "bg-surface-muted text-muted hover:text-foreground"
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </span>
            <select
              value={preset}
              onChange={(e) => setPreset(e.target.value as PublishedPreset)}
              aria-label="Filter by publication date"
              className="h-8 rounded-lg border border-border bg-surface px-2 text-xs"
            >
              <option value="all">All dates</option>
              <option value="24h">Last 24 hours</option>
              <option value="7d">Last 7 days</option>
              <option value="30d">Last 30 days</option>
              <option value="90d">Last 90 days</option>
              <option value="year">Last year</option>
              <option value="custom">Custom range…</option>
            </select>
            {preset === "custom" && (
              <span className="flex items-center gap-1.5 text-xs">
                <input
                  type="date"
                  value={customStart}
                  onChange={(e) => setCustomStart(e.target.value)}
                  aria-label="Published after"
                  className="h-8 rounded-lg border border-border bg-surface px-2 text-xs"
                />
                <span className="text-muted">–</span>
                <input
                  type="date"
                  value={customEnd}
                  onChange={(e) => setCustomEnd(e.target.value)}
                  aria-label="Published before"
                  className="h-8 rounded-lg border border-border bg-surface px-2 text-xs"
                />
              </span>
            )}
            <span className="flex items-center gap-1.5 text-xs">
              <input
                value={minViews}
                onChange={(e) => setMinViews(e.target.value.replace(/[^0-9]/g, ""))}
                placeholder="Min views"
                inputMode="numeric"
                aria-label="Minimum views"
                className="h-8 w-24 rounded-lg border border-border bg-surface px-2 text-xs"
              />
              <input
                value={maxViews}
                onChange={(e) => setMaxViews(e.target.value.replace(/[^0-9]/g, ""))}
                placeholder="Max views"
                inputMode="numeric"
                aria-label="Maximum views"
                className="h-8 w-24 rounded-lg border border-border bg-surface px-2 text-xs"
              />
            </span>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-muted">
              Showing <strong>{viewItems.length}</strong> of {manifest.items.length} items
              {query.trim() ? (
                <>
                  {" "}for “{query.trim()}”
                </>
              ) : null}
              {sort !== "manual" ? " — transient sort (manual order preserved)" : ""}
              {!reorderAllowed && sort === "manual" ? " — clear search & filters to reorder" : ""}
            </p>
            <div className="flex gap-2">
              <Button variant="secondary" className="h-8 gap-1.5 px-3 text-xs" onClick={() => setShowGroupForm((v) => !v)}>
                <FolderPlus className="h-3.5 w-3.5" /> New section
              </Button>
              <Button variant="secondary" className="h-8 gap-1.5 px-3 text-xs" onClick={() => setShowCustomForm((v) => !v)}>
                <Plus className="h-3.5 w-3.5" /> Add custom item
              </Button>
            </div>
          </div>
          {showGroupForm && (
            <GroupForm
              onCancel={() => setShowGroupForm(false)}
              onSubmit={(title, desc) => {
                void createGroup(id, title, desc).then(() => setShowGroupForm(false));
              }}
            />
          )}
          {showCustomForm && (
            <CustomItemForm
              onCancel={() => setShowCustomForm(false)}
              onSubmit={(input) => {
                void addCustomItem(id, input).then((ok) => {
                  if (ok) setShowCustomForm(false);
                });
              }}
            />
          )}
        </div>
      </Card>

      {/* ── Bulk bar ── */}
      {selected.size > 0 && (
        <Card className="border-primary/40">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <strong>{selected.size} selected</strong>
            <button type="button" onClick={() => setSelected(new Set())} className="text-primary hover:underline">
              Clear
            </button>
            <span className="text-muted">|</span>
            <select
              value=""
              onChange={(e) => {
                const v = e.target.value;
                if (v === "__none__") void handleBulkGroup(null);
                else if (v) void handleBulkGroup(v);
              }}
              aria-label="Move selected to section"
              className="h-8 rounded-lg border border-border bg-surface px-2 text-xs"
            >
              <option value="">Move to section…</option>
              <option value="__none__">Ungrouped</option>
              {orderedGroups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.title}
                </option>
              ))}
            </select>
            <select
              value={bulkTarget}
              onChange={(e) => setBulkTarget(e.target.value)}
              aria-label="Target playlist for copy or move"
              className="h-8 rounded-lg border border-border bg-surface px-2 text-xs"
            >
              <option value="">Other playlist…</option>
              {allPlaylists
                .filter((p) => p.id !== id)
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
            </select>
            <Button variant="secondary" className="h-8 px-3 text-xs" disabled={!bulkTarget} onClick={() => void handleBulkCopy()}>
              Copy to
            </Button>
            <Button variant="secondary" className="h-8 px-3 text-xs" disabled={!bulkTarget} onClick={() => void handleBulkMove()}>
              Move to
            </Button>
            <Button variant="secondary" className="h-8 px-3 text-xs" onClick={() => void handleCreateGroupFromSelection()}>
              <Layers className="h-3.5 w-3.5" /> Group selected
            </Button>
            <Button variant="danger" className="h-8 px-3 text-xs" onClick={() => void handleBulkRemove()}>
              <Trash2 className="h-3.5 w-3.5" /> Remove
            </Button>
          </div>
        </Card>
      )}

      {/* ── Undo toast ── */}
      {lastRemoved && lastRemoved.playlistId === id && (
        <div className="fixed bottom-6 right-6 z-50 flex items-center gap-3 rounded-xl border border-primary/40 bg-surface px-4 py-3 text-sm shadow-2xl">
          <span>Removed {lastRemoved.items.length} item{lastRemoved.items.length === 1 ? "" : "s"}.</span>
          <button
            type="button"
            onClick={() => void undoRemove()}
            className="inline-flex items-center gap-1 font-medium text-primary hover:underline"
          >
            <Undo2 className="h-3.5 w-3.5" /> Undo
          </button>
        </div>
      )}

      {/* ── Content ── */}
      {viewItems.length === 0 ? (
        <Card>
          <div className="flex flex-col items-center gap-2 py-10 text-center">
            <Search className="h-10 w-10 text-muted/40" />
            <p className="text-sm font-medium text-foreground">
              {manifest.items.length === 0 ? "This playlist is empty" : "No items match"}
            </p>
            <p className="max-w-md text-xs text-muted">
              {manifest.items.length === 0
                ? "Add videos, Shorts, YouTube playlists, channels, or custom notes from search results or the Saved hub."
                : "Try clearing the search box or loosening type, date, and view filters."}
            </p>
            {filtersActive && (
              <Button
                variant="secondary"
                className="mt-2 h-8 px-3 text-xs"
                onClick={() => {
                  setQuery("");
                  setContentFilter("all");
                  setPreset("all");
                  setMinViews("");
                  setMaxViews("");
                }}
              >
                Clear search & filters
              </Button>
            )}
          </div>
        </Card>
      ) : sort === "manual" ? (
        <div className="space-y-4">
          {orderedGroups.map((group) => {
            const members = viewItems
              .filter((i) => i.groupId === group.id)
              .sort((a, b) => a.position - b.position);
            const isCollapsed = collapsed.has(group.id);
            return (
              <section
                key={group.id}
                aria-label={`Section ${group.title}`}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => void handleDropOnContainer(group.id)}
                className="overflow-hidden rounded-xl border border-border/70 bg-surface"
              >
                <GroupHeader
                  groupId={group.id}
                  title={group.title}
                  description={group.description}
                  count={members.length}
                  collapsed={isCollapsed}
                  onToggle={() =>
                    setCollapsed((prev) => {
                      const next = new Set(prev);
                      if (next.has(group.id)) next.delete(group.id);
                      else next.add(group.id);
                      return next;
                    })
                  }
                  onRename={(t) => void renameGroup(id, group.id, t)}
                  onDescription={(d) => void updateGroupDescription(id, group.id, d)}
                  onMoveUp={() => void moveGroup(id, group.id, -1)}
                  onMoveDown={() => void moveGroup(id, group.id, 1)}
                  onDelete={(mode) => void deleteGroup(id, group.id, mode)}
                />
                {!isCollapsed && (
                  <div className="space-y-2 p-3">
                    {members.length === 0 ? (
                      <p className="rounded-lg border border-dashed border-border p-3 text-center text-xs text-muted">
                        {filtersActive
                          ? "No visible items in this section under the current filters."
                          : "Empty section — drag items here or use the bulk selector."}
                      </p>
                    ) : (
                      members.map((item) => (
                        <ItemRow key={item.entryId} item={item} {...rowProps} />
                      ))
                    )}
                  </div>
                )}
              </section>
            );
          })}
          <section
            aria-label="Ungrouped items"
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => void handleDropOnContainer(null)}
            className="overflow-hidden rounded-xl border border-border/70 bg-surface"
          >
            <div className="flex items-center justify-between border-b border-border/50 bg-surface-muted/40 px-4 py-2.5">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted">
                Ungrouped · {ungrouped.length}
              </p>
              <span className="text-[11px] text-muted">
                {groupedCount} in sections
              </span>
            </div>
            <div className="space-y-2 p-3">
              {ungrouped.length === 0 ? (
                <p className="rounded-lg border border-dashed border-border p-3 text-center text-xs text-muted">
                  {manifest.items.length === 0
                    ? "Nothing here yet — add your first item."
                    : "Every visible item is organized into a section."}
                </p>
              ) : (
                ungrouped
                  .sort((a, b) => a.position - b.position)
                  .map((item) => <ItemRow key={item.entryId} item={item} {...rowProps} />)
              )}
            </div>
          </section>
        </div>
      ) : (
        <div className="space-y-2">
          {viewItems.map((item) => (
            <ItemRow key={item.entryId} item={item} {...rowProps} flat />
          ))}
        </div>
      )}

      {confirmDelete && (
        <ConfirmDialog
          title={`Delete “${manifest.playlist.name}”?`}
          body="This removes the playlist and its manifest permanently. Global saved items, searches, and other playlists are kept."
          confirmLabel="Delete playlist"
          onCancel={() => setConfirmDelete(false)}
          onConfirm={() => {
            void deletePlaylist(id).then((ok) => {
              if (ok) setDeleted(true);
              setConfirmDelete(false);
            });
          }}
        />
      )}
    </div>
  );
}

/* ── Group header ── */

function GroupHeader({
  groupId,
  title,
  description,
  count,
  collapsed,
  onToggle,
  onRename,
  onDescription,
  onMoveUp,
  onMoveDown,
  onDelete,
}: {
  groupId: string;
  title: string;
  description: string | null;
  count: number;
  collapsed: boolean;
  onToggle: () => void;
  onRename: (title: string) => void;
  onDescription: (desc: string | null) => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onDelete: (mode: "keep-items" | "delete-items") => void;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(title);
  const [editingDesc, setEditingDesc] = useState(false);
  const [descValue, setDescValue] = useState(description ?? "");
  const [confirming, setConfirming] = useState<null | "keep-items" | "delete-items">(null);

  return (
    <div className="border-b border-border/50 bg-surface-muted/40 px-3 py-2.5">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={!collapsed}
          aria-label={`${collapsed ? "Expand" : "Collapse"} section ${title}`}
          className="rounded-md p-1 text-muted hover:bg-surface-muted hover:text-foreground"
        >
          {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </button>
        {editing ? (
          <span className="flex min-w-0 flex-1 gap-1.5">
            <input
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && value.trim()) {
                  onRename(value.trim());
                  setEditing(false);
                }
                if (e.key === "Escape") {
                  setValue(title);
                  setEditing(false);
                }
              }}
              aria-label="Section title"
              className="h-8 min-w-0 flex-1 rounded-md border border-border bg-surface px-2 text-xs"
            />
            <button
              type="button"
              onClick={() => {
                if (value.trim()) {
                  onRename(value.trim());
                  setEditing(false);
                }
              }}
              className="rounded-md p-1.5 text-primary hover:bg-primary-soft"
              aria-label="Save section title"
            >
              <Check className="h-4 w-4" />
            </button>
          </span>
        ) : (
          <button
            type="button"
            onClick={onToggle}
            className="min-w-0 flex-1 truncate text-left text-sm font-semibold text-foreground"
          >
            {title} <span className="ml-1 text-xs font-normal text-muted">({count})</span>
          </button>
        )}
        <span className="flex shrink-0 items-center gap-0.5">
          <button type="button" onClick={onMoveUp} title="Move section up" aria-label={`Move section ${title} up`} className="rounded-md p-1.5 text-muted hover:bg-surface-muted hover:text-foreground">
            <ArrowUp className="h-3.5 w-3.5" />
          </button>
          <button type="button" onClick={onMoveDown} title="Move section down" aria-label={`Move section ${title} down`} className="rounded-md p-1.5 text-muted hover:bg-surface-muted hover:text-foreground">
            <ArrowDown className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => {
              setValue(title);
              setEditing(true);
            }}
            title="Rename section"
            className="rounded-md p-1.5 text-muted hover:bg-surface-muted hover:text-foreground"
          >
            <Pencil className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => setConfirming("keep-items")}
            title="Delete section"
            aria-label={`Delete section ${title}`}
            className="rounded-md p-1.5 text-muted hover:bg-danger/10 hover:text-danger"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </span>
      </div>
      {(description || editingDesc) && (
        <div className="ml-7 mt-1">
          {editingDesc ? (
            <span className="flex gap-1.5">
              <input
                value={descValue}
                onChange={(e) => setDescValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    onDescription(descValue.trim() || null);
                    setEditingDesc(false);
                  }
                  if (e.key === "Escape") {
                    setDescValue(description ?? "");
                    setEditingDesc(false);
                  }
                }}
                placeholder="Section note…"
                aria-label="Section description"
                className="h-7 min-w-0 flex-1 rounded-md border border-border bg-surface px-2 text-xs"
              />
              <button
                type="button"
                onClick={() => {
                  onDescription(descValue.trim() || null);
                  setEditingDesc(false);
                }}
                className="rounded-md p-1 text-primary hover:bg-primary-soft"
                aria-label="Save section note"
              >
                <Check className="h-3.5 w-3.5" />
              </button>
            </span>
          ) : (
            <button
              type="button"
              onClick={() => {
                setDescValue(description ?? "");
                setEditingDesc(true);
              }}
              className="block max-w-full truncate text-left text-[11px] text-muted hover:text-foreground"
              title="Edit section note"
            >
              {description}
            </button>
          )}
        </div>
      )}
      {!description && !editingDesc && (
        <button
          type="button"
          onClick={() => setEditingDesc(true)}
          className="ml-7 mt-0.5 text-[11px] text-muted/70 hover:text-foreground"
        >
          + Add section note
        </button>
      )}
      {confirming && (
        <span className="ml-7 mt-2 flex flex-wrap items-center gap-2 rounded-lg border border-danger/30 bg-danger/5 px-2.5 py-2 text-[11px]">
          <span>Delete “{title}”?</span>
          <button
            type="button"
            onClick={() => {
              onDelete("keep-items");
              setConfirming(null);
            }}
            className="rounded-md bg-surface px-2 py-1 font-medium hover:bg-surface-muted"
          >
            Keep items (ungroup)
          </button>
          <button
            type="button"
            onClick={() => {
              onDelete("delete-items");
              setConfirming(null);
            }}
            className="rounded-md bg-danger px-2 py-1 font-medium text-white"
          >
            Delete items too
          </button>
          <button type="button" onClick={() => setConfirming(null)} className="text-muted hover:text-foreground">
            Cancel
          </button>
          <span className="hidden">{groupId}</span>
        </span>
      )}
    </div>
  );
}

/* ── Item row ── */

interface RowShared {
  selected: Set<string>;
  toggleSelect: (entryId: string) => void;
  draggingId: string | null;
  setDraggingId: (entryId: string | null) => void;
  reorderAllowed: boolean;
  onDropOnItem: (targetEntryId: string) => void;
  onMove: (entryId: string, dir: -1 | 1) => void;
  onRemove: (entryId: string) => void;
  onNote: (entryId: string, note: string | null) => void;
  onCustomEdit: (
    entryId: string,
    patch: { title?: string; note?: string | null; url?: string | null },
  ) => void;
  groupNameOf: (groupId: string | null) => string;
  sort: LibrarySortMode;
}

function typeBadge(item: LibraryPlaylistItem) {
  if (item.kind === "custom") return <Badge tone="ai"><StickyNote className="h-3 w-3" /> Custom</Badge>;
  switch (item.youtubeKind) {
    case "video":
      return <Badge tone="primary">Video</Badge>;
    case "shorts":
      return <Badge tone="primary">⚡ Shorts</Badge>;
    case "youtube_playlist":
      return <Badge tone="ai">YouTube Playlist</Badge>;
    case "channel":
      return <Badge tone="neutral">Channel</Badge>;
  }
}

function ItemRow({ item, flat, ...shared }: { item: LibraryPlaylistItem; flat?: boolean } & RowShared) {
  const [editingNote, setEditingNote] = useState(false);
  const [noteValue, setNoteValue] = useState(item.kind === "custom" ? (item.customNote ?? "") : (item.note ?? ""));
  const [editingCustom, setEditingCustom] = useState(false);
  const [customTitle, setCustomTitle] = useState(item.kind === "custom" ? item.title : "");
  const [customUrl, setCustomUrl] = useState(item.kind === "custom" ? (item.url ?? "") : "");
  const [confirmRemove, setConfirmRemove] = useState(false);
  const checked = shared.selected.has(item.entryId);
  const isDragging = shared.draggingId === item.entryId;

  const title = libraryItemTitle(item);
  const thumb = item.kind === "custom" ? null : item.snapshot.thumbnailUrl;
  const channel = item.kind === "custom" ? null : item.snapshot.channelTitle;
  const openUrl = item.kind === "custom" ? item.url : item.snapshot.url;
  const note = item.kind === "custom" ? (item.customNote ?? item.note) : item.note;

  return (
    <article
      draggable={shared.reorderAllowed}
      onDragStart={(e) => {
        if (!shared.reorderAllowed) {
          e.preventDefault();
          return;
        }
        shared.setDraggingId(item.entryId);
        e.dataTransfer.effectAllowed = "move";
      }}
      onDragEnd={() => shared.setDraggingId(null)}
      onDragOver={(e) => {
        if (shared.reorderAllowed) e.preventDefault();
      }}
      onDrop={(e) => {
        e.stopPropagation();
        void shared.onDropOnItem(item.entryId);
      }}
      aria-label={title}
      className={`research-surface flex items-start gap-3 p-3 transition ${
        isDragging ? "border-primary/60 opacity-60" : ""
      } ${checked ? "border-primary/50" : ""}`}
    >
      {shared.reorderAllowed && (
        <span
          className="mt-1 cursor-grab touch-none text-muted"
          title="Drag to reorder"
          aria-hidden="true"
        >
          <GripVertical className="h-4 w-4" />
        </span>
      )}
      <input
        type="checkbox"
        checked={checked}
        onChange={() => shared.toggleSelect(item.entryId)}
        aria-label={`Select ${title}`}
        className="mt-1.5 h-4 w-4 shrink-0 accent-[var(--primary)]"
      />
      <div className="relative h-14 w-24 shrink-0 overflow-hidden rounded-md bg-surface-muted">
        {thumb ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={thumb} alt="" loading="lazy" className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full items-center justify-center">
            <StickyNote className="h-4 w-4 text-muted" />
          </div>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-foreground" title={title}>
          {title}
        </p>
        <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted">
          {typeBadge(item)}
          {flat && <Badge>{shared.groupNameOf(item.groupId)}</Badge>}
          {channel && <span className="truncate">{channel}</span>}
          {item.kind === "youtube" && item.snapshot.durationSeconds !== null && (
            <span>{formatDuration(item.snapshot.durationSeconds)}</span>
          )}
          {item.kind === "youtube" && item.snapshot.viewsCount !== null && (
            <span>{formatCount(item.snapshot.viewsCount, "views")}</span>
          )}
          {item.kind === "youtube" && item.snapshot.publishedAt && (
            <span title={item.snapshot.publishedAt}>{formatDate(item.snapshot.publishedAt)}</span>
          )}
          {item.kind === "youtube" && item.snapshot.viewsCount === null && (
            <span className="italic">views unknown</span>
          )}
        </div>
        {note && !editingNote && (
          <p className="mt-1.5 line-clamp-2 rounded-md bg-surface-muted/60 px-2 py-1 text-xs italic text-muted">
            {note}
          </p>
        )}
        {editingNote && (
          <span className="mt-1.5 flex gap-1.5">
            <input
              value={noteValue}
              onChange={(e) => setNoteValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  if (item.kind === "custom") shared.onCustomEdit(item.entryId, { note: noteValue || null });
                  else shared.onNote(item.entryId, noteValue || null);
                  setEditingNote(false);
                }
                if (e.key === "Escape") setEditingNote(false);
              }}
              placeholder="Add a note…"
              aria-label="Item note"
              className="h-8 min-w-0 flex-1 rounded-md border border-border bg-surface px-2 text-xs"
            />
            <button
              type="button"
              onClick={() => {
                if (item.kind === "custom") shared.onCustomEdit(item.entryId, { note: noteValue || null });
                else shared.onNote(item.entryId, noteValue || null);
                setEditingNote(false);
              }}
              className="rounded-md p-1.5 text-primary hover:bg-primary-soft"
              aria-label="Save note"
            >
              <Check className="h-3.5 w-3.5" />
            </button>
          </span>
        )}
        {editingCustom && item.kind === "custom" && (
          <span className="mt-1.5 flex flex-col gap-1.5">
            <input
              value={customTitle}
              onChange={(e) => setCustomTitle(e.target.value)}
              aria-label="Custom item title"
              className="h-8 w-full rounded-md border border-border bg-surface px-2 text-xs"
            />
            <input
              value={customUrl}
              onChange={(e) => setCustomUrl(e.target.value)}
              placeholder="Optional URL"
              aria-label="Custom item URL"
              className="h-8 w-full rounded-md border border-border bg-surface px-2 text-xs"
            />
            <span className="flex gap-1.5">
              <Button
                variant="primary"
                className="h-7 px-2.5 text-xs"
                onClick={() => {
                  if (customTitle.trim()) {
                    shared.onCustomEdit(item.entryId, {
                      title: customTitle.trim(),
                      url: customUrl.trim() || null,
                    });
                    setEditingCustom(false);
                  }
                }}
              >
                Save
              </Button>
              <Button variant="ghost" className="h-7 px-2.5 text-xs" onClick={() => setEditingCustom(false)}>
                Cancel
              </Button>
            </span>
          </span>
        )}
        <p className="mt-1 text-[11px] text-muted/70">Added {formatDate(item.addedAt)}</p>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1">
        <span className="flex items-center gap-0.5">
          <button
            type="button"
            onClick={() => shared.onMove(item.entryId, -1)}
            disabled={!shared.reorderAllowed}
            title={shared.reorderAllowed ? "Move up" : "Manual order with no filters required"}
            aria-label={`Move ${title} up`}
            className="rounded-md p-1.5 text-muted hover:bg-surface-muted hover:text-foreground disabled:opacity-30"
          >
            <ArrowUp className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => shared.onMove(item.entryId, 1)}
            disabled={!shared.reorderAllowed}
            title={shared.reorderAllowed ? "Move down" : "Manual order with no filters required"}
            aria-label={`Move ${title} down`}
            className="rounded-md p-1.5 text-muted hover:bg-surface-muted hover:text-foreground disabled:opacity-30"
          >
            <ArrowDown className="h-3.5 w-3.5" />
          </button>
        </span>
        <span className="flex items-center gap-0.5">
          <button
            type="button"
            onClick={() => {
              setNoteValue(item.kind === "custom" ? (item.customNote ?? "") : (item.note ?? ""));
              setEditingNote(true);
            }}
            title={note ? "Edit note" : "Add note"}
            aria-label={`${note ? "Edit note on" : "Add note to"} ${title}`}
            className="rounded-md p-1.5 text-muted hover:bg-surface-muted hover:text-foreground"
          >
            <StickyNote className="h-3.5 w-3.5" />
          </button>
          {item.kind === "custom" && (
            <button
              type="button"
              onClick={() => setEditingCustom(true)}
              title="Edit custom item"
              aria-label={`Edit custom item ${title}`}
              className="rounded-md p-1.5 text-muted hover:bg-surface-muted hover:text-foreground"
            >
              <Pencil className="h-3.5 w-3.5" />
            </button>
          )}
          {openUrl && (
            <a
              href={openUrl}
              target="_blank"
              rel="noopener noreferrer"
              title="Open link"
              aria-label={`Open link for ${title}`}
              className="rounded-md p-1.5 text-muted hover:bg-surface-muted hover:text-foreground"
            >
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          )}
          {confirmRemove ? (
            <span className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => shared.onRemove(item.entryId)}
                className="rounded-md bg-danger px-1.5 py-1 text-[11px] font-medium text-white"
              >
                Confirm
              </button>
              <button
                type="button"
                onClick={() => setConfirmRemove(false)}
                className="rounded-md px-1 py-1 text-[11px] text-muted hover:text-foreground"
              >
                Keep
              </button>
            </span>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmRemove(true)}
              title="Remove from playlist"
              aria-label={`Remove ${title} from playlist`}
              className="rounded-md p-1.5 text-muted hover:bg-danger/10 hover:text-danger"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          )}
        </span>
      </div>
    </article>
  );
}

/* ── Forms ── */

function CustomItemForm({
  onCancel,
  onSubmit,
}: {
  onCancel: () => void;
  onSubmit: (input: { title: string; note?: string | null; url?: string | null }) => void;
}) {
  const [title, setTitle] = useState("");
  const [note, setNote] = useState("");
  const [url, setUrl] = useState("");
  return (
    <div className="rounded-lg border border-border bg-surface-muted/30 p-3">
      <p className="mb-2 text-xs font-semibold text-foreground">
        <ListPlus className="mr-1 inline h-3.5 w-3.5" />
        Add custom item / note — no YouTube ID required
      </p>
      <div className="flex flex-col gap-2">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Title (required) — e.g. Study these concepts later"
          aria-label="Custom item title"
          className="h-9 w-full rounded-lg border border-border bg-surface px-3 text-xs"
        />
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Note or description (optional)"
          aria-label="Custom item note"
          rows={2}
          className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-xs"
        />
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="Optional URL"
          aria-label="Custom item URL"
          className="h-9 w-full rounded-lg border border-border bg-surface px-3 text-xs"
        />
        <div className="flex justify-end gap-2">
          <Button variant="ghost" className="h-8 px-3 text-xs" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            variant="primary"
            className="h-8 px-3 text-xs"
            disabled={!title.trim()}
            onClick={() =>
              onSubmit({ title: title.trim(), note: note.trim() || null, url: url.trim() || null })
            }
          >
            Add item
          </Button>
        </div>
      </div>
    </div>
  );
}

function GroupForm({
  onCancel,
  onSubmit,
}: {
  onCancel: () => void;
  onSubmit: (title: string, description: string | null) => void;
}) {
  const [title, setTitle] = useState("");
  const [desc, setDesc] = useState("");
  return (
    <div className="rounded-lg border border-border bg-surface-muted/30 p-3">
      <p className="mb-2 text-xs font-semibold text-foreground">
        <FolderPlus className="mr-1 inline h-3.5 w-3.5" />
        New section inside this playlist
      </p>
      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Section title (required)"
          aria-label="Section title"
          className="h-9 min-w-0 flex-1 rounded-lg border border-border bg-surface px-3 text-xs"
        />
        <input
          value={desc}
          onChange={(e) => setDesc(e.target.value)}
          placeholder="Note (optional)"
          aria-label="Section note"
          className="h-9 min-w-0 flex-1 rounded-lg border border-border bg-surface px-3 text-xs"
        />
        <span className="flex shrink-0 justify-end gap-2">
          <Button variant="ghost" className="h-9 px-3 text-xs" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            variant="primary"
            className="h-9 px-3 text-xs"
            disabled={!title.trim()}
            onClick={() => onSubmit(title.trim(), desc.trim() || null)}
          >
            Create
          </Button>
        </span>
      </div>
    </div>
  );
}
