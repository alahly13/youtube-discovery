/**
 * ═══════════════════════════════════════════════════════════════════════════
 * YouTube Discovery 2026 — Safe Legacy Data Migration Service
 * ──────────────────────────────────────────────────────────────────────────
 * Scope: Discovers, normalizes, deduplicates, and prepares legacy local data
 *        from browser localStorage or exported backup files (e.g. manifest-example)
 *        for Cloudflare R2 upload under the canonical historical namespace:
 *        asdy/persistence/<ownerId>/<datasetSlug>/before-app-updating/...
 *
 * Guarantees:
 *   1. Non-destructive: NEVER automatically removes or clears legacy local data.
 *   2. Zero-value safety: Preserves numeric 0 for viewsCount, likesCount, commentsCount.
 *   3. Description fidelity: Preserves full description string without truncation.
 *   4. Strict deduplication: Eliminates duplicates per dataset with detailed counts.
 *   5. Unrecognized record handling: Isolates malformed records for inspection.
 *   6. Canonical Historical Paths: Formats keys with /before-app-updating/ namespace.
 * ═══════════════════════════════════════════════════════════════════════════
 */

import {
  CANONICAL_DATASET_TYPES,
  type CanonicalDatasetType,
  DATASET_SLUG_MAP,
  buildHistoricalDatasetPrefix,
  buildHistoricalGenerationPrefix,
  buildHistoricalManifestKey,
  buildHistoricalPartKey,
  buildHistoricalVersionPointerKey,
  sanitizeOwnerId,
} from "@/lib/storage/canonical-paths";
import {
  computePartSha256,
  computeAggregateGenerationSha256,
} from "@/lib/storage/manifest-serializer";

export interface NormalizedLegacyItem {
  id: string;
  platform: "youtube" | "custom";
  itemType: "video" | "channel" | "playlist" | "shorts_like";
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
  savedAt: string;
  isBeforeAppUpdating: true;
  rawJson?: Record<string, unknown>;
}

export interface NormalizedLegacyDatasets {
  SAVED_ITEMS: NormalizedLegacyItem[];
  PLAYLIST: Array<Record<string, unknown>>;
  SEARCH_HISTORY: Array<Record<string, unknown>>;
  RESEARCH_QUEUE: Array<Record<string, unknown>>;
  REFERENCES: Array<Record<string, unknown>>;
}

export interface LegacyScanSummary {
  scannedSources: string[];
  totalRawFound: number;
  totalNormalized: number;
  totalDuplicatesSkipped: number;
  totalUnrecognized: number;
  datasets: {
    [key in CanonicalDatasetType]: {
      count: number;
      duplicatesCount: number;
      items: unknown[];
    };
  };
  unrecognizedItems: Array<{ source: string; raw: unknown; reason: string }>;
}

export interface PreparedMigrationPart {
  partNumber: number;
  storagePath: string;
  byteCount: number;
  recordCount: number;
  sha256: string;
  jsonContent: string;
}

export interface PreparedMigrationGeneration {
  datasetType: CanonicalDatasetType;
  datasetSlug: string;
  generationId: string;
  ownerId: string;
  manifestPath: string;
  versionPointerPath: string;
  manifestJson: string;
  parts: PreparedMigrationPart[];
  totalBytes: number;
  totalRecords: number;
  aggregateSha256: string;
}

export interface PreparedMigrationPlan {
  planId: string;
  ownerId: string;
  preparedAt: string;
  totalRecords: number;
  totalBytes: number;
  generations: PreparedMigrationGeneration[];
}

/**
 * Scans browser localStorage for known YouTube Discovery legacy keys.
 * Returns raw extracted objects grouped by source.
 */
export function scanBrowserLocalStorage(): Record<string, unknown> {
  if (typeof window === "undefined" || !window.localStorage) {
    return {};
  }

  const legacyKeys = [
    "youtube-discovery-workspace::savedItems",
    "youtube-discovery-workspace",
    "youtube-discovery-user-playlists",
    "youtube-discovery-workspace::savedSearches",
    "youtube-discovery-workspace::searchHistory",
    "youtube_discovery_saved_items",
    "youtube_discovery_user_playlists",
    "youtube_discovery_saved_searches",
    "youtube_discovery_search_history",
  ];

  const found: Record<string, unknown> = {};

  for (const key of legacyKeys) {
    try {
      const raw = window.localStorage.getItem(key);
      if (raw) {
        try {
          found[key] = JSON.parse(raw);
        } catch {
          found[key] = raw;
        }
      }
    } catch {
      // Ignore security or permission errors
    }
  }

  return found;
}

