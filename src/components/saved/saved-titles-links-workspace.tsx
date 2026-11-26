"use client";

import {
  AlertTriangle,
  Bookmark,
  Check,
  CheckCircle2,
  Clock,
  Cloud,
  CloudUpload,
  Database,
  ExternalLink,
  FileText,
  HardDrive,
  Layers,
  Link2,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  classifyResourceRecord,
  type ResourceType,
} from "@/lib/resources/resource-taxonomy";
import { useMergedDataset } from "@/lib/storage/use-merged-dataset";
import { authFetch } from "@/lib/client/auth-fetch";
import { syncCoordinator } from "@/lib/sync/sync-coordinator";
import {
  uploadDatasetToCloudWithVerifiedCleanup,
  type CloudUploadFeedbackState,
} from "@/lib/sync/verified-cloud-upload";
import { CloudUploadFeedbackBanner } from "@/components/storage/cloud-upload-banner";
import { undoRedoService } from "@/lib/undo-redo/undo-redo-service";
import { UndoRedoControls } from "@/components/ui/undo-redo-controls";
import { formatDate } from "@/lib/utils/format";
import {
  removeLocalSavedReference,
  removeLocalSavedReferencesBatch,
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

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * Saved Titles & Links Workspace — /saved-titles-links (2026 SaaS)
 * ──────────────────────────────────────────────────────────────────────────
 * Scope: Unified three-state storage classification, authentic 3-way
 *        reconciliation (IndexedDB + Cloudflare R2 + Supabase PostgreSQL),
 *        and surgical safe local cleanup for SAVED_TITLE & SAVED_LINK.
 *
 * Distinct Persistence States:
 *   1. LOCAL_ONLY: Staged in browser IndexedDB; awaiting cloud commit.
 *   2. LOCAL_AND_CLOUD: Confirmed in Cloudflare R2 / Supabase; safe to clean up.
 *   3. CLOUD_ONLY: Authoritative in R2 / Supabase; local browser copy cleaned up.
 *
 * Guarantees:
 *   - Local cleanup never creates cloud DELETE tombstones.
 *   - Zero data loss: Preserves all existing R2 and Supabase records.
 * ═══════════════════════════════════════════════════════════════════════════
 */

export interface SavedReferenceRecord {
  id: string;
  recordId?: string;
  resourceType?: ResourceType | string;
  resourceId?: string;
  savedKind?: "SAVED_TITLE" | "SAVED_LINK";
  title: string;
  url?: string;
  notes?: string;
  createdAt?: string;
  updatedAt?: string;
  savedAt?: string;
  originDeviceId?: string;
  originDeviceLabel?: string;
  _localStatus?: string;
  _syncStatus?: string;
  _sourceLocation?: "LOCAL" | "CLOUD" | "BOTH";
  _storageState?: StorageStateCategory;
  _cleanupEligible?: boolean;
  _r2Verified?: boolean;
  _supabaseVerified?: boolean;
}

type ReferenceKind = "SAVED_TITLE" | "SAVED_LINK";
type KindFilter = "ALL" | ReferenceKind;
type SortOption = "newest" | "oldest" | "title";
type StorageView = "all" | "local" | "cloud";

interface EditorState {
  recordId: string | null;
  kind: ReferenceKind;
  title: string;
  url: string;
  notes: string;
}

const EMPTY_EDITOR: EditorState = {
  recordId: null,
  kind: "SAVED_TITLE",
  title: "",
  url: "",
  notes: "",
};

const MAX_TITLE_LENGTH = 512;
const MAX_URL_LENGTH = 2048;
const MAX_NOTES_LENGTH = 4000;

function isValidHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value.trim());
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function normalizeUrlForComparison(value: string): string {
  try {
    const parsed = new URL(value.trim());
    parsed.hash = "";
    const path = parsed.pathname.replace(/\/+$/, "") || "/";
    return `${parsed.protocol}//${parsed.host.toLowerCase()}${path}${parsed.search}`;
  } catch {
    return value.trim().toLowerCase();
  }
}

function referenceKindOf(record: SavedReferenceRecord): ReferenceKind | null {
  const classification = classifyResourceRecord(record as unknown as Record<string, unknown>, {
    datasetType: "REFERENCES",
  });
  if (classification.resourceType === "SAVED_TITLE") return "SAVED_TITLE";
  if (classification.resourceType === "SAVED_LINK") return "SAVED_LINK";
  return null;
}

function recordIdOf(record: SavedReferenceRecord): string {
  return String(record.recordId || record.id || "").trim();
}

