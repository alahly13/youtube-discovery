"use client";

import {
  Calendar,
  Cloud,
  ExternalLink,
  Eye,
  FileCode,
  Film,
  Flame,
  HardDrive,
  Laptop,
  Layers,
  ListPlus,
  ListVideo,
  Play,
  RefreshCw,
  Search,
  Sparkles,
  Trash2,
  Tv,
  X,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { NormalizedYouTubeDiscoveryItem } from "@/types/youtube";
import { useYouTubeWorkspaceStore } from "@/lib/state/youtube-workspace-store";
import { useMergedDataset } from "@/lib/storage/use-merged-dataset";
import { syncCoordinator } from "@/lib/sync/sync-coordinator";
import { getDeviceLabel } from "@/lib/device/device-identity";
import { AddToPlaylistDialog } from "@/components/library/add-to-playlist-dialog";
import { RawJsonInspectorDialog } from "@/components/saved/raw-json-inspector-dialog";
import { ExpandableDescription } from "@/components/youtube/expandable-description";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { formatCompactCount, formatDate, formatDuration } from "@/lib/utils/format";

type TypeFilter = "all" | "video" | "shorts" | "channel" | "playlist";
type SortOption = "date_desc" | "date_asc" | "title_az" | "views_desc";

/**
 * Normalizes an item's save timestamp to an epoch number.
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
 * Formats a timestamp into a human-readable calendar day grouping key.
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

/**
 * Filters and sorts an array of saved items.
 */
function filterAndSortItems(
  items: NormalizedYouTubeDiscoveryItem[],
  typeFilter: TypeFilter,
  searchQuery: string,
  sortOption: SortOption
): NormalizedYouTubeDiscoveryItem[] {
  const filtered = items.filter((item) => {
    if (typeFilter === "video") {
      if (item.itemType !== "video" || item.isShortsLike || (item.itemType as string) === "shorts_like") return false;
    }
    if (typeFilter === "shorts") {
      if (!item.isShortsLike && (item.itemType as string) !== "shorts_like") return false;
    }
    if (typeFilter === "channel" && item.itemType !== "channel") return false;
    if (typeFilter === "playlist" && item.itemType !== "playlist") return false;

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const titleMatch = item.title?.toLowerCase().includes(q);
      const channelMatch = item.channelTitle?.toLowerCase().includes(q);
      const tagMatch = item.tags?.some((t) => t.toLowerCase().includes(q));
      if (!titleMatch && !channelMatch && !tagMatch) return false;
    }

    return true;
  });

  switch (sortOption) {
    case "date_desc":
      return filtered.sort((a, b) => getItemSaveTime(b) - getItemSaveTime(a));
    case "date_asc":
      return filtered.sort((a, b) => getItemSaveTime(a) - getItemSaveTime(b));
    case "title_az":
      return filtered.sort((a, b) => (a.title || "").localeCompare(b.title || ""));
    case "views_desc":
      return filtered.sort((a, b) => (b.viewsCount ?? 0) - (a.viewsCount ?? 0));
    default:
      return filtered;
  }
}

/**
 * Groups items into daily calendar sections.
 */
function groupItemsByCalendarDay(
  sortedList: NormalizedYouTubeDiscoveryItem[],
  sortOption: SortOption
): Array<{ key: string; label: string; relative: string; items: NormalizedYouTubeDiscoveryItem[] }> {
  const map = new Map<string, { label: string; relative: string; items: NormalizedYouTubeDiscoveryItem[] }>();

  for (const item of sortedList) {
    const timeMs = getItemSaveTime(item);
    const { key, label, relative } = getDayGroupKey(timeMs);

    if (!map.has(key)) {
      map.set(key, { label, relative, items: [] });
    }
    map.get(key)!.items.push(item);
  }

  const groups = Array.from(map.entries()).map(([key, val]) => ({
    key,
    label: val.label,
    relative: val.relative,
    items: val.items,
  }));

  if (sortOption === "date_asc") {
    return groups.sort((a, b) => a.key.localeCompare(b.key));
  }
  return groups.sort((a, b) => b.key.localeCompare(a.key));
}

