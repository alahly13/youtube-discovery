"use client";

import {
  Bookmark,
  Check,
  Copy,
  ExternalLink,
  Film,
  FolderPlus,
  Layers,
  Library,
  ListPlus,
  Loader2,
  Play,
  Search,
  Star,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { NormalizedYouTubeDiscoveryItem } from "@/types/youtube";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { AddToPlaylistDialog } from "@/components/library/add-to-playlist-dialog";
import {
  createLocalSearcher,
  searchRanked,
  toSearchDoc,
  type LocalSearcher,
} from "@/lib/search/local-search";
import { canonicalYoutubeKey } from "@/types/library";
import { youtubeKindFromNormalized } from "@/lib/playlists/playlist-query";
import {
  collectPlaylistKeys,
  useUserPlaylistsStore,
} from "@/lib/state/user-playlists-store";
import { useYouTubeWorkspaceStore } from "@/lib/state/youtube-workspace-store";
import { formatCount, formatDate, formatDuration } from "@/lib/utils/format";

/* ═══════════════════════════════════════════════════════════════════════════
   Saved Library Hub — /saved
   ──────────────────────────────────────────────────────────────────────────
   Three distinct responsibilities, one hub:
     Playlists tab → browse/create/rename/delete user playlists (each with
       its own manifest + dedicated page at /saved/[playlistId]).
     Saved Items tab → global saved entities with dedupe by platformItemId,
       standalone detection (not yet in any playlist), and add-to-playlist.
     Saved Searches tab → preserved saved-search titles shelf.
   All tab searches run through the shared FlexSearch local-search service —
   strictly local, zero YouTube quota.
   ═══════════════════════════════════════════════════════════════════════════ */

type HubTab = "playlists" | "items" | "searches";
type ItemTypeFilter = "all" | "video" | "shorts" | "channel" | "playlist";
type PlaylistSort = "updated" | "name_az" | "most_items";

export function SavedLibraryWorkspace() {
  const [activeTab, setActiveTab] = useState<HubTab>("playlists");
  const [searchQuery, setSearchQuery] = useState("");
  const [copiedId, setCopiedId] = useState<string | null>(null);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2 overflow-x-auto rounded-lg border border-border bg-surface-muted/40 p-1">
          <HubTabButton
            active={activeTab === "playlists"}
            onClick={() => setActiveTab("playlists")}
            icon={<Library className="h-3.5 w-3.5" />}
            label="Playlists"
          />
          <HubTabButton
            active={activeTab === "items"}
            onClick={() => setActiveTab("items")}
            icon={<Film className="h-3.5 w-3.5" />}
            label="Saved Items"
          />
          <HubTabButton
            active={activeTab === "searches"}
            onClick={() => setActiveTab("searches")}
            icon={<Bookmark className="h-3.5 w-3.5 text-primary" />}
            label="Saved Searches"
          />
        </div>
        <div className="relative min-w-[240px]">
          <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted" />
          <input
            className="h-9 w-full rounded-lg border border-border bg-surface pl-9 pr-8 text-xs focus:outline-none focus:ring-2 focus:ring-[var(--ring)]"
            placeholder={
              activeTab === "playlists"
                ? "Search playlists by name…"
                : activeTab === "items"
                  ? "Filter saved videos, channels, playlists…"
                  : "Filter saved search titles & queries…"
            }
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            aria-label="Search saved library"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery("")}
              aria-label="Clear search"
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted hover:text-foreground"
            >
              ×
            </button>
          )}
        </div>
      </div>

      {activeTab === "playlists" && <PlaylistsTab query={searchQuery} />}
      {activeTab === "items" && <SavedItemsTab query={searchQuery} onCopy={setCopiedId} copiedId={copiedId} />}
      {activeTab === "searches" && <SavedSearchesTab query={searchQuery} onCopy={setCopiedId} copiedId={copiedId} />}
    </div>
  );
}

function HubTabButton({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`flex shrink-0 items-center gap-2 rounded-md px-3 py-1.5 text-xs font-medium transition ${
        active ? "bg-surface text-foreground shadow-xs" : "text-muted hover:text-foreground"
      }`}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}

/* ═══════════════════ Playlists tab ═══════════════════ */

