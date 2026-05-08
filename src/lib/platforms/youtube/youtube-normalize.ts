import type {
  NormalizedYouTubeDiscoveryItem,
  YouTubeDiscoveryItemType,
  YouTubeLiveBroadcastContent,
} from "@/types/youtube";

interface YouTubeThumbnailSet {
  default?: { url?: string };
  medium?: { url?: string };
  high?: { url?: string };
  standard?: { url?: string };
  maxres?: { url?: string };
}

interface YouTubeSnippet {
  title?: string;
  description?: string;
  channelId?: string;
  channelTitle?: string;
  publishedAt?: string;
  thumbnails?: YouTubeThumbnailSet;
  tags?: string[];
  categoryId?: string;
  defaultLanguage?: string;
  defaultAudioLanguage?: string;
  liveBroadcastContent?: YouTubeLiveBroadcastContent;
}

interface YouTubeVideoDetail {
  id: string;
  snippet?: YouTubeSnippet;
  contentDetails?: {
    duration?: string;
    caption?: string;
    regionRestriction?: { allowed?: string[]; blocked?: string[] };
  };
  statistics?: {
    viewCount?: string;
    likeCount?: string;
    commentCount?: string;
  };
  status?: {
    embeddable?: boolean;
  };
  liveStreamingDetails?: unknown;
}

interface YouTubeChannelDetail {
  id: string;
  snippet?: YouTubeSnippet & { customUrl?: string };
  contentDetails?: {
    relatedPlaylists?: {
      uploads?: string;
    };
  };
  statistics?: {
    viewCount?: string;
    subscriberCount?: string;
    videoCount?: string;
  };
}

interface YouTubePlaylistDetail {
  id: string;
  snippet?: YouTubeSnippet;
  contentDetails?: {
    itemCount?: number;
  };
}

interface YouTubeSearchItem {
  id?: {
    videoId?: string;
    channelId?: string;
    playlistId?: string;
  };
  snippet?: YouTubeSnippet;
}

export function parseIsoDurationToSeconds(duration: string | null | undefined) {
  if (!duration) {
    return null;
  }

  const match = duration.match(/^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/);

  if (!match) {
    return null;
  }

  const [, days, hours, minutes, seconds] = match;
  return (
    Number(days ?? 0) * 86400 +
    Number(hours ?? 0) * 3600 +
    Number(minutes ?? 0) * 60 +
    Number(seconds ?? 0)
  );
}

export function normalizeVideoDetail(raw: YouTubeVideoDetail): NormalizedYouTubeDiscoveryItem {
  const durationSeconds = parseIsoDurationToSeconds(raw.contentDetails?.duration);
  const liveBroadcastContent = raw.snippet?.liveBroadcastContent ?? "none";
  const isShortsLike = durationSeconds !== null && durationSeconds <= 60;
  const itemType = getVideoItemType(liveBroadcastContent, isShortsLike);

  return {
    id: `youtube:${raw.id}`,
    platform: "youtube",
    itemType,
    platformItemId: raw.id,
    url: `https://www.youtube.com/watch?v=${raw.id}`,
    title: raw.snippet?.title ?? "Untitled YouTube video",
    description: emptyToNull(raw.snippet?.description),
    thumbnailUrl: chooseThumbnail(raw.snippet?.thumbnails),
    channelId: raw.snippet?.channelId ?? null,
    channelTitle: raw.snippet?.channelTitle ?? null,
    publishedAt: raw.snippet?.publishedAt ?? null,
    durationSeconds,
    viewsCount: readNumber(raw.statistics?.viewCount),
    likesCount: readNumber(raw.statistics?.likeCount),
    commentsCount: readNumber(raw.statistics?.commentCount),
    language: raw.snippet?.defaultAudioLanguage ?? raw.snippet?.defaultLanguage ?? null,
    region: null,
    tags: raw.snippet?.tags ?? [],
    categoryId: raw.snippet?.categoryId ?? null,
    isEmbeddable: raw.status?.embeddable ?? null,
    liveBroadcastContent,
    isShortsLike,
    rawJson: raw,
  };
}

