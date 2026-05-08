import "server-only";

import type { YouTubeManifest } from "@/types/manifest";
import type { NormalizedYouTubeDiscoveryItem, YouTubeSearchSettings } from "@/types/youtube";
import { buildYouTubeManifest } from "@/lib/manifests/manifest-builder";
import { saveManifestInMemory } from "@/lib/manifests/manifest-memory-store";
import { estimateQuotaCost } from "./youtube-quota";
import { getYouTubeClient } from "./youtube-client";
import { normalizeChannelDetail, normalizePlaylistDetail, normalizeSearchFallback, normalizeVideoDetail } from "./youtube-normalize";

interface SearchListResponse {
  nextPageToken?: string;
  items?: Array<{
    id?: {
      videoId?: string;
      channelId?: string;
      playlistId?: string;
    };
    snippet?: unknown;
  }>;
}

interface ListResponse<T> {
  items?: T[];
}

export async function runYouTubeSearch(settings: YouTubeSearchSettings): Promise<YouTubeManifest> {
  const client = getYouTubeClient();
  const rawSearchItems: NonNullable<SearchListResponse["items"]> = [];
  let pageToken = settings.pageToken;
  let pagesFetched = 0;
  let quotaCostEstimate = 0;
  let nextPageToken: string | null = null;

  for (let page = 0; page < settings.maxPages; page += 1) {
    if (rawSearchItems.length >= settings.maxItems) {
      break;
    }

    const response = await client.searchList<SearchListResponse>({
      part: "snippet",
      q: settings.query,
      type: settings.types.join(","),
      maxResults: Math.min(settings.pageSize, settings.maxItems - rawSearchItems.length),
      order: settings.order,
      pageToken,
      publishedAfter: settings.publishedAfter,
      publishedBefore: settings.publishedBefore,
      regionCode: settings.regionCode,
      relevanceLanguage: settings.relevanceLanguage,
      safeSearch: settings.safeSearch,
      videoDuration: settings.types.length === 1 && settings.types[0] === "video" ? settings.videoDuration : undefined,
      videoDefinition: settings.types.length === 1 && settings.types[0] === "video" ? settings.videoDefinition : undefined,
      videoCaption: settings.types.length === 1 && settings.types[0] === "video" ? settings.videoCaption : undefined,
      videoEmbeddable: settings.types.length === 1 && settings.types[0] === "video" ? settings.videoEmbeddable : undefined,
      eventType: settings.types.length === 1 && settings.types[0] === "video" ? settings.eventType : undefined,
      topicId: settings.topicId,
    });

    quotaCostEstimate += estimateQuotaCost("searchList");
    pagesFetched += 1;
    rawSearchItems.push(...(response.items ?? []));
    nextPageToken = response.nextPageToken ?? null;
    pageToken = response.nextPageToken;

    if (!pageToken) {
      break;
    }

    await delay(Number(process.env.YOUTUBE_SEARCH_DELAY_MS ?? 250));
  }

  const items = await hydrateSearchItems(rawSearchItems, (cost) => {
    quotaCostEstimate += cost;
  });

  const manifest = buildYouTubeManifest({
    manifestType: "youtube_search",
    title: `Search: ${settings.query}`,
    query: settings.query,
    source: {
      kind: "search",
      id: settings.query,
      label: settings.query,
    },
    searchSettingsSnapshot: settings,
    pagesFetched,
    nextPageToken,
    quotaCostEstimate,
    items,
    status: nextPageToken && items.length >= settings.maxItems ? "max_items_reached" : "complete",
  });

  return saveManifestInMemory(manifest);
}

async function hydrateSearchItems(
  rawSearchItems: NonNullable<SearchListResponse["items"]>,
  addQuotaCost: (cost: number) => void,
): Promise<NormalizedYouTubeDiscoveryItem[]> {
  const client = getYouTubeClient();
  const videoIds = rawSearchItems.map((item) => item.id?.videoId).filter((id): id is string => Boolean(id));
  const channelIds = rawSearchItems.map((item) => item.id?.channelId).filter((id): id is string => Boolean(id));
  const playlistIds = rawSearchItems.map((item) => item.id?.playlistId).filter((id): id is string => Boolean(id));

  const [videos, channels, playlists] = await Promise.all([
    hydrateDetails(videoIds, (ids) =>
      client.videosList<ListResponse<Parameters<typeof normalizeVideoDetail>[0]>>({
        part: "snippet,contentDetails,statistics,status,liveStreamingDetails",
        id: ids.join(","),
      }),
    ),
    hydrateDetails(channelIds, (ids) =>
      client.channelsList<ListResponse<Parameters<typeof normalizeChannelDetail>[0]>>({
        part: "snippet,contentDetails,statistics",
        id: ids.join(","),
      }),
    ),
    hydrateDetails(playlistIds, (ids) =>
      client.playlistsList<ListResponse<Parameters<typeof normalizePlaylistDetail>[0]>>({
        part: "snippet,contentDetails,status",
        id: ids.join(","),
      }),
    ),
  ]);

  addQuotaCost(
    estimateQuotaCost("videosList", Math.ceil(unique(videoIds).length / 50)) +
      estimateQuotaCost("channelsList", Math.ceil(unique(channelIds).length / 50)) +
      estimateQuotaCost("playlistsList", Math.ceil(unique(playlistIds).length / 50)),
  );

  const videoMap = new Map(videos.map((video) => [video.platformItemId, video]));
  const channelMap = new Map(channels.map((channel) => [channel.platformItemId, channel]));
  const playlistMap = new Map(playlists.map((playlist) => [playlist.platformItemId, playlist]));

  return rawSearchItems
    .map((item) => {
      const id = item.id?.videoId ?? item.id?.channelId ?? item.id?.playlistId;
      return (id && (videoMap.get(id) ?? channelMap.get(id) ?? playlistMap.get(id))) ?? normalizeSearchFallback(item as Parameters<typeof normalizeSearchFallback>[0]);
    })
    .filter((item): item is NormalizedYouTubeDiscoveryItem => item !== null);
}

async function hydrateDetails<T>(
  ids: string[],
  fetcher: (ids: string[]) => Promise<ListResponse<T>>,
): Promise<NormalizedYouTubeDiscoveryItem[]> {
  const records: T[] = [];

  for (const chunk of chunkIds(unique(ids), 50)) {
    if (chunk.length === 0) {
      continue;
    }

    const response = await fetcher(chunk);
    records.push(...(response.items ?? []));
  }

  return records.map((record) => {
    if (isVideoRecord(record)) {
      return normalizeVideoDetail(record);
    }

    if (isChannelRecord(record)) {
      return normalizeChannelDetail(record);
    }

    return normalizePlaylistDetail(record as Parameters<typeof normalizePlaylistDetail>[0]);
  });
}

function isVideoRecord(record: unknown): record is Parameters<typeof normalizeVideoDetail>[0] {
  return Boolean(record && typeof record === "object" && "contentDetails" in record && "statistics" in record && "status" in record);
}

function isChannelRecord(record: unknown): record is Parameters<typeof normalizeChannelDetail>[0] {
  return Boolean(record && typeof record === "object" && "contentDetails" in record && "statistics" in record && !("status" in record));
}

function unique(ids: string[]) {
  return Array.from(new Set(ids));
}

function chunkIds(ids: string[], chunkSize: number) {
  const chunks: string[][] = [];

  for (let index = 0; index < ids.length; index += chunkSize) {
    chunks.push(ids.slice(index, index + chunkSize));
  }

  return chunks;
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
