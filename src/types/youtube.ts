export const YOUTUBE_ITEM_TYPES = [
  "video",
  "shorts_like",
  "channel",
  "playlist",
  "live",
  "upcoming",
  "completed_live",
  "post_unsupported",
] as const;

export type YouTubeDiscoveryItemType = (typeof YOUTUBE_ITEM_TYPES)[number];

export type YouTubeSearchResourceType = "video" | "channel" | "playlist";
export type YouTubeSearchResourceSelection = "ALL" | YouTubeSearchResourceType;

export type YouTubeLiveBroadcastContent = "none" | "live" | "upcoming" | "completed";

export interface NormalizedYouTubeDiscoveryItem {
  id: string;
  platform: "youtube";
  itemType: YouTubeDiscoveryItemType;
  platformItemId: string;
  url: string;
  title: string;
  description: string | null;
  thumbnailUrl: string | null;
  channelId: string | null;
  channelTitle: string | null;
  publishedAt: string | null;
  durationSeconds: number | null;
  viewsCount: number | null;
  likesCount: number | null;
  commentsCount: number | null;
  language: string | null;
  region: string | null;
  tags: string[];
  categoryId: string | null;
  isEmbeddable: boolean | null;
  liveBroadcastContent: YouTubeLiveBroadcastContent | null;
  isShortsLike: boolean;
  rawJson: unknown;
  manifestId?: string;
  collectedAt?: string;
  playlistPosition?: number | null;
  knownPublicPlaylistAppearances?: Array<{
    playlistId: string;
    playlistTitle: string;
    position: number | null;
  }>;
}

export interface YouTubeSearchSettings {
  query: string;
  types: YouTubeSearchResourceType[];
  pageSize: number;
  maxPages: number;
  maxItems: number;
  order?: "relevance" | "date" | "rating" | "viewCount" | "title" | "videoCount";
  publishedAfter?: string;
  publishedBefore?: string;
  regionCode?: string;
  relevanceLanguage?: string;
  safeSearch?: "none" | "moderate" | "strict";
  videoDuration?: "any" | "short" | "medium" | "long";
  videoDefinition?: "any" | "high" | "standard";
  videoCaption?: "any" | "closedCaption" | "none";
  videoEmbeddable?: "any" | "true";
  eventType?: "live" | "completed" | "upcoming";
  topicId?: string;
  pageToken?: string;
}

/* ═══════════════════════════════════════════════════════════════════════════
   YouTube Result Filters — local-only filter/sort contract.
   ──────────────────────────────────────────────────────────────────────────
   All numeric fields use `null` for "not set". Zero (0) is always a valid
   boundary. Never use `!value` or `|| fallback` on these fields — that
   would silently drop 0-view or 0-like items from the result set.
   ═══════════════════════════════════════════════════════════════════════════ */
export interface YouTubeResultFilters {
  keyword: string;
  minViews: number | null;
  maxViews: number | null;
  targetViews: number | null;
  minLikes: number | null;
  maxLikes: number | null;
  minComments: number | null;
  maxComments: number | null;
  durationMinSec: number | null;
  durationMaxSec: number | null;
  year: number | null;
  yearFrom: number | null;
  yearTo: number | null;
  /** Month filter (1-12). Can be combined with year or used independently. */
  month: number | null;
  publishedAfter: string | null;
  publishedBefore: string | null;
  itemTypes: YouTubeDiscoveryItemType[];
  channelId: string | null;
  channelName: string | null;
  language: string | null;
  hasThumbnail: "any" | "yes" | "no";
  hasDescription: "any" | "yes" | "no";
  /** Presence filter for language metadata */
  hasLanguage: "any" | "yes" | "no";
  shortsLikeOnly: boolean;
  sort:
    | "api_order"
    | "latest"
    | "oldest"
    | "most_views"
    | "least_views"
    | "most_likes"
    | "least_likes"
    | "most_comments"
    | "least_comments"
    | "shortest"
    | "longest"
    | "title_az"
    | "title_za"
    /** Engagement: like-to-view ratio descending */
    | "engagement_desc"
    /** Engagement: like-to-view ratio ascending */
    | "engagement_asc";
  strictMetadata: boolean;
}

export const DEFAULT_YOUTUBE_RESULT_FILTERS: YouTubeResultFilters = {
  keyword: "",
  minViews: null,
  maxViews: null,
  targetViews: null,
  minLikes: null,
  maxLikes: null,
  minComments: null,
  maxComments: null,
  durationMinSec: null,
  durationMaxSec: null,
  year: null,
  yearFrom: null,
  yearTo: null,
  month: null,
  publishedAfter: null,
  publishedBefore: null,
  itemTypes: [],
  channelId: null,
  channelName: null,
  language: null,
  hasThumbnail: "any",
  hasDescription: "any",
  hasLanguage: "any",
  shortsLikeOnly: false,
  sort: "api_order",
  strictMetadata: false,
};
