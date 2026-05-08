import type { NormalizedYouTubeDiscoveryItem, YouTubeSearchSettings } from "@/types/youtube";

export const YOUTUBE_MANIFEST_TYPES = [
  "youtube_search",
  "youtube_channel_uploads",
  "youtube_playlist",
  "youtube_related_videos",
  "youtube_saved_collection",
  "youtube_ai_result_set",
  "youtube_link_explorer",
] as const;

export type YouTubeManifestType = (typeof YOUTUBE_MANIFEST_TYPES)[number];

export const YOUTUBE_MANIFEST_STATUSES = [
  "draft",
  "running",
  "complete",
  "partial",
  "failed",
  "stopped",
  "max_items_reached",
  "quota_limited",
  "provider_limited",
  "expired",
] as const;

export type YouTubeManifestStatus = (typeof YOUTUBE_MANIFEST_STATUSES)[number];

export interface YouTubeManifestWarning {
  code: string;
  message: string;
}

export interface YouTubeManifest {
  manifestId: string;
  manifestType: YouTubeManifestType;
  platform: "youtube";
  title: string;
  query: string | null;
  source: {
    kind: "search" | "channel" | "playlist" | "link" | "collection" | "ai";
    id: string | null;
    label: string;
  };
  searchSettingsSnapshot: Partial<YouTubeSearchSettings> | null;
  pagesFetched: number;
  nextPageToken: string | null;
  quotaCostEstimate: number;
  status: YouTubeManifestStatus;
  itemCount: number;
  uniqueItemCount: number;
  duplicateCount: number;
  collectedAt: string;
  warnings: YouTubeManifestWarning[];
  errors: YouTubeManifestWarning[];
  normalizedItems: NormalizedYouTubeDiscoveryItem[];
  saved?: boolean;
}

export interface YouTubeManifestSummary {
  manifestId: string;
  manifestType: YouTubeManifestType;
  title: string;
  status: YouTubeManifestStatus;
  itemCount: number;
  quotaCostEstimate: number;
  collectedAt: string;
  saved: boolean;
}