function recordTimestamp(record: SavedReferenceRecord): number {
  for (const value of [record.updatedAt, record.createdAt, record.savedAt]) {
    if (typeof value === "string") {
      const parsed = Date.parse(value);
      if (!Number.isNaN(parsed)) return parsed;
    }
  }
  return 0;
}

export function SavedTitlesLinksWorkspace() {
  // Authoritative R2 Cloud + PostgreSQL records (`SAVED_TITLE` & `SAVED_LINK` strictly filtered)
  const [cloudReferenceRecords, setCloudReferenceRecords] = useState<SavedReferenceRecord[]>([]);
  const [uploadFeedback, setUploadFeedback] = useState<CloudUploadFeedbackState | null>(null);

  const {
    items,
    pendingCount,
    isLoading: isDatasetLoading,
    refresh,
  } = useMergedDataset<SavedReferenceRecord>("REFERENCES", cloudReferenceRecords);

  const [query, setQuery] = useState("");
  const [kindFilter, setKindFilter] = useState<KindFilter>("ALL");
  const [sortOption, setSortOption] = useState<SortOption>("newest");
  const [storageView, setStorageView] = useState<StorageView>("all");
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  // Reconciliation state
  const [isComparing, setIsComparing] = useState(false);
  const [lastComparedAt, setLastComparedAt] = useState<string | null>(null);
  const [reconciliationMap, setReconciliationMap] = useState<
    Map<string, { storageState: StorageStateCategory; cleanupEligible: boolean; r2Verified: boolean; supabaseVerified: boolean }>
  >(new Map());
  const [reconciledCloudOnlyItems, setReconciledCloudOnlyItems] = useState<SavedReferenceRecord[]>([]);
  const [generationSummaries, setGenerationSummaries] = useState<GenerationReconciliationSummary[]>([]);
  const [partResults, setPartResults] = useState<PartReconciliationResult[]>([]);
  const [artifactStats, setArtifactStats] = useState<ArtifactReconciliationStats | undefined>(undefined);

  // Cleanup confirmation state
  const [cleanupModalOpen, setCleanupModalOpen] = useState(false);
  const [isCleaning, setIsCleaning] = useState(false);
  const [singleCleanupTarget, setSingleCleanupTarget] = useState<SavedReferenceRecord | null>(null);

  const fetchCloudReferences = useCallback(async () => {
    try {
      const res = await authFetch("/api/references?kind=titles_links");
      if (!res.ok) return;
      const data = (await res.json()) as { items?: SavedReferenceRecord[] };
      if (Array.isArray(data.items)) {
        setCloudReferenceRecords(
          data.items.filter((record) => referenceKindOf(record) !== null)
        );
      }
    } catch {
      // Keep local view resilient on offline/auth race
    }
  }, []);

  useEffect(() => {
    void fetchCloudReferences();
  }, [fetchCloudReferences]);

  // Filter local browser items strictly to titles & links stored in IndexedDB/Outbox
  const localReferences = useMemo(() => {
    return items
      .filter(
        (record) =>
          record._sourceLocation === "LOCAL" ||
          record._sourceLocation === "BOTH" ||
          record._localStatus === "LOCAL_PENDING"
      )
      .map((record) => ({ record, kind: referenceKindOf(record) }))
      .filter(
        (entry): entry is { record: SavedReferenceRecord; kind: ReferenceKind } =>
          entry.kind !== null
      );
  }, [items]);

  // Execute 3-way reconciliation comparison against R2 and Supabase (Generation & Part Level)
  const runReconciliation = useCallback(async () => {
    setIsComparing(true);
    setStatusMessage(null);
    try {
      const pendingIds = localReferences
        .filter(({ record }) => record._localStatus === "LOCAL_PENDING" || record._syncStatus === "LOCAL")
        .map(({ record }) => recordIdOf(record));

      const localRecordsPayload = localReferences.map(({ record, kind }) => ({
        id: recordIdOf(record),
        recordId: record.recordId || record.id,
        resourceType: kind,
        savedKind: kind,
        title: record.title,
        url: record.url,
        notes: record.notes,
        savedAt: record.savedAt,
        createdAt: record.createdAt,
        _localStatus: record._localStatus,
        _syncStatus: record._syncStatus,
      }));

      const res = await fetch("/api/storage/reconciliation/compare", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          datasetType: "REFERENCES",
          // Enforce strict isolation from SAVED_SEARCH records in REFERENCES reconciliation
          resourceType: kindFilter === "ALL" ? "SAVED_TITLES_LINKS" : kindFilter,
          localContext: {
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

        // Process cloud-only items strictly filtered to SAVED_TITLE & SAVED_LINK
        if (Array.isArray(data.cloudOnlyRecords)) {
          const parsedCloudOnly: SavedReferenceRecord[] = (
            data.cloudOnlyRecords as Array<{
              id: string;
              recordId?: string;
              resourceType?: string;
              title?: string;
              url?: string;
              notes?: string;
              createdAt?: string;
              savedAt?: string;
            }>
          )
            .map((c) => ({
              id: c.id,
              recordId: c.recordId || c.id,
              resourceType: c.resourceType as ResourceType | undefined,
              savedKind: (c.resourceType === "SAVED_LINK" || c.url ? "SAVED_LINK" : "SAVED_TITLE") as ReferenceKind,
              title: c.title || "Untitled",
              url: c.url,
              notes: c.notes,
              createdAt: c.createdAt,
              savedAt: c.savedAt,
              _storageState: "CLOUD_ONLY" as const,
            }))
            .filter((record) => referenceKindOf(record) !== null);
          setReconciledCloudOnlyItems(parsedCloudOnly);
        }

        setStatusMessage(
          `Reconciliation complete: ${data.summary?.localOnlyCount ?? 0} local-only, ${data.summary?.localAndCloudCount ?? 0} synchronized, ${data.summary?.localRecordsEligibleForCleanup ?? data.summary?.cleanupEligibleCount ?? 0} cleanup eligible.`
        );
      }
    } catch (err) {
      setStatusMessage(err instanceof Error ? err.message : "Failed to run 3-way reconciliation.");
    } finally {
      setIsComparing(false);
    }
  }, [localReferences, kindFilter]);

  // Combine authoritative CLOUD_ONLY items across R2 reconciler + /api/references
  const cloudOnlyItems = useMemo(() => {
    const localIdSet = new Set(localReferences.map(({ record }) => recordIdOf(record)));
    const byId = new Map<string, SavedReferenceRecord>();

    for (const c of reconciledCloudOnlyItems) {
      const cid = recordIdOf(c);
      if (cid && !localIdSet.has(cid) && referenceKindOf(c) !== null) {
        byId.set(cid, c);
      }
    }
    for (const c of cloudReferenceRecords) {
      const cid = recordIdOf(c);
      if (cid && !localIdSet.has(cid) && referenceKindOf(c) !== null) {
        byId.set(cid, { ...(byId.get(cid) ?? {}), ...c, _storageState: "CLOUD_ONLY" });
      }
    }
    return Array.from(byId.values());
  }, [localReferences, reconciledCloudOnlyItems, cloudReferenceRecords]);

  // Run reconciliation automatically on mount or when local items change
  useEffect(() => {
    void runReconciliation();
  }, [localReferences.length]);

  // Listen for local mutations & verified cloud cleanup events
  useEffect(() => {
    const handleMutation = () => {
      refresh();
    };
    const handleCloudCommit = () => {
      void fetchCloudReferences();
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
  }, [fetchCloudReferences, refresh, runReconciliation]);

  // Classify references into 3 states
  const classifiedReferences = useMemo(() => {
    return localReferences.map(({ record, kind }) => {
      const id = recordIdOf(record);
      const recon = reconciliationMap.get(id);
      const isPending =
        record._localStatus === "LOCAL_PENDING" || record._syncStatus === "LOCAL";

      let storageState: StorageStateCategory = "LOCAL_ONLY";
      let cleanupEligible = false;
      let r2Verified = false;
      let supabaseVerified = false;

      if (recon) {
        storageState = isPending ? "LOCAL_ONLY" : recon.storageState;
        cleanupEligible = !isPending && recon.cleanupEligible;
        r2Verified = recon.r2Verified;
        supabaseVerified = recon.supabaseVerified;
      } else if (!isPending && record._localStatus === "COMMITTED") {
        storageState = "LOCAL_AND_CLOUD";
        cleanupEligible = true;
        r2Verified = true;
        supabaseVerified = true;
      }

      return {
        record: {
          ...record,
          _storageState: storageState,
          _cleanupEligible: cleanupEligible,
          _r2Verified: r2Verified,
          _supabaseVerified: supabaseVerified,
        },
        kind,
        storageState,
        cleanupEligible,
      };
    });
  }, [localReferences, reconciliationMap]);

  // Partition into 3 categories
  const localOnlyList = useMemo(() => {
    return classifiedReferences.filter((entry) => entry.storageState === "LOCAL_ONLY");
  }, [classifiedReferences]);

  const localAndCloudList = useMemo(() => {
    return classifiedReferences.filter((entry) => entry.storageState === "LOCAL_AND_CLOUD");
  }, [classifiedReferences]);

  const cleanupEligibleList = useMemo(() => {
    return classifiedReferences.filter((entry) => entry.cleanupEligible);
  }, [classifiedReferences]);

  const totalUniqueCount = useMemo(() => {
    return classifiedReferences.length + cloudOnlyItems.length;
  }, [classifiedReferences, cloudOnlyItems]);

  // Filter and sort helper
  const applyFilterAndSort = useCallback(
    (entries: Array<{ record: SavedReferenceRecord; kind: ReferenceKind }>) => {
      const q = query.trim().toLowerCase();

      const filtered = entries.filter(({ record, kind }) => {
        if (kindFilter !== "ALL" && kind !== kindFilter) return false;
        if (!q) return true;
        return (
          String(record.title || "").toLowerCase().includes(q) ||
          String(record.url || "").toLowerCase().includes(q) ||
          String(record.notes || "").toLowerCase().includes(q) ||
          recordIdOf(record).toLowerCase().includes(q)
        );
      });

      filtered.sort((a, b) => {
        if (sortOption === "title") {
          return String(a.record.title || "").localeCompare(String(b.record.title || ""));
        }
        const delta = recordTimestamp(b.record) - recordTimestamp(a.record);
        return sortOption === "oldest" ? -delta : delta;
      });

      return filtered;
    },
    [query, kindFilter, sortOption]
  );

  const visibleLocalOnly = useMemo(() => applyFilterAndSort(localOnlyList), [applyFilterAndSort, localOnlyList]);
  const visibleLocalAndCloud = useMemo(() => applyFilterAndSort(localAndCloudList), [applyFilterAndSort, localAndCloudList]);
  const visibleCloudOnly = useMemo(() => {
    const entries = cloudOnlyItems.map((record) => ({
      record,
      kind: (record.savedKind || (record.url ? "SAVED_LINK" : "SAVED_TITLE")) as ReferenceKind,
    }));
    return applyFilterAndSort(entries);
  }, [applyFilterAndSort, cloudOnlyItems]);

  const counts = useMemo(() => {
    let titles = 0;
    let links = 0;
    for (const entry of classifiedReferences) {
      if (entry.kind === "SAVED_TITLE") titles += 1;
      else links += 1;
    }
    return { titles, links, total: classifiedReferences.length };
  }, [classifiedReferences]);

  // Perform surgical local cleanup (single item)
  const handleSingleCleanup = async (record: SavedReferenceRecord) => {
    const ownerId = syncCoordinator.getOwnerId();
    if (!ownerId) return;

    const id = recordIdOf(record);
    if (!id) return;

    setIsCleaning(true);
    try {
      await removeLocalSavedReference(ownerId, id);
      await fetch("/api/storage/reconciliation/audit-cleanup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          datasetType: "REFERENCES",
          resourceType: record.savedKind || "SAVED_TITLE",
          cleanedRecordIds: [id],
          cleanupCount: 1,
        }),
      });
      refresh();
      setStatusMessage(`Safe local cleanup complete for "${record.title}". Cloud R2 copy preserved.`);
    } catch (err) {
      setStatusMessage(err instanceof Error ? err.message : "Failed to clean up local copy.");
    } finally {
      setIsCleaning(false);
      setSingleCleanupTarget(null);
    }
  };

  // Perform surgical batch local cleanup
  const handleBatchCleanup = async () => {
    const ownerId = syncCoordinator.getOwnerId();
    if (!ownerId) return;

    const targets = cleanupEligibleList.map((e) => recordIdOf(e.record)).filter(Boolean);
    if (targets.length === 0) return;

    setIsCleaning(true);
    try {
      const removedCount = await removeLocalSavedReferencesBatch(ownerId, targets);
      await fetch("/api/storage/reconciliation/audit-cleanup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          datasetType: "REFERENCES",
          resourceType: "REFERENCES",
          cleanedRecordIds: targets,
          cleanupCount: removedCount,
        }),
      });
      refresh();
      setCleanupModalOpen(false);
      setStatusMessage(
        `Safe local cleanup completed for ${removedCount} verified references. All cloud records in R2 remain completely intact.`
      );
      void runReconciliation();
    } catch (err) {
      setStatusMessage(err instanceof Error ? err.message : "Failed to execute batch local cleanup.");
    } finally {
      setIsCleaning(false);
    }
  };

  const startCreate = (kind: ReferenceKind) => {
    setFormError(null);
    setStatusMessage(null);
    setEditor({ ...EMPTY_EDITOR, kind });
  };

  const startEdit = (record: SavedReferenceRecord, kind: ReferenceKind) => {
    setFormError(null);
    setStatusMessage(null);
    setEditor({
      recordId: recordIdOf(record),
      kind,
      title: String(record.title || ""),
      url: String(record.url || ""),
      notes: String(record.notes || ""),
    });
  };

  const closeEditor = () => {
    if (saving) return;
    setEditor(null);
    setFormError(null);
  };

  const findDuplicate = (draft: EditorState): SavedReferenceRecord | null => {
    const title = draft.title.trim().toLowerCase();
    const url = draft.url.trim() ? normalizeUrlForComparison(draft.url) : "";

    for (const { record, kind } of classifiedReferences) {
      if (draft.recordId && recordIdOf(record) === draft.recordId) continue;
      if (kind !== draft.kind) continue;

      if (draft.kind === "SAVED_LINK" && url) {
        if (record.url && normalizeUrlForComparison(record.url) === url) return record;
      }
      if (draft.kind === "SAVED_TITLE" && title) {
        if (String(record.title || "").trim().toLowerCase() === title) return record;
      }
    }
    return null;
  };

  const handleSave = async () => {
    if (!editor) return;

    const ownerId = syncCoordinator.getOwnerId();
    if (!ownerId) {
      setFormError("Canonical owner is still resolving. Please retry in a moment.");
      return;
    }

    const title = editor.title.trim();
    const url = editor.url.trim();

    if (!title) {
      setFormError("A title is required.");
      return;
    }
    if (title.length > MAX_TITLE_LENGTH) {
      setFormError(`Title must be ${MAX_TITLE_LENGTH} characters or fewer.`);
      return;
    }
    if (editor.kind === "SAVED_LINK" && !url) {
      setFormError("A saved link requires a URL.");
      return;
    }
    if (url && !isValidHttpUrl(url)) {
      setFormError("The URL must be an absolute http(s) URL.");
      return;
    }
    if (url.length > MAX_URL_LENGTH) {
      setFormError(`URL must be ${MAX_URL_LENGTH} characters or fewer.`);
      return;
    }
    if (editor.notes.length > MAX_NOTES_LENGTH) {
      setFormError(`Notes must be ${MAX_NOTES_LENGTH} characters or fewer.`);
      return;
    }

    const duplicate = findDuplicate(editor);
    if (duplicate) {
      setFormError(
        editor.kind === "SAVED_LINK"
          ? `This link is already saved as "${duplicate.title}".`
          : `A saved title with this name already exists ("${duplicate.title}").`
      );
      return;
    }

    setSaving(true);
    setFormError(null);

    try {
      const now = new Date().toISOString();
      const recordId = editor.recordId || crypto.randomUUID();
      const existing = editor.recordId
        ? classifiedReferences.find((entry) => recordIdOf(entry.record) === editor.recordId)?.record
        : undefined;

      const record: SavedReferenceRecord & Record<string, unknown> = {
        ...(existing || {}),
        id: existing?.id || recordId,
        recordId,
        resourceId: url || recordId,
        resourceType: editor.kind,
        savedKind: editor.kind,
        title,
        notes: editor.notes.trim() || undefined,
        url: url || undefined,
        createdAt: existing?.createdAt || now,
        updatedAt: now,
        savedAt: existing?.savedAt || now,
        originDeviceId: existing?.originDeviceId,
        originDeviceLabel: existing?.originDeviceLabel,
      };

      const isEditing = Boolean(existing);
      const beforeState = isEditing
        ? (await undoRedoService.captureBeforeState(ownerId, "REFERENCES", recordId)) ??
          (existing as unknown as Record<string, unknown>)
        : null;

      await undoRedoService.executeMutation({
        ownerId,
        scope: "REFERENCES",
        datasetType: "REFERENCES",
        commandType: isEditing ? "EDIT_TITLE_LINK" : "CREATE_TITLE_LINK",
        label: `${isEditing ? "Edit" : "Create"} ${editor.kind === "SAVED_LINK" ? "link" : "title"} "${title.slice(0, 40)}"`,
        coalesceKey: isEditing ? `edit-ref:${recordId}` : undefined,
        changes: [
          {
            datasetType: "REFERENCES",
            entityId: recordId,
            beforeState,
            afterState: record,
          },
        ],
      });
      await syncCoordinator.refreshSummary();
      refresh();
      setEditor(null);
      setStatusMessage(
        `${editor.kind === "SAVED_LINK" ? "Link" : "Title"} staged locally in IndexedDB. Press Save to Cloud R2 when ready.`
      );
      void runReconciliation();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Failed to save the reference locally.");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (record: SavedReferenceRecord) => {
    const ownerId = syncCoordinator.getOwnerId();
    if (!ownerId) return;

    const entityId = recordIdOf(record);
    if (!entityId) return;

    setDeletingId(entityId);
    try {
      const beforeState =
        (await undoRedoService.captureBeforeState(ownerId, "REFERENCES", entityId)) ??
        (record as unknown as Record<string, unknown>);
      await undoRedoService.executeMutation({
        ownerId,
        scope: "REFERENCES",
        datasetType: "REFERENCES",
        commandType: "DELETE_TITLE_LINK",
        label: `Delete "${String(record.title || entityId).slice(0, 40)}"`,
        changes: [
          {
            datasetType: "REFERENCES",
            entityId,
            beforeState,
            afterState: null,
          },
        ],
      });
      await syncCoordinator.refreshSummary();
      refresh();
      setStatusMessage("Deleted locally (reversible with Undo). Press Save to Cloud R2 to commit.");
      void runReconciliation();
    } catch (err) {
      setStatusMessage(err instanceof Error ? err.message : "Failed to delete the reference.");
    } finally {
      setDeletingId(null);
    }
  };

  /**
   * Append-Only Verified Upload + Post-Commit Local Cleanup for Saved Titles & Links (`REFERENCES`):
   * Preserves all existing R2/PostgreSQL cloud records, verifies SHA-256 + DB commit,
   * clears verified local browser copies (IndexedDB + OPFS), and transitions cards to `R2 Cloud`.
   */
  const handleSaveAll = async () => {
    setSyncing(true);
    setStatusMessage(null);
    try {
      const res = await uploadDatasetToCloudWithVerifiedCleanup({
        datasetType: "REFERENCES",
        auditResourceType: "SAVED_TITLES_LINKS",
        operationType: "UPSERT",
        localRecords: localReferences.map(({ record, kind }) => ({
          id: recordIdOf(record),
          payload: {
            ...(record as unknown as Record<string, unknown>),
            recordId: recordIdOf(record),
            resourceType: kind,
            savedKind: kind,
          },
        })),
        removeLocalCopies: async (ownerId, verifiedIds) =>
          removeLocalSavedReferencesBatch(ownerId, verifiedIds),
        onStageChange: setUploadFeedback,
      });

      if (res.ok) {
        setStatusMessage(
          `Committed & verified in Cloud R2 (${res.uploadedCount} saved, ${res.cleanedCount} cleaned locally). Prior cloud data preserved.`
        );
        await fetchCloudReferences();
        refresh();
        void runReconciliation();
      } else if (res.error) {
        setStatusMessage(res.error);
      }
    } finally {
      setSyncing(false);
    }
  };

  // Helper to render reference card
  const renderReferenceCard = (record: SavedReferenceRecord, kind: ReferenceKind, isCloudOnly = false) => {
    const recordId = recordIdOf(record);
    const timestamp = record.updatedAt || record.createdAt || record.savedAt;
    const canCleanLocal = Boolean(record._cleanupEligible && !isCloudOnly);

    return (
      <Card
        key={recordId}
        className="flex flex-col justify-between rounded-xl border border-border/80 bg-surface p-4 transition hover:shadow-md"
      >
        <div className="min-w-0">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              <div className="mb-2 flex flex-wrap items-center gap-1.5">
                <Badge tone={kind === "SAVED_LINK" ? "primary" : "neutral"}>
                  {kind === "SAVED_LINK" ? "LINK" : "TITLE"}
                </Badge>
                <StorageStatusBadge
                  category={isCloudOnly ? "CLOUD_ONLY" : record._storageState || "LOCAL_ONLY"}
                  substate={
                    record._cleanupEligible
                      ? "CLEANUP_ELIGIBLE"
                      : record._storageState === "LOCAL_AND_CLOUD"
                      ? "AUDIT_PENDING"
                      : undefined
                  }
                />
              </div>
              <h4 className="line-clamp-2 text-base font-bold leading-snug tracking-tight text-foreground">
                {record.title || "Untitled reference"}
              </h4>
            </div>
          </div>

          {record.url && (
            <a
              href={record.url}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-2 inline-flex max-w-full items-center gap-1 text-xs text-primary hover:underline"
              title={record.url}
            >
              <ExternalLink className="h-3 w-3 shrink-0" />
              <span className="truncate">{record.url}</span>
            </a>
          )}

          {record.notes && (
            <p className="mt-2 line-clamp-3 rounded-md bg-surface-muted/60 p-2 text-xs italic text-muted">
              {record.notes}
            </p>
          )}

          <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-muted">
            {timestamp && <span>Updated {formatDate(timestamp)}</span>}
            {record.originDeviceLabel && <span>via {record.originDeviceLabel}</span>}
            <span className="truncate font-mono" title={recordId}>
              {recordId}
            </span>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-end gap-1.5 border-t border-border/50 pt-3">
          {canCleanLocal && (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => handleSingleCleanup(record)}
              disabled={isCleaning}
              className="h-7 border-cyan-500/30 bg-cyan-500/10 text-cyan-600 dark:text-cyan-400 hover:bg-cyan-500/20 px-2 text-[11px] font-semibold"
              title="Remove local copy from browser IndexedDB (cloud copy is preserved)"
            >
              <CheckCircle2 className="h-3 w-3" />
              <span>Clean Local</span>
            </Button>
          )}
          {!isCloudOnly && (
            <>
              <button
                type="button"
                onClick={() => startEdit(record, kind)}
                className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted transition hover:bg-surface-muted hover:text-foreground"
                title="Edit reference"
              >
                <Pencil className="h-3.5 w-3.5" />
                <span>Edit</span>
              </button>
              <button
                type="button"
                onClick={() => handleDelete(record)}
                disabled={deletingId === recordId}
                className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted transition hover:bg-danger/10 hover:text-danger disabled:opacity-50"
                title="Delete reference"
              >
                {deletingId === recordId ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Trash2 className="h-3.5 w-3.5" />
                )}
                <span>Delete</span>
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
        cloudOnlyCount={cloudOnlyItems.length}
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
        datasetLabel="Saved Titles & Links"
        generationSummaries={generationSummaries}
        partResults={partResults}
        artifactStats={artifactStats}
      />

      {/* 3. Toolbar */}
      <Card className="border border-border/80 p-4 shadow-sm sm:p-5">
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="relative w-full max-w-md flex-1">
              <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
              <input
                type="text"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search saved titles, links, notes, or record IDs..."
                className="h-10 w-full rounded-lg border border-border bg-surface pl-10 pr-9 text-sm transition focus:outline-none focus:ring-2 focus:ring-[var(--ring)]"
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

            <div className="flex flex-wrap items-center gap-2">
              <UndoRedoControls scope={["REFERENCES"]} enableKeyboardShortcuts compact />
              <Button
                type="button"
                variant="primary"
                onClick={() => startCreate("SAVED_TITLE")}
                className="h-9 gap-1.5 px-3 text-xs font-semibold"
              >
                <Plus className="h-3.5 w-3.5" />
                <span>New Title</span>
              </Button>
              <Button
                type="button"
                variant="secondary"
                onClick={() => startCreate("SAVED_LINK")}
                className="h-9 gap-1.5 px-3 text-xs font-semibold"
              >
                <Link2 className="h-3.5 w-3.5" />
                <span>New Link</span>
              </Button>
              <Button
                type="button"
                variant="secondary"
                onClick={handleSaveAll}
                disabled={syncing || (pendingCount === 0 && localReferences.length === 0)}
                className="h-9 gap-1.5 px-3 text-xs font-semibold bg-amber-500 hover:bg-amber-600 text-black border-amber-500 font-bold"
                title="Append local Saved Titles & Links to Cloudflare R2 (preserves all prior cloud items), verify SHA-256, and clear verified local copies"
              >
                {syncing ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <CloudUpload className="h-3.5 w-3.5" />
                )}
                <span>{syncing ? "Syncing…" : "Save to Cloud R2"}</span>
                {pendingCount > 0 && (
                  <span className="rounded-full bg-black/20 px-1.5 py-0.2 text-[10px] font-bold text-black">
                    {pendingCount}
                  </span>
                )}
              </Button>
            </div>
          </div>

          <div className="flex flex-col gap-3 border-t border-border/60 pt-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-wrap items-center gap-1.5">
              {(
                [
                  { value: "ALL", label: "All", count: counts.total },
                  { value: "SAVED_TITLE", label: "Titles", count: counts.titles },
                  { value: "SAVED_LINK", label: "Links", count: counts.links },
                ] as const
              ).map((filter) => (
                <button
                  key={filter.value}
                  type="button"
                  onClick={() => setKindFilter(filter.value)}
                  className={`rounded-full px-3 py-1 text-xs font-medium transition ${
                    kindFilter === filter.value
                      ? "bg-primary-soft text-primary font-bold"
                      : "bg-surface-muted/60 text-muted hover:text-foreground"
                  }`}
                >
                  {filter.label} ({filter.count})
                </button>
              ))}
            </div>

            <div className="flex items-center gap-2 text-xs text-muted">
              <span>Sort</span>
              <select
                value={sortOption}
                onChange={(event) => setSortOption(event.target.value as SortOption)}
                className="h-8 rounded-md border border-border bg-surface px-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              >
                <option value="newest">Newest first</option>
                <option value="oldest">Oldest first</option>
                <option value="title">Title A–Z</option>
              </select>
            </div>
          </div>
        </div>
      </Card>

      {statusMessage && (
        <div className="flex items-start gap-2 rounded-lg border border-border/70 bg-surface-muted/50 px-3 py-2 text-xs text-muted">
          <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success" />
          <span>{statusMessage}</span>
        </div>
      )}

      {/* Editor Modal / Card */}
      {editor && (
        <Card className="border border-primary/30 bg-primary/5 p-4 shadow-sm sm:p-5">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <h3 className="flex items-center gap-2 text-sm font-bold text-foreground">
                {editor.kind === "SAVED_LINK" ? (
                  <Link2 className="h-4 w-4 text-primary" />
                ) : (
                  <FileText className="h-4 w-4 text-primary" />
                )}
                {editor.recordId ? "Edit reference" : `New ${editor.kind === "SAVED_LINK" ? "link" : "title"}`}
              </h3>
              <p className="mt-0.5 text-xs text-muted">
                Stored in the REFERENCES dataset and synced to R2 + PostgreSQL.
              </p>
            </div>
            <button
              type="button"
              onClick={closeEditor}
              className="rounded-lg p-1.5 text-muted transition hover:bg-surface-muted hover:text-foreground"
              aria-label="Close editor"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-muted">
                Title
              </label>
              <input
                type="text"
                value={editor.title}
                maxLength={MAX_TITLE_LENGTH}
                onChange={(event) =>
                  setEditor((current) =>
                    current ? { ...current, title: event.target.value } : current
                  )
                }
                placeholder="A clear, human-readable title"
                className="h-10 w-full rounded-lg border border-border bg-surface px-3 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--ring)]"
              />
            </div>

            <div className="sm:col-span-2">
              <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-muted">
                URL {editor.kind === "SAVED_LINK" ? "(required)" : "(optional)"}
              </label>
              <input
                type="url"
                value={editor.url}
                maxLength={MAX_URL_LENGTH}
                onChange={(event) =>
                  setEditor((current) =>
                    current ? { ...current, url: event.target.value } : current
                  )
                }
                placeholder="https://..."
                className="h-10 w-full rounded-lg border border-border bg-surface px-3 font-mono text-xs focus:outline-none focus:ring-2 focus:ring-[var(--ring)]"
              />
            </div>

            <div className="sm:col-span-2">
              <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-muted">
                Research Notes (optional)
              </label>
              <textarea
                value={editor.notes}
                maxLength={MAX_NOTES_LENGTH}
                rows={3}
                onChange={(event) =>
                  setEditor((current) =>
                    current ? { ...current, notes: event.target.value } : current
                  )
                }
                placeholder="Context, tags, reasons for saving..."
                className="w-full rounded-lg border border-border bg-surface p-3 text-xs focus:outline-none focus:ring-2 focus:ring-[var(--ring)]"
              />
            </div>
          </div>

          {formError && (
            <div className="mt-3 flex items-start gap-2 rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>{formError}</span>
            </div>
          )}

          <div className="mt-4 flex items-center justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={closeEditor}
              disabled={saving}
              className="h-9 px-3 text-xs"
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="primary"
              size="sm"
              onClick={handleSave}
              disabled={saving}
              className="h-9 gap-1.5 px-4 text-xs font-semibold"
            >
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
              <span>{saving ? "Saving…" : editor.recordId ? "Update" : "Save Reference"}</span>
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
                onClick={handleSaveAll}
                disabled={syncing}
                className="h-8 gap-1.5 bg-amber-500 hover:bg-amber-600 text-black border-amber-500 font-bold text-xs"
              >
                <CloudUpload className="h-3.5 w-3.5" />
                <span>Upload to R2 Cloud ({visibleLocalOnly.length})</span>
              </Button>
            ) : undefined
          }
          emptyMessage="No local-only references pending cloud commit."
        >
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {visibleLocalOnly.map(({ record, kind }) => renderReferenceCard(record, kind))}
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
          emptyMessage="No references currently synchronized across both local browser and R2 cloud."
        >
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {visibleLocalAndCloud.map(({ record, kind }) => renderReferenceCard(record, kind))}
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
          emptyMessage="No cloud-only references yet. Once verified local copies are cleaned up, they appear here."
        >
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {visibleCloudOnly.map(({ record, kind }) => renderReferenceCard(record, kind, true))}
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
        datasetName="saved titles & links"
      />
    </div>
  );
}
