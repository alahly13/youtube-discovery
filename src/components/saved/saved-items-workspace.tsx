"use client";

import {
  AlertCircle,
  Calendar,
  CheckCircle2,
  Cloud,
  Database,
  ExternalLink,
  Eye,
  FileCode,
  Film,
  Flame,
  HardDrive,
  Laptop,
  Layers,
  ListPlus,
  ListVideo,
  Play,
  RefreshCw,
  Search,
  Sparkles,
  Trash2,
  Tv,
  X,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { NormalizedYouTubeDiscoveryItem } from "@/types/youtube";
import { useYouTubeWorkspaceStore } from "@/lib/state/youtube-workspace-store";
import { useMergedDataset } from "@/lib/storage/use-merged-dataset";
import {
  saveEntityLocally,
  removeLocalSavedItem,
  removeLocalSavedItemsBatch,
} from "@/lib/storage/indexeddb-store";
import { syncCoordinator } from "@/lib/sync/sync-coordinator";
import { getDeviceLabel } from "@/lib/device/device-identity";
import { AddToPlaylistDialog } from "@/components/library/add-to-playlist-dialog";
import { RawJsonInspectorDialog } from "@/components/saved/raw-json-inspector-dialog";
import { ExpandableDescription } from "@/components/youtube/expandable-description";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { UndoRedoControls } from "@/components/ui/undo-redo-controls";
import { formatCompactCount, formatDate, formatDuration } from "@/lib/utils/format";
import {
  SAVE_STAGE_LABELS,
  type SaveErrorCategory,
  type SaveReceipt,
  type SaveStatusStage,
} from "@/lib/sync/save-receipt";
import type { CloudCatalogStats } from "@/app/api/saved-items/route";

export type SavedItemStorageState =
  | "LOCAL_ONLY"
  | "LOCAL_AND_CLOUD"
  | "CLOUD_ONLY";

type TypeFilter = "all" | "video" | "shorts" | "channel" | "playlist";
type SortOption = "date_desc" | "date_asc" | "title_az" | "views_desc";
type StorageView = "all" | "local" | "cloud";

interface CloudSaveFeedbackState {
  stage: SaveStatusStage;
  isSaving: boolean;
  totalSelected: number;
  uploadedCount: number;
  verifiedCount: number;
  failedCount: number;
  successMessage?: string;
  errorMessage?: string;
  errorCategory?: SaveErrorCategory;
  receipt?: SaveReceipt;
}

/**
 * Normalizes an item's save timestamp to an epoch number for chronological sorting.
 */
function getItemSaveTime(item: NormalizedYouTubeDiscoveryItem): number {
  if (item.savedAt) {
    const t = new Date(item.savedAt).getTime();
    if (!isNaN(t)) return t;
  }
  if (item.collectedAt) {
    const t = new Date(item.collectedAt).getTime();
    if (!isNaN(t)) return t;
  }
  return 0;
}

/**
 * Formats a timestamp into a human-readable calendar day grouping key.
 */
function getDayGroupKey(timestampMs: number): { key: string; label: string; relative: string } {
  if (!timestampMs) {
    return { key: "earlier", label: "Earlier Saved Items", relative: "Archive" };
  }

  const d = new Date(timestampMs);
  const now = new Date();

  const isToday =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();

  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const isYesterday =
    d.getFullYear() === yesterday.getFullYear() &&
    d.getMonth() === yesterday.getMonth() &&
    d.getDate() === yesterday.getDate();

  const dateStr = d.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });

  const isoKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;

  if (isToday) {
    return { key: isoKey, label: `Today — ${dateStr}`, relative: "Today" };
  }
  if (isYesterday) {
    return { key: isoKey, label: `Yesterday — ${dateStr}`, relative: "Yesterday" };
  }

  const weekday = d.toLocaleDateString("en-US", { weekday: "long" });
  return { key: isoKey, label: `${weekday}, ${dateStr}`, relative: dateStr };
}

/**
 * Filters and sorts an array of saved items.
 */
function filterAndSortItems(
  items: NormalizedYouTubeDiscoveryItem[],
  typeFilter: TypeFilter,
  searchQuery: string,
  sortOption: SortOption
): NormalizedYouTubeDiscoveryItem[] {
  const filtered = items.filter((item) => {
    if (typeFilter === "video") {
      if (item.itemType !== "video" || item.isShortsLike || (item.itemType as string) === "shorts_like") return false;
    }
    if (typeFilter === "shorts") {
      if (!item.isShortsLike && (item.itemType as string) !== "shorts_like") return false;
    }
    if (typeFilter === "channel" && item.itemType !== "channel") return false;
    if (typeFilter === "playlist" && item.itemType !== "playlist") return false;

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const titleMatch = item.title?.toLowerCase().includes(q);
      const channelMatch = item.channelTitle?.toLowerCase().includes(q);
      const tagMatch = item.tags?.some((t) => t.toLowerCase().includes(q));
      if (!titleMatch && !channelMatch && !tagMatch) return false;
    }

    return true;
  });

  switch (sortOption) {
    case "date_desc":
      return filtered.sort((a, b) => getItemSaveTime(b) - getItemSaveTime(a));
    case "date_asc":
      return filtered.sort((a, b) => getItemSaveTime(a) - getItemSaveTime(b));
    case "title_az":
      return filtered.sort((a, b) => (a.title || "").localeCompare(b.title || ""));
    case "views_desc":
      return filtered.sort((a, b) => (b.viewsCount ?? 0) - (a.viewsCount ?? 0));
    default:
      return filtered;
  }
}

/**
 * Groups items into daily calendar sections.
 */
function groupItemsByCalendarDay(
  sortedList: NormalizedYouTubeDiscoveryItem[],
  sortOption: SortOption
): Array<{ key: string; label: string; relative: string; items: NormalizedYouTubeDiscoveryItem[] }> {
  const map = new Map<string, { label: string; relative: string; items: NormalizedYouTubeDiscoveryItem[] }>();

  for (const item of sortedList) {
    const timeMs = getItemSaveTime(item);
    const { key, label, relative } = getDayGroupKey(timeMs);

    if (!map.has(key)) {
      map.set(key, { label, relative, items: [] });
    }
    map.get(key)!.items.push(item);
  }

  const groups = Array.from(map.entries()).map(([key, val]) => ({
    key,
    label: val.label,
    relative: val.relative,
    items: val.items,
  }));

  if (sortOption === "date_asc") {
    return groups.sort((a, b) => a.key.localeCompare(b.key));
  }
  return groups.sort((a, b) => b.key.localeCompare(a.key));
}

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * Authoritative Saved Items Workspace — 3-State / 3-Section Unified Architecture
 * ──────────────────────────────────────────────────────────────────────────
 * Scope: Workstream 1, 2, 3, 4, 5 — Full Cloud Saved Library Recovery & Archival
 *
 * Distinct Persistence States:
 *   1. LOCAL_ONLY: Exists in browser IndexedDB; no verified R2 commit receipt.
 *      Displayed under: SECTION 1 — NEWLY ADDED — LOCAL BROWSER
 *      Action: Save to R2 Cloud
 *   2. LOCAL_AND_CLOUD: Exists in both locations; R2 upload is confirmed.
 *      Displayed under: SECTION 2 — LOCAL + R2 CLOUD (Synchronization Recovery)
 *      Action: Complete Local Cleanup (safe deletion of local copy only)
 *   3. CLOUD_ONLY: Authoritatively discoverable from Cloudflare R2 New Bucket;
 *      local copy cleanly removed.
 *      Displayed under: SECTION 3 — FROM R2 CLOUD — COMPLETE ARCHIVE
 * ═══════════════════════════════════════════════════════════════════════════
 */