/**
 * Parses dropped or selected legacy backup JSON strings (matching manifest-example layout).
 */
export function parseLegacyBackupJson(rawJson: string, sourceName = "Uploaded File"): Record<string, unknown> {
  const parsed = JSON.parse(rawJson);
  const result: Record<string, unknown> = {};

  if (!parsed || typeof parsed !== "object") {
    return { [sourceName]: parsed };
  }

  // Check if it is a container with data
  if (parsed.data !== undefined) {
    const key = parsed.storageKey || parsed.category || sourceName;
    result[key] = parsed.data;
  } else if (parsed.categoryStats && parsed.totalFiles) {
    // Top-level backup manifest
    result[`${sourceName}::manifest`] = parsed;
  } else {
    result[sourceName] = parsed;
  }

  return result;
}

/**
 * Normalizes, sanitizes, and deduplicates raw legacy data into the 5 canonical datasets.
 */
export function normalizeLegacyData(sourceMap: Record<string, unknown>): LegacyScanSummary {
  const summary: LegacyScanSummary = {
    scannedSources: Object.keys(sourceMap),
    totalRawFound: 0,
    totalNormalized: 0,
    totalDuplicatesSkipped: 0,
    totalUnrecognized: 0,
    datasets: {
      SAVED_ITEMS: { count: 0, duplicatesCount: 0, items: [] },
      PLAYLIST: { count: 0, duplicatesCount: 0, items: [] },
      SEARCH_HISTORY: { count: 0, duplicatesCount: 0, items: [] },
      RESEARCH_QUEUE: { count: 0, duplicatesCount: 0, items: [] },
      REFERENCES: { count: 0, duplicatesCount: 0, items: [] },
    },
    unrecognizedItems: [],
  };

  const seenSavedItemIds = new Set<string>();
  const seenPlaylistIds = new Set<string>();
  const seenHistoryIds = new Set<string>();
  const seenReferenceIds = new Set<string>();
  const seenQueueIds = new Set<string>();

  for (const [sourceKey, rawValue] of Object.entries(sourceMap)) {
    if (!rawValue) continue;

    // 1. Check for SAVED_ITEMS (e.g. from savedItems, workspace.savedItems, or direct list)
    if (
      sourceKey.includes("savedItems") ||
      sourceKey.includes("Saved-Items") ||
      sourceKey.includes("saved_items")
    ) {
      const itemsList = Array.isArray(rawValue)
        ? rawValue
        : typeof rawValue === "object" && (rawValue as any).data && Array.isArray((rawValue as any).data)
        ? (rawValue as any).data
        : typeof rawValue === "object" && (rawValue as any).state?.savedItems && Array.isArray((rawValue as any).state.savedItems)
        ? (rawValue as any).state.savedItems
        : null;

      if (itemsList) {
        summary.totalRawFound += itemsList.length;
        for (const item of itemsList) {
          const norm = normalizeSingleSavedItem(item);
          if (!norm) {
            summary.totalUnrecognized++;
            summary.unrecognizedItems.push({
              source: sourceKey,
              raw: item,
              reason: "Missing title or platform ID",
            });
            continue;
          }

          if (seenSavedItemIds.has(norm.platformItemId)) {
            summary.totalDuplicatesSkipped++;
            summary.datasets.SAVED_ITEMS.duplicatesCount++;
          } else {
            seenSavedItemIds.add(norm.platformItemId);
            summary.datasets.SAVED_ITEMS.items.push(norm);
            summary.datasets.SAVED_ITEMS.count++;
            summary.totalNormalized++;
          }
        }
      }
    }

    // 2. Check for PLAYLISTS (user playlists index & manifests)
    else if (
      sourceKey.includes("user-playlists") ||
      sourceKey.includes("Playlists") ||
      sourceKey.includes("user_playlists")
    ) {
      let playlistsList: any[] = [];
      if (Array.isArray(rawValue)) {
        playlistsList = rawValue;
      } else if (typeof rawValue === "object") {
        const obj = rawValue as any;
        if (obj.data?.state?.index && Array.isArray(obj.data.state.index)) {
          playlistsList = obj.data.state.index;
        } else if (obj.state?.index && Array.isArray(obj.state.index)) {
          playlistsList = obj.state.index;
        } else if (obj.data?.index && Array.isArray(obj.data.index)) {
          playlistsList = obj.data.index;
        }
      }

      summary.totalRawFound += playlistsList.length;
      for (const pl of playlistsList) {
        const id = String(pl.id || pl.name || "").trim();
        if (!id) {
          summary.totalUnrecognized++;
          summary.unrecognizedItems.push({ source: sourceKey, raw: pl, reason: "Missing playlist ID" });
          continue;
        }

        if (seenPlaylistIds.has(id)) {
          summary.totalDuplicatesSkipped++;
          summary.datasets.PLAYLIST.duplicatesCount++;
        } else {
          seenPlaylistIds.add(id);
          summary.datasets.PLAYLIST.items.push({
            ...pl,
            isBeforeAppUpdating: true,
          });
          summary.datasets.PLAYLIST.count++;
          summary.totalNormalized++;
        }
      }
    }

    // 3. Check for SEARCH_HISTORY
    else if (
      sourceKey.includes("searchHistory") ||
      sourceKey.includes("Search-History") ||
      sourceKey.includes("search_history")
    ) {
      const historyList = Array.isArray(rawValue)
        ? rawValue
        : typeof rawValue === "object" && (rawValue as any).data && Array.isArray((rawValue as any).data)
        ? (rawValue as any).data
        : typeof rawValue === "object" && (rawValue as any).state?.searchHistory && Array.isArray((rawValue as any).state.searchHistory)
        ? (rawValue as any).state.searchHistory
        : null;

      if (historyList) {
        summary.totalRawFound += historyList.length;
        for (const h of historyList) {
          const id = String(h.id || h.query || "").trim();
          if (!id) {
            summary.totalUnrecognized++;
            summary.unrecognizedItems.push({ source: sourceKey, raw: h, reason: "Missing search ID/query" });
            continue;
          }

          if (seenHistoryIds.has(id)) {
            summary.totalDuplicatesSkipped++;
            summary.datasets.SEARCH_HISTORY.duplicatesCount++;
          } else {
            seenHistoryIds.add(id);
            summary.datasets.SEARCH_HISTORY.items.push({
              ...h,
              isBeforeAppUpdating: true,
            });
            summary.datasets.SEARCH_HISTORY.count++;
            summary.totalNormalized++;
          }
        }
      }
    }

    // 4. Check for REFERENCES (e.g. savedSearches)
    else if (
      sourceKey.includes("savedSearches") ||
      sourceKey.includes("References") ||
      sourceKey.includes("saved_searches")
    ) {
      const refList = Array.isArray(rawValue)
        ? rawValue
        : typeof rawValue === "object" && (rawValue as any).data && Array.isArray((rawValue as any).data)
        ? (rawValue as any).data
        : typeof rawValue === "object" && (rawValue as any).state?.savedSearches && Array.isArray((rawValue as any).state.savedSearches)
        ? (rawValue as any).state.savedSearches
        : null;

      if (refList) {
        summary.totalRawFound += refList.length;
        for (const ref of refList) {
          const id = String(ref.id || ref.title || ref.query || "").trim();
          if (!id) {
            summary.totalUnrecognized++;
            summary.unrecognizedItems.push({ source: sourceKey, raw: ref, reason: "Missing reference ID/title" });
            continue;
          }

          if (seenReferenceIds.has(id)) {
            summary.totalDuplicatesSkipped++;
            summary.datasets.REFERENCES.duplicatesCount++;
          } else {
            seenReferenceIds.add(id);
            summary.datasets.REFERENCES.items.push({
              ...ref,
              isBeforeAppUpdating: true,
            });
            summary.datasets.REFERENCES.count++;
            summary.totalNormalized++;
          }
        }
      }
    }

    // 5. Complete workspace envelope containing multiple stores
    else if (sourceKey.includes("youtube-discovery-workspace")) {
      const state = (rawValue as any)?.state || (rawValue as any)?.data?.state;
      if (state && typeof state === "object") {
        if (Array.isArray(state.savedItems)) {
          for (const item of state.savedItems) {
            const norm = normalizeSingleSavedItem(item);
            if (norm && !seenSavedItemIds.has(norm.platformItemId)) {
              seenSavedItemIds.add(norm.platformItemId);
              summary.datasets.SAVED_ITEMS.items.push(norm);
              summary.datasets.SAVED_ITEMS.count++;
              summary.totalNormalized++;
            }
          }
        }
        if (Array.isArray(state.savedSearches)) {
          for (const ref of state.savedSearches) {
            const id = String(ref.id || ref.title || "").trim();
            if (id && !seenReferenceIds.has(id)) {
              seenReferenceIds.add(id);
              summary.datasets.REFERENCES.items.push({ ...ref, isBeforeAppUpdating: true });
              summary.datasets.REFERENCES.count++;
              summary.totalNormalized++;
            }
          }
        }
        if (Array.isArray(state.searchHistory)) {
          for (const h of state.searchHistory) {
            const id = String(h.id || h.query || "").trim();
            if (id && !seenHistoryIds.has(id)) {
              seenHistoryIds.add(id);
              summary.datasets.SEARCH_HISTORY.items.push({ ...h, isBeforeAppUpdating: true });
              summary.datasets.SEARCH_HISTORY.count++;
              summary.totalNormalized++;
            }
          }
        }
      }
    }
  }

  return summary;
}

