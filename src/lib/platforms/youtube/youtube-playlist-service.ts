import "server-only";

import type { YouTubeManifest } from "@/types/manifest";
import type { NormalizedYouTubeDiscoveryItem } from "@/types/youtube";
import { buildYouTubeManifest } from "@/lib/manifests/manifest-builder";
import { saveManifestInMemory } from "@/lib/manifests/manifest-memory-store";
import { estimateQuotaCost } from "./youtube-quota";
import { getYouTubeClient } from "./youtube-client";
import { analyzeYouTubeUrl } from "./youtube-url-analyzer";
import { normalizePlaylistDetail, normalizeVideoDetail } from "./youtube-normalize";

interface ListResponse<T> {
  nextPageToken?: string;
  items?: T[];
}

type PlaylistRecord = Parameters<typeof normalizePlaylistDetail>[0];
type VideoRecord = Parameters<typeof normalizeVideoDetail>[0];

interface PlaylistItemRecord {
  id: string;
  snippet?: {
    title?: string;
    position?: number;
    resourceId?: {
      videoId?: string;
    };
  };
  status?: {
    privacyStatus?: string;
  };
}

export async function analyzePlaylist(input: string) {
  const client = getYouTubeClient();
  const analyzed = analyzeYouTubeUrl(input);
  const playlistId = analyzed.kind === "playlist" ? analyzed.playlistId : input;

  const response = await client.playlistsList<ListResponse<PlaylistRecord>>({
    part: "snippet,contentDetails,status",
    id: playlistId,
  });

  const playlist = response.items?.[0] ?? null;

  return {
    analyzed,
    playlistId,
    quotaCostEstimate: estimateQuotaCost("playlistsList"),
    playlist: playlist ? normalizePlaylistDetail(playlist) : null,
  };
}

export async function fetchPlaylistItems(input: string, options: { pageToken?: string; maxPages: number; maxItems: number }): Promise<YouTubeManifest> {
  const client = getYouTubeClient();
  const analysis = await analyzePlaylist(input);

  if (!analysis.playlist) {
    const failedManifest = buildYouTubeManifest({
      manifestType: "youtube_playlist",
      title: `Playlist: ${input}`,
      query: input,
      source: {
        kind: "playlist",
        id: analysis.playlistId,
        label: input,
      },
      searchSettingsSnapshot: null,
      pagesFetched: 0,
      nextPageToken: null,
      quotaCostEstimate: analysis.quotaCostEstimate,
      items: [],
      status: "failed",
      errors: [
        {
          code: "playlist_not_found",
          message: "The playlist was not returned by the official API. It may be private, deleted, or unavailable.",
        },
      ],
    });

    return saveManifestInMemory(failedManifest);
  }

  const playlistItems: PlaylistItemRecord[] = [];
  let pageToken = options.pageToken;
  let nextPageToken: string | null = null;
  let pagesFetched = 0;
  let quotaCostEstimate = analysis.quotaCostEstimate;

  for (let page = 0; page < options.maxPages; page += 1) {
    if (playlistItems.length >= options.maxItems) {
      break;
    }

    const response = await client.playlistItemsList<ListResponse<PlaylistItemRecord>>({
      part: "snippet,contentDetails,status",
      playlistId: analysis.playlist.platformItemId,
      maxResults: Math.min(50, options.maxItems - playlistItems.length),
      pageToken,
    });

    pagesFetched += 1;
    quotaCostEstimate += estimateQuotaCost("playlistItemsList");
    playlistItems.push(...(response.items ?? []));
    nextPageToken = response.nextPageToken ?? null;
    pageToken = response.nextPageToken;

    if (!pageToken) {
      break;
    }
  }

  const videoItems = await hydrateVideos(playlistItems.map((item) => item.snippet?.resourceId?.videoId).filter((id): id is string => Boolean(id)));
  quotaCostEstimate += estimateQuotaCost("videosList", Math.ceil(videoItems.length / 50));

  const positionById = new Map(
    playlistItems
      .map((item) => [item.snippet?.resourceId?.videoId, item.snippet?.position ?? null] as const)
      .filter((entry): entry is [string, number | null] => Boolean(entry[0])),
  );

  const unavailableItems = playlistItems
    .filter((item) => !item.snippet?.resourceId?.videoId || item.status?.privacyStatus === "private")
    .map<NormalizedYouTubeDiscoveryItem>((item, index) => ({
      id: `youtube:playlist-unavailable:${item.id}`,
      platform: "youtube",
      itemType: "video",
      platformItemId: item.id,
      url: analysis.playlist?.url ?? `https://www.youtube.com/playlist?list=${analysis.playlistId}`,
      title: item.snippet?.title ?? "Unavailable playlist item",
      description: "This playlist item was returned without public video details by the official API.",
      thumbnailUrl: null,
      channelId: analysis.playlist?.channelId ?? null,
      channelTitle: analysis.playlist?.channelTitle ?? null,
      publishedAt: null,
      durationSeconds: null,
      viewsCount: null,
      likesCount: null,
      commentsCount: null,
      language: null,
      region: null,
      tags: [],
      categoryId: null,
      isEmbeddable: null,
      liveBroadcastContent: null,
      isShortsLike: false,
      rawJson: item,
      playlistPosition: item.snippet?.position ?? index,
    }));

  const items: NormalizedYouTubeDiscoveryItem[] = [
    analysis.playlist,
    ...videoItems.map((video) => ({
      ...video,
      playlistPosition: positionById.get(video.platformItemId) ?? null,
      knownPublicPlaylistAppearances: [
        {
          playlistId: analysis.playlist!.platformItemId,
          playlistTitle: analysis.playlist!.title,
          position: positionById.get(video.platformItemId) ?? null,
        },
      ],
    })),
    ...unavailableItems,
  ];

  const manifest = buildYouTubeManifest({
    manifestType: "youtube_playlist",
    title: `Playlist: ${analysis.playlist.title}`,
    query: input,
    source: {
      kind: "playlist",
      id: analysis.playlist.platformItemId,
      label: analysis.playlist.title,
    },
    searchSettingsSnapshot: null,
    pagesFetched,
    nextPageToken,
    quotaCostEstimate,
    items,
    warnings:
      unavailableItems.length > 0
        ? [
            {
              code: "unavailable_playlist_items",
              message: `${unavailableItems.length} playlist item(s) could not be hydrated and are shown honestly as unavailable.`,
            },
          ]
        : [],
    status: nextPageToken && videoItems.length >= options.maxItems ? "max_items_reached" : "complete",
  });

  return saveManifestInMemory(manifest);
}

async function hydrateVideos(videoIds: string[]) {
  const client = getYouTubeClient();
  const videos: VideoRecord[] = [];

  for (let index = 0; index < videoIds.length; index += 50) {
    const chunk = videoIds.slice(index, index + 50);

    if (chunk.length === 0) {
      continue;
    }

    const response = await client.videosList<ListResponse<VideoRecord>>({
      part: "snippet,contentDetails,statistics,status,liveStreamingDetails",
      id: chunk.join(","),
    });
    videos.push(...(response.items ?? []));
  }

  return videos.map(normalizeVideoDetail);
}