export function SavedItemsWorkspace() {
  const inMemorySavedItems = useYouTubeWorkspaceStore((s) => s.savedItems);
  const toggleItemSaved = useYouTubeWorkspaceStore((s) => s.toggleItemSaved);

  // Authoritative merged dataset combining IndexedDB Local-First, Outbox, and Hydrated Cloud
  const {
    items: allItems,
    localPendingItems,
    cloudCommittedItems,
    refresh,
  } = useMergedDataset<NormalizedYouTubeDiscoveryItem>(
    "SAVED_ITEMS",
    inMemorySavedItems
  );

  const [searchQuery, setSearchQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [sortOption, setSortOption] = useState<SortOption>("date_desc");
  const [isSyncing, setIsSyncing] = useState(false);
  const [deviceLabel, setDeviceLabelState] = useState("This Device");

  // Add to playlist modal state
  const [playlistTarget, setPlaylistTarget] = useState<NormalizedYouTubeDiscoveryItem | null>(null);
  // Raw JSON inspection modal state
  const [inspectedItem, setInspectedItem] = useState<NormalizedYouTubeDiscoveryItem | null>(null);

  useEffect(() => {
    setDeviceLabelState(getDeviceLabel());
    const unsub = syncCoordinator.subscribe((state) => {
      setIsSyncing(state.status === "SYNCING");
    });
    return unsub;
  }, []);

  const handleSaveToCloud = async () => {
    setIsSyncing(true);
    try {
      await syncCoordinator.saveAll();
      refresh();
    } finally {
      setIsSyncing(false);
    }
  };

  // Helper to identify historical "Before App Updating" items. Legacy fields
  // are read defensively because not every hydrated record declares them.
  const isHistorical = (item: NormalizedYouTubeDiscoveryItem) => {
    const record = item as unknown as Record<string, unknown>;
    return (
      record.isBeforeAppUpdating === true ||
      (typeof record.manifestId === "string" &&
        (record.manifestId.includes("legacy") ||
          record.manifestId.includes("before-app-updating"))) ||
      (typeof record.provenance === "string" &&
        record.provenance.includes("before-app-updating"))
    );
  };

  const beforeUpdatingItems = useMemo(() => {
    return allItems.filter((item) => isHistorical(item));
  }, [allItems]);

  const nonHistoricalLocalItems = useMemo(() => {
    return localPendingItems.filter((item) => !isHistorical(item));
  }, [localPendingItems]);

  const nonHistoricalCloudItems = useMemo(() => {
    return cloudCommittedItems.filter((item) => !isHistorical(item));
  }, [cloudCommittedItems]);

  // Filter and sort for local pending
  const filteredLocalItems = useMemo(() => {
    return filterAndSortItems(nonHistoricalLocalItems, typeFilter, searchQuery, sortOption);
  }, [nonHistoricalLocalItems, typeFilter, searchQuery, sortOption]);

  const localDailyGroups = useMemo(() => {
    return groupItemsByCalendarDay(filteredLocalItems, sortOption);
  }, [filteredLocalItems, sortOption]);

  // Filter and sort for cloud committed
  const filteredCloudItems = useMemo(() => {
    return filterAndSortItems(nonHistoricalCloudItems, typeFilter, searchQuery, sortOption);
  }, [nonHistoricalCloudItems, typeFilter, searchQuery, sortOption]);

  const cloudDailyGroups = useMemo(() => {
    return groupItemsByCalendarDay(filteredCloudItems, sortOption);
  }, [filteredCloudItems, sortOption]);

  // Filter and sort for Before App Updating historical items
  const filteredBeforeUpdatingItems = useMemo(() => {
    return filterAndSortItems(beforeUpdatingItems, typeFilter, searchQuery, sortOption);
  }, [beforeUpdatingItems, typeFilter, searchQuery, sortOption]);

  const beforeUpdatingDailyGroups = useMemo(() => {
    return groupItemsByCalendarDay(filteredBeforeUpdatingItems, sortOption);
  }, [filteredBeforeUpdatingItems, sortOption]);

  // Type counts across all unique deduplicated items
  const counts = useMemo(() => {
    let videos = 0;
    let shorts = 0;
    let channels = 0;
    let playlists = 0;
    for (const item of allItems) {
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
    return { all: allItems.length, videos, shorts, channels, playlists };
  }, [allItems]);

  const hasAnyItems = allItems.length > 0;

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

      {/* Main Content Area */}
      {hasAnyItems ? (
        <div className="space-y-12">
          {/* ═══════════════════════════════════════════════════════════════════ */}
          {/* SECTION 1: LOCAL — This Device (Amber / Gold Theme)                 */}
          {/* ═══════════════════════════════════════════════════════════════════ */}
          {filteredLocalItems.length > 0 && (
            <div className="space-y-6">
              {/* Section Header Card with Amber / Gold Accents */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 sm:p-5 rounded-xl border border-amber-500/30 bg-amber-500/5 shadow-xs">
                <div className="flex items-center gap-3.5">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-amber-500/20 text-amber-500 font-bold shadow-xs">
                    <HardDrive className="h-5 w-5" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h2 className="text-base font-bold text-foreground tracking-tight">
                        LOCAL — This Device
                      </h2>
                      <span className="inline-flex items-center rounded-full bg-amber-500/15 border border-amber-500/30 px-2 py-0.5 text-xs font-bold text-amber-500">
                        {filteredLocalItems.length} {filteredLocalItems.length === 1 ? "item pending" : "items pending"}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-muted">
                      Saved locally in browser storage on <span className="font-semibold text-foreground">{deviceLabel}</span>. Preserved offline in IndexedDB; waiting for cloud sync.
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2 sm:self-center">
                  <button
                    type="button"
                    onClick={handleSaveToCloud}
                    disabled={isSyncing}
                    className="inline-flex items-center justify-center gap-2 rounded-lg bg-amber-500 hover:bg-amber-600 text-black font-semibold text-xs px-4 py-2 shadow-xs transition hover:shadow-md disabled:opacity-50"
                  >
                    {isSyncing ? (
                      <>
                        <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                        <span>Saving to Cloud...</span>
                      </>
                    ) : (
                      <>
                        <Cloud className="h-3.5 w-3.5" />
                        <span>Save to Cloud</span>
                      </>
                    )}
                  </button>
                </div>
              </div>

              {/* Local Daily Groups */}
              <div className="space-y-8 pl-1">
                {localDailyGroups.map((group) => (
                  <section key={`local-${group.key}`} className="space-y-4">
                    <div className="sticky top-16 z-10 flex items-center gap-3 bg-background/95 py-2 backdrop-blur-md">
                      <div className="flex h-6 w-6 items-center justify-center rounded bg-amber-500/15 text-amber-500">
                        <Calendar className="h-3.5 w-3.5" />
                      </div>
                      <h3 className="text-xs font-bold tracking-wider text-amber-500 uppercase">
                        {group.label}
                      </h3>
                      <span className="rounded-full bg-border/60 px-2 py-0.5 text-[10px] font-semibold text-muted">
                        {group.items.length} {group.items.length === 1 ? "item" : "items"}
                      </span>
                      <div className="h-px flex-1 bg-amber-500/20" />
                    </div>

                    <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
                      {group.items.map((item) => (
                        <SavedItemCard
                          key={`local-${item.itemType}-${item.platformItemId}`}
                          item={item}
                          isLocalPending={true}
                          onRemove={() => toggleItemSaved(item)}
                          onAddToPlaylist={() => setPlaylistTarget(item)}
                          onInspectJson={() => setInspectedItem(item)}
                        />
                      ))}
                    </div>
                  </section>
                ))}
              </div>
            </div>
          )}

          {/* ═══════════════════════════════════════════════════════════════════ */}
          {/* SECTION 2: CLOUD — Synced (Emerald / Teal Theme)                   */}
          {/* ═══════════════════════════════════════════════════════════════════ */}
          {filteredCloudItems.length > 0 && (
            <div className="space-y-6">
              {/* Section Header Card with Emerald / Teal Accents */}
              <div className="flex items-center justify-between gap-4 p-4 sm:p-5 rounded-xl border border-emerald-500/30 bg-emerald-500/5 shadow-xs">
                <div className="flex items-center gap-3.5">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-emerald-500/20 text-emerald-500 font-bold shadow-xs">
                    <Cloud className="h-5 w-5" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h2 className="text-base font-bold text-foreground tracking-tight">
                        CLOUD — Synced
                      </h2>
                      <span className="inline-flex items-center rounded-full bg-emerald-500/15 border border-emerald-500/30 px-2 py-0.5 text-xs font-bold text-emerald-500">
                        {filteredCloudItems.length} {filteredCloudItems.length === 1 ? "item committed" : "items committed"}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-muted">
                      Confirmed multi-device persistence in Cloudflare R2 and PostgreSQL dataset registry.
                    </p>
                  </div>
                </div>
              </div>

              {/* Cloud Daily Groups */}
              <div className="space-y-8 pl-1">
                {cloudDailyGroups.map((group) => (
                  <section key={`cloud-${group.key}`} className="space-y-4">
                    <div className="sticky top-16 z-10 flex items-center gap-3 bg-background/95 py-2 backdrop-blur-md">
                      <div className="flex h-6 w-6 items-center justify-center rounded bg-emerald-500/15 text-emerald-500">
                        <Calendar className="h-3.5 w-3.5" />
                      </div>
                      <h3 className="text-xs font-bold tracking-wider text-emerald-500 uppercase">
                        {group.label}
                      </h3>
                      <span className="rounded-full bg-border/60 px-2 py-0.5 text-[10px] font-semibold text-muted">
                        {group.items.length} {group.items.length === 1 ? "item" : "items"}
                      </span>
                      <div className="h-px flex-1 bg-emerald-500/20" />
                    </div>

                    <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
                      {group.items.map((item) => (
                        <SavedItemCard
                          key={`cloud-${item.itemType}-${item.platformItemId}`}
                          item={item}
                          isLocalPending={false}
                          onRemove={() => toggleItemSaved(item)}
                          onAddToPlaylist={() => setPlaylistTarget(item)}
                          onInspectJson={() => setInspectedItem(item)}
                        />
                      ))}
                    </div>
                  </section>
                ))}
              </div>
            </div>
          )}

          {/* ═══════════════════════════════════════════════════════════════════ */}
          {/* SECTION 3: BEFORE APP UPDATING — Historical Data (Purple Theme)     */}
          {/* ═══════════════════════════════════════════════════════════════════ */}
          {filteredBeforeUpdatingItems.length > 0 && (
            <div className="space-y-6 pt-4">
              <div className="relative">
                <div className="absolute inset-0 flex items-center" aria-hidden="true">
                  <div className="w-full border-t border-purple-500/30" />
                </div>
                <div className="relative flex justify-center">
                  <span className="bg-background px-4 text-xs font-bold uppercase tracking-wider text-purple-600 dark:text-purple-400">
                    Historical Archive Divider
                  </span>
                </div>
              </div>

              {/* Section Header Card with Purple / Violet Accents */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 sm:p-5 rounded-xl border border-purple-500/30 bg-purple-500/5 shadow-xs">
                <div className="flex items-center gap-3.5">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-purple-500/20 text-purple-600 dark:text-purple-400 font-bold shadow-xs">
                    <Sparkles className="h-5 w-5" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h2 className="text-base font-bold text-foreground tracking-tight">
                        Before App Updating
                      </h2>
                      <span className="inline-flex items-center rounded-full bg-purple-500/15 border border-purple-500/30 px-2 py-0.5 text-xs font-bold text-purple-600 dark:text-purple-400">
                        {filteredBeforeUpdatingItems.length} {filteredBeforeUpdatingItems.length === 1 ? "item" : "items"}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-muted">
                      Historical saved items preserved from previous application versions, securely stored under <code className="text-foreground">asdy/persistence/&lt;ownerId&gt;/&lt;datasetSlug&gt;/before-app-updating/...</code>.
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2 sm:self-center">
                  <Link href="/other-actions">
                    <ButtonLink href="/other-actions" variant="secondary" className="gap-1.5 h-8 px-3 text-xs">
                      <Sparkles className="h-3.5 w-3.5 text-purple-600 dark:text-purple-400" />
                      Migration Actions
                    </ButtonLink>
                  </Link>
                </div>
              </div>

              {/* Before App Updating Daily Groups */}
              <div className="space-y-8 pl-1">
                {beforeUpdatingDailyGroups.map((group) => (
                  <section key={`before-updating-${group.key}`} className="space-y-4">
                    <div className="sticky top-16 z-10 flex items-center gap-3 bg-background/95 py-2 backdrop-blur-md">
                      <div className="flex h-6 w-6 items-center justify-center rounded bg-purple-500/15 text-purple-600 dark:text-purple-400">
                        <Calendar className="h-3.5 w-3.5" />
                      </div>
                      <h3 className="text-xs font-bold tracking-wider text-purple-600 dark:text-purple-400 uppercase">
                        {group.label}
                      </h3>
                      <span className="rounded-full bg-border/60 px-2 py-0.5 text-[10px] font-semibold text-muted">
                        {group.items.length} {group.items.length === 1 ? "item" : "items"}
                      </span>
                      <div className="h-px flex-1 bg-purple-500/20" />
                    </div>

                    <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
                      {group.items.map((item) => (
                        <SavedItemCard
                          key={`before-updating-${item.itemType}-${item.platformItemId}`}
                          item={item}
                          isLocalPending={false}
                          onRemove={() => toggleItemSaved(item)}
                          onAddToPlaylist={() => setPlaylistTarget(item)}
                          onInspectJson={() => setInspectedItem(item)}
                        />
                      ))}
                    </div>
                  </section>
                ))}
              </div>
            </div>
          )}

          {/* Filter produced 0 matches across local, cloud & historical */}
          {filteredLocalItems.length === 0 && filteredCloudItems.length === 0 && filteredBeforeUpdatingItems.length === 0 && (
            <Card className="flex flex-col items-center justify-center p-12 text-center">
              <Layers className="h-8 w-8 text-muted/50 mb-3" />
              <h3 className="text-sm font-semibold text-foreground">No matching saved items</h3>
              <p className="mt-1 text-xs text-muted max-w-sm">
                No items match your active filters ({typeFilter}) or query &ldquo;{searchQuery}&rdquo;.
              </p>
            </Card>
          )}
        </div>
      ) : (
        <Card className="flex flex-col items-center justify-center p-14 text-center">
          <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-surface-muted text-muted">
            <Layers className="h-7 w-7 opacity-40" />
          </div>
          <h3 className="text-base font-semibold text-foreground">No saved items found</h3>
          <p className="mt-1 text-xs text-muted max-w-md">
            You haven&apos;t saved any YouTube videos, channels, or playlists yet. Bookmark items from Search or Explorers to collect them with daily logs and multi-device cloud synchronization.
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
        />
      )}
    </div>
  );
}

/**
 * Unified item card for Saved Items supporting:
 * - Videos (Standard and Shorts-like)
 * - Channels
 * - Playlists
 * With explicit LOCAL vs CLOUD badge and Origin Device metadata display.
 */
function SavedItemCard({
  item,
  isLocalPending,
  onRemove,
  onAddToPlaylist,
  onInspectJson,
}: {
  item: NormalizedYouTubeDiscoveryItem;
  isLocalPending?: boolean;
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

  const rawItem = item as unknown as Record<string, unknown>;
  const isLocal =
    isLocalPending ??
    (rawItem._localStatus === "LOCAL_PENDING" ||
      rawItem._localStatus === "PENDING_SYNC" ||
      (rawItem._syncStatus === "LOCAL" && rawItem._localStatus !== "COMMITTED"));

  const originLabel: string | null =
    typeof rawItem._originDeviceLabel === "string"
      ? rawItem._originDeviceLabel
      : typeof rawItem.originDeviceLabel === "string"
      ? rawItem.originDeviceLabel
      : null;

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

        {/* Top-Left: Type Badge Overlay */}
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

        {/* Top-Right: LOCAL vs CLOUD vs Before App Updating Status Badge */}
        <div className="absolute top-2.5 right-2.5 flex items-center gap-1">
          {Boolean(rawItem.isBeforeAppUpdating) ? (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold bg-purple-600 text-white shadow-xs">
              <Sparkles className="h-3 w-3" />
              Before App Updating
            </span>
          ) : isLocal ? (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold bg-amber-500 text-black shadow-xs">
              <HardDrive className="h-3 w-3" />
              LOCAL
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold bg-emerald-600 text-white shadow-xs">
              <Cloud className="h-3 w-3" />
              CLOUD
            </span>
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
        <div className="mt-1.5 flex items-center justify-between text-xs text-muted">
          {item.channelTitle ? (
            <p className="line-clamp-1 font-medium hover:text-foreground transition-colors">
              {item.channelTitle}
            </p>
          ) : (
            <span />
          )}

          {/* Origin Device Label */}
          {originLabel && (
            <span
              className="inline-flex items-center gap-1 text-[10px] font-medium text-muted/80 bg-surface-muted px-1.5 py-0.5 rounded"
              title={`Saved from ${String(originLabel)}`}
            >
              <Laptop className="h-2.5 w-2.5" />
              <span className="max-w-[100px] truncate">{String(originLabel)}</span>
            </span>
          )}
        </div>

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

        {/* Expandable and Collapsible Description */}
        <ExpandableDescription description={item.description} />

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
