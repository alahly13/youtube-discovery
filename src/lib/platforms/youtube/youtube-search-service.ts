import "server-only";

import type { YouTubeManifest, YouTubeManifestWarning } from "@/types/manifest";
import type { NormalizedYouTubeDiscoveryItem, YouTubeSearchSettings } from "@/types/youtube";
import { buildYouTubeManifest } from "@/lib/manifests/manifest-builder";
import { saveManifestInMemory } from "@/lib/manifests/manifest-memory-store";
import { estimateQuotaCost } from "./youtube-quota";
import { getYouTubeClient } from "./youtube-client";
import { normalizeChannelDetail, normalizePlaylistDetail, normalizeSearchFallback, normalizeVideoDetail } from "./youtube-normalize";
import { analyzeYouTubeUrl } from "./youtube-url-analyzer";

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

/**
 * Normalizes query string by stripping quotes, invisible unicode characters,
 * zero-width spaces, and collapsing extra whitespace.
 */
export function cleanQueryString(raw: string): string {
  return raw
    .replace(/["'״”‟“„»«]/g, " ")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Generates relaxed subqueries from long or complex queries.
 * YouTube Data API v3 enforces strict AND-matching across query tokens and
 * blocks or suppresses queries containing certain colloquial or flagged terms.
 * Slicing into distinctive phrase windows allows discovering the exact video.
 */
export function generateRelaxedSubqueries(raw: string): string[] {
  const clean = cleanQueryString(raw);
  const words = clean.split(/\s+/).filter(Boolean);
  const candidates: string[] = [];

  if (clean !== raw && clean.length >= 3) {
    candidates.push(clean);
  }

  if (words.length >= 4) {
    const mid = Math.floor(words.length / 2);
    // 1. Second half of words (contains distinct event / title suffix)
    candidates.push(words.slice(mid).join(" "));

    // 2. Last 4-5 words (often distinctive subtitle/phrase)
    if (words.length > 5) {
      candidates.push(words.slice(words.length - 5).join(" "));
      candidates.push(words.slice(words.length - 4).join(" "));
    }

    // 3. First half of words
    candidates.push(words.slice(0, mid).join(" "));

    // 4. Middle window
    if (words.length >= 6) {
      const start = Math.max(1, Math.floor(words.length / 4));
      candidates.push(words.slice(start, start + 4).join(" "));
    }
  }

  return Array.from(new Set(candidates.map((c) => c.trim()).filter((c) => c.length >= 3)));
}

/**
 * Scores similarity between an item's title and the user's original query.
 * Exact substring match receives 100%, followed by token overlap percentage.
 */
export function scoreRelevance(itemTitle: string | undefined | null, originalQuery: string): number {
  const cleanOrig = cleanQueryString(originalQuery).toLowerCase();
  const cleanTitle = cleanQueryString(itemTitle || "").toLowerCase();

  if (!cleanOrig || !cleanTitle) return 0;

  if (cleanTitle.includes(cleanOrig) || cleanOrig.includes(cleanTitle)) {
    return 100;
  }

  const origTokens = new Set(cleanOrig.split(/\s+/).filter((w) => w.length > 2));
  if (origTokens.size === 0) return 0;

  const titleTokens = cleanTitle.split(/\s+/).filter((w) => w.length > 2);
  let matches = 0;
  for (const t of titleTokens) {
    if (origTokens.has(t)) matches++;
  }

  return (matches / origTokens.size) * 100;
}

export async function runYouTubeSearch(settings: YouTubeSearchSettings): Promise<YouTubeManifest> {
  const client = getYouTubeClient();

  /* ── 1. Check for direct Video ID or YouTube URL ───────────────────────
     If the query is a YouTube link or raw 11-char ID, fetch directly via
     videosList for 100% precision with zero search token restrictions.
     ────────────────────────────────────────────────────────────────────── */
  const analyzed = analyzeYouTubeUrl(settings.query);
  if (analyzed.kind === "video" || analyzed.kind === "shorts") {
    const response = await client.videosList<ListResponse<Parameters<typeof normalizeVideoDetail>[0]>>({
      part: "snippet,contentDetails,statistics,status,liveStreamingDetails",
      id: analyzed.videoId,
    });

    if (response.items && response.items.length > 0) {
      const items = response.items.map((item) => normalizeVideoDetail(item));
      const manifest = buildYouTubeManifest({
        manifestType: "youtube_search",
        title: items[0]?.title ?? `Video: ${analyzed.videoId}`,
        query: settings.query,
        source: {
          kind: "search",
          id: analyzed.videoId,
          label: items[0]?.title ?? analyzed.videoId,
        },
        searchSettingsSnapshot: settings,
        pagesFetched: 1,
        nextPageToken: null,
        quotaCostEstimate: estimateQuotaCost("videosList", 1),
        items,
        status: "complete",
      });
      return saveManifestInMemory(manifest);
    }
  }

  /* ── 2. Standard Search Execution with Clean Query ───────────────────── */
  const cleanQuery = cleanQueryString(settings.query) || settings.query;
  const rawSearchItems: NonNullable<SearchListResponse["items"]> = [];
  const warnings: YouTubeManifestWarning[] = [];
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
      q: cleanQuery,
      type: settings.types.join(","),
      maxResults: Math.min(settings.pageSize, settings.maxItems - rawSearchItems.length),
      order: settings.order,
      pageToken,
      publishedAfter: settings.publishedAfter,
      publishedBefore: settings.publishedBefore,
      regionCode: settings.regionCode || undefined,
      relevanceLanguage: settings.relevanceLanguage || undefined,
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

  /* ── 3. Adaptive Query Relaxation & Fallback ───────────────────────────
     If the query returned 0 items (common for long titles, titles containing
     censored/flagged slang words, or strict regional indexing), we test
     candidate subqueries and unrestricted fallbacks to locate the video.
     ────────────────────────────────────────────────────────────────────── */
  if (rawSearchItems.length === 0) {
    const candidates = generateRelaxedSubqueries(settings.query);

    // Tier A: Try candidate phrase windows with current settings
    for (const candidate of candidates) {
      const response = await client.searchList<SearchListResponse>({
        part: "snippet",
        q: candidate,
        type: settings.types.join(","),
        maxResults: Math.min(settings.pageSize, 25),
        order: settings.order,
        regionCode: settings.regionCode || undefined,
        relevanceLanguage: settings.relevanceLanguage || undefined,
        safeSearch: settings.safeSearch,
      });

      quotaCostEstimate += estimateQuotaCost("searchList");
      pagesFetched += 1;

      if (response.items && response.items.length > 0) {
        rawSearchItems.push(...response.items);
        warnings.push({
          code: "relaxed_query_used",
          message: `Primary query yielded 0 results due to YouTube API token filtering. Adaptive search used relaxed query "${candidate}" to discover matching videos.`,
        });
        break;
      }
    }

    // Tier B: Worldwide unrestricted fallback if still 0 items
    if (rawSearchItems.length === 0) {
      const allCandidates = [cleanQuery, ...candidates].filter((c): c is string => Boolean(c && c.length >= 3));
      for (const candidate of allCandidates) {
        const response = await client.searchList<SearchListResponse>({
          part: "snippet",
          q: candidate,
          type: settings.types.join(","),
          maxResults: Math.min(settings.pageSize, 25),
          order: settings.order,
          safeSearch: "none",
        });

        quotaCostEstimate += estimateQuotaCost("searchList");
        pagesFetched += 1;

        if (response.items && response.items.length > 0) {
          rawSearchItems.push(...response.items);
          warnings.push({
            code: "worldwide_fallback_used",
            message: `Unrestricted worldwide search discovered matching videos using query phrase "${candidate}".`,
          });
          break;
        }
      }
    }
  }

  /* ── 4. Hydrate item details ─────────────────────────────────────────── */
  let items = await hydrateSearchItems(rawSearchItems, (cost) => {
    quotaCostEstimate += cost;
  });

  /* ── 5. Re-rank items so best match to original query appears first ─── */
  if (items.length > 1) {
    items = [...items].sort((a, b) => {
      const scoreA = scoreRelevance(a.title, settings.query);
      const scoreB = scoreRelevance(b.title, settings.query);
      return scoreB - scoreA;
    });
  }

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
    warnings,
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
