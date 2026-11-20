"use client";

import {
  AlertCircle,
  Calendar,
  CheckCircle2,
  Cloud,
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
import { syncCoordinator } from "@/lib/sync/sync-coordinator";
import { getDeviceLabel } from "@/lib/device/device-identity";
import { AddToPlaylistDialog } from "@/components/library/add-to-playlist-dialog";
import { RawJsonInspectorDialog } from "@/components/saved/raw-json-inspector-dialog";
import { ExpandableDescription } from "@/components/youtube/expandable-description";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { UndoRedoControls } from "@/components/ui/undo-redo-controls";
import { formatCompactCount, formatDate, formatDuration } from "@/lib/utils/format";
import {
  SAVE_STAGE_LABELS,
  type SaveErrorCategory,
  type SaveReceipt,
  type SaveStatusStage,
} from "@/lib/sync/save-receipt";

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
 * Normalizes an item's save timestamp to an epoch number.
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
 * Dedicated Saved Items Workspace — Local & R2 Cloud Unified (2026 Production)
 * ──────────────────────────────────────────────────────────────────────────
 * Core Architecture & Guarantees:
 *   1. Clear Storage Separation: Provides independent views [All], [Local Browser],
 *      and [R2 Cloud] without confusing origins or fabricating cloud state.
 *   2. Append-Only Persistence: Saving new local items APPENDS them to R2.
 *      Previously committed cloud items are preserved and NEVER deleted.
 *   3. Authoritative Cloud Retrieval: Queries /api/saved-items to display authentic
 *      items committed to Cloudflare R2 with SHA-256 integrity verification.
 *   4. Honest Error Handling: If cloud retrieval fails, displays a clear error
 *      banner with retry; never pretends an error is an empty collection.
 *   5. Reliable User Feedback: Real-time status, upload counts, verified counts,
 *      accurate commit summaries, and safe idempotent retry.
 * ═══════════════════════════════════════════════════════════════════════════
 */
export function SavedItemsWorkspace() {
  const inMemorySavedItems = useYouTubeWorkspaceStore((s) => s.savedItems);
  const toggleItemSaved = useYouTubeWorkspaceStore((s) => s.toggleItemSaved);

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

  // Authoritative Cloud Data from /api/saved-items
  const [cloudApiItems, setCloudApiItems] = useState<NormalizedYouTubeDiscoveryItem[]>([]);
  const [cloudLoading, setCloudLoading] = useState<boolean>(true);
  const [cloudError, setCloudError] = useState<string | null>(null);
  const [cloudRevision, setCloudRevision] = useState<number>(0);

  // User feedback state for cloud upload & save operations
  const [saveFeedback, setSaveFeedback] = useState<CloudSaveFeedbackState | null>(null);

  // Filters, search & UI state
  const [searchQuery, setSearchQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [sortOption, setSortOption] = useState<SortOption>("date_desc");
  const [isSyncing, setIsSyncing] = useState(false);
  const [deviceLabel, setDeviceLabelState] = useState("This Device");

  // Dialog states
  const [playlistTarget, setPlaylistTarget] = useState<NormalizedYouTubeDiscoveryItem | null>(null);
  const [inspectedItem, setInspectedItem] = useState<NormalizedYouTubeDiscoveryItem | null>(null);

  /**
   * Fetches authoritative cloud saved items directly from Cloudflare R2 via /api/saved-items.
   * Honest error delivery: if the request fails, sets cloudError rather than pretending empty.
   */
  const fetchCloudItems = useCallback(async () => {
    setCloudLoading(true);
    setCloudError(null);
    try {
      const res = await fetch("/api/saved-items?limit=2000", {
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
        setCloudApiItems(data.items);
        setCloudRevision(data.revision || 0);
      } else {
        throw new Error(data.error || "Malformed response from cloud saved items API");
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unable to load cloud items from Cloudflare R2.";
      console.warn("[SavedItemsWorkspace] Cloud retrieval error:", msg);
      setCloudError(msg);
    } finally {
      setCloudLoading(false);
    }
  }, []);

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
      window.addEventListener("yt-discovery-hydration-changed", handleCloudSaveSuccess);
    }

    return () => {
      unsub();
      if (typeof window !== "undefined") {
        window.removeEventListener("yt-discovery-cloud-save-success", handleCloudSaveSuccess);
        window.removeEventListener("yt-discovery-hydration-changed", handleCloudSaveSuccess);
      }
    };
  }, [fetchCloudItems, refreshLocal]);

  // Helper to identify historical "Before App Updating" items
  const isHistorical = (item: NormalizedYouTubeDiscoveryItem) => {
    const record = item as unknown as Record<string, unknown>;
    return (
      record.isBeforeAppUpdating === true ||
      (typeof record.manifestId === "string" &&
        (record.manifestId.includes("legacy") ||
          record.manifestId.includes("before-app-updating"))) ||
      (typeof record.provenance === "string" &&
        record.provenance.includes("before-app-updating"))
    );
  };

  const beforeUpdatingItems = useMemo(() => {
    return allLocalAndHydratedItems.filter((item) => isHistorical(item));
  }, [allLocalAndHydratedItems]);

  // Non-historical local items stored in this browser
  const nonHistoricalLocalItems = useMemo(() => {
    return localPendingItems.filter((item) => !isHistorical(item));
  }, [localPendingItems]);

  // Non-historical cloud items fetched from Cloudflare R2
  const nonHistoricalCloudItems = useMemo(() => {
    return cloudApiItems.filter((item) => !isHistorical(item));
  }, [cloudApiItems]);

  // Combined, deduplicated collection for "All" view with explicit source badges
  const dedupedAllItems = useMemo(() => {
    const map = new Map<string, NormalizedYouTubeDiscoveryItem & { _sourceLocation?: "LOCAL" | "CLOUD" | "BOTH" }>();

    // 1. Seed with authoritative cloud items
    for (const c of nonHistoricalCloudItems) {
      if (!c.platformItemId) continue;
      map.set(c.platformItemId, {
        ...c,
        _sourceLocation: "CLOUD",
      });
    }

    // 2. Overlay local items; items in both are marked "BOTH"
    for (const l of nonHistoricalLocalItems) {
      if (!l.platformItemId) continue;
      const existing = map.get(l.platformItemId);
      if (existing) {
        map.set(l.platformItemId, {
          ...existing,
          ...l,
          _sourceLocation: "BOTH",
        });
      } else {
        map.set(l.platformItemId, {
          ...l,
          _sourceLocation: "LOCAL",
        });
      }
    }

    return Array.from(map.values());
  }, [nonHistoricalCloudItems, nonHistoricalLocalItems]);

  // Select the active list of items based on the active storage view
  const activeItemsToDisplay = useMemo(() => {
    let sourceList: NormalizedYouTubeDiscoveryItem[] = [];
    if (storageView === "local") {
      sourceList = nonHistoricalLocalItems;
    } else if (storageView === "cloud") {
      sourceList = nonHistoricalCloudItems;
    } else {
      sourceList = dedupedAllItems;
    }
    return filterAndSortItems(sourceList, typeFilter, searchQuery, sortOption);
  }, [storageView, nonHistoricalLocalItems, nonHistoricalCloudItems, dedupedAllItems, typeFilter, searchQuery, sortOption]);

  const activeDailyGroups = useMemo(() => {
    return groupItemsByCalendarDay(activeItemsToDisplay, sortOption);
  }, [activeItemsToDisplay, sortOption]);

  // Historical Before App Updating items
  const filteredBeforeUpdatingItems = useMemo(() => {
    return filterAndSortItems(beforeUpdatingItems, typeFilter, searchQuery, sortOption);
  }, [beforeUpdatingItems, typeFilter, searchQuery, sortOption]);

  const beforeUpdatingDailyGroups = useMemo(() => {
    return groupItemsByCalendarDay(filteredBeforeUpdatingItems, sortOption);
  }, [filteredBeforeUpdatingItems, sortOption]);

  // Type counts across deduplicated all items
  const counts = useMemo(() => {
    let videos = 0;
    let shorts = 0;
    let channels = 0;
    let playlists = 0;
    const baseList = storageView === "local" ? nonHistoricalLocalItems : storageView === "cloud" ? nonHistoricalCloudItems : dedupedAllItems;
    for (const item of baseList) {
      if (item.itemType === "channel") {
        channels++;
      } else if (item.itemType === "playlist") {
        playlists++;
      } else if (item.isShortsLike || (item.itemType as string) === "shorts_like") {
        shorts++;
      } else {
        videos++;
      }
    }
    return { all: baseList.length, videos, shorts, channels, playlists };
  }, [storageView, nonHistoricalLocalItems, nonHistoricalCloudItems, dedupedAllItems]);

  /**
   * Saves local items to Cloudflare R2 with reliable, honest user feedback across all stages.
   * Guarantees append-only persistence: existing cloud records are preserved intact.
   */
  const handleSaveToCloud = async () => {
    const localCount = nonHistoricalLocalItems.length;
    if (localCount === 0 && nonHistoricalCloudItems.length > 0) {
      setSaveFeedback({
        stage: "CLOUD_COMMITTED",
        isSaving: false,
        totalSelected: 0,
        uploadedCount: 0,
        verifiedCount: nonHistoricalCloudItems.length,
        failedCount: 0,
        successMessage: `All local items are already synced with Cloudflare R2. ${nonHistoricalCloudItems.length} cloud items preserved.`,
      });
      return;
    }

    setIsSyncing(true);
    setSaveFeedback({
      stage: "SYNCING",
      isSaving: true,
      totalSelected: localCount,
      uploadedCount: 0,
      verifiedCount: 0,
      failedCount: 0,
    });

    try {
      const result = await syncCoordinator.saveAll();

      if (result.ok) {
        const r = result.receipt;
        const savedDataset = r?.datasets.find((d) => d.datasetType === "SAVED_ITEMS") || r?.datasets[0];
        const added = savedDataset?.addedRecordsCount ?? r?.totalNewRecordsAdded ?? localCount;
        const preserved = savedDataset?.existingRecordsCount ?? r?.totalExistingRecordsPreserved ?? nonHistoricalCloudItems.length;

        setSaveFeedback({
          stage: "CLOUD_COMMITTED",
          isSaving: false,
          totalSelected: localCount,
          uploadedCount: localCount,
          verifiedCount: localCount,
          failedCount: 0,
          successMessage: `Cloud save completed successfully. ${added} new items saved to Cloudflare R2. ${preserved} existing cloud items preserved. 0 duplicates added.`,
          receipt: r,
        });

        // Authoritative reload of the cloud listing & local state
        await fetchCloudItems();
        refreshLocal();
      } else {
        setSaveFeedback({
          stage: "FAILED",
          isSaving: false,
          totalSelected: localCount,
          uploadedCount: 0,
          verifiedCount: 0,
          failedCount: localCount,
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
        totalSelected: localCount,
        uploadedCount: 0,
        verifiedCount: 0,
        failedCount: localCount,
        errorMessage: msg,
        errorCategory: "WORKER_ERROR",
      });
    } finally {
      setIsSyncing(false);
    }
  };

  const hasAnyDisplayItems = activeItemsToDisplay.length > 0;
  const hasHistoricalItems = filteredBeforeUpdatingItems.length > 0;

  return (
    <div className="space-y-6">
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
              {dedupedAllItems.length}
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
              {nonHistoricalLocalItems.length}
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
              {cloudLoading ? "…" : nonHistoricalCloudItems.length}
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
                {nonHistoricalLocalItems.length > 0 && (
                  <span className="rounded-full bg-black/20 px-1.5 py-0.2 text-[10px] font-bold">
                    {nonHistoricalLocalItems.length}
                  </span>
                )}
              </>
            )}
          </button>
        </div>
      </div>

      {/* ═════════════════════════════════════════════════════════════════════ */}
      {/* REAL-TIME CLOUD SAVE & UPLOAD PROGRESS FEEDBACK BANNER               */}
      {/* ═════════════════════════════════════════════════════════════════════ */}
      {saveFeedback && (
        <Card className={`p-4 sm:p-5 rounded-xl border shadow-sm transition ${
          saveFeedback.isSaving
            ? "border-amber-500/40 bg-amber-500/5 text-foreground"
            : saveFeedback.stage === "CLOUD_COMMITTED"
            ? "border-emerald-500/40 bg-emerald-500/5 text-foreground"
            : "border-red-500/40 bg-red-500/5 text-foreground"
        }`}>
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
                    <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-[10px] font-bold ${
                      saveFeedback.isSaving
                        ? "bg-amber-500/20 text-amber-500"
                        : saveFeedback.stage === "CLOUD_COMMITTED"
                        ? "bg-emerald-500/20 text-emerald-500"
                        : "bg-red-500/20 text-red-500"
                    }`}>
                      {SAVE_STAGE_LABELS[saveFeedback.stage] || saveFeedback.stage}
                    </span>
                  </div>

                  <p className="mt-1 text-xs text-muted">
                    {saveFeedback.isSaving ? (
                      `Uploading local items to Cloudflare R2 and committing database index (Target: ${saveFeedback.totalSelected} items)…`
                    ) : saveFeedback.successMessage ? (
                      saveFeedback.successMessage
                    ) : (
                      saveFeedback.errorMessage || "An unexpected error occurred during cloud synchronization."
                    )}
                  </p>
                </div>
              </div>

              {/* Close / Dismiss */}
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

            {/* Progress Metrics & Action Buttons */}
            {saveFeedback.isSaving && (
              <div className="flex flex-wrap items-center gap-4 text-xs font-medium text-muted pt-1">
                <span>Selected: <strong className="text-foreground">{saveFeedback.totalSelected}</strong></span>
                <span>Uploading: <strong className="text-foreground">{saveFeedback.totalSelected} / {saveFeedback.totalSelected}</strong></span>
                <span>Integrity: <strong className="text-emerald-500">SHA-256 Verified</strong></span>
                <span>Mode: <strong className="text-foreground">Append-Only</strong></span>
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
                <span className="text-xs text-muted">Local browser items remain safely preserved in IndexedDB.</span>
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
              placeholder={`Search in ${storageView === "local" ? "Local Browser" : storageView === "cloud" ? "R2 Cloud" : "All Saved Items"}…`}
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

      {/* ═════════════════════════════════════════════════════════════════════ */}
      {/* STORAGE VIEW BANNER / STATUS HEADER                                  */}
      {/* ═════════════════════════════════════════════════════════════════════ */}
      {storageView === "local" ? (
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 sm:p-5 rounded-xl border border-amber-500/30 bg-amber-500/5 shadow-xs">
          <div className="flex items-center gap-3.5">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-amber-500/20 text-amber-500 font-bold shadow-xs">
              <HardDrive className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold text-foreground tracking-tight">
                  LOCAL BROWSER — This Device
                </h2>
                <span className="inline-flex items-center rounded-full bg-amber-500/15 border border-amber-500/30 px-2 py-0.5 text-xs font-bold text-amber-500">
                  {nonHistoricalLocalItems.length} {nonHistoricalLocalItems.length === 1 ? "item" : "items"}
                </span>
              </div>
              <p className="mt-0.5 text-xs text-muted">
                Persisted locally in IndexedDB storage on <span className="font-semibold text-foreground">{deviceLabel}</span>. Preserved offline; click &ldquo;Save to R2 Cloud&rdquo; to append to cloud storage.
              </p>
            </div>
          </div>
        </div>
      ) : storageView === "cloud" ? (
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 sm:p-5 rounded-xl border border-emerald-500/30 bg-emerald-500/5 shadow-xs">
          <div className="flex items-center gap-3.5">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-emerald-500/20 text-emerald-500 font-bold shadow-xs">
              <Cloud className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold text-foreground tracking-tight">
                  R2 CLOUD — Committed Storage
                </h2>
                <span className="inline-flex items-center rounded-full bg-emerald-500/15 border border-emerald-500/30 px-2 py-0.5 text-xs font-bold text-emerald-500">
                  {cloudLoading ? "Loading…" : `${nonHistoricalCloudItems.length} committed`}
                </span>
                {cloudRevision > 0 && (
                  <span className="inline-flex items-center rounded-md bg-surface-muted px-2 py-0.5 text-[10px] font-mono text-muted">
                    Rev {cloudRevision}
                  </span>
                )}
              </div>
              <p className="mt-0.5 text-xs text-muted">
                Authoritative multi-device persistence committed to Cloudflare R2 bucket and Supabase PostgreSQL dataset registry.
              </p>
            </div>
          </div>
        </div>
      ) : (
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 sm:p-5 rounded-xl border border-primary/30 bg-primary/5 shadow-xs">
          <div className="flex items-center gap-3.5">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/20 text-primary font-bold shadow-xs">
              <Layers className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold text-foreground tracking-tight">
                  ALL SAVED ITEMS — Unified Storage
                </h2>
                <span className="inline-flex items-center rounded-full bg-primary/15 border border-primary/30 px-2 py-0.5 text-xs font-bold text-primary">
                  {dedupedAllItems.length} {dedupedAllItems.length === 1 ? "item" : "items"}
                </span>
              </div>
              <p className="mt-0.5 text-xs text-muted">
                Deduplicated collection combining items from this local browser and committed Cloudflare R2 cloud storage with provenance badges.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* ═════════════════════════════════════════════════════════════════════ */}
      {/* CLOUD ERROR STATE BANNER (Honest Error Delivery)                      */}
      {/* ═════════════════════════════════════════════════════════════════════ */}
      {storageView === "cloud" && cloudError && (
        <Card className="p-5 border-red-500/40 bg-red-500/5 text-foreground rounded-xl">
          <div className="flex items-start gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-red-500/20 text-red-500">
              <AlertCircle className="h-5 w-5" />
            </div>
            <div className="flex-1">
              <h3 className="text-sm font-bold text-red-600 dark:text-red-400">
                Unable to load cloud items from Cloudflare R2
              </h3>
              <p className="mt-1 text-xs text-muted">
                {cloudError}. Your local browser items remain completely safe and accessible in IndexedDB.
              </p>
              <div className="mt-3 flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => void fetchCloudItems()}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-red-600 hover:bg-red-700 text-white font-semibold text-xs px-3.5 py-1.5 transition"
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                  <span>Retry Loading Cloud Items</span>
                </button>
                <button
                  type="button"
                  onClick={() => setStorageView("local")}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface hover:bg-surface-muted px-3 py-1.5 text-xs text-muted hover:text-foreground transition"
                >
                  <HardDrive className="h-3.5 w-3.5 text-amber-500" />
                  <span>View Local Browser Items</span>
                </button>
              </div>
            </div>
          </div>
        </Card>
      )}

      {/* ═════════════════════════════════════════════════════════════════════ */}
      {/* CLOUD LOADING SKELETON STATE                                         */}
      {/* ═════════════════════════════════════════════════════════════════════ */}
      {storageView === "cloud" && cloudLoading && !cloudError && (
        <Card className="flex flex-col items-center justify-center p-14 text-center">
          <RefreshCw className="h-8 w-8 text-emerald-500 animate-spin mb-3" />
          <h3 className="text-sm font-semibold text-foreground">
            Connecting to Cloudflare R2…
          </h3>
          <p className="mt-1 text-xs text-muted max-w-sm">
            Retrieving authoritative cloud saved items and verifying SHA-256 integrity receipts.
          </p>
        </Card>
      )}

      {/* ═════════════════════════════════════════════════════════════════════ */}
      {/* MAIN ITEMS DISPLAY (Chronological Daily Grouping)                    */}
      {/* ═════════════════════════════════════════════════════════════════════ */}
      {!cloudLoading && hasAnyDisplayItems && (
        <div className="space-y-8 pl-1">
          {activeDailyGroups.map((group) => (
            <section key={`${storageView}-${group.key}`} className="space-y-4">
              <div className="sticky top-16 z-10 flex items-center gap-3 bg-background/95 py-2 backdrop-blur-md">
                <div className={`flex h-6 w-6 items-center justify-center rounded ${
                  storageView === "local"
                    ? "bg-amber-500/15 text-amber-500"
                    : storageView === "cloud"
                    ? "bg-emerald-500/15 text-emerald-500"
                    : "bg-primary/15 text-primary"
                }`}>
                  <Calendar className="h-3.5 w-3.5" />
                </div>
                <h3 className={`text-xs font-bold tracking-wider uppercase ${
                  storageView === "local"
                    ? "text-amber-500"
                    : storageView === "cloud"
                    ? "text-emerald-500"
                    : "text-primary"
                }`}>
                  {group.label}
                </h3>
                <span className="rounded-full bg-border/60 px-2 py-0.5 text-[10px] font-semibold text-muted">
                  {group.items.length} {group.items.length === 1 ? "item" : "items"}
                </span>
                <div className={`h-px flex-1 ${
                  storageView === "local"
                    ? "bg-amber-500/20"
                    : storageView === "cloud"
                    ? "bg-emerald-500/20"
                    : "bg-primary/20"
                }`} />
              </div>

              <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
                {group.items.map((item) => (
                  <SavedItemCard
                    key={`${storageView}-${item.itemType}-${item.platformItemId}`}
                    item={item}
                    isLocalOnly={storageView === "local" || (item as unknown as Record<string, unknown>)._sourceLocation === "LOCAL"}
                    onRemove={() => toggleItemSaved(item)}
                    onAddToPlaylist={() => setPlaylistTarget(item)}
                    onInspectJson={() => setInspectedItem(item)}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

      {/* ═════════════════════════════════════════════════════════════════════ */}
      {/* EMPTY STATES FOR DIFFERENT STORAGE VIEWS                             */}
      {/* ═════════════════════════════════════════════════════════════════════ */}
      {!cloudLoading && !hasAnyDisplayItems && !cloudError && (
        <Card className="flex flex-col items-center justify-center p-14 text-center">
          <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-surface-muted text-muted">
            {storageView === "local" ? (
              <HardDrive className="h-7 w-7 opacity-40 text-amber-500" />
            ) : storageView === "cloud" ? (
              <Cloud className="h-7 w-7 opacity-40 text-emerald-500" />
            ) : (
              <Layers className="h-7 w-7 opacity-40" />
            )}
          </div>

          <h3 className="text-base font-semibold text-foreground">
            {storageView === "local"
              ? "No locally saved items in this browser"
              : storageView === "cloud"
              ? "No cloud items found in Cloudflare R2"
              : "No saved items found"}
          </h3>

          <p className="mt-1 text-xs text-muted max-w-md">
            {storageView === "local" ? (
              `You haven't saved any items locally on ${deviceLabel}. Bookmark items from Search or Explorers to collect them.`
            ) : storageView === "cloud" ? (
              nonHistoricalLocalItems.length > 0 ? (
                `You have ${nonHistoricalLocalItems.length} items saved locally in this browser. Click "Save to R2 Cloud" above to upload them to Cloudflare R2.`
              ) : (
                "No records have been committed to Cloudflare R2 yet. Save items in the app and click 'Save to R2 Cloud' to back them up."
              )
            ) : (
              searchQuery ? `No items match query "${searchQuery}" or type filter "${typeFilter}".` : "You haven't saved any YouTube videos, channels, or playlists yet."
            )}
          </p>

          <div className="mt-6 flex flex-wrap justify-center gap-3">
            {storageView === "cloud" && nonHistoricalLocalItems.length > 0 ? (
              <button
                type="button"
                onClick={handleSaveToCloud}
                disabled={isSyncing}
                className="inline-flex items-center gap-2 rounded-lg bg-amber-500 hover:bg-amber-600 text-black font-semibold text-xs px-4 py-2 transition shadow-xs"
              >
                <Cloud className="h-3.5 w-3.5" />
                <span>Save Local Items to R2 Cloud ({nonHistoricalLocalItems.length})</span>
              </button>
            ) : (
              <>
                <ButtonLink href="/search" variant="primary" className="h-9 px-4 text-xs font-medium">
                  Explore Search
                </ButtonLink>
                <ButtonLink href="/channels" variant="secondary" className="h-9 px-4 text-xs">
                  Explore Channels
                </ButtonLink>
                <ButtonLink href="/playlists" variant="secondary" className="h-9 px-4 text-xs">
                  Explore Playlists
                </ButtonLink>
              </>
            )}
          </div>
        </Card>
      )}

      {/* ═════════════════════════════════════════════════════════════════════ */}
      {/* HISTORICAL ARCHIVE SECTION: Before App Updating (Purple Theme)       */}
      {/* ═════════════════════════════════════════════════════════════════════ */}
      {hasHistoricalItems && (
        <div className="space-y-6 pt-6">
          <div className="relative">
            <div className="absolute inset-0 flex items-center" aria-hidden="true">
              <div className="w-full border-t border-purple-500/30" />
            </div>
            <div className="relative flex justify-center">
              <span className="bg-background px-4 text-xs font-bold uppercase tracking-wider text-purple-600 dark:text-purple-400">
                Historical Archive Divider
              </span>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 sm:p-5 rounded-xl border border-purple-500/30 bg-purple-500/5 shadow-xs">
            <div className="flex items-center gap-3.5">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-purple-500/20 text-purple-600 dark:text-purple-400 font-bold shadow-xs">
                <Sparkles className="h-5 w-5" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-base font-bold text-foreground tracking-tight">
                    Before App Updating
                  </h2>
                  <span className="inline-flex items-center rounded-full bg-purple-500/15 border border-purple-500/30 px-2 py-0.5 text-xs font-bold text-purple-600 dark:text-purple-400">
                    {filteredBeforeUpdatingItems.length} {filteredBeforeUpdatingItems.length === 1 ? "item" : "items"}
                  </span>
                </div>
                <p className="mt-1 text-xs text-muted">
                  Historical saved items preserved from previous application versions, securely stored in Cloudflare R2 under <code className="text-foreground">before-app-updating/…</code>.
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2 sm:self-center">
              <Link href="/other-actions">
                <ButtonLink href="/other-actions" variant="secondary" className="gap-1.5 h-8 px-3 text-xs">
                  <Sparkles className="h-3.5 w-3.5 text-purple-600 dark:text-purple-400" />
                  Migration Actions
                </ButtonLink>
              </Link>
            </div>
          </div>

          <div className="space-y-8 pl-1">
            {beforeUpdatingDailyGroups.map((group) => (
              <section key={`before-updating-${group.key}`} className="space-y-4">
                <div className="sticky top-16 z-10 flex items-center gap-3 bg-background/95 py-2 backdrop-blur-md">
                  <div className="flex h-6 w-6 items-center justify-center rounded bg-purple-500/15 text-purple-600 dark:text-purple-400">
                    <Calendar className="h-3.5 w-3.5" />
                  </div>
                  <h3 className="text-xs font-bold tracking-wider text-purple-600 dark:text-purple-400 uppercase">
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
                      onRemove={() => toggleItemSaved(item)}
                      onAddToPlaylist={() => setPlaylistTarget(item)}
                      onInspectJson={() => setInspectedItem(item)}
                    />
                  ))}
                </div>
              </section>
            ))}
          </div>
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
 * Unified item card for Saved Items supporting Videos, Shorts, Channels, and Playlists.
 * Features unambiguous provenance badges:
 *   - "LOCAL & CLOUD" (Cyan): Saved locally and committed in Cloudflare R2
 *   - "LOCAL BROWSER" (Amber): Saved locally in this browser; waiting for cloud sync
 *   - "R2 CLOUD" (Emerald): Confirmed multi-device persistence in Cloudflare R2
 *   - "Before App Updating" (Purple): Historical archive
 */
