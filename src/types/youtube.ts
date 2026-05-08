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
  publishedAfter: string | null;
  publishedBefore: string | null;
  itemTypes: YouTubeDiscoveryItemType[];
  channelId: string | null;
  channelName: string | null;
  language: string | null;
  hasThumbnail: "any" | "yes" | "no";
  hasDescription: "any" | "yes" | "no";
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
    | "title_za";
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
  publishedAfter: null,
  publishedBefore: null,
  itemTypes: [],
  channelId: null,
  channelName: null,
  language: null,
  hasThumbnail: "any",
  hasDescription: "any",
  sort: "api_order",
  strictMetadata: false,
};
