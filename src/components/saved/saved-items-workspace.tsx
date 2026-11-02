"use client";

import {
  Calendar,
  ExternalLink,
  Eye,
  FileCode,
  Film,
  Flame,
  Layers,
  ListPlus,
  ListVideo,
  Play,
  Search,
  Trash2,
  Tv,
  X,
} from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import type { NormalizedYouTubeDiscoveryItem } from "@/types/youtube";
import { useYouTubeWorkspaceStore } from "@/lib/state/youtube-workspace-store";
import { AddToPlaylistDialog } from "@/components/library/add-to-playlist-dialog";
import { RawJsonInspectorDialog } from "@/components/saved/raw-json-inspector-dialog";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { formatCompactCount, formatDate, formatDuration } from "@/lib/utils/format";

type TypeFilter = "all" | "video" | "shorts" | "channel" | "playlist";
type SortOption = "date_desc" | "date_asc" | "title_az" | "views_desc";

/**
 * Normalizes an item's save timestamp to an ISO string.
 * Falls back gracefully to collectedAt or current time.
 */
function getItemSaveTime(item: NormalizedYouTubeDiscoveryItem): number {
  if (item.savedAt) {
    const t = new Date(item.savedAt).getTime();
    if (!isNaN(t)) return t;
  }
  if (item.collectedAt) {
    const t = new Date(item.collectedAt).getTime();
    if (!isNaN(t)) return t;
  }
  return 0;
}

/**
 * Formats a timestamp into a human-readable calendar day grouping key,
 * e.g., "November 2, 2026" or "Today — November 2, 2026".
 */
function getDayGroupKey(timestampMs: number): { key: string; label: string; relative: string } {
  if (!timestampMs) {
    return { key: "earlier", label: "Earlier Saved Items", relative: "Archive" };
  }

  const d = new Date(timestampMs);
  const now = new Date();

  const isToday =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();

  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const isYesterday =
    d.getFullYear() === yesterday.getFullYear() &&
    d.getMonth() === yesterday.getMonth() &&
    d.getDate() === yesterday.getDate();

  const dateStr = d.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });

  const isoKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;

  if (isToday) {
    return { key: isoKey, label: `Today — ${dateStr}`, relative: "Today" };
  }
  if (isYesterday) {
    return { key: isoKey, label: `Yesterday — ${dateStr}`, relative: "Yesterday" };
  }

  const weekday = d.toLocaleDateString("en-US", { weekday: "long" });
  return { key: isoKey, label: `${weekday}, ${dateStr}`, relative: dateStr };
}

