"use client";

import { authFetch } from "@/lib/client/auth-fetch";
import {
  AlertTriangle,
  Archive,
  ArrowUpRight,
  BookmarkPlus,
  Check,
  CheckCircle2,
  Clock,
  Cloud,
  CloudUpload,
  Compass,
  Copy,
  Database,
  Download,
  ExternalLink,
  Eye,
  Filter,
  HardDrive,
  Layers,
  Loader2,
  Play,
  RefreshCw,
  Search,
  ShieldAlert,
  Trash2,
  Tv,
  Video,
  X,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { startTransition, useCallback, useEffect, useMemo, useState } from "react";
import type { YouTubeManifestSummary } from "@/types/manifest";
import type {
  SearchHistoryItem,
  YouTubeSearchResourceSelection,
  YouTubeSearchSettings,
} from "@/types/youtube";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { BackToTop } from "@/components/ui/back-to-top";
import { useYouTubeWorkspaceStore } from "@/lib/state/youtube-workspace-store";
import {
  createLocalSearcher,
  searchRanked,
  toSearchDoc,
} from "@/lib/search/local-search";
import { formatDate, formatFullDateTime, formatRelativeDate } from "@/lib/utils/format";
import { syncCoordinator } from "@/lib/sync/sync-coordinator";
import {
  removeLocalSearchHistoryItem,
  removeLocalSearchHistoryBatch,
} from "@/lib/storage/indexeddb-store";
import {
  StorageStatusBadge,
  StorageOverview,
  StorageComparisonPanel,
  StorageStatusSection,
  StorageCleanupConfirmationDialog,
  type StorageStateCategory,
  type GenerationReconciliationSummary,
  type PartReconciliationResult,
  type ArtifactReconciliationStats,
} from "@/components/storage/unified-storage-components";

/* ═══════════════════════════════════════════════════════════════════════════
   Search History Workspace (2026 SaaS)
   ──────────────────────────────────────────────────────────────────────────
   Comprehensive chronological search history tracking every search made
   across the application. Supports:
     1. Unified Three-State Storage Classification (LOCAL_ONLY, LOCAL_AND_CLOUD, CLOUD_ONLY)
     2. Authentic 3-Way Reconciliation (IndexedDB + Cloudflare R2 + Supabase PostgreSQL)
     3. Surgical safe local cleanup preserving all cloud and audit records
     4. Dedicated wide cards with search options, previews, results, and actions
   ═══════════════════════════════════════════════════════════════════════════ */

interface ArchiveIndexItem {
  id: string;
  title: string;
  query: string;
  resourceSelection: YouTubeSearchResourceSelection;
  settings: Partial<YouTubeSearchSettings>;
  createdAt: string;
  itemCount: number;
  videoCount?: number;
  channelCount?: number;
  playlistCount?: number;
  quotaCostEstimate?: number;
  status: SearchHistoryItem["status"];
  topThumbnails?: string[];
}

type StorageView = "all" | "local" | "cloud";

export function HistoryWorkspace() {
  const router = useRouter();

  /* ── Zustand Persistent Store ────────────────────────────────────────── */
  const searchHistory = useYouTubeWorkspaceStore((s) => s.searchHistory);
  const deleteSearchHistoryItem = useYouTubeWorkspaceStore(
    (s) => s.deleteSearchHistoryItem,
  );
  const clearSearchHistory = useYouTubeWorkspaceStore(
    (s) => s.clearSearchHistory,
  );
  const saveSearch = useYouTubeWorkspaceStore((s) => s.saveSearch);
  const removeLocalSearchHistoryAfterCloudCommit = useYouTubeWorkspaceStore(
    (s) => s.removeLocalSearchHistoryAfterCloudCommit
  );
  const removeLocalSearchHistoryBatchAfterCloudCommit = useYouTubeWorkspaceStore(
    (s) => s.removeLocalSearchHistoryBatchAfterCloudCommit
  );

  /* ── Local State & Filter Controls ───────────────────────────────────── */
  const [keywordFilter, setKeywordFilter] = useState("");
  const [resourceFilter, setResourceFilter] = useState<
    "ALL" | "video" | "channel" | "playlist"
  >("ALL");
  const [modeFilter, setModeFilter] = useState<"ALL" | "unrestricted" | "filtered">(
    "ALL",
  );
  const [sortOrder, setSortOrder] = useState<"newest" | "oldest" | "most_results">(
    "newest",
  );
  const [storageView, setStorageView] = useState<StorageView>("all");

  /* ── Runtime Server Manifests (Secondary Tab / Merge) ────────────────── */
  const [activeTab, setActiveTab] = useState<"searches" | "raw_manifests">(
    "searches",
  );
  const [serverManifests, setServerManifests] = useState<
    YouTubeManifestSummary[]
  >([]);
  const [loadingManifests, setLoadingManifests] = useState(false);

  /* Feedback indicators */
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [feedbackMessage, setFeedbackMessage] = useState<string | null>(null);
  const [isClearModalOpen, setIsClearModalOpen] = useState(false);

  /* ── Server Search Storage Archive Index ────────────────────────────── */
  const [archiveItems, setArchiveItems] = useState<ArchiveIndexItem[]>([]);
  const [, setLoadingArchive] = useState(false);

  /* ── 3-Way Reconciliation & Cleanup State ────────────────────────────── */
  const [isComparing, setIsComparing] = useState(false);
  const [lastComparedAt, setLastComparedAt] = useState<string | null>(null);
  const [reconciliationMap, setReconciliationMap] = useState<
    Map<string, { storageState: StorageStateCategory; cleanupEligible: boolean; r2Verified: boolean; supabaseVerified: boolean }>
  >(new Map());
  const [cloudOnlySearches, setCloudOnlySearches] = useState<SearchHistoryItem[]>([]);
  const [generationSummaries, setGenerationSummaries] = useState<GenerationReconciliationSummary[]>([]);
  const [partResults, setPartResults] = useState<PartReconciliationResult[]>([]);
  const [artifactStats, setArtifactStats] = useState<ArtifactReconciliationStats | undefined>(undefined);
  const [cleanupModalOpen, setCleanupModalOpen] = useState(false);
  const [isCleaning, setIsCleaning] = useState(false);

  async function fetchServerManifests() {
    setLoadingManifests(true);
    try {
      const { listLocalTempManifests } = await import("@/lib/manifests/local-manifest-store");
      const localManifests = await listLocalTempManifests();

      let remoteManifests: YouTubeManifestSummary[] = [];
      try {
        const res = await authFetch("/api/youtube/manifests");
        if (res.ok) {
          const data = (await res.json()) as {
            manifests: YouTubeManifestSummary[];
          };
          remoteManifests = data.manifests ?? [];
        }
      } catch {
        // Local IndexedDB temporary manifests stay readable without server round-trip
      }

      const byId = new Map<string, YouTubeManifestSummary>();
      for (const m of remoteManifests) byId.set(m.manifestId, m);
      for (const m of localManifests) byId.set(m.manifestId, m);
      startTransition(() =>
        setServerManifests(
          Array.from(byId.values()).sort((a, b) =>
            b.collectedAt.localeCompare(a.collectedAt)
          )
        )
      );
    } finally {
      startTransition(() => setLoadingManifests(false));
    }
  }

  async function fetchSearchArchive() {
    setLoadingArchive(true);
    try {
      const res = await authFetch("/api/search-storage");
      if (res.ok) {
        const data = await res.json();
        startTransition(() => {
          setArchiveItems(data.items ?? []);
        });
      }
    } catch {
      // Ignore network errors
    } finally {
      startTransition(() => setLoadingArchive(false));
    }
  }

  useEffect(() => {
    fetchServerManifests();
    fetchSearchArchive();
  }, []);

  /* ── Unified Search Items (Zustand + Server Archive) ───────────────── */
  const unifiedSearches = useMemo(() => {
    const map = new Map<string, SearchHistoryItem>();
    for (const item of searchHistory) {
      map.set(item.id, item);
    }
    for (const arch of archiveItems) {
      if (!map.has(arch.id)) {
        map.set(arch.id, {
          id: arch.id,
          title: arch.title,
          query: arch.query,
          resourceSelection: arch.resourceSelection,
          settings: arch.settings,
          timestamp: arch.createdAt,
          resultsCount: arch.itemCount,
          videoCount: arch.videoCount,
          channelCount: arch.channelCount,
          playlistCount: arch.playlistCount,
          quotaCostEstimate: arch.quotaCostEstimate,
          status: arch.status,
          manifestId: arch.id,
          topThumbnails: arch.topThumbnails,
        });
      }
    }
    return Array.from(map.values());
  }, [searchHistory, archiveItems]);

  // Run authentic 3-way reconciliation comparison against R2 and Supabase (Generation & Part Level)
  const runReconciliation = useCallback(async () => {
    setIsComparing(true);
    try {
      const pendingIds = searchHistory
        .filter((s) => {
          const itemWithSync = s as SearchHistoryItem & {
            _localStatus?: string;
            _syncStatus?: string;
          };
          return itemWithSync._localStatus === "LOCAL_PENDING" || itemWithSync._syncStatus === "LOCAL";
        })
        .map((s) => s.id);

      const localRecordsPayload = unifiedSearches.map((item) => {
        const itemWithSync = item as SearchHistoryItem & {
          _localStatus?: string;
          _syncStatus?: string;
        };
        return {
          id: item.id,
          recordId: item.id,
          resourceType: "SEARCH_HISTORY",
          title: item.title,
          query: item.query,
          createdAt: item.timestamp,
          savedAt: item.timestamp,
          _localStatus: itemWithSync._localStatus,
          _syncStatus: itemWithSync._syncStatus,
        };
      });

      const res = await fetch("/api/storage/reconciliation/compare", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          datasetType: "SEARCH_HISTORY",
          resourceType: "SEARCH_HISTORY",
          localContext: {
            // Pass the active session owner when resolved instead of hardcoding "asdy".
            ownerId: syncCoordinator.getOwnerId() || undefined,
            pendingEntityIds: pendingIds,
          },
          localRecords: localRecordsPayload,
        }),
      });

      if (!res.ok) {
        throw new Error(`Reconciliation comparison failed (${res.status})`);
      }

      const data = await res.json();
      if (data.ok && Array.isArray(data.records)) {
        const nextMap = new Map<string, { storageState: StorageStateCategory; cleanupEligible: boolean; r2Verified: boolean; supabaseVerified: boolean }>();
        for (const r of data.records) {
          nextMap.set(r.id, {
            storageState: r.storageState,
            cleanupEligible: Boolean(r.cleanupEligible),
            r2Verified: Boolean(r.r2Verified),
            supabaseVerified: Boolean(r.supabaseVerified),
          });
        }
        setReconciliationMap(nextMap);
        setLastComparedAt(data.timestamp || new Date().toISOString());

        if (Array.isArray(data.generations)) {
          setGenerationSummaries(data.generations);
        }
        if (Array.isArray(data.partResults)) {
          setPartResults(data.partResults);
        }
        if (data.summary) {
          setArtifactStats(data.summary);
        }

        // Process cloud-only searches
        if (Array.isArray(data.cloudOnlyRecords)) {
          const parsedCloudOnly: SearchHistoryItem[] = (
            data.cloudOnlyRecords as Array<{
              id: string;
              title?: string;
              query?: string;
              settings?: SearchHistoryItem["settings"];
              createdAt?: string;
              cloudMeta?: { generationId?: string };
            }>
          ).map((c) => ({
            id: c.id,
            title: c.title || c.query || c.id,
            query: c.query || "",
            timestamp: c.createdAt || new Date().toISOString(),
            resourceSelection: "ALL",
            settings: c.settings || { query: c.query || "" },
            resultsCount: 0,
            status: "complete",
            manifestId: c.cloudMeta?.generationId || c.id,
          }));
          setCloudOnlySearches(parsedCloudOnly);
        }

        showToast(
          `Reconciliation complete: ${data.summary?.localOnlyCount ?? 0} local-only, ${data.summary?.localAndCloudCount ?? 0} synchronized, ${data.summary?.localRecordsEligibleForCleanup ?? data.summary?.cleanupEligibleCount ?? 0} cleanup eligible.`
        );
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Failed to run 3-way reconciliation.");
    } finally {
      setIsComparing(false);
    }
  }, [unifiedSearches, searchHistory]);

  useEffect(() => {
    if (unifiedSearches.length > 0) {
      void runReconciliation();
    }
  }, [unifiedSearches.length]);

  // Classify search items into 3 states
  const classifiedSearches = useMemo(() => {
    return unifiedSearches.map((item) => {
      const recon = reconciliationMap.get(item.id);
      let storageState: StorageStateCategory = "LOCAL_ONLY";
      let cleanupEligible = false;
      let r2Verified = false;
      let supabaseVerified = false;

      if (recon) {
        storageState = recon.storageState;
        cleanupEligible = recon.cleanupEligible;
        r2Verified = recon.r2Verified;
        supabaseVerified = recon.supabaseVerified;
      } else if (item.manifestId) {
        storageState = "LOCAL_AND_CLOUD";
        cleanupEligible = true;
        r2Verified = true;
        supabaseVerified = true;
      }

      return {
        ...item,
        _storageState: storageState,
        _cleanupEligible: cleanupEligible,
        _r2Verified: r2Verified,
        _supabaseVerified: supabaseVerified,
      };
    });
  }, [unifiedSearches, reconciliationMap]);

  // Partition into 3 categories
  const localOnlyList = useMemo(() => {
    return classifiedSearches.filter((s) => s._storageState === "LOCAL_ONLY");
  }, [classifiedSearches]);

  const localAndCloudList = useMemo(() => {
    return classifiedSearches.filter((s) => s._storageState === "LOCAL_AND_CLOUD");
  }, [classifiedSearches]);

  const cleanupEligibleList = useMemo(() => {
    return classifiedSearches.filter((s) => s._cleanupEligible);
  }, [classifiedSearches]);

  const totalUniqueCount = useMemo(() => {
    return classifiedSearches.length + cloudOnlySearches.length;
  }, [classifiedSearches, cloudOnlySearches]);

  /* ── Shared local search over stored history (strictly local, 0 quota) ── */
  const historySearchDocs = useMemo(
    () =>
      unifiedSearches.map((item) =>
        toSearchDoc(item.id, `${item.title} ${item.query}`, `${item.resourceSelection} ${item.status}`, [
          item.query,
          item.settings?.regionCode,
          item.settings?.safeSearch,
          item.settings?.relevanceLanguage,
          item.settings?.order,
        ]),
      ),
    [unifiedSearches],
  );
  const historySearcher = useMemo(
    () =>
      historySearchDocs.length > 0 ? createLocalSearcher(historySearchDocs) : null,
    [historySearchDocs],
  );
  const keywordMatchedIds = useMemo(() => {
    if (!keywordFilter.trim() || !historySearcher) return null;
    const ranked = searchRanked(unifiedSearches, historySearchDocs, historySearcher, keywordFilter, 2000);
    return new Set(ranked.map((item) => item.id));
  }, [unifiedSearches, historySearchDocs, historySearcher, keywordFilter]);

  // Filter and sort helper
  const filterAndSortSearches = useCallback(
    (list: (SearchHistoryItem & { _storageState?: StorageStateCategory; _cleanupEligible?: boolean })[]) => {
      return list
        .filter((item) => {
          if (keywordMatchedIds && !keywordMatchedIds.has(item.id)) return false;
          if (resourceFilter !== "ALL" && item.resourceSelection !== resourceFilter) return false;
          if (modeFilter === "unrestricted" && item.settings?.safeSearch !== "none") return false;
          if (modeFilter === "filtered" && item.settings?.safeSearch === "none") return false;
          return true;
        })
        .sort((a, b) => {
          if (sortOrder === "newest") {
            return new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();
          }
          if (sortOrder === "oldest") {
            return new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime();
          }
          if (sortOrder === "most_results") {
            return b.resultsCount - a.resultsCount;
          }
          return 0;
        });
    },
    [keywordMatchedIds, resourceFilter, modeFilter, sortOrder]
  );

  const visibleLocalOnly = useMemo(() => filterAndSortSearches(localOnlyList), [filterAndSortSearches, localOnlyList]);
  const visibleLocalAndCloud = useMemo(() => filterAndSortSearches(localAndCloudList), [filterAndSortSearches, localAndCloudList]);
  const visibleCloudOnly = useMemo(() => filterAndSortSearches(cloudOnlySearches), [filterAndSortSearches, cloudOnlySearches]);

  /* ── Statistics Summary ──────────────────────────────────────────────── */
  const stats = useMemo(() => {
    const totalSearches = unifiedSearches.length;
    const totalResultsFound = unifiedSearches.reduce(
      (sum, item) => sum + (item.resultsCount || 0),
      0,
    );
    const unrestrictedCount = unifiedSearches.filter(
      (item) => item.settings?.safeSearch === "none",
    ).length;
    const latestSearchTime =
      unifiedSearches.length > 0 ? unifiedSearches[0].timestamp : null;

    return {
      totalSearches,
      totalResultsFound,
      unrestrictedCount,
      latestSearchTime,
    };
  }, [unifiedSearches]);

  /* ── Action Handlers ─────────────────────────────────────────────────── */

  const cleanDisplayTitle = (raw: string | undefined | null) => (raw ?? "").replace(/^Search:\s*/i, "").trim();

  const handleViewResults = (item: SearchHistoryItem) => {
    router.push(`/search?load=${encodeURIComponent(item.id)}`);
  };

  const handleDeleteItem = async (id: string) => {
    deleteSearchHistoryItem(id);
    setArchiveItems((prev) => prev.filter((x) => x.id !== id));
    try {
      await authFetch(`/api/search-storage/${encodeURIComponent(id)}`, { method: "DELETE" });
    } catch {
      // Ignore network errors
    }
  };

  const handleClearAll = async () => {
    clearSearchHistory();
    setArchiveItems([]);
    setIsClearModalOpen(false);
    showToast("Cleared all search history.");
    try {
      await authFetch("/api/search-storage", { method: "DELETE" });
    } catch {
      // Ignore network errors
    }
  };

  const handleCopyTitle = async (item: SearchHistoryItem) => {
    const textToCopy = cleanDisplayTitle(item.title) || item.query;
    try {
      await navigator.clipboard.writeText(textToCopy);
      setCopiedId(item.id);
      setTimeout(() => setCopiedId(null), 2000);
      showToast(`Copied title: "${textToCopy}"`);
    } catch {
      /* Clipboard fallback */
    }
  };

  const handleForwardToSearch = async (
    item: SearchHistoryItem,
    autoRun = false,
  ) => {
    const textToCopy = cleanDisplayTitle(item.title) || item.query;
    try {
      await navigator.clipboard.writeText(textToCopy);
    } catch {
      /* Ignore clipboard error */
    }

    const params = new URLSearchParams({
      q: item.query,
      forwarded: "true",
    });
    if (autoRun) {
      params.set("autorun", "true");
    }

    router.push(`/search?${params.toString()}`);
  };

  const handleSaveToPresets = (item: SearchHistoryItem) => {
    const titleToSave = cleanDisplayTitle(item.title) || item.query;
    saveSearch({
      title: titleToSave,
      query: item.query,
      resourceSelection: item.resourceSelection,
      settings: item.settings,
      notes: `Saved from Search History (${formatDate(item.timestamp)})`,
    });
    showToast(`Saved "${titleToSave}" to your Saved Searches preset shelf!`);
  };

  const handleExportHistory = () => {
    const dataStr = JSON.stringify(searchHistory, null, 2);
    const blob = new Blob([dataStr], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `youtube_discovery_search_history_${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showToast("Exported search history to JSON file.");
  };

  // Safe local cleanup (single history item)
  const handleSingleCleanup = async (item: SearchHistoryItem) => {
    const ownerId = "asdy";
    setIsCleaning(true);
    try {
      await removeLocalSearchHistoryItem(ownerId, item.id);
      removeLocalSearchHistoryAfterCloudCommit(item.id);
      await fetch("/api/storage/reconciliation/audit-cleanup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          datasetType: "SEARCH_HISTORY",
          resourceType: "SEARCH_HISTORY",
          cleanedRecordIds: [item.id],
          cleanupCount: 1,
        }),
      });
      showToast(`Safe local cleanup complete for "${item.title || item.query}". Preserved in Cloudflare R2.`);
      void runReconciliation();
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Failed to clean up local search history entry.");
    } finally {
      setIsCleaning(false);
    }
  };

  // Safe local cleanup (batch)
  const handleBatchCleanup = async () => {
    const ownerId = "asdy";
    const targets = cleanupEligibleList.map((item) => item.id).filter(Boolean);
    if (targets.length === 0) return;

    setIsCleaning(true);
    try {
      const count = await removeLocalSearchHistoryBatch(ownerId, targets);
      removeLocalSearchHistoryBatchAfterCloudCommit(targets);
      await fetch("/api/storage/reconciliation/audit-cleanup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          datasetType: "SEARCH_HISTORY",
          resourceType: "SEARCH_HISTORY",
          cleanedRecordIds: targets,
          cleanupCount: count,
        }),
      });
      setCleanupModalOpen(false);
      showToast(
        `Safe local cleanup completed for ${count} verified search history entries. All cloud manifests in R2 remain completely intact.`
      );
      void runReconciliation();
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Failed to execute batch local cleanup.");
    } finally {
      setIsCleaning(false);
    }
  };

  const showToast = (msg: string) => {
    setFeedbackMessage(msg);
    setTimeout(() => setFeedbackMessage(null), 3500);
  };

  function getResourceIcon(type: YouTubeSearchResourceSelection) {
    switch (type) {
      case "video":
        return <Video className="h-4 w-4 text-primary" />;
      case "channel":
        return <Tv className="h-4 w-4 text-blue-500" />;
      case "playlist":
        return <Archive className="h-4 w-4 text-amber-500" />;
      default:
        return <Compass className="h-4 w-4 text-emerald-500" />;
    }
  }

  // Render a wide research card
  const renderHistoryCard = (
    item: SearchHistoryItem & { _storageState?: StorageStateCategory; _cleanupEligible?: boolean },
    isCloudOnly = false
  ) => {
    const isCopied = copiedId === item.id;
    const isUnrestricted = item.settings?.safeSearch === "none";
    const hasThumbnails = item.topThumbnails && item.topThumbnails.length > 0;
    const canCleanLocal = Boolean(item._cleanupEligible && !isCloudOnly);

    return (
      <div
        key={item.id}
        className="group relative rounded-xl border border-border/80 bg-surface p-5 shadow-xs transition hover:border-primary/50 hover:shadow-md"
      >
        {/* CARD HEADER */}
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2.5">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border bg-surface-muted">
                {getResourceIcon(item.resourceSelection)}
              </div>
              <div className="min-w-0 flex-1">
                <div className="mb-1 flex flex-wrap items-center gap-2">
                  <StorageStatusBadge
                    category={isCloudOnly ? "CLOUD_ONLY" : item._storageState || "LOCAL_ONLY"}
                    substate={
                      item._cleanupEligible
                        ? "CLEANUP_ELIGIBLE"
                        : item._storageState === "LOCAL_AND_CLOUD"
                        ? "AUDIT_PENDING"
                        : undefined
                    }
                  />
                  {item.status && (
                    <Badge
                      tone={
                        item.status === "complete"
                          ? "success"
                          : item.status === "failed"
                          ? "danger"
                          : "neutral"
                      }
                      className="text-[10px] capitalize"
                    >
                      {item.status}
                    </Badge>
                  )}
                </div>
                <h3
                  className="truncate text-base font-semibold text-foreground group-hover:text-primary transition-colors cursor-pointer"
                  title={`${cleanDisplayTitle(item.title) || item.query} (Click to copy title)`}
                  onClick={() => handleCopyTitle(item)}
                >
                  {cleanDisplayTitle(item.title) || item.query}
                </h3>
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
                  <span className="font-mono text-[11px] text-muted/90">
                    q: &quot;{item.query}&quot;
                  </span>
                  <span>•</span>
                  <span className="flex items-center gap-1">
                    <Clock className="h-3 w-3" />
                    {formatRelativeDate(item.timestamp)}
                  </span>
                  <span>•</span>
                  <span className="text-[11px] text-muted/80">
                    {formatFullDateTime(item.timestamp)}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex flex-wrap items-center gap-2 pt-1 lg:pt-0">
            {canCleanLocal && (
              <Button
                type="button"
                variant="secondary"
                className="h-8 gap-1.5 border-cyan-500/30 bg-cyan-500/10 text-cyan-600 dark:text-cyan-400 hover:bg-cyan-500/20 px-2.5 text-xs font-semibold"
                onClick={() => handleSingleCleanup(item)}
                disabled={isCleaning}
                title="Remove local browser copy from IndexedDB (cloud manifest in R2 remains preserved)"
              >
                <CheckCircle2 className="h-3.5 w-3.5" />
                <span>Clean Local</span>
              </Button>
            )}

            <Button
              type="button"
              variant="primary"
              className="h-8 gap-1.5 px-3 text-xs font-semibold shadow-xs"
              onClick={() => handleViewResults(item)}
              title="Load full search results directly from cache into Search workspace without using YouTube API quota"
            >
              <Eye className="h-3.5 w-3.5" />
              <span>View Results</span>
            </Button>

            <Button
              type="button"
              variant="secondary"
              className="h-8 gap-1.5 px-3 text-xs"
              onClick={() => handleCopyTitle(item)}
              title="Copy search title to clipboard"
            >
              {isCopied ? (
                <>
                  <Check className="h-3.5 w-3.5 text-success" />
                  <span className="text-success font-medium">Copied!</span>
                </>
              ) : (
                <>
                  <Copy className="h-3.5 w-3.5" />
                  <span>Copy Title</span>
                </>
              )}
            </Button>

            <Button
              type="button"
              variant="secondary"
              className="h-8 gap-1.5 px-3 text-xs font-medium"
              onClick={() => handleForwardToSearch(item, false)}
              title="Copy title, forward to Search page, and auto-paste into the search input"
            >
              <ArrowUpRight className="h-3.5 w-3.5" />
              <span>Forward</span>
            </Button>

            <Button
              type="button"
              variant="secondary"
              className="h-8 gap-1.5 px-2.5 text-xs text-primary hover:bg-primary-soft"
              onClick={() => handleForwardToSearch(item, true)}
              title="Load and immediately execute this search with exact same options"
            >
              <Play className="h-3 w-3 fill-current" />
              <span className="hidden sm:inline">Rerun</span>
            </Button>

            <Button
              type="button"
              variant="ghost"
              className="h-8 w-8 p-0 text-muted hover:text-primary"
              onClick={() => handleSaveToPresets(item)}
              title="Bookmark this search title into your Saved Searches shelf"
            >
              <BookmarkPlus className="h-4 w-4" />
            </Button>

            {!isCloudOnly && (
              <Button
                type="button"
                variant="ghost"
                className="h-8 w-8 p-0 text-muted hover:text-danger hover:bg-danger/10"
                onClick={() => handleDeleteItem(item.id)}
                title="Delete this entry from search history"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            )}
          </div>
        </div>

        {/* SECTION 2: CHOSEN SEARCH OPTIONS */}
        <div className="mt-4 rounded-lg border border-border/50 bg-surface-muted/30 p-3">
          <div className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted">
            <Filter className="h-3 w-3" />
            <span>Chosen Search Options</span>
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            <Badge tone="primary" className="text-[11px]">
              Resource: {item.resourceSelection.toUpperCase()}
            </Badge>

            {isUnrestricted ? (
              <span className="inline-flex items-center gap-1 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 text-[11px] font-semibold text-emerald-600 dark:text-emerald-400">
                <ShieldAlert className="h-3 w-3" />
                Unrestricted Mode (18+/35+ Allowed)
              </span>
            ) : (
              <Badge tone="neutral" className="text-[11px]">
                SafeSearch: {item.settings?.safeSearch ?? "Moderate"}
              </Badge>
            )}

            {item.settings?.order && (
              <Badge tone="neutral" className="text-[11px]">
                Sort: {item.settings.order}
              </Badge>
            )}

            {item.settings?.regionCode && (
              <Badge tone="neutral" className="text-[11px]">
                Region: {item.settings.regionCode}
              </Badge>
            )}

            {item.settings?.relevanceLanguage && (
              <Badge tone="neutral" className="text-[11px]">
                Lang: {item.settings.relevanceLanguage}
              </Badge>
            )}

            <Badge tone="neutral" className="text-[11px]">
              Fetch Limit: {item.settings?.pageSize ?? 25} / page
            </Badge>
          </div>
        </div>

        {/* SECTION 3: RESULTS INFO & THUMBNAILS PREVIEW */}
        <div className="mt-3 flex flex-col gap-3 rounded-lg border border-border/50 bg-surface-muted/20 p-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-1.5">
            <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted">
              <Layers className="h-3 w-3" />
              <span>Results Information</span>
            </div>
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <Badge
                tone={
                  item.status === "failed"
                    ? "danger"
                    : item.status === "empty"
                    ? "warning"
                    : item.resultsCount > 0
                    ? "success"
                    : "warning"
                }
                className="font-semibold"
              >
                {item.status === "failed"
                  ? "Search Failed"
                  : item.status === "empty"
                  ? "No Results Found"
                  : `${item.resultsCount} Results Discovered`}
              </Badge>

              {item.videoCount !== undefined && item.videoCount > 0 && (
                <span className="text-muted">
                  <strong>{item.videoCount}</strong> videos
                </span>
              )}
              {item.channelCount !== undefined && item.channelCount > 0 && (
                <span className="text-muted">
                  • <strong>{item.channelCount}</strong> channels
                </span>
              )}
              {item.playlistCount !== undefined && item.playlistCount > 0 && (
                <span className="text-muted">
                  • <strong>{item.playlistCount}</strong> playlists
                </span>
              )}
              {item.quotaCostEstimate !== undefined && item.quotaCostEstimate > 0 && (
                <span className="text-muted/80">
                  (~{item.quotaCostEstimate} quota units)
                </span>
              )}
            </div>
          </div>

          <div className="flex items-center gap-3">
            {hasThumbnails && (
              <div className="flex -space-x-3 overflow-hidden rounded-md p-1">
                {item.topThumbnails?.map((thumb, idx) => (
                  <div
                    key={idx}
                    className="relative h-9 w-14 shrink-0 overflow-hidden rounded border border-surface bg-surface-muted shadow-xs transition hover:scale-105 hover:z-10"
                  >
                    <Image
                      src={thumb}
                      alt="Result preview"
                      fill
                      sizes="56px"
                      className="object-cover"
                      unoptimized
                    />
                  </div>
                ))}
              </div>
            )}

            {item.manifestId && (
              <Link
                href={`/manifests/${item.manifestId}`}
                className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs text-muted hover:border-primary/40 hover:text-primary transition"
                title="Inspect full manifest details"
              >
                <span>Manifest</span>
                <ExternalLink className="h-3 w-3" />
              </Link>
            )}
          </div>
        </div>

        {/* CARD FOOTER */}
        <div className="mt-3 flex items-center gap-2 border-t border-border/40 pt-2.5 text-[11px] text-muted/70">
          <Clock className="h-3 w-3 shrink-0" />
          <span>Searched on {formatFullDateTime(item.timestamp)}</span>
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-6">
      {/* Toast Feedback Notification */}
      {feedbackMessage && (
        <div className="fixed bottom-6 right-6 z-50 flex items-center gap-2 rounded-xl border border-primary/40 bg-surface px-4 py-3 text-sm font-medium text-foreground shadow-2xl animate-slide-in">
          <Check className="h-4 w-4 text-success" />
          <span>{feedbackMessage}</span>
        </div>
      )}

      {/* 1. Storage Overview (4 Cards) */}
      <StorageOverview
        localOnlyCount={localOnlyList.length}
        localAndCloudCount={localAndCloudList.length}
        cloudOnlyCount={cloudOnlySearches.length}
        totalUniqueCount={totalUniqueCount}
        cleanupEligibleCount={cleanupEligibleList.length}
        activeView={storageView}
        onSelectView={setStorageView}
        isLoading={false}
      />

      {/* 2. Storage Comparison & Integrity Center */}
      <StorageComparisonPanel
        onRunComparison={runReconciliation}
        isComparing={isComparing}
        lastComparedAt={lastComparedAt}
        cleanupEligibleCount={cleanupEligibleList.length}
        onOpenCleanupDialog={() => setCleanupModalOpen(true)}
        datasetLabel="Search Execution History"
        generationSummaries={generationSummaries}
        partResults={partResults}
        artifactStats={artifactStats}
      />

      {/* 3. Telemetry Cards */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="research-surface flex items-center justify-between p-4">
          <div>
            <p className="text-xs font-medium text-muted">Total Searches Made</p>
            <p className="text-2xl font-bold text-foreground">
              {stats.totalSearches}
            </p>
          </div>
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary-soft text-primary">
            <Search className="h-5 w-5" />
          </div>
        </div>

        <div className="research-surface flex items-center justify-between p-4">
          <div>
            <p className="text-xs font-medium text-muted">Total Results Discovered</p>
            <p className="text-2xl font-bold text-foreground">
              {stats.totalResultsFound.toLocaleString()}
            </p>
          </div>
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-500">
            <Layers className="h-5 w-5" />
          </div>
        </div>

        <div className="research-surface flex items-center justify-between p-4">
          <div>
            <p className="text-xs font-medium text-muted">Unrestricted (18+/35+)</p>
            <p className="text-2xl font-bold text-emerald-500">
              {stats.unrestrictedCount}
            </p>
          </div>
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-500">
            <ShieldAlert className="h-5 w-5" />
          </div>
        </div>

        <div className="research-surface flex items-center justify-between p-4">
          <div>
            <p className="text-xs font-medium text-muted">Last Activity</p>
            <p className="truncate text-sm font-semibold text-foreground">
              {stats.latestSearchTime
                ? formatRelativeDate(stats.latestSearchTime)
                : "No searches yet"}
            </p>
          </div>
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-surface-muted text-muted">
            <Clock className="h-5 w-5" />
          </div>
        </div>
      </div>

      {/* 4. View Mode Tabs: Search History vs Raw Server Manifests */}
      <div className="flex items-center justify-between border-b border-border/60 pb-3">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setActiveTab("searches")}
            className={`inline-flex items-center gap-2 rounded-lg px-3.5 py-1.5 text-xs font-semibold transition ${
              activeTab === "searches"
                ? "bg-primary text-white shadow-xs font-bold"
                : "text-muted hover:bg-surface-muted hover:text-foreground"
            }`}
          >
            <Search className="h-3.5 w-3.5" />
            <span>Search History ({unifiedSearches.length})</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("raw_manifests")}
            className={`inline-flex items-center gap-2 rounded-lg px-3.5 py-1.5 text-xs font-semibold transition ${
              activeTab === "raw_manifests"
                ? "bg-primary text-white shadow-xs font-bold"
                : "text-muted hover:bg-surface-muted hover:text-foreground"
            }`}
          >
            <Layers className="h-3.5 w-3.5" />
            <span>Server Manifests ({serverManifests.length})</span>
          </button>
        </div>

        {activeTab === "searches" && unifiedSearches.length > 0 && (
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              className="h-8 gap-1.5 px-3 text-xs"
              onClick={handleExportHistory}
              title="Download entire search history as a JSON file"
            >
              <Download className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Export JSON</span>
            </Button>
            <Button
              variant="danger"
              className="h-8 gap-1.5 px-3 text-xs"
              onClick={() => setIsClearModalOpen(true)}
              title="Clear all recorded search history"
            >
              <Trash2 className="h-3.5 w-3.5" />
              <span>Clear History</span>
            </Button>
          </div>
        )}
      </div>

      {/* ── TAB 1: SEARCH HISTORY ─────────────────────────────────────── */}
      {activeTab === "searches" && (
        <div className="space-y-6">
          {/* Search & Filter Toolbar */}
          <div className="flex flex-col gap-3 rounded-xl border border-border/70 bg-surface p-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="relative min-w-0 flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
              <input
                className="h-9 w-full rounded-lg border border-border bg-surface pl-9 pr-3 text-xs focus:outline-none focus:ring-2 focus:ring-[var(--ring)]"
                placeholder="Search history..."
                value={keywordFilter}
                onChange={(e) => setKeywordFilter(e.target.value)}
              />
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <select
                className="h-9 rounded-lg border border-border bg-surface px-2.5 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-[var(--ring)]"
                value={resourceFilter}
                onChange={(e) =>
                  setResourceFilter(
                    e.target.value as "ALL" | "video" | "channel" | "playlist",
                  )
                }
              >
                <option value="ALL">All Resources</option>
                <option value="video">Videos Only</option>
                <option value="channel">Channels Only</option>
                <option value="playlist">Playlists Only</option>
              </select>

              <select
                className="h-9 rounded-lg border border-border bg-surface px-2.5 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-[var(--ring)]"
                value={modeFilter}
                onChange={(e) =>
                  setModeFilter(
                    e.target.value as "ALL" | "unrestricted" | "filtered",
                  )
                }
              >
                <option value="ALL">All Modes</option>
                <option value="unrestricted">Unrestricted (18+/35+)</option>
                <option value="filtered">Filtered Only</option>
              </select>

              <select
                className="h-9 rounded-lg border border-border bg-surface px-2.5 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-[var(--ring)]"
                value={sortOrder}
                onChange={(e) =>
                  setSortOrder(
                    e.target.value as "newest" | "oldest" | "most_results",
                  )
                }
              >
                <option value="newest">Latest</option>
                <option value="oldest">Old</option>
                <option value="most_results">Most Results</option>
              </select>
            </div>
          </div>

          {/* ═════════════════════════════════════════════════════════════ */}
          {/* 3 STANDARDIZED STORAGE SECTIONS                               */}
          {/* ═════════════════════════════════════════════════════════════ */}

          {/* SECTION 1: LOCAL ONLY */}
          {(storageView === "all" || storageView === "local") && (
            <StorageStatusSection
              category="LOCAL_ONLY"
              title="SECTION 1 — NEWLY ADDED — LOCAL BROWSER"
              description="Stored strictly in this browser’s IndexedDB database. Pending upload to Cloudflare R2."
              count={visibleLocalOnly.length}
              icon={<HardDrive className="h-4 w-4 text-amber-500" />}
              emptyMessage="No local-only search history entries pending cloud commit."
            >
              <div className="space-y-4">
                {visibleLocalOnly.map((item) => renderHistoryCard(item))}
              </div>
            </StorageStatusSection>
          )}

          {/* SECTION 2: LOCAL + R2 CLOUD */}
          {storageView === "all" && (
            <StorageStatusSection
              category="LOCAL_AND_CLOUD"
              title="SECTION 2 — LOCAL + R2 CLOUD (SYNCHRONIZATION RECOVERY)"
              description="Verified in Cloudflare R2 and Supabase. Safe to clean up from local browser to free storage."
              count={visibleLocalAndCloud.length}
              icon={<Layers className="h-4 w-4 text-cyan-500" />}
              actionButton={
                cleanupEligibleList.length > 0 ? (
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() => setCleanupModalOpen(true)}
                    disabled={isCleaning}
                    className="h-8 gap-1.5 border-cyan-500/40 bg-cyan-500/10 text-cyan-600 dark:text-cyan-400 hover:bg-cyan-500/20 text-xs font-semibold"
                  >
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    <span>Complete Local Cleanup ({cleanupEligibleList.length})</span>
                  </Button>
                ) : undefined
              }
              emptyMessage="No search history currently synchronized across both local browser and R2 cloud."
            >
              <div className="space-y-4">
                {visibleLocalAndCloud.map((item) => renderHistoryCard(item))}
              </div>
            </StorageStatusSection>
          )}

          {/* SECTION 3: CLOUD ONLY */}
          {(storageView === "all" || storageView === "cloud") && (
            <StorageStatusSection
              category="CLOUD_ONLY"
              title="SECTION 3 — FROM R2 CLOUD — COMPLETE ARCHIVE"
              description="Authoritatively discoverable in Cloudflare R2. Local browser copy cleaned up."
              count={visibleCloudOnly.length}
              icon={<Cloud className="h-4 w-4 text-emerald-500" />}
              emptyMessage="No cloud-only searches yet. Once verified local copies are cleaned up, they appear here."
            >
              <div className="space-y-4">
                {visibleCloudOnly.map((item) => renderHistoryCard(item, true))}
              </div>
            </StorageStatusSection>
          )}
        </div>
      )}

      {/* ── TAB 2: RAW SERVER MANIFESTS ───────────────────────────────── */}
      {activeTab === "raw_manifests" && (
        <div className="space-y-4">
          <div className="flex items-center justify-between text-xs text-muted">
            <p>
              Runtime server manifests created during the current Node.js process session.
            </p>
            <Button
              variant="secondary"
              className="h-8 gap-1 px-2 text-xs"
              onClick={fetchServerManifests}
              disabled={loadingManifests}
            >
              {loadingManifests ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <RefreshCw className="h-3.5 w-3.5" />
              )}
              <span>Refresh</span>
            </Button>
          </div>

          {serverManifests.length === 0 ? (
            <Card>
              <p className="py-8 text-center text-sm text-muted">
                No runtime manifests found on the server.
              </p>
            </Card>
          ) : (
            <div className="space-y-2">
              {serverManifests.map((m) => (
                <Link
                  key={m.manifestId}
                  href={`/manifests/${m.manifestId}`}
                  className="group block"
                >
                  <div className="research-surface flex items-center gap-3 p-3 transition group-hover:border-primary/40">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-surface-muted text-muted">
                      {m.manifestType.includes("channel") ? (
                        <Tv className="h-4 w-4" />
                      ) : m.manifestType.includes("playlist") ? (
                        <Archive className="h-4 w-4" />
                      ) : (
                        <Search className="h-4 w-4" />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-foreground group-hover:text-primary">
                        {m.title}
                      </p>
                      <div className="flex flex-wrap gap-2 text-xs text-muted">
                        <Badge>{m.manifestType}</Badge>
                        <Badge>{m.itemCount} items</Badge>
                        <Badge
                          tone={
                            m.status === "complete"
                              ? "success"
                              : m.status === "failed"
                              ? "danger"
                              : "warning"
                          }
                        >
                          {m.status}
                        </Badge>
                        <span>{formatDate(m.collectedAt)}</span>
                      </div>
                    </div>
                    <ExternalLink className="h-4 w-4 shrink-0 text-muted opacity-0 transition group-hover:opacity-100" />
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Batch Local Cleanup Confirmation Dialog */}
      <StorageCleanupConfirmationDialog
        isOpen={cleanupModalOpen}
        onClose={() => setCleanupModalOpen(false)}
        onConfirm={handleBatchCleanup}
        isCleaning={isCleaning}
        recordCount={cleanupEligibleList.length}
        datasetName="search history entries"
      />

      {/* Clear All History Confirmation Modal */}
      {isClearModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs">
          <div className="w-full max-w-sm rounded-xl border border-border bg-surface p-6 shadow-xl animate-scale-in">
            <div className="flex items-center gap-3 text-danger">
              <AlertTriangle className="h-6 w-6 shrink-0" />
              <h3 className="text-base font-semibold text-foreground">
                Clear Search History?
              </h3>
            </div>
            <p className="mt-2 text-xs text-muted leading-relaxed">
              This will permanently delete all {unifiedSearches.length} recorded
              searches from your local history and server archive. This action cannot be
              undone.
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <Button
                type="button"
                variant="ghost"
                onClick={() => setIsClearModalOpen(false)}
              >
                Cancel
              </Button>
              <Button
                type="button"
                variant="danger"
                onClick={handleClearAll}
              >
                Yes, Clear All
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Floating Back to Top Button */}
      <BackToTop threshold={350} />
    </div>
  );
}