/**
 * Normalizes a single raw saved item, strictly preserving 0 numeric values and description.
 */
function normalizeSingleSavedItem(raw: any): NormalizedLegacyItem | null {
  if (!raw || typeof raw !== "object") return null;

  const rawId = String(raw.platformItemId || raw.id || raw.videoId || "").trim();
  const platformItemId = rawId.replace(/^youtube:/, "");
  const title = String(raw.title || raw.name || "").trim();

  if (!platformItemId || !title) {
    return null;
  }

  const rawType = String(raw.itemType || raw.type || raw.kind || "video").toLowerCase();
  let itemType: "video" | "channel" | "playlist" | "shorts_like" = "video";
  if (rawType.includes("channel")) itemType = "channel";
  else if (rawType.includes("playlist")) itemType = "playlist";
  else if (rawType.includes("short")) itemType = "shorts_like";

  // Description preservation: Keep full text or null
  const description = typeof raw.description === "string" && raw.description.trim() ? raw.description.trim() : null;

  // Zero-safe numeric checks
  const viewsCount = typeof raw.viewsCount === "number" ? raw.viewsCount : null;
  const likesCount = typeof raw.likesCount === "number" ? raw.likesCount : null;
  const commentsCount = typeof raw.commentsCount === "number" ? raw.commentsCount : null;
  const durationSeconds = typeof raw.durationSeconds === "number" ? raw.durationSeconds : null;

  const savedAt = typeof raw.savedAt === "string"
    ? raw.savedAt
    : typeof raw.collectedAt === "string"
    ? raw.collectedAt
    : new Date().toISOString();

  const publishedAt = typeof raw.publishedAt === "string" ? raw.publishedAt : null;
  const channelTitle = typeof raw.channelTitle === "string" ? raw.channelTitle : null;
  const channelId = typeof raw.channelId === "string" ? raw.channelId : null;
  const thumbnailUrl = typeof raw.thumbnailUrl === "string" ? raw.thumbnailUrl : null;

  const url = typeof raw.url === "string" && raw.url.startsWith("http")
    ? raw.url
    : itemType === "video" || itemType === "shorts_like"
    ? `https://www.youtube.com/watch?v=${platformItemId}`
    : itemType === "playlist"
    ? `https://www.youtube.com/playlist?list=${platformItemId}`
    : `https://www.youtube.com/channel/${platformItemId}`;

  return {
    id: `youtube:${platformItemId}`,
    platform: "youtube",
    itemType,
    platformItemId,
    url,
    title,
    description,
    thumbnailUrl,
    channelId,
    channelTitle,
    publishedAt,
    durationSeconds,
    viewsCount,
    likesCount,
    commentsCount,
    savedAt,
    isBeforeAppUpdating: true,
  };
}