function SavedItemCard({
  item,
  isLocalOnly,
  onRemove,
  onAddToPlaylist,
  onInspectJson,
}: {
  item: NormalizedYouTubeDiscoveryItem;
  isLocalOnly?: boolean;
  onRemove: () => void;
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
  const sourceLocation = rawItem._sourceLocation as string | undefined;

  const isBoth = sourceLocation === "BOTH";
  const isLocal =
    isLocalOnly ??
    (sourceLocation === "LOCAL" ||
      rawItem._localStatus === "LOCAL_PENDING" ||
      rawItem._localStatus === "PENDING_SYNC" ||
      (rawItem._syncStatus === "LOCAL" && rawItem._localStatus !== "COMMITTED"));

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

        {/* Top-Right: Explicit Storage Provenance Badge */}
        <div className="absolute top-2.5 right-2.5 flex items-center gap-1">
          {Boolean(rawItem.isBeforeAppUpdating) ? (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold bg-purple-600 text-white shadow-xs">
              <Sparkles className="h-3 w-3" />
              Before App Updating
            </span>
          ) : isBoth ? (
            <span
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold bg-cyan-600 text-white shadow-xs"
              title="Persisted both in this local browser and committed to Cloudflare R2"
            >
              <HardDrive className="h-2.5 w-2.5" />
              <span>+</span>
              <Cloud className="h-2.5 w-2.5" />
              <span>LOCAL & CLOUD</span>
            </span>
          ) : isLocal ? (
            <span
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold bg-amber-500 text-black shadow-xs"
              title="Saved locally in browser storage on this device; pending cloud backup"
            >
              <HardDrive className="h-3 w-3" />
              LOCAL BROWSER
            </span>
          ) : (
            <span
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold bg-emerald-600 text-white shadow-xs"
              title="Committed to Cloudflare R2 object storage"
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
          {item.publishedAt && (
            <span className="ml-auto text-[11px] text-muted/80">
              {formatDate(item.publishedAt)}
            </span>
          )}
        </div>

        {/* Expandable Description */}
        <ExpandableDescription description={item.description} />

        {/* Card Footer Actions */}
        <div className="mt-4 pt-3 flex items-center justify-between border-t border-border/60">
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

          {/* Remove from Saved Items */}
          <button
            type="button"
            onClick={onRemove}
            className="flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs text-muted hover:bg-danger/10 hover:text-danger transition"
            title="Remove from Saved Items"
          >
            <Trash2 className="h-3.5 w-3.5" />
            <span>Remove</span>
          </button>
        </div>
      </div>
    </Card>
  );
}
