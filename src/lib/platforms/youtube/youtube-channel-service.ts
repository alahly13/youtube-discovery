import "server-only";

import type { YouTubeManifest } from "@/types/manifest";
import type { NormalizedYouTubeDiscoveryItem } from "@/types/youtube";
import { buildYouTubeManifest } from "@/lib/manifests/manifest-builder";
import { saveManifestInMemory } from "@/lib/manifests/manifest-memory-store";
import { estimateQuotaCost } from "./youtube-quota";
import { getYouTubeClient } from "./youtube-client";
import { analyzeYouTubeUrl } from "./youtube-url-analyzer";
import { normalizeChannelDetail, normalizeVideoDetail } from "./youtube-normalize";

interface ListResponse<T> {
  nextPageToken?: string;
  items?: T[];
}

type ChannelRecord = Parameters<typeof normalizeChannelDetail>[0] & {
  contentDetails?: {
    relatedPlaylists?: {
      uploads?: string;
    };
  };
};

type VideoRecord = Parameters<typeof normalizeVideoDetail>[0];

interface PlaylistItemRecord {
  id: string;
  snippet?: {
    position?: number;
    resourceId?: {
      videoId?: string;
    };
  };
}

export async function analyzeChannel(input: string) {
  const client = getYouTubeClient();
  const analyzed = analyzeYouTubeUrl(input);
  let response: ListResponse<ChannelRecord>;

  if (analyzed.kind === "channel") {
    response = await client.channelsList<ListResponse<ChannelRecord>>({
      part: "snippet,contentDetails,statistics",
      id: analyzed.channelId,
    });
  } else if (analyzed.kind === "handle") {
    response = await client.channelsList<ListResponse<ChannelRecord>>({
      part: "snippet,contentDetails,statistics",
      forHandle: analyzed.handle,
    });
  } else {
    response = await client.channelsList<ListResponse<ChannelRecord>>({
      part: "snippet,contentDetails,statistics",
      id: input,
    });
  }

  const channel = response.items?.[0] ?? null;

  return {
    analyzed,
    quotaCostEstimate: estimateQuotaCost("channelsList"),
    channel: channel ? normalizeChannelDetail(channel) : null,
    uploadsPlaylistId: channel?.contentDetails?.relatedPlaylists?.uploads ?? null,
  };
}

export async function fetchChannelUploads(input: string, options: { pageToken?: string; maxPages: number; maxItems: number }): Promise<YouTubeManifest> {
  const client = getYouTubeClient();
  const analysis = await analyzeChannel(input);

  if (!analysis.channel || !analysis.uploadsPlaylistId) {
    const failedManifest = buildYouTubeManifest({
      manifestType: "youtube_channel_uploads",
      title: `Channel uploads: ${input}`,
      query: input,
      source: {
        kind: "channel",
        id: analysis.channel?.platformItemId ?? input,
        label: analysis.channel?.title ?? input,
      },
      searchSettingsSnapshot: null,
      pagesFetched: 0,
      nextPageToken: null,
      quotaCostEstimate: analysis.quotaCostEstimate,
      items: analysis.channel ? [analysis.channel] : [],
      status: "failed",
      errors: [
        {
          code: "uploads_playlist_missing",
          message: "The channel uploads playlist was not available from the official API response.",
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
      playlistId: analysis.uploadsPlaylistId,
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

  const items: NormalizedYouTubeDiscoveryItem[] = [analysis.channel, ...videoItems.map((video) => ({ ...video, playlistPosition: positionById.get(video.platformItemId) ?? null }))];

  const manifest = buildYouTubeManifest({
    manifestType: "youtube_channel_uploads",
    title: `Channel uploads: ${analysis.channel.title}`,
    query: input,
    source: {
      kind: "channel",
      id: analysis.channel.platformItemId,
      label: analysis.channel.title,
    },
    searchSettingsSnapshot: null,
    pagesFetched,
    nextPageToken,
    quotaCostEstimate,
    items,
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