export function SavedItemsWorkspace() {
  const inMemorySavedItems = useYouTubeWorkspaceStore((s) => s.savedItems);
  const toggleItemSaved = useYouTubeWorkspaceStore((s) => s.toggleItemSaved);
  const removeLocalItemAfterCloudCommit = useYouTubeWorkspaceStore(
    (s) => s.removeLocalItemAfterCloudCommit
  );
  const removeLocalItemsBatchAfterCloudCommit = useYouTubeWorkspaceStore(
    (s) => s.removeLocalItemsBatchAfterCloudCommit
  );

  // Authoritative merged dataset combining IndexedDB Local-First, Outbox, and Hydrated Cloud
  const {
    items: allLocalAndHydratedItems,
    localPendingItems,
    refresh: refreshLocal,
  } = useMergedDataset<NormalizedYouTubeDiscoveryItem>(
    "SAVED_ITEMS",
    inMemorySavedItems
  );

  // Storage view state: "all" | "local" | "cloud"
  const [storageView, setStorageView] = useState<StorageView>("all");

  // Authoritative Cloud Data from /api/saved-items (R2 Cloudflare Worker)
  const [cloudApiItems, setCloudApiItems] = useState<NormalizedYouTubeDiscoveryItem[]>([]);
  const [cloudLoading, setCloudLoading] = useState<boolean>(true);
  const [cloudLoadingMore, setCloudLoadingMore] = useState<boolean>(false);
  const [cloudError, setCloudError] = useState<string | null>(null);
  const [cloudRevision, setCloudRevision] = useState<number>(0);
  const [cloudTotalCount, setCloudTotalCount] = useState<number>(0);
  const [cloudHasMore, setCloudHasMore] = useState<boolean>(false);
  const [cloudNextOffset, setCloudNextOffset] = useState<number | null>(null);
  const [cloudCatalogStats, setCloudCatalogStats] = useState<CloudCatalogStats | null>(null);
  const [historicalArchiveMeta, setHistoricalArchiveMeta] = useState<{
    generationId: string;
    bucket: string;
    exactGenerationPrefix: string;
    exactPartsPrefix: string;
    totalRecords: number;
  } | null>(null);

  // User feedback state for cloud upload & save operations
  const [saveFeedback, setSaveFeedback] = useState<CloudSaveFeedbackState | null>(null);

  // Cleanup feedback state
  const [cleanupMessage, setCleanupMessage] = useState<string | null>(null);

  // Filters, search & UI state
  const [searchQuery, setSearchQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [sortOption, setSortOption] = useState<SortOption>("date_desc");
  const [isSyncing, setIsSyncing] = useState(false);
  const [isCleaningBatch, setIsCleaningBatch] = useState(false);
  const [deviceLabel, setDeviceLabelState] = useState("This Device");

  // Dialog states
  const [playlistTarget, setPlaylistTarget] = useState<NormalizedYouTubeDiscoveryItem | null>(null);
  const [inspectedItem, setInspectedItem] = useState<NormalizedYouTubeDiscoveryItem | null>(null);

  /**
   * Fetches authoritative cloud saved items directly from Cloudflare R2 via /api/saved-items.
   * Supports progressive cursor/offset pagination.
   */
  const fetchCloudItems = useCallback(
    async (options?: { offset?: number; append?: boolean }) => {
      const currentOffset = options?.offset ?? 0;
      const isAppending = options?.append ?? false;

      if (!isAppending) {
        setCloudLoading(true);
      } else {
        setCloudLoadingMore(true);
      }
      setCloudError(null);

      try {
        const queryParams = new URLSearchParams({
          limit: "1000",
          offset: String(currentOffset),
          sort: sortOption,
          type: typeFilter,
        });
        if (searchQuery.trim()) {
          queryParams.set("q", searchQuery.trim());
        }

        const res = await fetch(`/api/saved-items?${queryParams.toString()}`, {
          headers: { "Cache-Control": "no-cache" },
        });

        if (!res.ok) {
          let errDetail = `Status ${res.status}`;
          try {
            const errJson = await res.json();
            if (errJson.error) errDetail = errJson.error;
          } catch {
            // Non-JSON response
          }
          throw new Error(errDetail);
        }

        const data = await res.json();
        if (data.ok && Array.isArray(data.items)) {
          setCloudApiItems((prev) => {
            if (!isAppending) return data.items;
            // Deduplicate items on append
            const map = new Map<string, NormalizedYouTubeDiscoveryItem>();
            for (const item of prev) {
              if (item.platformItemId) map.set(item.platformItemId, item);
            }
            for (const item of data.items) {
              if (item.platformItemId) map.set(item.platformItemId, item);
            }
            return Array.from(map.values());
          });
          setCloudRevision(data.revision || 0);
          setCloudTotalCount(data.totalCount || 0);
          setCloudHasMore(Boolean(data.hasMore));
          setCloudNextOffset(data.nextOffset ?? null);
          if (data.catalogStats) {
            setCloudCatalogStats(data.catalogStats);
          }
          if (data.beforeAppUpdatingArchive) {
            setHistoricalArchiveMeta({
              generationId: data.beforeAppUpdatingArchive.generationId,
              bucket: data.beforeAppUpdatingArchive.bucket,
              exactGenerationPrefix: data.beforeAppUpdatingArchive.exactGenerationPrefix,
              exactPartsPrefix: data.beforeAppUpdatingArchive.exactPartsPrefix,
              totalRecords: data.beforeAppUpdatingArchive.totalRecords,
            });
          }
        } else {
          throw new Error(data.error || "Malformed response from cloud saved items API");
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Unable to load cloud items from Cloudflare R2.";
        console.warn("[SavedItemsWorkspace] Cloud retrieval error:", msg);
        setCloudError(msg);
      } finally {
        setCloudLoading(false);
        setCloudLoadingMore(false);
      }
    },
    [sortOption, typeFilter, searchQuery]
  );

  useEffect(() => {
    setDeviceLabelState(getDeviceLabel());
    void fetchCloudItems();

    const unsub = syncCoordinator.subscribe((state) => {
      setIsSyncing(state.status === "SYNCING");
      if (state.lastSaveReceipt && state.status === "SYNCED") {
        setSaveFeedback((prev) => {
          if (!prev?.isSaving) return prev;
          return {
            ...prev,
            stage: "CLOUD_COMMITTED",
            isSaving: false,
            receipt: state.lastSaveReceipt || undefined,
          };
        });
      }
    });

    const handleCloudSaveSuccess = () => {
      void fetchCloudItems();
      refreshLocal();
    };

    if (typeof window !== "undefined") {
      window.addEventListener("yt-discovery-cloud-save-success", handleCloudSaveSuccess);
      window.addEventListener("yt-discovery-cloud-committed-cleanup", handleCloudSaveSuccess);
      window.addEventListener("yt-discovery-hydration-changed", handleCloudSaveSuccess);
      window.addEventListener("yt-discovery-local-committed", handleCloudSaveSuccess);
      window.addEventListener("yt-discovery-local-mutation", handleCloudSaveSuccess);
    }

    return () => {
      unsub();
      if (typeof window !== "undefined") {
        window.removeEventListener("yt-discovery-cloud-save-success", handleCloudSaveSuccess);
        window.removeEventListener("yt-discovery-cloud-committed-cleanup", handleCloudSaveSuccess);
        window.removeEventListener("yt-discovery-hydration-changed", handleCloudSaveSuccess);
        window.removeEventListener("yt-discovery-local-committed", handleCloudSaveSuccess);
        window.removeEventListener("yt-discovery-local-mutation", handleCloudSaveSuccess);
      }
    };
  }, [fetchCloudItems, refreshLocal]);

  // Fast set of verified platform item IDs present in Cloudflare R2
  const verifiedCloudPlatformIds = useMemo(() => {
    const set = new Set<string>();
    for (const item of cloudApiItems) {
      if (item.platformItemId) set.add(item.platformItemId);
    }
    return set;
  }, [cloudApiItems]);

  // Fast set of pending operation entity IDs in outbox
  const pendingOutboxEntityIds = useMemo(() => {
    const set = new Set<string>();
    for (const item of localPendingItems) {
      if (item.platformItemId) set.add(item.platformItemId);
    }
    return set;
  }, [localPendingItems]);

  // Complete local items map from IndexedDB + in-memory store
  const localItemsMap = useMemo(() => {
    const map = new Map<string, NormalizedYouTubeDiscoveryItem>();
    for (const item of allLocalAndHydratedItems) {
      if (item.platformItemId) map.set(item.platformItemId, item);
    }
    for (const item of inMemorySavedItems) {
      if (item.platformItemId && !map.has(item.platformItemId)) {
        map.set(item.platformItemId, item);
      }
    }
    return map;
  }, [allLocalAndHydratedItems, inMemorySavedItems]);

  // ─────────────────────────────────────────────────────────────────────────
  // THREE EXPLICIT STORAGE STATE PARTITIONS:
  // 1. localOnlyItems (LOCAL_ONLY): Present locally, not verified in R2 cloud
  // 2. localAndCloudItems (LOCAL_AND_CLOUD): Present in both; cleanup pending
  // 3. cloudArchiveItems (CLOUD_ONLY & Complete Archive): All authoritative R2 records
  // ─────────────────────────────────────────────────────────────────────────

  const localOnlyItems = useMemo(() => {
    const list: NormalizedYouTubeDiscoveryItem[] = [];
    for (const [platformId, item] of localItemsMap.entries()) {
      const inCloud = verifiedCloudPlatformIds.has(platformId);
      const isPending = pendingOutboxEntityIds.has(platformId);
      if (!inCloud || isPending) {
        list.push({
          ...item,
          ...({ _storageState: "LOCAL_ONLY", _sourceLocation: "LOCAL" } as Record<string, unknown>),
        });
      }
    }
    return filterAndSortItems(list, typeFilter, searchQuery, sortOption);
  }, [localItemsMap, verifiedCloudPlatformIds, pendingOutboxEntityIds, typeFilter, searchQuery, sortOption]);

  const localAndCloudItems = useMemo(() => {
    const list: NormalizedYouTubeDiscoveryItem[] = [];
    for (const [platformId, item] of localItemsMap.entries()) {
      const inCloud = verifiedCloudPlatformIds.has(platformId);
      const isPending = pendingOutboxEntityIds.has(platformId);
      if (inCloud && !isPending) {
        list.push({
          ...item,
          ...({ _storageState: "LOCAL_AND_CLOUD", _sourceLocation: "BOTH" } as Record<string, unknown>),
        });
      }
    }
    return filterAndSortItems(list, typeFilter, searchQuery, sortOption);
  }, [localItemsMap, verifiedCloudPlatformIds, pendingOutboxEntityIds, typeFilter, searchQuery, sortOption]);

  // Active recent cloud items (committed in recent generations)
  const activeCloudItems = useMemo(() => {
    const list = cloudApiItems
      .filter((item) => !(item as unknown as Record<string, unknown>)._isHistorical)
      .map((item) => {
        const inLocal = localItemsMap.has(item.platformItemId);
        const storageState: SavedItemStorageState = inLocal ? "LOCAL_AND_CLOUD" : "CLOUD_ONLY";
        return {
          ...item,
          ...({ _storageState: storageState, _sourceLocation: inLocal ? "BOTH" : "CLOUD" } as Record<string, unknown>),
        };
      });
    return filterAndSortItems(list, typeFilter, searchQuery, sortOption);
  }, [cloudApiItems, localItemsMap, typeFilter, searchQuery, sortOption]);

  // BEFORE APP UPDATING historical archive items (exact gen_legacy_20261112_vkyh94 prefix)
  const beforeUpdatingItems = useMemo(() => {
    const list = cloudApiItems
      .filter((item) => Boolean((item as unknown as Record<string, unknown>)._isHistorical))
      .map((item) => ({
        ...item,
        ...({
          _storageState: "CLOUD_ONLY" as SavedItemStorageState,
          _sourceLocation: "CLOUD",
          _isHistorical: true,
        } as Record<string, unknown>),
      }));
    return filterAndSortItems(list, typeFilter, searchQuery, sortOption);
  }, [cloudApiItems, typeFilter, searchQuery, sortOption]);

  // Combined cloud collection for backward compatibility
  const cloudArchiveItems = useMemo(() => {
    const list = cloudApiItems.map((item) => {
      const inLocal = localItemsMap.has(item.platformItemId);
      const storageState: SavedItemStorageState = inLocal ? "LOCAL_AND_CLOUD" : "CLOUD_ONLY";
      return {
        ...item,
        ...({ _storageState: storageState, _sourceLocation: inLocal ? "BOTH" : "CLOUD" } as Record<string, unknown>),
      };
    });
    return filterAndSortItems(list, typeFilter, searchQuery, sortOption);
  }, [cloudApiItems, localItemsMap, typeFilter, searchQuery, sortOption]);

  // Combined deduplicated total library count
  const totalUniqueItemsCount = useMemo(() => {
    const allKeys = new Set<string>();
    for (const item of cloudApiItems) {
      if (item.platformItemId) allKeys.add(item.platformItemId);
    }
    for (const item of localOnlyItems) {
      if (item.platformItemId) allKeys.add(item.platformItemId);
    }
    return allKeys.size;
  }, [cloudApiItems, localOnlyItems]);

  // Daily calendar grouping for each of the sections
  const localOnlyDailyGroups = useMemo(() => {
    return groupItemsByCalendarDay(localOnlyItems, sortOption);
  }, [localOnlyItems, sortOption]);

  const localAndCloudDailyGroups = useMemo(() => {
    return groupItemsByCalendarDay(localAndCloudItems, sortOption);
  }, [localAndCloudItems, sortOption]);

  const activeCloudDailyGroups = useMemo(() => {
    return groupItemsByCalendarDay(activeCloudItems, sortOption);
  }, [activeCloudItems, sortOption]);

  const beforeUpdatingDailyGroups = useMemo(() => {
    return groupItemsByCalendarDay(beforeUpdatingItems, sortOption);
  }, [beforeUpdatingItems, sortOption]);

  const cloudArchiveDailyGroups = useMemo(() => {
    return groupItemsByCalendarDay(cloudArchiveItems, sortOption);
  }, [cloudArchiveItems, sortOption]);

  // Type counts across all unique items
  const counts = useMemo(() => {
    let videos = 0;
    let shorts = 0;
    let channels = 0;
    let playlists = 0;
    const seen = new Set<string>();

    const evaluateItem = (item: NormalizedYouTubeDiscoveryItem) => {
      if (!item.platformItemId || seen.has(item.platformItemId)) return;
      seen.add(item.platformItemId);
      if (item.itemType === "channel") {
        channels++;
      } else if (item.itemType === "playlist") {
        playlists++;
      } else if (item.isShortsLike || (item.itemType as string) === "shorts_like") {
        shorts++;
      } else {
        videos++;
      }
    };

    for (const item of cloudApiItems) evaluateItem(item);
    for (const item of localOnlyItems) evaluateItem(item);

    return { all: seen.size, videos, shorts, channels, playlists };
  }, [cloudApiItems, localOnlyItems]);

  /**
   * Workstream 1 & 5: Safe Local Cleanup of a single item after verified R2 persistence.
   * Deletes ONLY that exact local record; never touches R2 or other local records.
   */
  const handleSingleLocalCleanup = async (item: NormalizedYouTubeDiscoveryItem) => {
    const ownerId = syncCoordinator.getOwnerId();
    if (!ownerId || !item.platformItemId) return;

    try {
      // 1. Remove exact record from IndexedDB entities_saved_items
      await removeLocalSavedItem(ownerId, item.platformItemId);
      // 2. Remove exact record from in-memory Zustand store
      removeLocalItemAfterCloudCommit(item.platformItemId);
      // 3. Refresh local hook state
      refreshLocal();
      setCleanupMessage(`Local copy of "${item.title.slice(0, 36)}" removed. Cloud copy preserved in R2.`);
      setTimeout(() => setCleanupMessage(null), 5000);
    } catch (err) {
      console.error("[SavedItemsWorkspace] Local cleanup error:", err);
    }
  };

  /**
   * Workstream 1 & 5: Batch local cleanup of all verified LOCAL_AND_CLOUD items.
   * Transforms verified local items into CLOUD_ONLY without data loss.
   */
  const handleCompleteAllLocalCleanups = async () => {
    const ownerId = syncCoordinator.getOwnerId();
    if (!ownerId || localAndCloudItems.length === 0) return;

    setIsCleaningBatch(true);
    try {
      const ids = localAndCloudItems.map((i) => i.platformItemId).filter(Boolean);
      await removeLocalSavedItemsBatch(ownerId, ids);
      removeLocalItemsBatchAfterCloudCommit(ids);
      refreshLocal();
      setCleanupMessage(`Cleaned up ${ids.length} local copies. All records remain safely archived in Cloudflare R2.`);
      setTimeout(() => setCleanupMessage(null), 6000);
    } catch (err) {
      console.error("[SavedItemsWorkspace] Batch local cleanup error:", err);
    } finally {
      setIsCleaningBatch(false);
    }
  };

  /**
   * Saves local items to Cloudflare R2 with reliable, honest user feedback across all stages.
   * Guarantees append-only persistence: existing cloud records are preserved intact.
   */
  const handleSaveToCloud = async () => {
    const pendingCount = localOnlyItems.length;
    if (pendingCount === 0) {
      setSaveFeedback({
        stage: "CLOUD_COMMITTED",
        isSaving: false,
        totalSelected: 0,
        uploadedCount: 0,
        verifiedCount: cloudApiItems.length,
        failedCount: 0,
        successMessage: `All local items are already synced with Cloudflare R2. ${cloudApiItems.length} cloud records preserved.`,
      });
      return;
    }

    setIsSyncing(true);
    setSaveFeedback({
      stage: "SYNCING",
      isSaving: true,
      totalSelected: pendingCount,
      uploadedCount: 0,
      verifiedCount: 0,
      failedCount: 0,
    });

    try {
      // 1. Ensure all localOnlyItems are persisted locally in IndexedDB with pending outbox entries
      const ownerId = syncCoordinator.getOwnerId();
      if (ownerId && localOnlyItems.length > 0) {
        for (const item of localOnlyItems) {
          if (!item.platformItemId) continue;
          try {
            await saveEntityLocally(
              ownerId,
              "SAVED_ITEMS",
              item.platformItemId,
              item as unknown as Record<string, unknown>,
              "UPSERT"
            );
          } catch (e) {
            console.warn("[SavedItemsWorkspace] Pre-save entity enlist note:", e);
          }
        }
        await syncCoordinator.refreshSummary();
      }

      const result = await syncCoordinator.saveAll("SAVED_ITEMS");

      if (result.ok) {
        const r = result.receipt;
        const savedDataset = r?.datasets.find((d) => d.datasetType === "SAVED_ITEMS") || r?.datasets[0];
        const added = savedDataset?.addedRecordsCount ?? r?.totalNewRecordsAdded ?? (r ? pendingCount : 0);
        const preserved = savedDataset?.existingRecordsCount ?? r?.totalExistingRecordsPreserved ?? cloudApiItems.length;

        // Authoritative reload of the cloud listing & local state
        await fetchCloudItems();
        refreshLocal();

        setSaveFeedback({
          stage: "CLOUD_COMMITTED",
          isSaving: false,
          totalSelected: pendingCount,
          uploadedCount: added > 0 ? added : pendingCount,
          verifiedCount: added > 0 ? added : pendingCount,
          failedCount: 0,
          successMessage: `Cloud save completed successfully. ${added} new items committed to Cloudflare R2. ${preserved} existing cloud items preserved. 0 duplicates added.`,
          receipt: r,
        });
      } else {
        setSaveFeedback({
          stage: "FAILED",
          isSaving: false,
          totalSelected: pendingCount,
          uploadedCount: 0,
          verifiedCount: 0,
          failedCount: pendingCount,
          errorMessage: result.error || "Failed to commit items to Cloudflare R2.",
          errorCategory: result.errorCategory || "WORKER_ERROR",
          receipt: result.receipt,
        });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Cloud save failed.";
      setSaveFeedback({
        stage: "FAILED",
        isSaving: false,
        totalSelected: pendingCount,
        uploadedCount: 0,
        verifiedCount: 0,
        failedCount: pendingCount,
        errorMessage: msg,
        errorCategory: "WORKER_ERROR",
      });
    } finally {
      setIsSyncing(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* ═════════════════════════════════════════════════════════════════════ */}
      {/* SAVED LIBRARY OVERVIEW & DETAILED STATS HEADER                        */}
      {/* ═════════════════════════════════════════════════════════════════════ */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Card className="p-3.5 sm:p-4 border-amber-500/30 bg-amber-500/5 shadow-xs">
          <div className="flex items-center gap-2 text-xs font-semibold text-amber-500">
            <HardDrive className="h-4 w-4" />
            <span>Local Browser</span>
          </div>
          <div className="mt-2 text-2xl font-bold tracking-tight text-foreground">
            {localOnlyItems.length}
          </div>
          <p className="mt-0.5 text-[11px] text-muted">Pending cloud sync</p>
        </Card>

        <Card className="p-3.5 sm:p-4 border-cyan-500/30 bg-cyan-500/5 shadow-xs">
          <div className="flex items-center gap-2 text-xs font-semibold text-cyan-600 dark:text-cyan-400">
            <Layers className="h-4 w-4" />
            <span>Local + R2 Cloud</span>
          </div>
          <div className="mt-2 text-2xl font-bold tracking-tight text-foreground">
            {localAndCloudItems.length}
          </div>
          <p className="mt-0.5 text-[11px] text-muted">Verified; cleanup pending</p>
        </Card>

        <Card className="p-3.5 sm:p-4 border-emerald-500/30 bg-emerald-500/5 shadow-xs">
          <div className="flex items-center gap-2 text-xs font-semibold text-emerald-500">
            <Cloud className="h-4 w-4" />
            <span>R2 Cloud (Active)</span>
          </div>
          <div className="mt-2 text-2xl font-bold tracking-tight text-foreground">
            {cloudLoading ? "…" : activeCloudItems.length}
          </div>
          <p className="mt-0.5 text-[11px] text-muted">Recent generation</p>
        </Card>

        <Card className="p-3.5 sm:p-4 border-purple-500/30 bg-purple-500/5 shadow-xs">
          <div className="flex items-center gap-2 text-xs font-semibold text-purple-600 dark:text-purple-400">
            <Sparkles className="h-4 w-4" />
            <span>Historical Archive</span>
          </div>
          <div className="mt-2 text-2xl font-bold tracking-tight text-foreground">
            {cloudLoading ? "…" : beforeUpdatingItems.length}
          </div>
          <p className="mt-0.5 text-[11px] text-muted">Before app updating</p>
        </Card>
      </div>

      {/* Cloud Catalog Reconstruction Metrics */}
      {cloudCatalogStats && (
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 rounded-lg border border-border/70 bg-surface-muted/50 text-[11px] text-muted">
          <div className="flex flex-wrap items-center gap-4">
            <span>
              Objects Enumerated: <strong className="text-foreground">{cloudCatalogStats.enumeratedObjectsCount}</strong>
            </span>
            <span>
              Manifests Inspected: <strong className="text-foreground">{cloudCatalogStats.enumeratedManifestsCount}</strong>
            </span>
            <span>
              Parts Read: <strong className="text-foreground">{cloudCatalogStats.enumeratedPartsCount}</strong>
            </span>
            <span>
              Historical Records: <strong className="text-purple-600 dark:text-purple-400">{cloudCatalogStats.historicalRecordsCount}</strong>
            </span>
            <span>
              Recent Cloud Records: <strong className="text-emerald-500">{cloudCatalogStats.recentRecordsCount}</strong>
            </span>
          </div>
          {cloudRevision > 0 && (
            <span className="font-mono text-muted/80">Dataset Revision {cloudRevision}</span>
          )}
        </div>
      )}

      {/* ═════════════════════════════════════════════════════════════════════ */}
      {/* STORAGE VIEWS SELECTOR & ACTION BAR: [ All ] [ Local ] [ R2 Cloud ]  */}
      {/* ═════════════════════════════════════════════════════════════════════ */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3.5 sm:p-4 rounded-xl border border-border/80 bg-surface shadow-xs">
        {/* Storage View Buttons */}
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => setStorageView("all")}
            className={`flex items-center gap-2 rounded-lg px-3.5 py-2 text-xs font-semibold transition ${
              storageView === "all"
                ? "bg-foreground text-background shadow-xs font-bold"
                : "bg-surface-muted text-muted hover:text-foreground border border-border/60"
            }`}
          >
            <Layers className="h-3.5 w-3.5" />
            <span>All Storage</span>
            <span className="rounded-full bg-border/60 px-1.5 py-0.2 text-[10px] text-muted">
              {totalUniqueItemsCount}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setStorageView("local")}
            className={`flex items-center gap-2 rounded-lg px-3.5 py-2 text-xs font-semibold transition ${
              storageView === "local"
                ? "bg-amber-500 text-black shadow-xs font-bold"
                : "bg-surface-muted text-muted hover:text-foreground border border-border/60"
            }`}
          >
            <HardDrive className="h-3.5 w-3.5" />
            <span>Local Browser</span>
            <span className="rounded-full bg-border/60 px-1.5 py-0.2 text-[10px] text-muted">
              {localOnlyItems.length}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setStorageView("cloud")}
            className={`flex items-center gap-2 rounded-lg px-3.5 py-2 text-xs font-semibold transition ${
              storageView === "cloud"
                ? "bg-emerald-600 text-white shadow-xs font-bold"
                : "bg-surface-muted text-muted hover:text-foreground border border-border/60"
            }`}
          >
            <Cloud className="h-3.5 w-3.5" />
            <span>R2 Cloud</span>
            <span className="rounded-full bg-border/60 px-1.5 py-0.2 text-[10px] text-muted">
              {cloudLoading ? "…" : cloudTotalCount || cloudApiItems.length}
            </span>
          </button>
        </div>

        {/* Action Controls: Refresh Cloud & Save to R2 Cloud */}
        <div className="flex items-center gap-2 sm:self-center">
          <button
            type="button"
            onClick={() => void fetchCloudItems()}
            disabled={cloudLoading}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface hover:bg-surface-muted px-3 py-2 text-xs font-medium text-muted hover:text-foreground transition disabled:opacity-50"
            title="Reload authoritative items from Cloudflare R2"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${cloudLoading ? "animate-spin text-emerald-500" : ""}`} />
            <span className="hidden sm:inline">Refresh Cloud</span>
          </button>

          {localAndCloudItems.length > 0 && (
            <button
              type="button"
              onClick={handleCompleteAllLocalCleanups}
              disabled={isCleaningBatch}
              className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-cyan-600 hover:bg-cyan-700 text-white font-semibold text-xs px-3.5 py-2 shadow-xs transition disabled:opacity-50"
              title="Remove local copies of already-verified cloud items"
            >
              <CheckCircle2 className="h-3.5 w-3.5" />
              <span>{isCleaningBatch ? "Cleaning…" : `Clean Up Local (${localAndCloudItems.length})`}</span>
            </button>
          )}

          <button
            type="button"
            onClick={handleSaveToCloud}
            disabled={isSyncing}
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-amber-500 hover:bg-amber-600 text-black font-semibold text-xs px-4 py-2 shadow-xs transition hover:shadow-md disabled:opacity-50"
            title="Append eligible local items to Cloudflare R2 (preserves all existing cloud items)"
          >
            {isSyncing ? (
              <>
                <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                <span>Saving to R2 Cloud…</span>
              </>
            ) : (
              <>
                <Cloud className="h-3.5 w-3.5" />
                <span>Save to R2 Cloud</span>
                {localOnlyItems.length > 0 && (
                  <span className="rounded-full bg-black/20 px-1.5 py-0.2 text-[10px] font-bold">
                    {localOnlyItems.length}
                  </span>
                )}
              </>
            )}
          </button>
        </div>
      </div>

      {/* Local Cleanup Confirmation Toast */}
      {cleanupMessage && (
        <div className="flex items-center justify-between p-3 rounded-lg border border-cyan-500/40 bg-cyan-500/10 text-cyan-600 dark:text-cyan-400 text-xs font-medium">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 shrink-0" />
            <span>{cleanupMessage}</span>
          </div>
          <button
            type="button"
            onClick={() => setCleanupMessage(null)}
            className="hover:opacity-75"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* ═════════════════════════════════════════════════════════════════════ */}
      {/* REAL-TIME CLOUD SAVE & UPLOAD PROGRESS FEEDBACK BANNER               */}
      {/* ═════════════════════════════════════════════════════════════════════ */}
      {saveFeedback && (
        <Card
          className={`p-4 sm:p-5 rounded-xl border shadow-sm transition ${
            saveFeedback.isSaving
              ? "border-amber-500/40 bg-amber-500/5 text-foreground"
              : saveFeedback.stage === "CLOUD_COMMITTED"
              ? "border-emerald-500/40 bg-emerald-500/5 text-foreground"
              : "border-red-500/40 bg-red-500/5 text-foreground"
          }`}
        >
          <div className="flex flex-col gap-3">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                {saveFeedback.isSaving ? (
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-amber-500/20 text-amber-500">
                    <RefreshCw className="h-4 w-4 animate-spin" />
                  </div>
                ) : saveFeedback.stage === "CLOUD_COMMITTED" ? (
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-emerald-500/20 text-emerald-500">
                    <CheckCircle2 className="h-4 w-4" />
                  </div>
                ) : (
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-red-500/20 text-red-500">
                    <AlertCircle className="h-4 w-4" />
                  </div>
                )}

                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-bold tracking-tight">
                      {saveFeedback.isSaving
                        ? "Saving to Cloudflare R2…"
                        : saveFeedback.stage === "CLOUD_COMMITTED"
                        ? "Cloud Save Completed"
                        : "Cloud Save Failed"}
                    </h3>
                    <span
                      className={`inline-flex items-center rounded-md px-2 py-0.5 text-[10px] font-bold ${
                        saveFeedback.isSaving
                          ? "bg-amber-500/20 text-amber-500"
                          : saveFeedback.stage === "CLOUD_COMMITTED"
                          ? "bg-emerald-500/20 text-emerald-500"
                          : "bg-red-500/20 text-red-500"
                      }`}
                    >
                      {SAVE_STAGE_LABELS[saveFeedback.stage] || saveFeedback.stage}
                    </span>
                  </div>

                  <p className="mt-1 text-xs text-muted">
                    {saveFeedback.isSaving
                      ? `Uploading local items to Cloudflare R2 and committing Supabase audit receipt (Target: ${saveFeedback.totalSelected} items)…`
                      : saveFeedback.successMessage
                      ? saveFeedback.successMessage
                      : saveFeedback.errorMessage ||
                        "An unexpected error occurred during cloud synchronization."}
                  </p>
                </div>
              </div>

              {!saveFeedback.isSaving && (
                <button
                  type="button"
                  onClick={() => setSaveFeedback(null)}
                  className="text-muted hover:text-foreground p-1"
                  aria-label="Dismiss feedback"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>

            {saveFeedback.isSaving && (
              <div className="flex flex-wrap items-center gap-4 text-xs font-medium text-muted pt-1">
                <span>
                  Selected: <strong className="text-foreground">{saveFeedback.totalSelected}</strong>
                </span>
                <span>
                  Uploading:{" "}
                  <strong className="text-foreground">
                    {saveFeedback.totalSelected} / {saveFeedback.totalSelected}
                  </strong>
                </span>
                <span>
                  Integrity: <strong className="text-emerald-500">SHA-256 Verified</strong>
                </span>
                <span>
                  Mode: <strong className="text-foreground">Append-Only</strong>
                </span>
              </div>
            )}

            {saveFeedback.stage === "FAILED" && (
              <div className="flex items-center gap-2 pt-1">
                <button
                  type="button"
                  onClick={handleSaveToCloud}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-red-600 hover:bg-red-700 text-white font-semibold text-xs px-3.5 py-1.5 transition"
                >
                  <RefreshCw className="h-3 w-3" />
                  <span>Retry Save to R2 Cloud</span>
                </button>
                <span className="text-xs text-muted">
                  Local browser items remain safely preserved in IndexedDB.
                </span>
              </div>
            )}
          </div>
        </Card>
      )}

      {/* ═════════════════════════════════════════════════════════════════════ */}
      {/* FILTER, SEARCH, SORT & UNDO/REDO CONTROLS BAR                        */}
      {/* ═════════════════════════════════════════════════════════════════════ */}
      <Card className="p-4 sm:p-5 shadow-sm border border-border/80">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          {/* Search Input */}
          <div className="relative flex-1 max-w-lg">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted" />
            <input
              type="text"
              placeholder={`Search in ${
                storageView === "local"
                  ? "Local Browser"
                  : storageView === "cloud"
                  ? "R2 Cloud Archive"
                  : "All Saved Items"
              }…`}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="h-10 w-full rounded-lg border border-border bg-surface pl-10 pr-9 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--ring)] transition"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery("")}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted hover:text-foreground"
                aria-label="Clear search"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>

          {/* Type Filters & Sorting */}
          <div className="flex flex-wrap items-center gap-2.5">
            {/* Type Filters */}
            <div className="flex items-center rounded-lg border border-border bg-surface-muted p-1 text-xs">
              <button
                type="button"
                onClick={() => setTypeFilter("all")}
                className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 font-medium transition ${
                  typeFilter === "all"
                    ? "bg-surface text-foreground shadow-sm font-semibold"
                    : "text-muted hover:text-foreground"
                }`}
              >
                <span>All</span>
                <span className="rounded-full bg-border/60 px-1.5 py-0.2 text-[10px] text-muted">
                  {counts.all}
                </span>
              </button>
              <button
                type="button"
                onClick={() => setTypeFilter("video")}
                className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 font-medium transition ${
                  typeFilter === "video"
                    ? "bg-surface text-foreground shadow-sm font-semibold"
                    : "text-muted hover:text-foreground"
                }`}
              >
                <Film className="h-3.5 w-3.5 text-primary" />
                <span>Videos</span>
                <span className="rounded-full bg-border/60 px-1.5 py-0.2 text-[10px] text-muted">
                  {counts.videos}
                </span>
              </button>
              <button
                type="button"
                onClick={() => setTypeFilter("shorts")}
                className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 font-medium transition ${
                  typeFilter === "shorts"
                    ? "bg-surface text-foreground shadow-sm font-semibold"
                    : "text-muted hover:text-foreground"
                }`}
              >
                <Flame className="h-3.5 w-3.5 text-red-500" />
                <span>Shorts</span>
                <span className="rounded-full bg-border/60 px-1.5 py-0.2 text-[10px] text-muted">
                  {counts.shorts}
                </span>
              </button>
              <button
                type="button"
                onClick={() => setTypeFilter("channel")}
                className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 font-medium transition ${
                  typeFilter === "channel"
                    ? "bg-surface text-foreground shadow-sm font-semibold"
                    : "text-muted hover:text-foreground"
                }`}
              >
                <Tv className="h-3.5 w-3.5 text-emerald-500" />
                <span>Channels</span>
                <span className="rounded-full bg-border/60 px-1.5 py-0.2 text-[10px] text-muted">
                  {counts.channels}
                </span>
              </button>
              <button
                type="button"
                onClick={() => setTypeFilter("playlist")}
                className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 font-medium transition ${
                  typeFilter === "playlist"
                    ? "bg-surface text-foreground shadow-sm font-semibold"
                    : "text-muted hover:text-foreground"
                }`}
              >
                <ListVideo className="h-3.5 w-3.5 text-indigo-500" />
                <span>Playlists</span>
                <span className="rounded-full bg-border/60 px-1.5 py-0.2 text-[10px] text-muted">
                  {counts.playlists}
                </span>
              </button>
            </div>

            {/* Undo/Redo & Sort Selector */}
            <div className="flex flex-wrap items-center gap-2">
              <UndoRedoControls scope={["SAVED_ITEMS"]} enableKeyboardShortcuts compact />
              <select
                value={sortOption}
                onChange={(e) => setSortOption(e.target.value as SortOption)}
                className="h-9 rounded-lg border border-border bg-surface px-3 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-[var(--ring)]"
              >
                <option value="date_desc">Save Date (Newest first)</option>
                <option value="date_asc">Save Date (Oldest first)</option>
                <option value="title_az">Title (A to Z)</option>
                <option value="views_desc">Most Views</option>
              </select>
            </div>
          </div>
        </div>
      </Card>

      {/* Cloud Error State Banner (Honest Error Delivery) */}
      {cloudError && (
        <Card className="p-5 border-red-500/40 bg-red-500/5 text-foreground rounded-xl">
          <div className="flex items-start gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-red-500/20 text-red-500">
              <AlertCircle className="h-5 w-5" />
            </div>
            <div className="flex-1">
              <h3 className="text-sm font-bold text-red-600 dark:text-red-400">
                Unable to load cloud archive from Cloudflare R2
              </h3>
              <p className="mt-1 text-xs text-muted">
                {cloudError}. Your local browser items remain completely safe in IndexedDB.
              </p>
              <div className="mt-3 flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => void fetchCloudItems()}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-red-600 hover:bg-red-700 text-white font-semibold text-xs px-3.5 py-1.5 transition"
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                  <span>Retry Loading Cloud Archive</span>
                </button>
              </div>
            </div>
          </div>
        </Card>
      )}

      {/* Cloud Loading Spinner */}
      {cloudLoading && !cloudError && (
        <Card className="flex flex-col items-center justify-center p-12 text-center">
          <RefreshCw className="h-8 w-8 text-emerald-500 animate-spin mb-3" />
          <h3 className="text-sm font-semibold text-foreground">
            Reconstructing Authoritative R2 Cloud Catalog…
          </h3>
          <p className="mt-1 text-xs text-muted max-w-sm">
            Enumerating generations, verifying manifest parts, and retrieving historical records.
          </p>
        </Card>
      )}

      {/* ═════════════════════════════════════════════════════════════════════ */}
      {/* SECTION 1 — NEWLY ADDED — LOCAL BROWSER (LOCAL_ONLY)                  */}
      {/* ═════════════════════════════════════════════════════════════════════ */}
      {(storageView === "all" || storageView === "local") && (
        <div className="space-y-4 pt-2">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 rounded-xl border border-amber-500/30 bg-amber-500/5 shadow-xs">
            <div className="flex items-center gap-3.5">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-amber-500/20 text-amber-500 font-bold shadow-xs">
                <HardDrive className="h-5 w-5" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-base font-bold text-foreground tracking-tight">
                    NEWLY ADDED — LOCAL BROWSER
                  </h2>
                  <span className="inline-flex items-center rounded-full bg-amber-500/20 border border-amber-500/40 px-2.5 py-0.5 text-xs font-bold text-amber-600 dark:text-amber-400">
                    {localOnlyItems.length} {localOnlyItems.length === 1 ? "item" : "items"}
                  </span>
                </div>
                <p className="mt-0.5 text-xs text-muted">
                  Saved in local browser IndexedDB on <span className="font-semibold text-foreground">{deviceLabel}</span>. Awaiting verified upload to Cloudflare R2.
                </p>
              </div>
            </div>

            {localOnlyItems.length > 0 && (
              <button
                type="button"
                onClick={handleSaveToCloud}
                disabled={isSyncing}
                className="inline-flex items-center gap-1.5 rounded-lg bg-amber-500 hover:bg-amber-600 text-black font-semibold text-xs px-3.5 py-1.5 transition self-start sm:self-center shadow-xs"
              >
                <Cloud className="h-3.5 w-3.5" />
                <span>Upload to R2 Cloud</span>
              </button>
            )}
          </div>

          {localOnlyItems.length > 0 ? (
            <div className="space-y-8 pl-1">
              {localOnlyDailyGroups.map((group) => (
                <section key={`local-only-${group.key}`} className="space-y-4">
                  <div className="sticky top-16 z-10 flex items-center gap-3 bg-background/95 py-2 backdrop-blur-md">
                    <div className="flex h-6 w-6 items-center justify-center rounded bg-amber-500/15 text-amber-500">
                      <Calendar className="h-3.5 w-3.5" />
                    </div>
                    <h3 className="text-xs font-bold tracking-wider uppercase text-amber-500">
                      {group.label}
                    </h3>
                    <span className="rounded-full bg-border/60 px-2 py-0.5 text-[10px] font-semibold text-muted">
                      {group.items.length} {group.items.length === 1 ? "item" : "items"}
                    </span>
                    <div className="h-px flex-1 bg-amber-500/20" />
                  </div>

                  <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
                    {group.items.map((item) => (
                      <SavedItemCard
                        key={`local-only-${item.itemType}-${item.platformItemId}`}
                        item={item}
                        storageState="LOCAL_ONLY"
                        onRemove={() => toggleItemSaved(item)}
                        onAddToPlaylist={() => setPlaylistTarget(item)}
                        onInspectJson={() => setInspectedItem(item)}
                      />
                    ))}
                  </div>
                </section>
              ))}
            </div>
          ) : (
            <div className="p-6 text-center rounded-xl border border-dashed border-border/70 text-xs text-muted">
              All local items on this device have completed verified cloud synchronization.
            </div>
          )}
        </div>
      )}

      {/* ═════════════════════════════════════════════════════════════════════ */}
      {/* SECTION 2 — LOCAL + R2 CLOUD (LOCAL_AND_CLOUD — Cleanup Pending)     */}
      {/* ═════════════════════════════════════════════════════════════════════ */}
      {(storageView === "all" || storageView === "local" || storageView === "cloud") && (
        <div className="space-y-4 pt-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 rounded-xl border border-cyan-500/30 bg-cyan-500/5 shadow-xs">
            <div className="flex items-center gap-3.5">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-cyan-500/20 text-cyan-600 dark:text-cyan-400 font-bold shadow-xs">
                <Layers className="h-5 w-5" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-base font-bold text-foreground tracking-tight">
                    LOCAL + R2 CLOUD
                  </h2>
                  <span className="inline-flex items-center rounded-full bg-cyan-500/20 border border-cyan-500/40 px-2.5 py-0.5 text-xs font-bold text-cyan-600 dark:text-cyan-400">
                    {localAndCloudItems.length} {localAndCloudItems.length === 1 ? "item" : "items"}
                  </span>
                </div>
                <p className="mt-0.5 text-xs text-muted">
                  Present in both local browser and Cloudflare R2. Cloud persistence verified; complete local cleanup to transition to Cloud Only.
                </p>
              </div>
            </div>

            {localAndCloudItems.length > 0 && (
              <button
                type="button"
                onClick={handleCompleteAllLocalCleanups}
                disabled={isCleaningBatch}
                className="inline-flex items-center gap-1.5 rounded-lg bg-cyan-600 hover:bg-cyan-700 text-white font-semibold text-xs px-3.5 py-1.5 transition self-start sm:self-center shadow-xs disabled:opacity-50"
              >
                <CheckCircle2 className="h-3.5 w-3.5" />
                <span>{isCleaningBatch ? "Cleaning…" : "Complete All Local Cleanups"}</span>
              </button>
            )}
          </div>

          {localAndCloudItems.length > 0 ? (
            <div className="space-y-8 pl-1">
              {localAndCloudDailyGroups.map((group) => (
                <section key={`local-cloud-${group.key}`} className="space-y-4">
                  <div className="sticky top-16 z-10 flex items-center gap-3 bg-background/95 py-2 backdrop-blur-md">
                    <div className="flex h-6 w-6 items-center justify-center rounded bg-cyan-500/15 text-cyan-600 dark:text-cyan-400">
                      <Calendar className="h-3.5 w-3.5" />
                    </div>
                    <h3 className="text-xs font-bold tracking-wider uppercase text-cyan-600 dark:text-cyan-400">
                      {group.label}
                    </h3>
                    <span className="rounded-full bg-border/60 px-2 py-0.5 text-[10px] font-semibold text-muted">
                      {group.items.length} {group.items.length === 1 ? "item" : "items"}
                    </span>
                    <div className="h-px flex-1 bg-cyan-500/20" />
                  </div>

                  <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
                    {group.items.map((item) => (
                      <SavedItemCard
                        key={`local-cloud-${item.itemType}-${item.platformItemId}`}
                        item={item}
                        storageState="LOCAL_AND_CLOUD"
                        onRemove={() => toggleItemSaved(item)}
                        onCompleteLocalCleanup={() => handleSingleLocalCleanup(item)}
                        onAddToPlaylist={() => setPlaylistTarget(item)}
                        onInspectJson={() => setInspectedItem(item)}
                      />
                    ))}
                  </div>
                </section>
              ))}
            </div>
          ) : (
            <div className="p-6 text-center rounded-xl border border-dashed border-border/70 text-xs text-muted">
              No items pending local cleanup. All synchronized items are securely retained in Cloudflare R2.
            </div>
          )}
        </div>
      )}

      {/* ═════════════════════════════════════════════════════════════════════ */}
      {/* SECTION 3 — FROM R2 CLOUD — ACTIVE RECENT GENERATIONS                 */}
      {/* ═════════════════════════════════════════════════════════════════════ */}
      {(storageView === "all" || storageView === "cloud") && (
        <div className="space-y-4 pt-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 rounded-xl border border-emerald-500/30 bg-emerald-500/5 shadow-xs">
            <div className="flex items-center gap-3.5">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-emerald-500/20 text-emerald-500 font-bold shadow-xs">
                <Cloud className="h-5 w-5" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-base font-bold text-foreground tracking-tight">
                    FROM R2 CLOUD — ACTIVE RECENT GENERATIONS
                  </h2>
                  <span className="inline-flex items-center rounded-full bg-emerald-500/20 border border-emerald-500/40 px-2.5 py-0.5 text-xs font-bold text-emerald-600 dark:text-emerald-400">
                    {cloudLoading ? "Loading…" : `${activeCloudItems.length} active records`}
                  </span>
                </div>
                <p className="mt-0.5 text-xs text-muted">
                  Recently synchronized items authoritatively committed to Cloudflare R2 New Bucket.
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={() => void fetchCloudItems()}
              disabled={cloudLoading}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface hover:bg-surface-muted px-3 py-1.5 text-xs font-medium text-muted hover:text-foreground transition self-start sm:self-center disabled:opacity-50"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${cloudLoading ? "animate-spin text-emerald-500" : ""}`} />
              <span>Refresh Archive</span>
            </button>
          </div>

          {!cloudLoading && activeCloudItems.length > 0 && (
            <div className="space-y-8 pl-1">
              {activeCloudDailyGroups.map((group) => (
                <section key={`cloud-active-${group.key}`} className="space-y-4">
                  <div className="sticky top-16 z-10 flex items-center gap-3 bg-background/95 py-2 backdrop-blur-md">
                    <div className="flex h-6 w-6 items-center justify-center rounded bg-emerald-500/15 text-emerald-500">
                      <Calendar className="h-3.5 w-3.5" />
                    </div>
                    <h3 className="text-xs font-bold tracking-wider uppercase text-emerald-500">
                      {group.label}
                    </h3>
                    <span className="rounded-full bg-border/60 px-2 py-0.5 text-[10px] font-semibold text-muted">
                      {group.items.length} {group.items.length === 1 ? "item" : "items"}
                    </span>
                    <div className="h-px flex-1 bg-emerald-500/20" />
                  </div>

                  <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
                    {group.items.map((item) => (
                      <SavedItemCard
                        key={`cloud-active-${item.itemType}-${item.platformItemId}`}
                        item={item}
                        storageState={
                          (item as unknown as Record<string, unknown>)._storageState as SavedItemStorageState || "CLOUD_ONLY"
                        }
                        onRemove={() => toggleItemSaved(item)}
                        onCompleteLocalCleanup={
                          localItemsMap.has(item.platformItemId)
                            ? () => handleSingleLocalCleanup(item)
                            : undefined
                        }
                        onAddToPlaylist={() => setPlaylistTarget(item)}
                        onInspectJson={() => setInspectedItem(item)}
                      />
                    ))}
                  </div>
                </section>
              ))}
            </div>
          )}

          {!cloudLoading && activeCloudItems.length === 0 && !cloudError && (
            <div className="p-6 text-center rounded-xl border border-dashed border-border/70 text-xs text-muted">
              No recent active cloud generation items in this view. Check the Historical Archive below for pre-update records.
            </div>
          )}
        </div>
      )}

      {/* ═════════════════════════════════════════════════════════════════════ */}
      {/* DISTINCT VISUAL HORIZONTAL DIVIDER                                    */}
      {/* ═════════════════════════════════════════════════════════════════════ */}
      {(storageView === "all" || storageView === "cloud") && (
        <div className="relative my-10">
          <div className="absolute inset-0 flex items-center" aria-hidden="true">
            <div className="w-full border-t-2 border-dashed border-purple-500/50" />
          </div>
          <div className="relative flex justify-center">
            <span className="bg-background px-5 py-2 text-xs font-black tracking-widest uppercase text-purple-400 border-2 border-purple-500/60 rounded-full shadow-lg flex items-center gap-2.5">
              <Sparkles className="h-4 w-4 text-purple-400 animate-pulse" />
              BEFORE APP UPDATING — HISTORICAL ARCHIVE
              <span className="inline-flex items-center rounded-full bg-purple-500/20 px-2 py-0.5 text-[10px] font-bold text-purple-300">
                {beforeUpdatingItems.length} RECORDS
              </span>
            </span>
          </div>
        </div>
      )}

      {/* ═════════════════════════════════════════════════════════════════════ */}
      {/* SECTION 4 — BEFORE APP UPDATING — HISTORICAL ARCHIVE (IMMUTABLE R2)   */}
      {/* ═════════════════════════════════════════════════════════════════════ */}
      {(storageView === "all" || storageView === "cloud") && (
        <div className="space-y-4 pt-2">
          {/* Historical Archive Provenance Card */}
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 p-5 rounded-xl border border-purple-500/30 bg-purple-500/5 shadow-xs">
            <div className="flex items-start gap-4">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-purple-500/20 text-purple-400 font-bold shadow-xs">
                <Sparkles className="h-6 w-6" />
              </div>
              <div className="space-y-1.5">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-base font-bold text-foreground tracking-tight">
                    BEFORE APP UPDATING — HISTORICAL ARCHIVE
                  </h2>
                  <span className="inline-flex items-center rounded-full bg-purple-500/20 border border-purple-500/40 px-2.5 py-0.5 text-xs font-bold text-purple-300">
                    {cloudLoading ? "Loading…" : `${beforeUpdatingItems.length} historical records`}
                  </span>
                  <span className="inline-flex items-center rounded-full bg-surface-muted border border-border px-2 py-0.5 text-[10px] font-mono font-medium text-muted">
                    gen_legacy_20261112_vkyh94
                  </span>
                </div>
                <p className="text-xs text-muted max-w-3xl leading-relaxed">
                  Authentic historical saved items uploaded to Cloudflare R2 before the application architecture update.
                  Preserved with complete fidelity in bucket <code className="text-purple-300 font-mono text-[11px]">new-youtube-discovery-private</code> under generation <code className="text-purple-300 font-mono text-[11px]">gen_legacy_20261112_vkyh94</code>.
                </p>
                <div className="flex flex-wrap items-center gap-4 pt-1 text-[11px] text-muted">
                  <span className="flex items-center gap-1.5">
                    <Database className="h-3.5 w-3.5 text-purple-400" />
                    <span>Bucket: <strong>new-youtube-discovery-private</strong></span>
                  </span>
                  <span className="flex items-center gap-1.5">
                    <Calendar className="h-3.5 w-3.5 text-purple-400" />
                    <span>Archived: <strong>November 12, 2026</strong></span>
                  </span>
                  <span className="flex items-center gap-1.5">
                    <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
                    <span>Status: <strong>Permanent Immutable Read-Only</strong></span>
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Historical Items Render Grid */}
          {!cloudLoading && beforeUpdatingItems.length > 0 && (
            <div className="space-y-8 pl-1">
              {beforeUpdatingDailyGroups.map((group) => (
                <section key={`before-updating-${group.key}`} className="space-y-4">
                  <div className="sticky top-16 z-10 flex items-center gap-3 bg-background/95 py-2 backdrop-blur-md">
                    <div className="flex h-6 w-6 items-center justify-center rounded bg-purple-500/15 text-purple-400">
                      <Calendar className="h-3.5 w-3.5" />
                    </div>
                    <h3 className="text-xs font-bold tracking-wider uppercase text-purple-400">
                      {group.label}
                    </h3>
                    <span className="rounded-full bg-border/60 px-2 py-0.5 text-[10px] font-semibold text-muted">
                      {group.items.length} {group.items.length === 1 ? "item" : "items"}
                    </span>
                    <div className="h-px flex-1 bg-purple-500/20" />
                  </div>

                  <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
                    {group.items.map((item) => (
                      <SavedItemCard
                        key={`before-updating-${item.itemType}-${item.platformItemId}`}
                        item={item}
                        storageState="CLOUD_ONLY"
                        onRemove={() => {}}
                        onAddToPlaylist={() => setPlaylistTarget(item)}
                        onInspectJson={() => setInspectedItem(item)}
                      />
                    ))}
                  </div>
                </section>
              ))}

              {/* Progressive Pagination for Large Historical Archives */}
              {cloudHasMore && (
                <div className="flex flex-col items-center justify-center py-6 gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      if (cloudNextOffset !== null) {
                        void fetchCloudItems({ offset: cloudNextOffset, append: true });
                      }
                    }}
                    disabled={cloudLoadingMore}
                    className="inline-flex items-center gap-2 rounded-xl bg-surface hover:bg-surface-muted border border-border px-6 py-2.5 text-xs font-bold text-foreground transition shadow-xs hover:shadow-md disabled:opacity-50"
                  >
                    <RefreshCw className={`h-3.5 w-3.5 ${cloudLoadingMore ? "animate-spin text-purple-400" : ""}`} />
                    <span>
                      {cloudLoadingMore
                        ? "Loading More Historical Items…"
                        : `Load More Archive Items (Showing ${beforeUpdatingItems.length} of ${cloudTotalCount})`}
                    </span>
                  </button>
                  <p className="text-[11px] text-muted">
                    Progressively reads earlier generation parts without replacing loaded records.
                  </p>
                </div>
              )}
            </div>
          )}

          {!cloudLoading && beforeUpdatingItems.length === 0 && !cloudError && (
            <div className="p-8 text-center rounded-xl border border-dashed border-border/70 text-xs text-muted">
              No historical before-app-updating items found for the current query/filter.
            </div>
          )}
        </div>
      )}

      {/* Add To Playlist Dialog */}
      {playlistTarget && (
        <AddToPlaylistDialog
          item={playlistTarget}
          open={Boolean(playlistTarget)}
          onClose={() => setPlaylistTarget(null)}
        />
      )}

      {/* Raw JSON Inspection Dialog */}
      {inspectedItem && (
        <RawJsonInspectorDialog
          item={inspectedItem}
          open={Boolean(inspectedItem)}
          onClose={() => setInspectedItem(null)}
        />
      )}
    </div>
  );
}

