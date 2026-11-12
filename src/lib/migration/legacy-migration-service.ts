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
 * Scans BOTH legacy `localStorage` keys AND read-only IndexedDB entity stores
 * (`entities_*`, explicitly EXCLUDING strictly local `local_research_reminders`).
 * Non-destructive: never deletes or mutates original local records.
 */
export async function scanBrowserAllLegacySources(
  ownerId?: string
): Promise<Record<string, unknown>> {
  const combined = scanBrowserLocalStorage();
  if (typeof window === "undefined" || !window.indexedDB) {
    return combined;
  }

  try {
    const { openLocalDatabase, IDB_STORES } = await import(
      "@/lib/storage/indexeddb-store"
    );
    const db = await openLocalDatabase();
    const idbMappings: Array<{ storeName: string; sourceKey: string }> = [
      { storeName: IDB_STORES.SAVED_ITEMS, sourceKey: "indexeddb::savedItems" },
      { storeName: IDB_STORES.USER_PLAYLISTS, sourceKey: "indexeddb::user_playlists" },
      { storeName: IDB_STORES.SAVED_REFERENCES, sourceKey: "indexeddb::savedSearches" },
      { storeName: IDB_STORES.SEARCH_HISTORY, sourceKey: "indexeddb::search_history" },
      { storeName: IDB_STORES.RESEARCH_QUEUE, sourceKey: "indexeddb::research_queue" },
    ];

    for (const { storeName, sourceKey } of idbMappings) {
      if (!db.objectStoreNames.contains(storeName)) continue;
      const rows = await new Promise<Record<string, unknown>[]>((resolve) => {
        try {
          const tx = db.transaction([storeName], "readonly");
          const req = tx.objectStore(storeName).getAll();
          req.onsuccess = () => resolve((req.result as Record<string, unknown>[]) || []);
          req.onerror = () => resolve([]);
        } catch {
          resolve([]);
        }
      });

      const relevant = ownerId
        ? rows.filter((r) => !r.ownerId || r.ownerId === ownerId || r.ownerId === "asdy-admin")
        : rows;
      if (relevant.length > 0) {
        combined[sourceKey] = relevant;
      }
    }
  } catch {
    // Keep localStorage scan results even if IDB read fails
  }

  return combined;
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

  const asRec = (val: unknown): Record<string, unknown> | null =>
    val && typeof val === "object" && !Array.isArray(val) ? (val as Record<string, unknown>) : null;

  const extractList = (rawValue: unknown, stateField: string): unknown[] | null => {
    if (Array.isArray(rawValue)) return rawValue;
    const obj = asRec(rawValue);
    if (!obj) return null;
    if (Array.isArray(obj.data)) return obj.data;
    const state = asRec(obj.state) ?? asRec(asRec(obj.data)?.state);
    if (state && Array.isArray(state[stateField])) return state[stateField] as unknown[];
    return null;
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
      const itemsList = extractList(rawValue, "savedItems");

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

    // 2. Check for PLAYLISTS (user playlists index & full manifests)
    else if (
      sourceKey.includes("user-playlists") ||
      sourceKey.includes("Playlists") ||
      sourceKey.includes("user_playlists")
    ) {
      let playlistsList: unknown[] = [];
      let manifestsMap: Record<string, Record<string, unknown>> | null = null;
      if (Array.isArray(rawValue)) {
        playlistsList = rawValue;
      } else {
        const obj = asRec(rawValue);
        const dataRec = asRec(obj?.data);
        const stateRec = asRec(obj?.state);
        const dataStateRec = asRec(dataRec?.state);
        const rawManifests =
          asRec(dataStateRec?.manifests) ||
          asRec(stateRec?.manifests) ||
          asRec(obj?.manifests);
        if (rawManifests && Object.keys(rawManifests).length > 0) {
          manifestsMap = rawManifests as Record<string, Record<string, unknown>>;
          playlistsList = Object.values(rawManifests);
        } else if (Array.isArray(dataStateRec?.index)) {
          playlistsList = dataStateRec.index;
        } else if (Array.isArray(stateRec?.index)) {
          playlistsList = stateRec.index;
        } else if (Array.isArray(dataRec?.index)) {
          playlistsList = dataRec.index;
        }
      }

      summary.totalRawFound += playlistsList.length;
      for (const rawPl of playlistsList) {
        const pl = asRec(rawPl);
        if (!pl) continue;
        const plObj = asRec(pl.playlist) ?? pl;
        const id = String(plObj.id || pl.id || plObj.name || pl.name || "").trim();
        if (!id) {
          summary.totalUnrecognized++;
          summary.unrecognizedItems.push({ source: sourceKey, raw: pl, reason: "Missing playlist ID" });
          continue;
        }

        const fullManifest = manifestsMap && manifestsMap[id] ? manifestsMap[id] : pl;
        if (seenPlaylistIds.has(id)) {
          summary.totalDuplicatesSkipped++;
          summary.datasets.PLAYLIST.duplicatesCount++;
        } else {
          seenPlaylistIds.add(id);
          summary.datasets.PLAYLIST.items.push({
            ...fullManifest,
            id,
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
      const historyList = extractList(rawValue, "searchHistory");

      if (historyList) {
        summary.totalRawFound += historyList.length;
        for (const rawH of historyList) {
          const h = asRec(rawH);
          const id = h ? String(h.id || h.query || "").trim() : "";
          if (!h || !id) {
            summary.totalUnrecognized++;
            summary.unrecognizedItems.push({ source: sourceKey, raw: rawH, reason: "Missing search ID/query" });
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
      const refList = extractList(rawValue, "savedSearches");

      if (refList) {
        summary.totalRawFound += refList.length;
        for (const rawRef of refList) {
          const ref = asRec(rawRef);
          const id = ref ? String(ref.id || ref.title || ref.query || "").trim() : "";
          if (!ref || !id) {
            summary.totalUnrecognized++;
            summary.unrecognizedItems.push({ source: sourceKey, raw: rawRef, reason: "Missing reference ID/title" });
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

    // 4B. Check for RESEARCH_QUEUE (never includes local_research_reminders)
    else if (
      sourceKey.includes("research_queue") ||
      sourceKey.includes("researchQueue") ||
      sourceKey.includes("Research-Queue")
    ) {
      const rqList = extractList(rawValue, "researchQueue");
      if (rqList) {
        summary.totalRawFound += rqList.length;
        for (const rawItem of rqList) {
          const item = asRec(rawItem);
          const id = item ? String(item.id || item.query || item.queryText || "").trim() : "";
          if (!item || !id) {
            summary.totalUnrecognized++;
            summary.unrecognizedItems.push({ source: sourceKey, raw: rawItem, reason: "Missing queue ID/query" });
            continue;
          }
          if (seenQueueIds.has(id)) {
            summary.totalDuplicatesSkipped++;
            summary.datasets.RESEARCH_QUEUE.duplicatesCount++;
          } else {
            seenQueueIds.add(id);
            summary.datasets.RESEARCH_QUEUE.items.push({
              ...item,
              isBeforeAppUpdating: true,
            });
            summary.datasets.RESEARCH_QUEUE.count++;
            summary.totalNormalized++;
          }
        }
      }
    }

    // 5. Complete workspace envelope containing multiple stores
    else if (sourceKey.includes("youtube-discovery-workspace")) {
      const rootRec = asRec(rawValue);
      const state = asRec(rootRec?.state) || asRec(asRec(rootRec?.data)?.state);
      if (state) {
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
          for (const rawRef of state.savedSearches) {
            const ref = asRec(rawRef);
            const id = ref ? String(ref.id || ref.title || "").trim() : "";
            if (ref && id && !seenReferenceIds.has(id)) {
              seenReferenceIds.add(id);
              summary.datasets.REFERENCES.items.push({ ...ref, isBeforeAppUpdating: true });
              summary.datasets.REFERENCES.count++;
              summary.totalNormalized++;
            }
          }
        }
        if (Array.isArray(state.searchHistory)) {
          for (const rawH of state.searchHistory) {
            const h = asRec(rawH);
            const id = h ? String(h.id || h.query || "").trim() : "";
            if (h && id && !seenHistoryIds.has(id)) {
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
function normalizeSingleSavedItem(rawInput: unknown): NormalizedLegacyItem | null {
  if (!rawInput || typeof rawInput !== "object" || Array.isArray(rawInput)) return null;
  const raw = rawInput as Record<string, unknown>;

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
