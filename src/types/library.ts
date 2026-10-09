/**
 * ═══════════════════════════════════════════════════════════════════════════
 * User Library Types — personal playlists, groups, and entries.
 * ──────────────────────────────────────────────────────────────────────────
 * A "user playlist" is a personal collection created in this app. It is NOT
 * a YouTube playlist. A YouTube playlist can be saved as ONE entry inside a
 * user playlist.
 *
 * Identity rules:
 * - `UserPlaylistManifest.playlist.id` is the permanent identity. Renames
 *   never change it, and the on-disk filename is stable after creation.
 * - YouTube entries dedupe within a playlist by
 *   `youtubeType + platformItemId` (same video is not duplicated merely
 *   because it also appears as a Short elsewhere — see `canonicalYoutubeKey`).
 * - Custom entries are first-class items with their own `entryId`.
 * - Membership identity (`entryId`) is independent from the global Saved
 *   Library identity (`platformItemId`).
 * ═══════════════════════════════════════════════════════════════════════════
 */

export const USER_PLAYLIST_MANIFEST_VERSION = 1;
export const USER_PLAYLIST_MANIFEST_TYPE = "youtube-discovery-playlist";

/** Discriminated entry kinds inside a user playlist. */
export type LibraryEntryKind = "youtube" | "custom";

/** YouTube entity flavour preserved on each membership. */
export type LibraryYouTubeKind =
  | "video"
  | "shorts"
  | "youtube_playlist"
  | "channel";

export interface LibraryYouTubeSnapshot {
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
  /** Original normalized `itemType` (e.g. `shorts_like`, `live`) for honesty. */
  sourceItemType: string;
  isShortsLike: boolean;
  isAgeRestricted?: boolean;
}

export interface LibraryPlaylistItemBase {
  /** Stable membership identity (NOT the YouTube id). */
  entryId: string;
  /** Canonical manual position. Never overwritten by transient sorts. */
  position: number;
  /** Owning group id, or null when outside any group. */
  groupId: string | null;
  /** When this membership was added to the playlist (ISO). */
  addedAt: string;
  /** Last membership edit (notes, group move, reorder) (ISO). */
  updatedAt: string;
  /** Free-form user note on ANY entry type. */
  note: string | null;
}

export interface LibraryYouTubeItem extends LibraryPlaylistItemBase {
  kind: "youtube";
  youtubeKind: LibraryYouTubeKind;
  snapshot: LibraryYouTubeSnapshot;
}

export interface LibraryCustomItem extends LibraryPlaylistItemBase {
  kind: "custom";
  title: string;
  customNote: string | null;
  url: string | null;
}

export type LibraryPlaylistItem = LibraryYouTubeItem | LibraryCustomItem;

export interface LibraryPlaylistGroup {
  id: string;
  title: string;
  description: string | null;
  /** Canonical manual group order. */
  position: number;
  createdAt: string;
  updatedAt: string;
}

export interface UserPlaylistMeta {
  id: string;
  name: string;
  description: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * Complete, self-contained playlist manifest. Every user playlist has its own
 * file with this exact shape — never just a list of ids.
 */
export interface UserPlaylistManifest {
  manifestVersion: number;
  type: typeof USER_PLAYLIST_MANIFEST_TYPE;
  playlist: UserPlaylistMeta;
  groups: LibraryPlaylistGroup[];
  items: LibraryPlaylistItem[];
}

/** Lightweight index row. Must NOT duplicate full playlist contents. */
export interface UserPlaylistIndexEntry {
  id: string;
  name: string;
  description: string | null;
  createdAt: string;
  updatedAt: string;
  itemCount: number;
  groupCount: number;
  manifestFile: string;
  /** Up to 4 representative thumbnails for card collages. */
  thumbnails: string[];
  counts: {
    videos: number;
    shorts: number;
    youtubePlaylists: number;
    channels: number;
    custom: number;
  };
}

/** Content-type filter used by playlist detail pages. */
export type LibraryContentFilter =
  | "all"
  | "videos"
  | "shorts"
  | "youtube_playlists"
  | "channels"
  | "custom";

/** Persisted sort modes for the playlist detail workspace. */
export type LibrarySortMode =
  | "manual"
  | "views_desc"
  | "views_asc"
  | "published_desc"
  | "published_asc"
  | "added_desc"
  | "added_asc"
  | "title_az"
  | "title_za"
  | "updated_desc"
  | "duration_desc"
  | "duration_asc";

/**
 * Canonical dedupe key for a YouTube entity inside ONE playlist.
 * Videos and Shorts share the same underlying video identity: a video saved
 * once as `video` must not be duplicated when added again as `shorts`.
 */
export function canonicalYoutubeKey(
  youtubeKind: LibraryYouTubeKind,
  platformItemId: string,
): string {
  const normalizedId = platformItemId.trim();
  if (youtubeKind === "video" || youtubeKind === "shorts") {
    return `yt-video:${normalizedId}`;
  }
  if (youtubeKind === "youtube_playlist") {
    return `yt-playlist:${normalizedId}`;
  }
  return `yt-channel:${normalizedId}`;
}

/** Membership entry id derived from the canonical key (stable, deduping). */
export function youtubeEntryId(
  youtubeKind: LibraryYouTubeKind,
  platformItemId: string,
): string {
  return canonicalYoutubeKey(youtubeKind, platformItemId);
}

export function libraryItemTitle(item: LibraryPlaylistItem): string {
  return item.kind === "custom" ? item.title : item.snapshot.title;
}

export function libraryItemMatchesKind(
  item: LibraryPlaylistItem,
  filter: LibraryContentFilter,
): boolean {
  if (filter === "all") return true;
  if (filter === "custom") return item.kind === "custom";
  if (item.kind !== "youtube") return false;
  switch (filter) {
    case "videos":
      return item.youtubeKind === "video";
    case "shorts":
      return item.youtubeKind === "shorts";
    case "youtube_playlists":
      return item.youtubeKind === "youtube_playlist";
    case "channels":
      return item.youtubeKind === "channel";
    default:
      return true;
  }
}

/** Create a filesystem-safe slug for manifest filenames. */
export function slugifyPlaylistName(name: string): string {
  const slug = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\u0600-\u06FF]+/gi, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
  return slug || "playlist";
}

export function createPlaylistId(): string {
  return `upl_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function createEntryId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function emptyPlaylistManifest(
  name: string,
  description: string | null = null,
): UserPlaylistManifest {
  const now = new Date().toISOString();
  return {
    manifestVersion: USER_PLAYLIST_MANIFEST_VERSION,
    type: USER_PLAYLIST_MANIFEST_TYPE,
    playlist: {
      id: createPlaylistId(),
      name: name.trim(),
      description: description?.trim() ? description.trim() : null,
      createdAt: now,
      updatedAt: now,
    },
    groups: [],
    items: [],
  };
}