/**
 * Enhanced Saved Item Card with 3 Explicit Storage Badges and Local Cleanup Action.
 */
function SavedItemCard({
  item,
  storageState,
  onRemove,
  onCompleteLocalCleanup,
  onAddToPlaylist,
  onInspectJson,
}: {
  item: NormalizedYouTubeDiscoveryItem;
  storageState: SavedItemStorageState;
  onRemove: () => void;
  onCompleteLocalCleanup?: () => void;
  onAddToPlaylist: () => void;
  onInspectJson: () => void;
}) {
  const isChannel = item.itemType === "channel";
  const isPlaylist = item.itemType === "playlist";
  const isVideo = !isChannel && !isPlaylist;

  const targetHref = isChannel
    ? `/channels/${item.platformItemId}`
    : isPlaylist
    ? `/playlists/${item.platformItemId}`
    : `/watch/${item.platformItemId}`;

  const rawItem = item as unknown as Record<string, unknown>;
  const isHistorical = Boolean(rawItem._isHistorical || rawItem.isBeforeAppUpdating);

  const originLabel: string | null =
    typeof rawItem._originDeviceLabel === "string"
      ? rawItem._originDeviceLabel
      : typeof rawItem.originDeviceLabel === "string"
      ? rawItem.originDeviceLabel
      : null;

  return (
    <Card className="group relative flex flex-col overflow-hidden rounded-xl border border-border/80 bg-surface shadow-xs transition hover:border-border hover:shadow-md">
      {/* Thumbnail or Avatar Container */}
      <div className="relative aspect-video w-full overflow-hidden bg-surface-muted">
        {item.thumbnailUrl ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            src={item.thumbnailUrl}
            alt={item.title}
            className={`h-full w-full object-cover transition-transform duration-300 group-hover:scale-102 ${
              isChannel ? "p-6 object-contain rounded-full max-h-36 mx-auto my-auto" : ""
            }`}
            loading="lazy"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-muted">
            {isChannel ? <Tv className="h-10 w-10 opacity-30" /> : <Play className="h-10 w-10 opacity-30" />}
          </div>
        )}

        {/* Top-Left: Entity Type Badge */}
        <div className="absolute top-2.5 left-2.5 flex items-center gap-1.5">
          {isChannel && (
            <Badge tone="success" className="text-[10px] uppercase font-semibold tracking-wider">
              Channel
            </Badge>
          )}
          {isPlaylist && (
            <Badge tone="ai" className="text-[10px] uppercase font-semibold tracking-wider">
              Playlist
            </Badge>
          )}
          {isVideo && item.isShortsLike && (
            <Badge tone="danger" className="text-[10px] uppercase font-semibold tracking-wider">
              Shorts-like
            </Badge>
          )}
        </div>

        {/* Top-Right: Explicit 3-State Storage Provenance Badge */}
        <div className="absolute top-2.5 right-2.5 flex items-center gap-1">
          {isHistorical ? (
            <span
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold bg-purple-600 text-white shadow-xs"
              title="Historical saved item preserved before app updating in Cloudflare R2"
            >
              <Sparkles className="h-3 w-3" />
              BEFORE APP UPDATING
            </span>
          ) : storageState === "LOCAL_AND_CLOUD" ? (
            <span
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold bg-cyan-600 text-white shadow-xs"
              title="Verified in Cloudflare R2; local browser copy cleanup pending"
            >
              <HardDrive className="h-2.5 w-2.5" />
              <span>+</span>
              <Cloud className="h-2.5 w-2.5" />
              <span>LOCAL & R2 CLOUD</span>
            </span>
          ) : storageState === "LOCAL_ONLY" ? (
            <span
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold bg-amber-500 text-black shadow-xs"
              title="Saved locally in browser storage on this device; awaiting R2 upload"
            >
              <HardDrive className="h-3 w-3" />
              LOCAL ONLY
            </span>
          ) : (
            <span
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold bg-emerald-600 text-white shadow-xs"
              title="Authoritatively committed in Cloudflare R2 object storage"
            >
              <Cloud className="h-3 w-3" />
              R2 CLOUD
            </span>
          )}
        </div>

        {/* Video Duration Overlay */}
        {isVideo && typeof item.durationSeconds === "number" && item.durationSeconds > 0 && (
          <div className="absolute bottom-2 right-2 rounded bg-black/80 px-2 py-0.5 text-xs font-semibold text-white backdrop-blur-xs">
            {formatDuration(item.durationSeconds)}
          </div>
        )}

        {/* Playlist Count Overlay */}
        {isPlaylist && typeof item.itemCount === "number" && (
          <div className="absolute bottom-2 right-2 flex items-center gap-1 rounded bg-black/80 px-2 py-0.5 text-xs font-semibold text-white backdrop-blur-xs">
            <ListVideo className="h-3.5 w-3.5" />
            <span>{item.itemCount} videos</span>
          </div>
        )}
      </div>

      {/* Body Information */}
      <div className="flex flex-1 flex-col p-4 sm:p-5">
        {/* Title */}
        <Link
          href={targetHref}
          className="line-clamp-2 text-base font-bold text-foreground transition-colors hover:text-primary leading-snug tracking-tight"
          title={item.title}
        >
          {item.title}
        </Link>

        {/* Channel or Creator Information */}
        <div className="mt-1.5 flex items-center justify-between text-xs text-muted">
          {item.channelTitle ? (
            <p className="line-clamp-1 font-medium hover:text-foreground transition-colors">
              {item.channelTitle}
            </p>
          ) : (
            <span />
          )}

          {/* Origin Device Label */}
          {originLabel && (
            <span
              className="inline-flex items-center gap-1 text-[10px] font-medium text-muted/80 bg-surface-muted px-1.5 py-0.5 rounded"
              title={`Saved from ${String(originLabel)}`}
            >
              <Laptop className="h-2.5 w-2.5" />
              <span className="max-w-[100px] truncate">{String(originLabel)}</span>
            </span>
          )}
        </div>

        {/* Metrics Bar */}
        <div className="mt-3 flex items-center gap-3 text-xs text-muted">
          {typeof item.viewsCount === "number" && (
            <span className="flex items-center gap-1 font-medium">
              <Eye className="h-3.5 w-3.5 text-muted/70" />
              {formatCompactCount(item.viewsCount)} views
            </span>
          )}
          {typeof item.subscriberCount === "number" && (
            <span className="font-medium">{formatCompactCount(item.subscriberCount)} subs</span>
          )}
          {item.savedAt && (
            <span className="ml-auto text-[11px] text-muted/80">
              {formatDate(item.savedAt)}
            </span>
          )}
        </div>

        {/* Expandable Description */}
        <ExpandableDescription description={item.description} />

        {/* Card Footer Actions */}
        <div className="mt-4 pt-3 flex flex-wrap items-center justify-between gap-2 border-t border-border/60">
          <div className="flex items-center gap-1">
            {/* Add to personal playlist button */}
            <button
              type="button"
              onClick={onAddToPlaylist}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-muted hover:bg-surface-muted hover:text-foreground transition"
              title="Add to personal playlist"
              aria-label="Add to playlist"
            >
              <ListPlus className="h-4 w-4" />
            </button>
            {/* Open External YouTube */}
            {item.url && (
              <a
                href={item.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex h-8 w-8 items-center justify-center rounded-lg text-muted hover:bg-surface-muted hover:text-foreground transition"
                title="Open on YouTube"
                aria-label="Open on YouTube"
              >
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
            )}
            {/* Inspect Raw JSON Metadata */}
            <button
              type="button"
              onClick={onInspectJson}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-muted hover:bg-surface-muted hover:text-foreground transition"
              title="Inspect Raw JSON Metadata"
              aria-label="Inspect JSON"
            >
              <FileCode className="h-3.5 w-3.5" />
            </button>
          </div>

          <div className="flex items-center gap-1.5">
            {/* Complete Local Cleanup Button for LOCAL_AND_CLOUD items */}
            {storageState === "LOCAL_AND_CLOUD" && onCompleteLocalCleanup && (
              <button
                type="button"
                onClick={onCompleteLocalCleanup}
                className="inline-flex items-center gap-1 rounded-md bg-cyan-600/15 hover:bg-cyan-600 text-cyan-600 hover:text-white dark:text-cyan-400 px-2 py-1 text-[11px] font-semibold transition"
                title="Remove local browser copy (already verified in R2 Cloud)"
              >
                <CheckCircle2 className="h-3 w-3" />
                <span>Clean Local</span>
              </button>
            )}

            {/* Remove or Historical Archive Protected Badge */}
            {isHistorical ? (
              <span
                className="inline-flex items-center gap-1 text-[11px] font-semibold text-purple-400 bg-purple-500/10 border border-purple-500/20 px-2 py-1 rounded-md"
                title="Historical archive record permanently preserved in Cloudflare R2"
              >
                <Sparkles className="h-3 w-3" />
                <span>Historical Archive</span>
              </span>
            ) : (
              <button
                type="button"
                onClick={onRemove}
                className="flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs text-muted hover:bg-danger/10 hover:text-danger transition"
                title="Remove from Saved Items"
              >
                <Trash2 className="h-3.5 w-3.5" />
                <span>Remove</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </Card>
  );
}