export function normalizeChannelDetail(raw: YouTubeChannelDetail): NormalizedYouTubeDiscoveryItem {
  return {
    id: `youtube:${raw.id}`,
    platform: "youtube",
    itemType: "channel",
    platformItemId: raw.id,
    url: `https://www.youtube.com/channel/${raw.id}`,
    title: raw.snippet?.title ?? "Untitled YouTube channel",
    description: emptyToNull(raw.snippet?.description),
    thumbnailUrl: chooseThumbnail(raw.snippet?.thumbnails),
    channelId: raw.id,
    channelTitle: raw.snippet?.title ?? null,
    publishedAt: raw.snippet?.publishedAt ?? null,
    durationSeconds: null,
    viewsCount: readNumber(raw.statistics?.viewCount),
    likesCount: null,
    commentsCount: null,
    language: raw.snippet?.defaultLanguage ?? null,
    region: null,
    tags: [],
    categoryId: null,
    isEmbeddable: null,
    liveBroadcastContent: null,
    isShortsLike: false,
    rawJson: raw,
  };
}

export function normalizePlaylistDetail(raw: YouTubePlaylistDetail): NormalizedYouTubeDiscoveryItem {
  return {
    id: `youtube:${raw.id}`,
    platform: "youtube",
    itemType: "playlist",
    platformItemId: raw.id,
    url: `https://www.youtube.com/playlist?list=${raw.id}`,
    title: raw.snippet?.title ?? "Untitled YouTube playlist",
    description: emptyToNull(raw.snippet?.description),
    thumbnailUrl: chooseThumbnail(raw.snippet?.thumbnails),
    channelId: raw.snippet?.channelId ?? null,
    channelTitle: raw.snippet?.channelTitle ?? null,
    publishedAt: raw.snippet?.publishedAt ?? null,
    durationSeconds: null,
    viewsCount: null,
    likesCount: null,
    commentsCount: null,
    language: raw.snippet?.defaultLanguage ?? null,
    region: null,
    tags: [],
    categoryId: null,
    isEmbeddable: null,
    liveBroadcastContent: null,
    isShortsLike: false,
    rawJson: raw,
  };
}

export function normalizeSearchFallback(raw: YouTubeSearchItem): NormalizedYouTubeDiscoveryItem | null {
  const id = raw.id?.videoId ?? raw.id?.channelId ?? raw.id?.playlistId;

  if (!id) {
    return null;
  }

  const itemType: YouTubeDiscoveryItemType = raw.id?.videoId ? "video" : raw.id?.channelId ? "channel" : "playlist";
  const url =
    itemType === "video"
      ? `https://www.youtube.com/watch?v=${id}`
      : itemType === "channel"
        ? `https://www.youtube.com/channel/${id}`
        : `https://www.youtube.com/playlist?list=${id}`;

  return {
    id: `youtube:${id}`,
    platform: "youtube",
    itemType,
    platformItemId: id,
    url,
    title: raw.snippet?.title ?? "Untitled YouTube item",
    description: emptyToNull(raw.snippet?.description),
    thumbnailUrl: chooseThumbnail(raw.snippet?.thumbnails),
    channelId: raw.snippet?.channelId ?? (itemType === "channel" ? id : null),
    channelTitle: raw.snippet?.channelTitle ?? null,
    publishedAt: raw.snippet?.publishedAt ?? null,
    durationSeconds: null,
    viewsCount: null,
    likesCount: null,
    commentsCount: null,
    language: raw.snippet?.defaultLanguage ?? null,
    region: null,
    tags: [],
    categoryId: null,
    isEmbeddable: null,
    liveBroadcastContent: raw.snippet?.liveBroadcastContent ?? null,
    isShortsLike: false,
    rawJson: raw,
  };
}

export function readNumber(value: string | number | null | undefined) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : null;
}

function getVideoItemType(liveBroadcastContent: YouTubeLiveBroadcastContent, isShortsLike: boolean): YouTubeDiscoveryItemType {
  if (liveBroadcastContent === "live") {
    return "live";
  }

  if (liveBroadcastContent === "upcoming") {
    return "upcoming";
  }

  if (liveBroadcastContent === "completed") {
    return "completed_live";
  }

  return isShortsLike ? "shorts_like" : "video";
}

function chooseThumbnail(thumbnails: YouTubeThumbnailSet | undefined) {
  return thumbnails?.maxres?.url ?? thumbnails?.standard?.url ?? thumbnails?.high?.url ?? thumbnails?.medium?.url ?? thumbnails?.default?.url ?? null;
}

function emptyToNull(value: string | null | undefined) {
  if (value === undefined || value === null || value.trim() === "") {
    return null;
  }

  return value;
}
