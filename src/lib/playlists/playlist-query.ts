import type { NormalizedYouTubeDiscoveryItem } from "@/types/youtube";
import type {
  LibraryContentFilter,
  LibraryPlaylistItem,
  LibrarySortMode,
  LibraryYouTubeKind,
  UserPlaylistManifest,
} from "@/types/library";
import { canonicalYoutubeKey, libraryItemMatchesKind } from "@/types/library";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * Playlist Query Helpers — adapters, filters, and sorts for user playlists.
 * ──────────────────────────────────────────────────────────────────────────
 * All helpers operate on already-saved data. They never call the YouTube API
 * and never consume quota. Sorting never mutates the canonical `position`
 * fields; the `manual` mode is the only view that reflects stored order.
 * ═══════════════════════════════════════════════════════════════════════════
 */

export function youtubeKindFromNormalized(
  item: NormalizedYouTubeDiscoveryItem,
): LibraryYouTubeKind {
  if (item.itemType === "channel") return "channel";
  if (item.itemType === "playlist") return "youtube_playlist";
  if (item.itemType === "shorts_like" || item.isShortsLike) return "shorts";
  return "video";
}

export function toYoutubeSnapshot(
  item: NormalizedYouTubeDiscoveryItem,
): {
  kind: "youtube";
  youtubeKind: LibraryYouTubeKind;
  snapshot: {
    platformItemId: string;
    title: string;
    description: string | null;
    thumbnailUrl: string | null;
    channelId: string | null;
    channelTitle: string | null;
    publishedAt: string | null;
    viewsCount: number | null;
    likesCount: number | null;
    commentsCount: number | null;
    durationSeconds: number | null;
    itemCount: number | null;
    url: string;
    sourceItemType: string;
    isShortsLike: boolean;
    isAgeRestricted?: boolean;
  };
} {
  return {
    kind: "youtube",
    youtubeKind: youtubeKindFromNormalized(item),
    snapshot: {
      platformItemId: item.platformItemId,
      title: item.title,
      description: item.description ?? null,
      thumbnailUrl: item.thumbnailUrl ?? null,
      channelId: item.channelId ?? null,
      channelTitle: item.channelTitle ?? null,
      publishedAt: item.publishedAt ?? null,
      viewsCount: item.viewsCount ?? null,
      likesCount: item.likesCount ?? null,
      commentsCount: item.commentsCount ?? null,
      durationSeconds: item.durationSeconds ?? null,
      itemCount: item.itemCount ?? null,
      url: item.url,
      sourceItemType: item.itemType,
      isShortsLike: item.isShortsLike,
      isAgeRestricted: item.isAgeRestricted,
    },
  };
}

/** Item-level timestamp used by published-date sorts (null when unknown). */
export function itemPublishedTime(item: LibraryPlaylistItem): number | null {
  if (item.kind !== "youtube") return null;
  const t = item.snapshot.publishedAt ? Date.parse(item.snapshot.publishedAt) : NaN;
  return Number.isFinite(t) ? t : null;
}

export type PublishedPreset =
  | "all"
  | "24h"
  | "7d"
  | "30d"
  | "90d"
  | "year"
  | "custom";

export function matchesPublishedPreset(
  item: LibraryPlaylistItem,
  preset: PublishedPreset,
  customStart: string | null,
  customEnd: string | null,
  now = Date.now(),
): boolean {
  if (preset === "all") return true;
  const published = itemPublishedTime(item);
  if (preset === "custom") {
    // Items with unknown dates are excluded from a bounded custom range —
    // never invent metadata by treating unknown as current.
    if (published === null) return false;
    const start = customStart ? Date.parse(`${customStart}T00:00:00Z`) : NaN;
    const end = customEnd ? Date.parse(`${customEnd}T23:59:59Z`) : NaN;
    if (Number.isFinite(start) && published < start) return false;
    if (Number.isFinite(end) && published > end) return false;
    return true;
  }
  // Preset windows apply to videos/shorts; non-video entries pass through so
  // channels/playlists/custom notes are not hidden by a video-date filter.
  if (item.kind !== "youtube") return true;
  if (item.youtubeKind !== "video" && item.youtubeKind !== "shorts") return true;
  if (published === null) return false;
  const windows: Record<Exclude<PublishedPreset, "all" | "custom">, number> = {
    "24h": 24 * 3600 * 1000,
    "7d": 7 * 24 * 3600 * 1000,
    "30d": 30 * 24 * 3600 * 1000,
    "90d": 90 * 24 * 3600 * 1000,
    year: 365 * 24 * 3600 * 1000,
  };
  return now - published <= windows[preset];
}

export function matchesViewsRange(
  item: LibraryPlaylistItem,
  minViews: number | null,
  maxViews: number | null,
): boolean {
  if (minViews === null && maxViews === null) return true;
  if (item.kind !== "youtube") return minViews === null || minViews <= 0;
  const views = item.snapshot.viewsCount;
  // Missing view counts are handled gracefully: they pass only when no
  // minimum is required.
  if (views === null || views === undefined) {
    if (minViews !== null && minViews > 0) return false;
    if (maxViews !== null && 0 > maxViews) return false;
    return true;
  }
  if (minViews !== null && views < minViews) return false;
  if (maxViews !== null && views > maxViews) return false;
  return true;
}

