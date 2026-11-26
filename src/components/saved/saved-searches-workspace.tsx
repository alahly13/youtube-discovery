"use client";

import {
  Bookmark,
  Check,
  CheckCircle2,
  Clock,
  Cloud,
  CloudUpload,
  Copy,
  Database,
  HardDrive,
  Layers,
  Loader2,
  Pencil,
  Play,
  RefreshCw,
  Search,
  Star,
  Trash2,
  X,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useYouTubeWorkspaceStore } from "@/lib/state/youtube-workspace-store";
import { useMergedDataset } from "@/lib/storage/use-merged-dataset";
import { authFetch } from "@/lib/client/auth-fetch";
import { classifyResourceRecord } from "@/lib/resources/resource-taxonomy";
import { syncCoordinator } from "@/lib/sync/sync-coordinator";
import {
  uploadDatasetToCloudWithVerifiedCleanup,
  type CloudUploadFeedbackState,
} from "@/lib/sync/verified-cloud-upload";
import { CloudUploadFeedbackBanner } from "@/components/storage/cloud-upload-banner";
import {
  removeLocalSavedSearch,
  removeLocalSavedSearchesBatch,
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
import { Badge } from "@/components/ui/badge";
import { Button, ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { UndoRedoControls } from "@/components/ui/undo-redo-controls";
import { formatDate } from "@/lib/utils/format";
import type { SavedSearch } from "@/types/youtube";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * Saved Searches Workspace — /saved-searches (2026 SaaS)
 * ──────────────────────────────────────────────────────────────────────────
 * Scope: Unified three-state storage classification, authentic 3-way
 *        reconciliation (IndexedDB + Cloudflare R2 + Supabase PostgreSQL),
 *        and surgical safe local cleanup for SAVED_SEARCH presets.
 *
 * Distinct Persistence States:
 *   1. LOCAL_ONLY: Staged in browser IndexedDB; awaiting cloud commit.
 *   2. LOCAL_AND_CLOUD: Confirmed in Cloudflare R2 / Supabase; safe to clean up.
 *   3. CLOUD_ONLY: Authoritative in R2 / Supabase; local browser copy cleaned up.
 * ═══════════════════════════════════════════════════════════════════════════
 */

function isSavedSearchRecord(record: Record<string, unknown>): boolean {
  const cls = classifyResourceRecord(record, { datasetType: "REFERENCES" });
  if (cls.resourceType === "SAVED_SEARCH") return true;
  return (
    cls.resourceType === "UNKNOWN" &&
    typeof record.query === "string" &&
    typeof record.url !== "string"
  );
}

type StorageView = "all" | "local" | "cloud";

export function SavedSearchesWorkspace() {
  const storeSavedSearches = useYouTubeWorkspaceStore((s) => s.savedSearches);
  const updateSavedSearch = useYouTubeWorkspaceStore((s) => s.updateSavedSearch);
  const deleteSavedSearch = useYouTubeWorkspaceStore((s) => s.deleteSavedSearch);
  const togglePinSavedSearch = useYouTubeWorkspaceStore((s) => s.togglePinSavedSearch);
  const removeLocalSavedSearchAfterCloudCommit = useYouTubeWorkspaceStore(
    (s) => s.removeLocalSavedSearchAfterCloudCommit
  );
  const removeLocalSavedSearchesBatchAfterCloudCommit = useYouTubeWorkspaceStore(
    (s) => s.removeLocalSavedSearchesBatchAfterCloudCommit
  );

  // Authoritative R2 Cloud + PostgreSQL presets (`SAVED_SEARCH` strictly isolated from SAVED_TITLE/SAVED_LINK)
  const [cloudSearchPresets, setCloudSearchPresets] = useState<Array<SavedSearch & Record<string, unknown>>>([]);
  const [uploadFeedback, setUploadFeedback] = useState<CloudUploadFeedbackState | null>(null);

  const { items: mergedRefs, pendingCount, isLoading: isDatasetLoading, refresh } = useMergedDataset<
    SavedSearch & Record<string, unknown>
  >("REFERENCES", cloudSearchPresets);

  const fetchCloudSearches = useCallback(async () => {
    try {
      const res = await authFetch("/api/references?kind=searches");
      if (!res.ok) return;
      const data = (await res.json()) as { items?: Array<SavedSearch & Record<string, unknown>> };
      if (Array.isArray(data.items)) {
        setCloudSearchPresets(data.items);
      }
    } catch {
      // Keep local view resilient on offline/auth race
    }
  }, []);

  useEffect(() => {
    void fetchCloudSearches();
  }, [fetchCloudSearches]);

  // Strictly track local browser `SAVED_SEARCH` items (IndexedDB `REFERENCES` + unbridged Zustand)
  const savedSearches = useMemo(() => {
    const map = new Map<string, SavedSearch & Record<string, unknown>>();
    for (const item of mergedRefs) {
      const tagged = item as SavedSearch & {
        _sourceLocation?: string;
        _localStatus?: string;
      };
      if (
        (tagged._sourceLocation === "LOCAL" ||
          tagged._sourceLocation === "BOTH" ||
          tagged._localStatus === "LOCAL_PENDING") &&
        isSavedSearchRecord(item as unknown as Record<string, unknown>)
      ) {
        map.set(item.id, item);
      }
    }
    for (const s of storeSavedSearches) {
      if (!map.has(s.id)) {
        map.set(s.id, {
          ...s,
          recordId: s.id,
          resourceType: "SAVED_SEARCH",
          resourceId: s.id,
        });
      }
    }
    return Array.from(map.values());
  }, [mergedRefs, storeSavedSearches]);

  const [query, setQuery] = useState("");
  const [storageView, setStorageView] = useState<StorageView>("all");
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [editing, setEditing] = useState<{
    id: string;
    title: string;
    query: string;
    notes: string;
  } | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncNotice, setSyncNotice] = useState<string | null>(null);

  // Reconciliation state
  const [isComparing, setIsComparing] = useState(false);
  const [lastComparedAt, setLastComparedAt] = useState<string | null>(null);
  const [reconciliationMap, setReconciliationMap] = useState<
    Map<string, { storageState: StorageStateCategory; cleanupEligible: boolean; r2Verified: boolean; supabaseVerified: boolean }>
  >(new Map());
  const [reconciledCloudOnlySearches, setReconciledCloudOnlySearches] = useState<SavedSearch[]>([]);
  const [generationSummaries, setGenerationSummaries] = useState<GenerationReconciliationSummary[]>([]);
  const [partResults, setPartResults] = useState<PartReconciliationResult[]>([]);
  const [artifactStats, setArtifactStats] = useState<ArtifactReconciliationStats | undefined>(undefined);

  // Cleanup confirmation state
  const [cleanupModalOpen, setCleanupModalOpen] = useState(false);
  const [isCleaning, setIsCleaning] = useState(false);

  // Run authentic 3-way reconciliation comparison against R2 and Supabase (Generation & Part Level)
  const runReconciliation = useCallback(async () => {
    setIsComparing(true);
    setSyncNotice(null);
    try {
      const pendingIds = savedSearches
        .filter((s) => {
          const withMeta = s as SavedSearch & {
            _localStatus?: string;
            _syncStatus?: string;
          };
          return withMeta._localStatus === "LOCAL_PENDING" || withMeta._syncStatus === "LOCAL";
        })
        .map((s) => s.id);

      const localRecordsPayload = savedSearches.map((s) => {
        const withMeta = s as SavedSearch & {
          recordId?: string;
          _localStatus?: string;
          _syncStatus?: string;
        };
        return {
          id: s.id,
          recordId: withMeta.recordId || s.id,
          resourceType: "SAVED_SEARCH",
          title: s.title,
          query: s.query,
          notes: s.notes,
          createdAt: s.createdAt,
          _localStatus: withMeta._localStatus,
          _syncStatus: withMeta._syncStatus,
        };
      });

      const res = await fetch("/api/storage/reconciliation/compare", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          datasetType: "REFERENCES",
          resourceType: "SAVED_SEARCH",
          localContext: {
            // Always resolve the authenticated session owner dynamically; never pin to "asdy".
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

        // Process cloud-only searches strictly filtered to SAVED_SEARCH
        if (Array.isArray(data.cloudOnlyRecords)) {
          const parsedCloudOnly: SavedSearch[] = (
            data.cloudOnlyRecords as Array<{
              id: string;
              resourceType?: string;
              title?: string;
              query?: string;
              resourceSelection?: unknown;
              settings?: SavedSearch["settings"];
              notes?: string;
              createdAt?: string;
              isPinned?: boolean;
            }>
          )
            .filter((c) => !c.resourceType || c.resourceType === "SAVED_SEARCH")
            .map((c) => ({
              id: c.id,
              title: c.title || c.query || c.id,
              query: c.query || "",
              resourceSelection:
                typeof c.resourceSelection === "string"
                  ? (c.resourceSelection as SavedSearch["resourceSelection"])
                  : "ALL",
              settings: c.settings || { query: c.query || "" },
              notes: c.notes,
              createdAt: c.createdAt || new Date().toISOString(),
              isPinned: Boolean(c.isPinned),
              _storageState: "CLOUD_ONLY",
            }));
          setReconciledCloudOnlySearches(parsedCloudOnly);
        }

        setSyncNotice(
          `Reconciliation complete: ${data.summary?.localOnlyCount ?? 0} local-only, ${data.summary?.localAndCloudCount ?? 0} synchronized, ${data.summary?.localRecordsEligibleForCleanup ?? data.summary?.cleanupEligibleCount ?? 0} cleanup eligible.`
        );
      }
    } catch (err) {
      setSyncNotice(err instanceof Error ? err.message : "Failed to run 3-way reconciliation.");
    } finally {
      setIsComparing(false);
    }
  }, [savedSearches]);

  // Combine authoritative CLOUD_ONLY Saved Searches across R2 reconciler + /api/references?kind=searches
  const cloudOnlySearches = useMemo(() => {
    const localIdSet = new Set(savedSearches.map((s) => s.id));
    const byId = new Map<string, SavedSearch>();

    for (const s of reconciledCloudOnlySearches) {
      if (s.id && !localIdSet.has(s.id)) {
        byId.set(s.id, s);
      }
    }
    for (const s of cloudSearchPresets) {
      if (s.id && !localIdSet.has(s.id)) {
        byId.set(s.id, {
          ...(byId.get(s.id) ?? {}),
          ...s,
          query: s.query || "",
          resourceSelection:
            typeof s.resourceSelection === "string"
              ? (s.resourceSelection as SavedSearch["resourceSelection"])
              : "ALL",
          settings: s.settings || { query: s.query || "" },
          _storageState: "CLOUD_ONLY",
        } as SavedSearch);
      }
    }
    return Array.from(byId.values());
  }, [savedSearches, reconciledCloudOnlySearches, cloudSearchPresets]);

  // Run reconciliation automatically on mount
  useEffect(() => {
    void runReconciliation();
  }, [savedSearches.length]);

  // Listen for local mutations & verified cloud-commit cleanup events
  useEffect(() => {
    const handleMutation = () => {
      refresh();
    };
    const handleCloudCommit = () => {
      void fetchCloudSearches();
      refresh();
      void runReconciliation();
    };
    window.addEventListener("yt-discovery-local-mutation", handleMutation);
    window.addEventListener("yt-discovery-cloud-save-success", handleCloudCommit);
    window.addEventListener("yt-discovery-cloud-committed-cleanup", handleCloudCommit);
    window.addEventListener("yt-discovery-hydration-changed", handleCloudCommit);
    return () => {
      window.removeEventListener("yt-discovery-local-mutation", handleMutation);
      window.removeEventListener("yt-discovery-cloud-save-success", handleCloudCommit);
      window.removeEventListener("yt-discovery-cloud-committed-cleanup", handleCloudCommit);
      window.removeEventListener("yt-discovery-hydration-changed", handleCloudCommit);
    };
  }, [fetchCloudSearches, refresh, runReconciliation]);

  // Classify local searches into 3 states
  const classifiedSearches = useMemo(() => {
    return savedSearches.map((s) => {
      const id = s.id;
      const recon = reconciliationMap.get(id);
      const sMeta = s as SavedSearch & {
        _localStatus?: string;
        _syncStatus?: string;
      };
      const isPending =
        sMeta._localStatus === "LOCAL_PENDING" || sMeta._syncStatus === "LOCAL";

      let storageState: StorageStateCategory = "LOCAL_ONLY";
      let cleanupEligible = false;
      let r2Verified = false;
      let supabaseVerified = false;

      if (recon) {
        storageState = isPending ? "LOCAL_ONLY" : recon.storageState;
        cleanupEligible = !isPending && recon.cleanupEligible;
        r2Verified = recon.r2Verified;
        supabaseVerified = recon.supabaseVerified;
      } else if (!isPending && sMeta._localStatus === "COMMITTED") {
        storageState = "LOCAL_AND_CLOUD";
        cleanupEligible = true;
        r2Verified = true;
        supabaseVerified = true;
      }

      return {
        ...s,
        _storageState: storageState,
        _cleanupEligible: cleanupEligible,
        _r2Verified: r2Verified,
        _supabaseVerified: supabaseVerified,
      };
    });
  }, [savedSearches, reconciliationMap]);

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

  // Filter and sort helper
  const filterAndSortSearches = useCallback(
    (list: SavedSearch[]) => {
      const sorted = [...list].sort((a, b) => {
        if (a.isPinned && !b.isPinned) return -1;
        if (!a.isPinned && b.isPinned) return 1;
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      });

      if (!query.trim()) return sorted;
      const q = query.toLowerCase();
      return sorted.filter(
        (s) =>
          String(s.title || "").toLowerCase().includes(q) ||
          String(s.query || "").toLowerCase().includes(q) ||
          (s.notes && String(s.notes).toLowerCase().includes(q))
      );
    },
    [query]
  );

  const visibleLocalOnly = useMemo(() => filterAndSortSearches(localOnlyList), [filterAndSortSearches, localOnlyList]);
  const visibleLocalAndCloud = useMemo(() => filterAndSortSearches(localAndCloudList), [filterAndSortSearches, localAndCloudList]);
  const visibleCloudOnly = useMemo(() => filterAndSortSearches(cloudOnlySearches), [filterAndSortSearches, cloudOnlySearches]);

  const handleCopyTitle = async (title: string, id: string) => {
    try {
      await navigator.clipboard.writeText(title);
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2000);
    } catch {
      // ignore clipboard failures
    }
  };

  const handleSaveEdit = () => {
    if (!editing || !editing.title.trim() || !editing.query.trim()) return;
    updateSavedSearch(editing.id, {
      title: editing.title.trim(),
      query: editing.query.trim(),
      notes: editing.notes.trim() || undefined,
    });
    setEditing(null);
    refresh();
    void runReconciliation();
  };

  /**
   * Append-Only Verified Upload + Post-Commit Local Cleanup for Saved Searches (`REFERENCES`):
   * Preserves all existing R2/PostgreSQL cloud records, verifies SHA-256 + DB commit,
   * clears verified local browser copies (IndexedDB `SAVED_SEARCHES` + `SAVED_REFERENCES`, OPFS, Zustand),
   * and transitions cards cleanly to the `R2 Cloud` (`CLOUD_ONLY`) badge.
   */
  const handleSaveToCloud = async () => {
    setSyncing(true);
    setSyncNotice(null);
    try {
      const res = await uploadDatasetToCloudWithVerifiedCleanup({
        datasetType: "REFERENCES",
        auditResourceType: "SAVED_SEARCH",
        operationType: "UPSERT",
        localRecords: savedSearches.map((s) => ({
          id: s.id,
          payload: {
            ...(s as unknown as Record<string, unknown>),
            recordId: s.id,
            resourceType: "SAVED_SEARCH",
            resourceId: s.id,
          },
        })),
        removeLocalCopies: async (ownerId, verifiedIds) => {
          const removed = await removeLocalSavedSearchesBatch(ownerId, verifiedIds);
          removeLocalSavedSearchesBatchAfterCloudCommit(verifiedIds);
          return removed;
        },
        onStageChange: setUploadFeedback,
      });

      if (res.ok) {
        setSyncNotice(
          `Committed & verified in Cloud R2 (${res.uploadedCount} saved, ${res.cleanedCount} cleaned locally). Prior cloud items preserved.`
        );
        await fetchCloudSearches();
        refresh();
        void runReconciliation();
      } else if (res.error) {
        setSyncNotice(res.error);
      }
    } finally {
      setSyncing(false);
    }
  };

  // Perform surgical local cleanup for a single search
  const handleSingleCleanup = async (search: SavedSearch & { _cleanupEligible?: boolean }) => {
    const ownerId = syncCoordinator.getOwnerId();
    if (!ownerId) return;

    setIsCleaning(true);
    try {
      await removeLocalSavedSearch(ownerId, search.id);
      removeLocalSavedSearchAfterCloudCommit(search.id);
      await fetch("/api/storage/reconciliation/audit-cleanup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          datasetType: "REFERENCES",
          resourceType: "SAVED_SEARCH",
          cleanedRecordIds: [search.id],
          cleanupCount: 1,
        }),
      });
      refresh();
      setSyncNotice(`Safe local cleanup complete for "${search.title}". Preserved in Cloudflare R2.`);
    } catch (err) {
      setSyncNotice(err instanceof Error ? err.message : "Failed to clean up local saved search.");
    } finally {
      setIsCleaning(false);
    }
  };

  // Perform surgical batch local cleanup
  const handleBatchCleanup = async () => {
    const ownerId = syncCoordinator.getOwnerId();
    if (!ownerId) return;

    const targets = cleanupEligibleList.map((s) => s.id).filter(Boolean);
    if (targets.length === 0) return;

    setIsCleaning(true);
    try {
      const removedCount = await removeLocalSavedSearchesBatch(ownerId, targets);
      removeLocalSavedSearchesBatchAfterCloudCommit(targets);
      await fetch("/api/storage/reconciliation/audit-cleanup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          datasetType: "REFERENCES",
          resourceType: "SAVED_SEARCH",
          cleanedRecordIds: targets,
          cleanupCount: removedCount,
        }),
      });
      refresh();
      setCleanupModalOpen(false);
      setSyncNotice(
        `Safe local cleanup completed for ${removedCount} verified searches. All cloud records in R2 remain completely intact.`
      );
      void runReconciliation();
    } catch (err) {
      setSyncNotice(err instanceof Error ? err.message : "Failed to execute batch local cleanup.");
    } finally {
      setIsCleaning(false);
    }
  };

  // Helper to render saved search card
  const renderSearchCard = (s: SavedSearch & { _storageState?: StorageStateCategory; _cleanupEligible?: boolean }, isCloudOnly = false) => {
    const isCopied = copiedId === s.id;
    const canCleanLocal = Boolean(s._cleanupEligible && !isCloudOnly);

    return (
      <Card
        key={s.id}
        className={`flex flex-col justify-between rounded-xl border p-4.5 transition hover:shadow-md ${
          s.isPinned ? "border-primary/50 bg-primary/5" : "border-border/80 bg-surface"
        }`}
      >
        <div>
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              <div className="mb-2 flex flex-wrap items-center gap-1.5">
                <StorageStatusBadge
                  category={isCloudOnly ? "CLOUD_ONLY" : s._storageState || "LOCAL_ONLY"}
                  substate={
                    s._cleanupEligible
                      ? "CLEANUP_ELIGIBLE"
                      : s._storageState === "LOCAL_AND_CLOUD"
                      ? "AUDIT_PENDING"
                      : undefined
                  }
                />
              </div>
              <h4
                className="line-clamp-2 text-base font-bold text-foreground cursor-pointer hover:text-primary transition leading-snug tracking-tight"
                title={`${s.title} (click to copy)`}
                onClick={() => handleCopyTitle(s.title, s.id)}
              >
                {s.title}
              </h4>
              <p className="mt-1 font-mono text-xs text-muted truncate" title={s.query}>
                q: {s.query}
              </p>
            </div>
            {!isCloudOnly && (
              <button
                type="button"
                onClick={() => togglePinSavedSearch(s.id)}
                className="text-muted hover:text-amber-500 transition p-1"
                title={s.isPinned ? "Unpin search" : "Pin to top"}
              >
                <Star
                  className={`h-4 w-4 ${
                    s.isPinned ? "fill-amber-500 text-amber-500" : ""
                  }`}
                />
              </button>
            )}
          </div>

          {s.notes && (
            <p className="mt-2 text-xs text-muted line-clamp-2 italic bg-surface-muted/60 p-2 rounded-md">
              {s.notes}
            </p>
          )}

          <div className="mt-3 flex flex-wrap items-center gap-1.5 text-[10px] text-muted">
            <Badge className="text-[10px] uppercase">{s.resourceSelection || "ALL"}</Badge>
            {s.settings?.safeSearch === "none" && (
              <span className="rounded bg-emerald-500/10 px-1.5 py-0.5 text-emerald-600 dark:text-emerald-400 font-medium">
                Unrestricted Mode
              </span>
            )}
            <span>Saved {formatDate(s.createdAt)}</span>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-between border-t border-border/50 pt-3 gap-2">
          <button
            type="button"
            onClick={() => handleCopyTitle(s.title, s.id)}
            className="inline-flex items-center gap-1 text-xs text-muted hover:text-foreground transition"
            title="Copy search title"
          >
            {isCopied ? (
              <Check className="h-3.5 w-3.5 text-success" />
            ) : (
              <Copy className="h-3.5 w-3.5" />
            )}
            <span>{isCopied ? "Copied" : "Copy"}</span>
          </button>

          <div className="flex items-center gap-1.5">
            {canCleanLocal && (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => handleSingleCleanup(s)}
                disabled={isCleaning}
                className="h-7 border-cyan-500/30 bg-cyan-500/10 text-cyan-600 dark:text-cyan-400 hover:bg-cyan-500/20 px-2 text-[11px] font-semibold"
                title="Remove local copy from browser IndexedDB (cloud copy is preserved)"
              >
                <CheckCircle2 className="h-3 w-3" />
                <span>Clean Local</span>
              </Button>
            )}
            <Link
              href={`/search?q=${encodeURIComponent(s.query)}`}
              className="inline-flex items-center gap-1 rounded-md bg-primary-soft px-2.5 py-1 text-xs font-semibold text-primary hover:bg-primary/20 transition"
            >
              <Play className="h-3 w-3 fill-current" />
              <span>Run</span>
            </Link>
            {!isCloudOnly && (
              <>
                <button
                  type="button"
                  onClick={() =>
                    setEditing({
                      id: s.id,
                      title: s.title || "",
                      query: s.query || "",
                      notes: s.notes || "",
                    })
                  }
                  className="rounded-md p-1.5 text-muted hover:bg-surface-muted hover:text-foreground transition"
                  title="Edit saved search"
                >
                  <Pencil className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => deleteSavedSearch(s.id)}
                  className="rounded-md p-1.5 text-muted hover:bg-danger/10 hover:text-danger transition"
                  title="Delete saved search"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </>
            )}
            {isCloudOnly && (
              <span className="text-[11px] font-semibold text-emerald-500 flex items-center gap-1">
                <Cloud className="h-3 w-3" />
                <span>Preserved in R2</span>
              </span>
            )}
          </div>
        </div>
      </Card>
    );
  };

  return (
    <div className="space-y-6">
      <CloudUploadFeedbackBanner
        feedback={uploadFeedback}
        onDismiss={() => setUploadFeedback(null)}
      />

      {/* 1. Storage Overview (4 Cards) */}
      <StorageOverview
        localOnlyCount={localOnlyList.length}
        localAndCloudCount={localAndCloudList.length}
        cloudOnlyCount={cloudOnlySearches.length}
        totalUniqueCount={totalUniqueCount}
        cleanupEligibleCount={cleanupEligibleList.length}
        activeView={storageView}
        onSelectView={setStorageView}
        isLoading={isDatasetLoading}
      />

      {/* 2. Storage Comparison & Integrity Center */}
      <StorageComparisonPanel
        onRunComparison={runReconciliation}
        isComparing={isComparing}
        lastComparedAt={lastComparedAt}
        cleanupEligibleCount={cleanupEligibleList.length}
        onOpenCleanupDialog={() => setCleanupModalOpen(true)}
        datasetLabel="Saved Searches"
        generationSummaries={generationSummaries}
        partResults={partResults}
        artifactStats={artifactStats}
      />

      {/* 3. Search, Undo/Redo, Sync and Stats Bar */}
      <Card className="p-4 sm:p-5 shadow-sm border border-border/80">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted" />
            <input
              type="text"
              placeholder="Filter saved search titles & queries..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="h-10 w-full rounded-lg border border-border bg-surface pl-10 pr-9 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--ring)] transition"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery("")}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted hover:text-foreground"
                aria-label="Clear filter"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <UndoRedoControls scope={["SAVED_SEARCHES", "REFERENCES"]} enableKeyboardShortcuts compact />
            <Button
              type="button"
              variant="secondary"
              disabled={syncing || (pendingCount === 0 && savedSearches.length === 0)}
              onClick={() => void handleSaveToCloud()}
              className="h-9 gap-1.5 px-3 text-xs font-semibold bg-amber-500 hover:bg-amber-600 text-black border-amber-500 font-bold"
              title="Append local Saved Searches to Cloudflare R2 (preserves prior cloud items), verify SHA-256, and clear verified local copies"
            >
              {syncing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CloudUpload className="h-3.5 w-3.5" />}
              <span>Save to Cloud R2</span>
              {pendingCount > 0 && (
                <span className="rounded-full bg-black/20 px-1.5 text-[10px] font-bold text-black">
                  {pendingCount}
                </span>
              )}
            </Button>
            <div className="text-xs text-muted">
              <strong>{savedSearches.length}</strong> saved {savedSearches.length === 1 ? "query" : "queries"}
            </div>
          </div>
        </div>
        {syncNotice && (
          <p className="mt-3 rounded-lg border border-border bg-surface-muted px-3 py-2 text-xs text-foreground">
            {syncNotice}
          </p>
        )}
      </Card>

      {/* Edit Saved Search Panel */}
      {editing && (
        <Card className="border-primary/40 bg-primary/5 p-4 sm:p-5 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-foreground">Edit Saved Search</h3>
            <button
              type="button"
              onClick={() => setEditing(null)}
              className="text-muted hover:text-foreground"
              aria-label="Close edit panel"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-medium text-muted">Title</label>
              <input
                type="text"
                value={editing.title}
                onChange={(e) => setEditing({ ...editing, title: e.target.value })}
                className="h-9 w-full rounded-lg border border-border bg-surface px-3 text-sm"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-muted">Query</label>
              <input
                type="text"
                value={editing.query}
                onChange={(e) => setEditing({ ...editing, query: e.target.value })}
                className="h-9 w-full rounded-lg border border-border bg-surface px-3 text-sm font-mono"
              />
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-muted">Notes</label>
            <textarea
              rows={2}
              value={editing.notes}
              onChange={(e) => setEditing({ ...editing, notes: e.target.value })}
              className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-xs"
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" className="h-8 px-3 text-xs" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button type="button" variant="primary" className="h-8 px-3 text-xs" onClick={handleSaveEdit}>
              Save Edit Locally
            </Button>
          </div>
        </Card>
      )}

      {/* ═════════════════════════════════════════════════════════════════════ */}
      {/* 3 STANDARDIZED STORAGE SECTIONS                                       */}
      {/* ═════════════════════════════════════════════════════════════════════ */}

      {/* SECTION 1: LOCAL ONLY */}
      {(storageView === "all" || storageView === "local") && (
        <StorageStatusSection
          category="LOCAL_ONLY"
          title="SECTION 1 — NEWLY ADDED — LOCAL BROWSER"
          description="Stored strictly in this browser’s IndexedDB database. Pending upload to Cloudflare R2."
          count={visibleLocalOnly.length}
          icon={<HardDrive className="h-4 w-4 text-amber-500" />}
          actionButton={
            visibleLocalOnly.length > 0 ? (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={handleSaveToCloud}
                disabled={syncing}
                className="h-8 gap-1.5 bg-amber-500 hover:bg-amber-600 text-black border-amber-500 font-bold text-xs"
              >
                <CloudUpload className="h-3.5 w-3.5" />
                <span>Upload to R2 Cloud ({visibleLocalOnly.length})</span>
              </Button>
            ) : undefined
          }
          emptyMessage="No local-only saved searches pending cloud commit."
        >
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {visibleLocalOnly.map((s) => renderSearchCard(s))}
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
          emptyMessage="No saved searches currently synchronized across both local browser and R2 cloud."
        >
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {visibleLocalAndCloud.map((s) => renderSearchCard(s))}
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
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {visibleCloudOnly.map((s) => renderSearchCard(s, true))}
          </div>
        </StorageStatusSection>
      )}

      {/* Batch Local Cleanup Confirmation Dialog */}
      <StorageCleanupConfirmationDialog
        isOpen={cleanupModalOpen}
        onClose={() => setCleanupModalOpen(false)}
        onConfirm={handleBatchCleanup}
        isCleaning={isCleaning}
        recordCount={cleanupEligibleList.length}
        datasetName="saved searches"
      />
    </div>
  );
}
