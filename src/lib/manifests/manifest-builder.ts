import { randomUUID } from "node:crypto";
import type { YouTubeManifest, YouTubeManifestType, YouTubeManifestWarning } from "@/types/manifest";
import type { NormalizedYouTubeDiscoveryItem, YouTubeSearchSettings } from "@/types/youtube";
import { buildQuotaWarning } from "@/lib/platforms/youtube/youtube-quota";

interface BuildManifestInput {
  manifestType: YouTubeManifestType;
  title: string;
  query: string | null;
  source: YouTubeManifest["source"];
  searchSettingsSnapshot: Partial<YouTubeSearchSettings> | null;
  pagesFetched: number;
  nextPageToken: string | null;
  quotaCostEstimate: number;
  items: NormalizedYouTubeDiscoveryItem[];
  warnings?: YouTubeManifestWarning[];
  errors?: YouTubeManifestWarning[];
  status?: YouTubeManifest["status"];
}

export function buildYouTubeManifest(input: BuildManifestInput): YouTubeManifest {
  const manifestId = `mft_${randomUUID()}`;
  const now = new Date().toISOString();
  const seen = new Set<string>();
  const normalizedItems = input.items
    .map((item, index) => ({
      ...item,
      manifestId,
      collectedAt: item.collectedAt ?? now,
      rawJson: item.rawJson ?? null,
      id: item.id || `youtube:${item.platformItemId || index}`,
    }))
    .filter((item) => {
      const key = `${item.itemType}:${item.platformItemId}`;
      const duplicate = seen.has(key);
      seen.add(key);
      return !duplicate;
    });

  const quotaWarning = buildQuotaWarning(input.quotaCostEstimate);
  const warnings = [...(input.warnings ?? []), ...(quotaWarning ? [quotaWarning] : [])];

  return {
    manifestId,
    manifestType: input.manifestType,
    platform: "youtube",
    title: input.title,
    query: input.query,
    resourceTypes: resolveManifestResourceTypes(input),
    source: input.source,
    searchSettingsSnapshot: input.searchSettingsSnapshot,
    createdAt: now,
    fetchedAt: now,
    pageSize: input.searchSettingsSnapshot?.pageSize ?? null,
    pagesFetched: input.pagesFetched,
    nextPageToken: input.nextPageToken,
    quotaCostEstimate: input.quotaCostEstimate,
    region: input.searchSettingsSnapshot?.regionCode ?? null,
    language: input.searchSettingsSnapshot?.relevanceLanguage ?? null,
    status: input.status ?? "complete",
    itemCount: input.items.length,
    totalItemsCollected: input.items.length,
    uniqueItemCount: normalizedItems.length,
    duplicateCount: Math.max(input.items.length - normalizedItems.length, 0),
    duplicatesCount: Math.max(input.items.length - normalizedItems.length, 0),
    collectedAt: now,
    warnings,
    errors: input.errors ?? [],
    normalizedItems,
    items: normalizedItems,
  };
}

function resolveManifestResourceTypes(input: BuildManifestInput): YouTubeManifest["resourceTypes"] {
  const types = input.searchSettingsSnapshot?.types;

  if (types?.length === 3 && types.includes("video") && types.includes("channel") && types.includes("playlist")) {
    return ["ALL"];
  }

  if (types?.length) {
    return types;
  }

  if (input.manifestType === "youtube_channel_uploads" || input.manifestType === "youtube_playlist") {
    return ["video"];
  }

  return [];
}