function titleOf(item: LibraryPlaylistItem): string {
  return (item.kind === "custom" ? item.title : item.snapshot.title).toLowerCase();
}

function durationOf(item: LibraryPlaylistItem): number | null {
  if (item.kind !== "youtube") return null;
  return item.snapshot.durationSeconds ?? null;
}

function viewsOf(item: LibraryPlaylistItem): number | null {
  if (item.kind !== "youtube") return null;
  return item.snapshot.viewsCount ?? null;
}

/**
 * Sorts a copy of `items`. `manual` preserves canonical stored positions;
 * every other mode is a transient view and must not rewrite positions.
 * Unknown/missing metadata sorts last in descending modes, first in
 * ascending modes — predictably, and without inventing values.
 */
export function sortPlaylistItems(
  items: LibraryPlaylistItem[],
  mode: LibrarySortMode,
): LibraryPlaylistItem[] {
  const arr = [...items];
  switch (mode) {
    case "manual":
      return arr.sort((a, b) => a.position - b.position);
    case "views_desc":
      return arr.sort((a, b) => (viewsOf(b) ?? -1) - (viewsOf(a) ?? -1));
    case "views_asc":
      return arr.sort((a, b) => {
        const av = viewsOf(a);
        const bv = viewsOf(b);
        if (av === null && bv === null) return 0;
        if (av === null) return -1;
        if (bv === null) return 1;
        return av - bv;
      });
    case "published_desc":
      return arr.sort((a, b) => (itemPublishedTime(b) ?? -1) - (itemPublishedTime(a) ?? -1));
    case "published_asc": {
      return arr.sort((a, b) => {
        const at = itemPublishedTime(a);
        const bt = itemPublishedTime(b);
        if (at === null && bt === null) return 0;
        if (at === null) return -1;
        if (bt === null) return 1;
        return at - bt;
      });
    }
    case "added_desc":
      return arr.sort((a, b) => b.addedAt.localeCompare(a.addedAt));
    case "added_asc":
      return arr.sort((a, b) => a.addedAt.localeCompare(b.addedAt));
    case "title_az":
      return arr.sort((a, b) => titleOf(a).localeCompare(titleOf(b)));
    case "title_za":
      return arr.sort((a, b) => titleOf(b).localeCompare(titleOf(a)));
    case "updated_desc":
      return arr.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    case "duration_desc":
      return arr.sort((a, b) => (durationOf(b) ?? -1) - (durationOf(a) ?? -1));
    case "duration_asc": {
      const av = (x: LibraryPlaylistItem) => durationOf(x);
      return arr.sort((a, b) => {
        const x = av(a);
        const y = av(b);
        if (x === null && y === null) return 0;
        if (x === null) return -1;
        if (y === null) return 1;
        return x - y;
      });
    }
    default:
      return arr;
  }
}

export interface PlaylistItemQuery {
  query: string;
  contentFilter: LibraryContentFilter;
  publishedPreset: PublishedPreset;
  customStart: string | null;
  customEnd: string | null;
  minViews: number | null;
  maxViews: number | null;
  sort: LibrarySortMode;
}

/**
 * Applies type/date/views filters + sort to ALREADY-SEARCHED items.
 * Text search itself runs through the shared FlexSearch service before this.
 */
export function applyItemFilters(
  items: LibraryPlaylistItem[],
  q: PlaylistItemQuery,
  now = Date.now(),
): LibraryPlaylistItem[] {
  const filtered = items.filter(
    (item) =>
      libraryItemMatchesKind(item, q.contentFilter) &&
      matchesPublishedPreset(item, q.publishedPreset, q.customStart, q.customEnd, now) &&
      matchesViewsRange(item, q.minViews, q.maxViews),
  );
  return sortPlaylistItems(filtered, q.sort);
}

/** Next free position at the end of a container (group or ungrouped). */
export function nextPositionIn(
  manifest: UserPlaylistManifest,
  groupId: string | null,
): number {
  const inContainer = manifest.items.filter(
    (i) => (i.groupId ?? null) === (groupId ?? null),
  );
  if (inContainer.length === 0) return 0;
  return Math.max(...inContainer.map((i) => i.position)) + 1;
}

/** True when the same YouTube entity already belongs to the playlist. */
export function playlistContainsYoutube(
  manifest: UserPlaylistManifest,
  youtubeKind: LibraryYouTubeKind,
  platformItemId: string,
): boolean {
  const key = canonicalYoutubeKey(youtubeKind, platformItemId);
  return manifest.items.some(
    (i) =>
      i.kind === "youtube" &&
      canonicalYoutubeKey(i.youtubeKind, i.snapshot.platformItemId) === key,
  );
}