function PlaylistsTab({ query }: { query: string }) {
  const index = useUserPlaylistsStore((s) => s.index);
  const indexLoaded = useUserPlaylistsStore((s) => s.indexLoaded);
  const fetchIndex = useUserPlaylistsStore((s) => s.fetchIndex);
  const createPlaylist = useUserPlaylistsStore((s) => s.createPlaylist);
  const renamePlaylist = useUserPlaylistsStore((s) => s.renamePlaylist);
  const deletePlaylist = useUserPlaylistsStore((s) => s.deletePlaylist);

  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);
  const [sort, setSort] = useState<PlaylistSort>("updated");
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => {
    if (!indexLoaded) void fetchIndex();
  }, [indexLoaded, fetchIndex]);

  // Shared search over playlist names + descriptions (index built once per
  // index change, reused across keystrokes).
  const searchDocs = useMemo(
    () =>
      index.map((p) =>
        toSearchDoc(p.id, p.name, p.description, [
          `items ${p.itemCount}`,
          `groups ${p.groupCount}`,
        ]),
      ),
    [index],
  );
  const searcher: LocalSearcher | null = useMemo(
    () => (searchDocs.length > 0 ? createLocalSearcher(searchDocs) : null),
    [searchDocs],
  );
  const ranked = useMemo(
    () => searchRanked(index, searchDocs, searcher, query),
    [index, searchDocs, searcher, query],
  );
  const visible = useMemo(() => {
    const arr = [...ranked];
    if (sort === "name_az") arr.sort((a, b) => a.name.localeCompare(b.name));
    else if (sort === "most_items") arr.sort((a, b) => b.itemCount - a.itemCount);
    else arr.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    // A text query already defines relevance order — keep it.
    return query.trim() ? ranked : arr;
  }, [ranked, sort, query]);

  const handleCreate = async () => {
    const name = newName.trim();
    if (!name || creating) return;
    setCreating(true);
    await createPlaylist(name);
    setCreating(false);
    setNewName("");
  };

  const handleRename = async (id: string) => {
    const name = renameValue.trim();
    if (!name) return;
    await renamePlaylist(id, name);
    setRenamingId(null);
  };

  const handleDelete = async (id: string) => {
    await deletePlaylist(id);
    setDeletingId(null);
  };

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="min-w-0 flex-1">
            <label htmlFor="new-playlist-name" className="mb-1 block text-xs font-medium text-muted">
              Create a new playlist
            </label>
            <input
              id="new-playlist-name"
              className="h-10 w-full rounded-lg border border-border bg-surface px-3 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--ring)]"
              placeholder="e.g. React Tutorials, Biology, Favorites…"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void handleCreate();
              }}
            />
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as PlaylistSort)}
              aria-label="Sort playlists"
              className="h-10 rounded-lg border border-border bg-surface px-2.5 text-xs text-foreground"
            >
              <option value="updated">Recently updated</option>
              <option value="name_az">Name A–Z</option>
              <option value="most_items">Most items</option>
            </select>
            <Button
              variant="primary"
              disabled={!newName.trim() || creating}
              onClick={() => void handleCreate()}
            >
              {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <FolderPlus className="h-4 w-4" />}
              Create
            </Button>
          </div>
        </div>
        <p className="mt-2 text-[11px] text-muted">
          Each playlist gets its own permanent manifest file and dedicated page. Playlists persist
          until you delete them — search-history expiry never touches them.
        </p>
      </Card>

      {!indexLoaded ? (
        <Card>
          <p className="flex items-center justify-center gap-2 py-8 text-sm text-muted">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading playlists…
          </p>
        </Card>
      ) : visible.length === 0 ? (
        <Card>
          <div className="flex flex-col items-center gap-3 py-10 text-center">
            <Library className="h-10 w-10 text-muted/40" />
            <div>
              <p className="text-sm font-medium text-foreground">
                {index.length === 0 ? "No playlists yet" : "No playlists match your search"}
              </p>
              <p className="mt-1 text-xs text-muted">
                {index.length === 0
                  ? "Create your first playlist above, then add videos, Shorts, YouTube playlists, channels, and custom notes from any result card."
                  : "Try a different search term or clear the search box."}
              </p>
            </div>
          </div>
        </Card>
      ) : (
        <>
          <p className="text-xs text-muted">
            Showing <strong>{visible.length}</strong> of {index.length} playlists
            {query.trim() ? (
              <>
                {" "}for “{query.trim()}” — ranked by relevance
              </>
            ) : null}
            .
          </p>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {visible.map((entry) => (
              <div
                key={entry.id}
                className="research-surface flex flex-col p-4 transition hover:border-primary/40"
              >
                <Link href={`/saved/${entry.id}`} className="group block min-w-0">
                  <PlaylistCollage thumbnails={entry.thumbnails} name={entry.name} />
                  <h3 className="mt-3 truncate text-sm font-semibold text-foreground group-hover:text-primary">
                    {entry.name}
                  </h3>
                </Link>
                {entry.description && (
                  <p className="mt-1 line-clamp-2 text-xs text-muted">{entry.description}</p>
                )}
                <div className="mt-2 flex flex-wrap gap-1.5">
                  <Badge tone="primary">{entry.itemCount} items</Badge>
                  <Badge>
                    <Layers className="h-3 w-3" /> {entry.groupCount} sections
                  </Badge>
                  {(entry.counts.shorts ?? 0) > 0 && <Badge>⚡ {entry.counts.shorts} Shorts</Badge>}
                </div>
                <p className="mt-2 text-[11px] text-muted">Updated {formatDate(entry.updatedAt)}</p>
                <div className="mt-3 flex items-center gap-1.5 border-t border-border/50 pt-3">
                  {renamingId === entry.id ? (
                    <span className="flex min-w-0 flex-1 gap-1.5">
                      <input
                        value={renameValue}
                        onChange={(e) => setRenameValue(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") void handleRename(entry.id);
                          if (e.key === "Escape") setRenamingId(null);
                        }}
                        aria-label="Playlist name"
                        className="h-8 min-w-0 flex-1 rounded-md border border-border bg-surface px-2 text-xs"
                      />
                      <Button variant="primary" className="h-8 px-2.5 text-xs" onClick={() => void handleRename(entry.id)}>
                        <Check className="h-3.5 w-3.5" />
                      </Button>
                    </span>
                  ) : (
                    <>
                      <Link
                        href={`/saved/${entry.id}`}
                        className="inline-flex h-8 flex-1 items-center justify-center gap-1.5 rounded-lg bg-primary-soft px-3 text-xs font-medium text-primary hover:bg-primary/20"
                      >
                        <Play className="h-3 w-3 fill-current" /> Open
                      </Link>
                      <button
                        type="button"
                        onClick={() => {
                          setRenamingId(entry.id);
                          setRenameValue(entry.name);
                        }}
                        className="rounded-md px-2 py-1.5 text-xs text-muted hover:bg-surface-muted hover:text-foreground"
                      >
                        Rename
                      </button>
                      <button
                        type="button"
                        onClick={() => setDeletingId(entry.id)}
                        className="rounded-md p-1.5 text-muted hover:bg-danger/10 hover:text-danger"
                        title="Delete playlist"
                        aria-label={`Delete playlist ${entry.name}`}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {deletingId && (
        <ConfirmDialog
          title="Delete playlist?"
          body="This removes the playlist and its manifest permanently. Saved items in your global library are kept."
          confirmLabel="Delete"
          onCancel={() => setDeletingId(null)}
          onConfirm={() => void handleDelete(deletingId)}
        />
      )}
    </div>
  );
}

function PlaylistCollage({ thumbnails, name }: { thumbnails: string[]; name: string }) {
  if (thumbnails.length === 0) {
    return (
      <div className="flex aspect-video items-center justify-center rounded-lg bg-surface-muted">
        <Library className="h-8 w-8 text-muted/40" />
      </div>
    );
  }
  return (
    <div className="grid aspect-video grid-cols-2 gap-0.5 overflow-hidden rounded-lg bg-surface-muted">
      {[0, 1, 2, 3].map((i) => {
        const src = thumbnails[i % thumbnails.length];
        return (
          // eslint-disable-next-line @next/next/no-img-element
          <img key={i} src={src} alt="" loading="lazy" title={name} className="h-full w-full object-cover" />
        );
      })}
    </div>
  );
}

/* ═══════════════════ Saved items tab ═══════════════════ */

function SavedItemsTab({
  query,
  onCopy,
  copiedId,
}: {
  query: string;
  onCopy: (id: string | null) => void;
  copiedId: string | null;
}) {
  const savedItems = useYouTubeWorkspaceStore((s) => s.savedItems);
  const toggleItemSaved = useYouTubeWorkspaceStore((s) => s.toggleItemSaved);
  const manifests = useUserPlaylistsStore((s) => s.manifests);
  const fetchIndex = useUserPlaylistsStore((s) => s.fetchIndex);
  const indexLoaded = useUserPlaylistsStore((s) => s.indexLoaded);

  const [typeFilter, setTypeFilter] = useState<ItemTypeFilter>("all");
  const [standaloneOnly, setStandaloneOnly] = useState(false);
  const [pickerItem, setPickerItem] = useState<NormalizedYouTubeDiscoveryItem | null>(null);

  useEffect(() => {
    if (!indexLoaded) void fetchIndex();
  }, [indexLoaded, fetchIndex]);

  const playlistKeys = useMemo(() => collectPlaylistKeys(manifests), [manifests]);

  const isStandalone = (item: NormalizedYouTubeDiscoveryItem) => {
    const key = canonicalYoutubeKey(youtubeKindFromNormalized(item), item.platformItemId);
    return !playlistKeys.has(key);
  };

  const searchDocs = useMemo(
    () =>
      savedItems.map((item, i) =>
        toSearchDoc(`${item.itemType}-${item.platformItemId}-${i}`, item.title, item.channelTitle, [
          item.description,
          item.platformItemId,
          ...(item.tags ?? []),
        ]),
      ),
    [savedItems],
  );
  const searcher = useMemo(
    () => (searchDocs.length > 0 ? createLocalSearcher(searchDocs) : null),
    [searchDocs],
  );
  const rankedItems = useMemo(
    () => searchRanked(savedItems, searchDocs, searcher, query),
    [savedItems, searchDocs, searcher, query],
  );

  const filteredItems = useMemo(
    () =>
      rankedItems.filter((item) => {
        if (typeFilter === "video" && !(item.itemType === "video")) return false;
        if (typeFilter === "shorts" && !(item.itemType === "shorts_like" || item.isShortsLike)) return false;
        if (typeFilter === "channel" && item.itemType !== "channel") return false;
        if (typeFilter === "playlist" && item.itemType !== "playlist") return false;
        if (standaloneOnly && !isStandalone(item)) return false;
        return true;
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rankedItems, typeFilter, standaloneOnly, manifests],
  );

  const handleCopyTitle = async (text: string, id: string) => {
    try {
      await navigator.clipboard.writeText(text);
      onCopy(id);
      setTimeout(() => onCopy(null), 1800);
    } catch {
      /* Clipboard blocked — silent fallback */
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-2">
          <Badge tone="success">{savedItems.length} saved items</Badge>
          <Badge>{savedItems.filter((i) => i.itemType === "video" || i.itemType === "shorts_like").length} videos</Badge>
          <Badge>{savedItems.filter((i) => i.itemType === "channel").length} channels</Badge>
          <Badge>{savedItems.filter((i) => i.itemType === "playlist").length} playlists</Badge>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value as ItemTypeFilter)}
            aria-label="Filter by content type"
            className="h-8 rounded-lg border border-border bg-surface px-2 text-xs"
          >
            <option value="all">All types</option>
            <option value="video">Videos</option>
            <option value="shorts">Shorts</option>
            <option value="channel">Channels</option>
            <option value="playlist">YouTube playlists</option>
          </select>
          <label className="flex cursor-pointer items-center gap-1.5 text-xs text-muted">
            <input
              type="checkbox"
              checked={standaloneOnly}
              onChange={(e) => setStandaloneOnly(e.target.checked)}
              className="h-3.5 w-3.5 accent-[var(--primary)]"
            />
            Standalone only
          </label>
        </div>
      </div>

      {filteredItems.length === 0 ? (
        <Card>
          <p className="py-8 text-center text-sm text-muted">
            {savedItems.length === 0
              ? "No saved items yet. Click the bookmark button on any video, channel, or playlist card to save items here."
              : "No saved items match your filter."}
          </p>
        </Card>
      ) : (
        <div className="space-y-2">
          {filteredItems.map((item) => (
            <div
              key={`${item.itemType}-${item.platformItemId}`}
              className="research-surface flex items-center gap-3 p-3 transition hover:border-border/90"
            >
              <div className="relative h-14 w-24 shrink-0 overflow-hidden rounded-md bg-surface-muted">
                {item.thumbnailUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={item.thumbnailUrl} alt="" className="h-full w-full object-cover" />
                ) : (
                  <div className="flex h-full items-center justify-center">
                    <Bookmark className="h-4 w-4 text-muted" />
                  </div>
                )}
                {item.isAgeRestricted && (
                  <span className="absolute bottom-1 left-1 rounded bg-red-600/90 px-1 text-[9px] font-bold text-white">
                    18+
                  </span>
                )}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-foreground" title={item.title}>
                  {item.title}
                </p>
                <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted">
                  <Badge tone="neutral">{item.itemType}</Badge>
                  {isStandalone(item) ? (
                    <Badge tone="warning">Standalone</Badge>
                  ) : (
                    <Badge tone="success">In playlist</Badge>
                  )}
                  {item.channelTitle && <span>{item.channelTitle}</span>}
                  {item.durationSeconds !== null && <span>{formatDuration(item.durationSeconds)}</span>}
                  {item.viewsCount !== null && <span>{formatCount(item.viewsCount, "views")}</span>}
                  {item.publishedAt && <span>{formatDate(item.publishedAt)}</span>}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <button
                  type="button"
                  className="inline-flex items-center gap-1 rounded-lg p-2 text-muted hover:bg-surface-muted hover:text-foreground"
                  onClick={() => handleCopyTitle(item.title, item.platformItemId)}
                  title="Copy title"
                >
                  {copiedId === item.platformItemId ? (
                    <Check className="h-4 w-4 text-success" />
                  ) : (
                    <Copy className="h-4 w-4" />
                  )}
                </button>
                <button
                  type="button"
                  className="rounded-lg p-2 text-muted hover:bg-surface-muted hover:text-foreground"
                  onClick={() => setPickerItem(item)}
                  title="Add to playlist"
                  aria-label={`Add ${item.title} to playlist`}
                >
                  <ListPlus className="h-4 w-4" />
                </button>
                {item.itemType === "channel" ? (
                  <Link
                    href={`/channels/${item.platformItemId}`}
                    className="rounded-lg p-2 text-muted hover:bg-surface-muted hover:text-foreground"
                    title="Explore channel"
                  >
                    <ExternalLink className="h-4 w-4" />
                  </Link>
                ) : item.itemType === "playlist" ? (
                  <Link
                    href={`/playlists/${item.platformItemId}`}
                    className="rounded-lg p-2 text-muted hover:bg-surface-muted hover:text-foreground"
                    title="Explore playlist"
                  >
                    <ExternalLink className="h-4 w-4" />
                  </Link>
                ) : (
                  <Link
                    href={`/watch/${item.platformItemId}`}
                    className="rounded-lg p-2 text-muted hover:bg-surface-muted hover:text-foreground"
                    title="Watch video"
                  >
                    <ExternalLink className="h-4 w-4" />
                  </Link>
                )}
                <button
                  type="button"
                  className="rounded-lg p-2 text-muted hover:bg-danger/10 hover:text-danger"
                  onClick={() => toggleItemSaved(item)}
                  title="Remove from saved"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
      <AddToPlaylistDialog item={pickerItem} open={pickerItem !== null} onClose={() => setPickerItem(null)} />
    </div>
  );
}

/* ═══════════════════ Saved searches tab (preserved) ═══════════════════ */

function SavedSearchesTab({
  query,
  onCopy,
  copiedId,
}: {
  query: string;
  onCopy: (id: string | null) => void;
  copiedId: string | null;
}) {
  const savedSearches = useYouTubeWorkspaceStore((s) => s.savedSearches);
  const deleteSavedSearch = useYouTubeWorkspaceStore((s) => s.deleteSavedSearch);
  const togglePinSavedSearch = useYouTubeWorkspaceStore((s) => s.togglePinSavedSearch);

  const searchDocs = useMemo(
    () =>
      savedSearches.map((s) =>
        toSearchDoc(s.id, s.title, s.query, [s.notes, s.resourceSelection]),
      ),
    [savedSearches],
  );
  const searcher = useMemo(
    () => (searchDocs.length > 0 ? createLocalSearcher(searchDocs) : null),
    [searchDocs],
  );
  const ranked = useMemo(
    () => searchRanked(savedSearches, searchDocs, searcher, query),
    [savedSearches, searchDocs, searcher, query],
  );
  const filteredSearches = useMemo(() => {
    const sorted = [...(query.trim() ? ranked : savedSearches)].sort((a, b) => {
      if (!query.trim()) {
        if (a.isPinned && !b.isPinned) return -1;
        if (!a.isPinned && b.isPinned) return 1;
      }
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });
    return sorted;
  }, [savedSearches, ranked, query]);

  const handleCopyTitle = async (text: string, id: string) => {
    try {
      await navigator.clipboard.writeText(text);
      onCopy(id);
      setTimeout(() => onCopy(null), 1800);
    } catch {
      /* Fallback if clipboard API is blocked */
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted">
          {filteredSearches.length} saved search title{filteredSearches.length === 1 ? "" : "s"} preserved locally.
        </p>
        <Link href="/search">
          <Button variant="secondary" className="h-8 gap-1.5 px-3 text-xs">
            <Search className="h-3.5 w-3.5" />
            Open Search
          </Button>
        </Link>
      </div>
      {filteredSearches.length === 0 ? (
        <Card>
          <div className="flex flex-col items-center gap-3 py-10 text-center">
            <Bookmark className="h-10 w-10 text-muted/40" />
            <div>
              <p className="text-sm font-medium text-foreground">No saved search titles yet</p>
              <p className="mt-1 text-xs text-muted">
                Go to the Search page, type a query, and click &quot;Save Search Title&quot; to bookmark search titles and parameters here.
              </p>
            </div>
          </div>
        </Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {filteredSearches.map((s) => {
            const isCopied = copiedId === s.id;
            return (
              <div
                key={s.id}
                className="research-surface flex flex-col justify-between rounded-xl border border-border/80 p-4 transition hover:border-primary/40 shadow-xs"
              >
                <div>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <h4
                        className="truncate text-sm font-semibold text-foreground cursor-pointer hover:text-primary"
                        title={`${s.title} (click to copy)`}
                        onClick={() => handleCopyTitle(s.title, s.id)}
                      >
                        {s.title}
                      </h4>
                      <p className="mt-1 font-mono text-xs text-muted truncate" title={s.query}>
                        q: {s.query}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => togglePinSavedSearch(s.id)}
                      className="text-muted hover:text-warning"
                      title={s.isPinned ? "Unpin search" : "Pin to top"}
                    >
                      <Star className={`h-4 w-4 ${s.isPinned ? "fill-warning text-warning" : ""}`} />
                    </button>
                  </div>
                  {s.notes && (
                    <p className="mt-2 text-xs text-muted line-clamp-2 italic bg-surface-muted/50 p-2 rounded-md">
                      {s.notes}
                    </p>
                  )}
                  <div className="mt-3 flex flex-wrap items-center gap-1.5 text-[10px] text-muted">
                    <Badge className="text-[10px] uppercase">{s.resourceSelection}</Badge>
                    {s.settings?.safeSearch === "none" && (
                      <span className="rounded bg-emerald-500/10 px-1.5 py-0.5 text-emerald-600 dark:text-emerald-400 font-medium">
                        Unrestricted Mode
                      </span>
                    )}
                    <span>Saved {formatDate(s.createdAt)}</span>
                  </div>
                </div>
                <div className="mt-4 flex items-center justify-between border-t border-border/50 pt-3">
                  <button
                    type="button"
                    onClick={() => handleCopyTitle(s.title, s.id)}
                    className="inline-flex items-center gap-1 text-xs text-muted hover:text-foreground"
                    title="Copy search title"
                  >
                    {isCopied ? <Check className="h-3.5 w-3.5 text-success" /> : <Copy className="h-3.5 w-3.5" />}
                    <span>{isCopied ? "Copied" : "Copy Title"}</span>
                  </button>
                  <div className="flex items-center gap-1">
                    <Link
                      href={`/search?q=${encodeURIComponent(s.query)}`}
                      className="inline-flex items-center gap-1 rounded-md bg-primary-soft px-2.5 py-1 text-xs font-medium text-primary hover:bg-primary/20"
                    >
                      <Play className="h-3 w-3 fill-current" />
                      <span>Run</span>
                    </Link>
                    <button
                      type="button"
                      onClick={() => deleteSavedSearch(s.id)}
                      className="rounded-md p-1 text-muted hover:bg-danger/10 hover:text-danger"
                      title="Delete saved search"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function ConfirmDialog({
  title,
  body,
  confirmLabel,
  onCancel,
  onConfirm,
}: {
  title: string;
  body: string;
  confirmLabel: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs">
      <div className="w-full max-w-sm rounded-xl border border-border bg-surface p-6 shadow-xl">
        <h3 className="text-base font-semibold text-foreground">{title}</h3>
        <p className="mt-2 text-xs leading-relaxed text-muted">{body}</p>
        <div className="mt-5 flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="button" variant="danger" onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