export function SavedItemsWorkspace() {
  const savedItems = useYouTubeWorkspaceStore((s) => s.savedItems);
  const toggleItemSaved = useYouTubeWorkspaceStore((s) => s.toggleItemSaved);

  const [searchQuery, setSearchQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [sortOption, setSortOption] = useState<SortOption>("date_desc");

  // Add to playlist modal state
  const [playlistTarget, setPlaylistTarget] = useState<NormalizedYouTubeDiscoveryItem | null>(null);
  // Raw JSON inspection modal state
  const [inspectedItem, setInspectedItem] = useState<NormalizedYouTubeDiscoveryItem | null>(null);

  // Type counts for quick pills
  const counts = useMemo(() => {
    let videos = 0;
    let shorts = 0;
    let channels = 0;
    let playlists = 0;
    for (const item of savedItems) {
      if (item.itemType === "channel") {
        channels++;
      } else if (item.itemType === "playlist") {
        playlists++;
      } else if (item.isShortsLike || (item.itemType as string) === "shorts_like") {
        shorts++;
      } else {
        videos++;
      }
    }
    return { all: savedItems.length, videos, shorts, channels, playlists };
  }, [savedItems]);

  // Filter and sort items across the 4 explicit filters
  const filteredItems = useMemo(() => {
    return savedItems.filter((item) => {
      // 4-Filter logic:
      // 1. VIDEO: itemType === 'video' && !item.isShortsLike && itemType !== 'shorts_like'
      // 2. SHORTS: item.isShortsLike === true || itemType === 'shorts_like'
      // 3. CHANNELS: itemType === 'channel'
      // 4. PLAYLISTS: itemType === 'playlist'
      if (typeFilter === "video") {
        if (item.itemType !== "video" || item.isShortsLike || (item.itemType as string) === "shorts_like") return false;
      }
      if (typeFilter === "shorts") {
        if (!item.isShortsLike && (item.itemType as string) !== "shorts_like") return false;
      }
      if (typeFilter === "channel" && item.itemType !== "channel") return false;
      if (typeFilter === "playlist" && item.itemType !== "playlist") return false;

      // Query match
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const titleMatch = item.title?.toLowerCase().includes(q);
        const channelMatch = item.channelTitle?.toLowerCase().includes(q);
        const tagMatch = item.tags?.some((t) => t.toLowerCase().includes(q));
        if (!titleMatch && !channelMatch && !tagMatch) return false;
      }

      return true;
    });
  }, [savedItems, typeFilter, searchQuery]);

  // Sort items
  const sortedItems = useMemo(() => {
    const list = [...filteredItems];
    switch (sortOption) {
      case "date_desc":
        return list.sort((a, b) => getItemSaveTime(b) - getItemSaveTime(a));
      case "date_asc":
        return list.sort((a, b) => getItemSaveTime(a) - getItemSaveTime(b));
      case "title_az":
        return list.sort((a, b) => (a.title || "").localeCompare(b.title || ""));
      case "views_desc":
        return list.sort((a, b) => (b.viewsCount ?? 0) - (a.viewsCount ?? 0));
      default:
        return list;
    }
  }, [filteredItems, sortOption]);

  // Daily grouping: group items by the calendar date they were saved
  const dailyGroups = useMemo(() => {
    const groups: Array<{
      key: string;
      label: string;
      relative: string;
      items: NormalizedYouTubeDiscoveryItem[];
    }> = [];

    const map = new Map<string, { label: string; relative: string; items: NormalizedYouTubeDiscoveryItem[] }>();

    for (const item of sortedItems) {
      const timeMs = getItemSaveTime(item);
      const { key, label, relative } = getDayGroupKey(timeMs);

      if (!map.has(key)) {
        map.set(key, { label, relative, items: [] });
      }
      map.get(key)!.items.push(item);
    }

    for (const [key, val] of map.entries()) {
      groups.push({ key, label: val.label, relative: val.relative, items: val.items });
    }

    // Keep chronological order of groups matching sortOption
    if (sortOption === "date_asc") {
      return groups.sort((a, b) => a.key.localeCompare(b.key));
    }
    // Default: newest dates first
    return groups.sort((a, b) => b.key.localeCompare(a.key));
  }, [sortedItems, sortOption]);

  return (
    <div className="space-y-8">
      {/* Top Filter and Controls Bar */}
      <Card className="p-4 sm:p-5 shadow-sm border border-border/80">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          {/* Search Input */}
          <div className="relative flex-1 max-w-lg">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted" />
            <input
              type="text"
              placeholder="Search saved titles, channels, or tags..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="h-10 w-full rounded-lg border border-border bg-surface pl-10 pr-9 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--ring)] transition"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery("")}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted hover:text-foreground"
                aria-label="Clear search"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>

          {/* Type Filters & Sorting */}
          <div className="flex flex-wrap items-center gap-2.5">
            {/* Type Filters */}
            <div className="flex items-center rounded-lg border border-border bg-surface-muted p-1 text-xs">
              <button
                type="button"
                onClick={() => setTypeFilter("all")}
                className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 font-medium transition ${
                  typeFilter === "all"
                    ? "bg-surface text-foreground shadow-sm font-semibold"
                    : "text-muted hover:text-foreground"
                }`}
              >
                <span>All</span>
                <span className="rounded-full bg-border/60 px-1.5 py-0.2 text-[10px] text-muted">
                  {counts.all}
                </span>
              </button>
              <button
                type="button"
                onClick={() => setTypeFilter("video")}
                className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 font-medium transition ${
                  typeFilter === "video"
                    ? "bg-surface text-foreground shadow-sm font-semibold"
                    : "text-muted hover:text-foreground"
                }`}
              >
                <Film className="h-3.5 w-3.5 text-primary" />
                <span>Videos</span>
                <span className="rounded-full bg-border/60 px-1.5 py-0.2 text-[10px] text-muted">
                  {counts.videos}
                </span>
              </button>
              <button
                type="button"
                onClick={() => setTypeFilter("shorts")}
                className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 font-medium transition ${
                  typeFilter === "shorts"
                    ? "bg-surface text-foreground shadow-sm font-semibold"
                    : "text-muted hover:text-foreground"
                }`}
              >
                <Flame className="h-3.5 w-3.5 text-red-500" />
                <span>Shorts</span>
                <span className="rounded-full bg-border/60 px-1.5 py-0.2 text-[10px] text-muted">
                  {counts.shorts}
                </span>
              </button>
              <button
                type="button"
                onClick={() => setTypeFilter("channel")}
                className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 font-medium transition ${
                  typeFilter === "channel"
                    ? "bg-surface text-foreground shadow-sm font-semibold"
                    : "text-muted hover:text-foreground"
                }`}
              >
                <Tv className="h-3.5 w-3.5 text-emerald-500" />
                <span>Channels</span>
                <span className="rounded-full bg-border/60 px-1.5 py-0.2 text-[10px] text-muted">
                  {counts.channels}
                </span>
              </button>
              <button
                type="button"
                onClick={() => setTypeFilter("playlist")}
                className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 font-medium transition ${
                  typeFilter === "playlist"
                    ? "bg-surface text-foreground shadow-sm font-semibold"
                    : "text-muted hover:text-foreground"
                }`}
              >
                <ListVideo className="h-3.5 w-3.5 text-indigo-500" />
                <span>Playlists</span>
                <span className="rounded-full bg-border/60 px-1.5 py-0.2 text-[10px] text-muted">
                  {counts.playlists}
                </span>
              </button>
            </div>

            {/* Sort Selector */}
            <div className="flex items-center gap-2">
              <select
                value={sortOption}
                onChange={(e) => setSortOption(e.target.value as SortOption)}
                className="h-9 rounded-lg border border-border bg-surface px-3 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-[var(--ring)]"
              >
                <option value="date_desc">Save Date (Newest first)</option>
                <option value="date_asc">Save Date (Oldest first)</option>
                <option value="title_az">Title (A to Z)</option>
                <option value="views_desc">Most Views</option>
              </select>
            </div>
          </div>
        </div>
      </Card>

      {/* Main Content Area — Daily Grouped Lists */}
      {dailyGroups.length > 0 ? (
        <div className="space-y-10">
          {dailyGroups.map((group) => (
            <section key={group.key} className="space-y-4">
              {/* Distinct Visual Day Header & Divider */}
              <div className="sticky top-16 z-10 flex items-center gap-3 bg-background/95 py-2.5 backdrop-blur-md">
                <div className="flex h-7 w-7 items-center justify-center rounded-md bg-primary-soft text-primary shadow-xs">
                  <Calendar className="h-4 w-4" />
                </div>
                <h2 className="text-sm font-semibold tracking-wide text-foreground uppercase">
                  {group.label}
                </h2>
                <Badge tone="neutral" className="text-xs px-2 py-0.5">
                  {group.items.length} {group.items.length === 1 ? "item" : "items"}
                </Badge>
                <div className="h-px flex-1 bg-border/80" />
              </div>

              {/* Items Grid for this specific day */}
              <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
                {group.items.map((item) => (
                  <SavedItemCard
                    key={`${item.itemType}-${item.platformItemId}`}
                    item={item}
                    onRemove={() => toggleItemSaved(item)}
                    onAddToPlaylist={() => setPlaylistTarget(item)}
                    onInspectJson={() => setInspectedItem(item)}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      ) : (
        <Card className="flex flex-col items-center justify-center p-14 text-center">
          <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-surface-muted text-muted">
            <Layers className="h-7 w-7 opacity-40" />
          </div>
          <h3 className="text-base font-semibold text-foreground">No saved items found</h3>
          <p className="mt-1 text-xs text-muted max-w-md">
            {searchQuery || typeFilter !== "all"
              ? "No saved items match your filter criteria. Try adjusting your query or filter."
              : "You haven't saved any YouTube videos, channels, or playlists yet. Bookmark items from Search or Explorers to collect them here with daily logs."}
          </p>
          <div className="mt-6 flex flex-wrap justify-center gap-3">
            <ButtonLink href="/search" variant="primary" className="h-9 px-4 text-xs font-medium">
              Explore Search
            </ButtonLink>
            <ButtonLink href="/channels" variant="secondary" className="h-9 px-4 text-xs">
              Explore Channels
            </ButtonLink>
            <ButtonLink href="/playlists" variant="secondary" className="h-9 px-4 text-xs">
              Explore Playlists
            </ButtonLink>
          </div>
        </Card>
      )}

      {/* Add To Playlist Dialog */}
      {playlistTarget && (
        <AddToPlaylistDialog
          item={playlistTarget}
          open={Boolean(playlistTarget)}
          onClose={() => setPlaylistTarget(null)}
        />
      )}

      {/* Raw JSON Inspection Dialog */}
      {inspectedItem && (
        <RawJsonInspectorDialog
          item={inspectedItem}
          open={Boolean(inspectedItem)}
          onClose={() => setInspectedItem(null)}
          title="Saved Item Metadata"
        />
      )}
    </div>
  );
}

/**
 * Unified, professional item card for Saved Items supporting:
 * - Videos (Standard and Shorts-like)
 * - Channels
 * - Playlists
 */
function SavedItemCard({
  item,
  onRemove,
  onAddToPlaylist,
  onInspectJson,
}: {
  item: NormalizedYouTubeDiscoveryItem;
  onRemove: () => void;
  onAddToPlaylist: () => void;
  onInspectJson: () => void;
}) {
  const isChannel = item.itemType === "channel";
  const isPlaylist = item.itemType === "playlist";
  const isVideo = !isChannel && !isPlaylist;

  const targetHref = isChannel
    ? `/channels/${item.platformItemId}`
    : isPlaylist
    ? `/playlists/${item.platformItemId}`
    : `/watch/${item.platformItemId}`;

  return (
    <Card className="group relative flex flex-col overflow-hidden rounded-xl border border-border/80 bg-surface shadow-xs transition hover:border-border hover:shadow-md">
      {/* Thumbnail or Avatar Container */}
      <div className="relative aspect-video w-full overflow-hidden bg-surface-muted">
        {item.thumbnailUrl ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            src={item.thumbnailUrl}
            alt={item.title}
            className={`h-full w-full object-cover transition-transform duration-300 group-hover:scale-102 ${
              isChannel ? "p-6 object-contain rounded-full max-h-36 mx-auto my-auto" : ""
            }`}
            loading="lazy"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-muted">
            {isChannel ? <Tv className="h-10 w-10 opacity-30" /> : <Play className="h-10 w-10 opacity-30" />}
          </div>
        )}

        {/* Type Badge Overlay */}
        <div className="absolute top-2.5 left-2.5 flex items-center gap-1.5">
          {isChannel && (
            <Badge tone="success" className="text-[10px] uppercase font-semibold tracking-wider">
              Channel
            </Badge>
          )}
          {isPlaylist && (
            <Badge tone="ai" className="text-[10px] uppercase font-semibold tracking-wider">
              Playlist
            </Badge>
          )}
          {isVideo && item.isShortsLike && (
            <Badge tone="danger" className="text-[10px] uppercase font-semibold tracking-wider">
              Shorts-like
            </Badge>
          )}
        </div>

        {/* Video Duration Overlay */}
        {isVideo && typeof item.durationSeconds === "number" && item.durationSeconds > 0 && (
          <div className="absolute bottom-2 right-2 rounded bg-black/80 px-2 py-0.5 text-xs font-semibold text-white backdrop-blur-xs">
            {formatDuration(item.durationSeconds)}
          </div>
        )}

        {/* Playlist Count Overlay */}
        {isPlaylist && typeof item.itemCount === "number" && (
          <div className="absolute bottom-2 right-2 flex items-center gap-1 rounded bg-black/80 px-2 py-0.5 text-xs font-semibold text-white backdrop-blur-xs">
            <ListVideo className="h-3.5 w-3.5" />
            <span>{item.itemCount} videos</span>
          </div>
        )}
      </div>

      {/* Body Information */}
      <div className="flex flex-1 flex-col p-4 sm:p-5">
        {/* Title */}
        <Link
          href={targetHref}
          className="line-clamp-2 text-base font-bold text-foreground transition-colors hover:text-primary leading-snug tracking-tight"
          title={item.title}
        >
          {item.title}
        </Link>

        {/* Channel or Creator Information */}
        {item.channelTitle && (
          <p className="mt-1.5 line-clamp-1 text-xs font-medium text-muted hover:text-foreground transition-colors">
            {item.channelTitle}
          </p>
        )}

        {/* Metrics Bar */}
        <div className="mt-3 flex items-center gap-3 text-xs text-muted">
          {typeof item.viewsCount === "number" && (
            <span className="flex items-center gap-1 font-medium">
              <Eye className="h-3.5 w-3.5 text-muted/70" />
              {formatCompactCount(item.viewsCount)} views
            </span>
          )}
          {typeof item.subscriberCount === "number" && (
            <span className="font-medium">{formatCompactCount(item.subscriberCount)} subs</span>
          )}
          {item.publishedAt && (
            <span className="ml-auto text-[11px] text-muted/80">
              {formatDate(item.publishedAt)}
            </span>
          )}
        </div>

        {/* Card Footer Actions */}
        <div className="mt-4 pt-3 flex items-center justify-between border-t border-border/60">
          <div className="flex items-center gap-1">
            {/* Add to personal playlist button */}
            <button
              type="button"
              onClick={onAddToPlaylist}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-muted hover:bg-surface-muted hover:text-foreground transition"
              title="Add to personal playlist"
              aria-label="Add to playlist"
            >
              <ListPlus className="h-4 w-4" />
            </button>
            {/* Open External YouTube */}
            {item.url && (
              <a
                href={item.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex h-8 w-8 items-center justify-center rounded-lg text-muted hover:bg-surface-muted hover:text-foreground transition"
                title="Open on YouTube"
                aria-label="Open on YouTube"
              >
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
            )}
            {/* Inspect Raw JSON Metadata */}
            <button
              type="button"
              onClick={onInspectJson}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-muted hover:bg-surface-muted hover:text-foreground transition"
              title="Inspect Raw JSON Metadata"
              aria-label="Inspect JSON"
            >
              <FileCode className="h-3.5 w-3.5" />
            </button>
          </div>

          {/* Remove from Saved Items */}
          <button
            type="button"
            onClick={onRemove}
            className="flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs text-muted hover:bg-danger/10 hover:text-danger transition"
            title="Remove from Saved Items"
          >
            <Trash2 className="h-3.5 w-3.5" />
            <span>Remove</span>
          </button>
        </div>
      </div>
    </Card>
  );
}