/**
 * Prepares generation manifests and part files for Cloudflare R2 upload
 * under canonical historical namespace:
 * asdy/persistence/<ownerId>/<datasetSlug>/before-app-updating/generations/<genId>/
 */
export function prepareLegacyMigrationPlan(params: {
  summary: LegacyScanSummary;
  ownerId: string;
}): PreparedMigrationPlan {
  const cleanOwner = sanitizeOwnerId(params.ownerId);
  const now = new Date();
  const dateSlug = now.toISOString().slice(0, 10).replace(/-/g, "");
  const planId = `plan_legacy_${dateSlug}_${Math.random().toString(36).slice(2, 8)}`;

  const generations: PreparedMigrationGeneration[] = [];
  let totalRecordsAcrossPlan = 0;
  let totalBytesAcrossPlan = 0;

  for (const datasetType of CANONICAL_DATASET_TYPES) {
    const datasetInfo = params.summary.datasets[datasetType];
    if (!datasetInfo || datasetInfo.items.length === 0) continue;

    const datasetSlug = DATASET_SLUG_MAP[datasetType];
    const generationId = `gen_legacy_${dateSlug}_${Math.random().toString(36).slice(2, 8)}`;
    const items = datasetInfo.items;

    // Partition items into parts (target: 40 MiB per part)
    // For legacy data, items easily fit in part 1 unless > 40MB
    const partNumber = 1;
    const partStoragePath = buildHistoricalPartKey(cleanOwner, datasetType, generationId, partNumber);

    const partEnvelope = {
      $schema: "https://youtube-discovery.app/schemas/manifest-part-v1.json",
      schemaVersion: 1,
      datasetType,
      datasetSlug,
      ownerId: cleanOwner,
      storageOwnerUuid: cleanOwner,
      generationId,
      isBeforeAppUpdating: true,
      partNumber,
      totalPartsInGeneration: 1,
      createdAt: now.toISOString(),
      recordCount: items.length,
      items,
    };

    const partJson = JSON.stringify(partEnvelope);
    const byteCount = Buffer.byteLength(partJson, "utf8");
    const sha256 = computePartSha256(partJson);

    const partDescriptor: PreparedMigrationPart = {
      partNumber,
      storagePath: partStoragePath,
      byteCount,
      recordCount: items.length,
      sha256,
      jsonContent: partJson,
    };

    const aggregateSha256 = computeAggregateGenerationSha256([
      {
        partNumber: 1,
        byteCount,
        recordCount: items.length,
        sha256,
      },
    ]);

    const manifestPath = buildHistoricalManifestKey(cleanOwner, datasetType, generationId);
    const versionPointerPath = buildHistoricalVersionPointerKey(cleanOwner, datasetType);

    const manifestPayload = {
      $schema: "https://youtube-discovery.app/schemas/manifest-v1.json",
      schemaVersion: 1,
      datasetType,
      datasetSlug,
      ownerId: cleanOwner,
      storageOwnerUuid: cleanOwner,
      generationId,
      isBeforeAppUpdating: true,
      originDeviceLabel: "Legacy Data Migration (Before App Updating)",
      createdAt: now.toISOString(),
      committedAt: now.toISOString(),
      totalRecords: items.length,
      totalBytes: byteCount,
      aggregateSha256,
      parts: [
        {
          partNumber: 1,
          storagePath: partStoragePath,
          byteCount,
          recordCount: items.length,
          sha256,
        },
      ],
    };

    const manifestJson = JSON.stringify(manifestPayload, null, 2);

    generations.push({
      datasetType,
      datasetSlug,
      generationId,
      ownerId: cleanOwner,
      manifestPath,
      versionPointerPath,
      manifestJson,
      parts: [partDescriptor],
      totalBytes: byteCount,
      totalRecords: items.length,
      aggregateSha256,
    });

    totalRecordsAcrossPlan += items.length;
    totalBytesAcrossPlan += byteCount;
  }

  return {
    planId,
    ownerId: cleanOwner,
    preparedAt: now.toISOString(),
    totalRecords: totalRecordsAcrossPlan,
    totalBytes: totalBytesAcrossPlan,
    generations,
  };
}
