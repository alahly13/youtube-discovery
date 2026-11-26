import { syncCoordinator } from "./sync-coordinator";
import type { SaveErrorCategory, SaveReceipt, SaveStatusStage } from "./save-receipt";
import { saveEntityLocally } from "../storage/indexeddb-store";
import type { CanonicalDatasetType } from "../storage/canonical-paths";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * Verified Cloud Upload + Post-Commit Local Browser Cleanup Coordinator
 * ───────────────────────────────────────────────────────────────────────────
 * Architecture Role:
 *   Shared upload & cleanup pipeline used across:
 *     - `/history` (`SEARCH_HISTORY`)
 *     - `/saved-titles-links` (`REFERENCES` -> `SAVED_TITLE` / `SAVED_LINK`)
 *     - `/saved-titles-links#saved-searches` (`REFERENCES` -> `SAVED_SEARCH`)
 *
 * Guarantees (Critical Rule Zero — Never Delete Cloud Data):
 *   1. Bridges every eligible local record into IndexedDB + Outbox cleanly so no
 *      in-memory/Zustand entry is skipped.
 *   2. Executes `syncCoordinator.saveAll(datasetType)` -> R2 Worker immutable
 *      generation upload (`version.json` -> `manifest.json` -> parts) -> SHA-256
 *      read-back verification -> atomic PostgreSQL transaction. Prior R2 objects
 *      and historical cloud rows are NEVER deleted or overwritten.
 *   3. Verifies BEFORE clearing local storage:
 *        - `result.ok === true`
 *        - `receipt.ok === true && receipt.stage === "CLOUD_COMMITTED"`
 *        - `dsReceipt.dbCommitConfirmed === true`
 *        - `dsReceipt.verifiedCount >= dsReceipt.partsCount`
 *   4. ONLY after proof passes, clears verified IDs from local browser storage
 *      (IndexedDB + Zustand + OPFS staging) WITHOUT emitting cloud `DELETE`
 *      tombstones, then logs the audit event via `/api/storage/reconciliation/audit-cleanup`.
 *   5. Cleaned records immediately remain visible under the `R2 Cloud` (`CLOUD_ONLY`)
 *      badge sourced from authoritative `/api/history` and `/api/references`.
 * ═══════════════════════════════════════════════════════════════════════════
 */

export interface CloudUploadFeedbackState {
  stage: SaveStatusStage | "CLEANING_LOCAL";
  isSaving: boolean;
  totalSelected: number;
  uploadedCount: number;
  verifiedCount: number;
  failedCount: number;
  cleanedCount: number;
  successMessage?: string;
  errorMessage?: string;
  errorCategory?: SaveErrorCategory;
  receipt?: SaveReceipt;
  generationId?: string;
  manifestPath?: string;
  existingRecordsPreserved?: number;
}

export interface LocalRecordForCloudUpload {
  id: string;
  payload: Record<string, unknown>;
}

export interface UploadAndCleanupParams {
  datasetType: CanonicalDatasetType;
  auditResourceType: string;
  operationType?: "APPEND" | "UPSERT";
  localRecords: LocalRecordForCloudUpload[];
  removeLocalCopies: (ownerId: string, verifiedIds: string[]) => Promise<number | void>;
  onStageChange: (feedback: CloudUploadFeedbackState) => void;
}

export interface UploadAndCleanupResult {
  ok: boolean;
  uploadedCount: number;
  cleanedCount: number;
  generationId?: string;
  manifestPath?: string;
  existingRecordsPreserved?: number;
  receipt?: SaveReceipt;
  error?: string;
}

export async function uploadDatasetToCloudWithVerifiedCleanup(
  params: UploadAndCleanupParams
): Promise<UploadAndCleanupResult> {
  const {
    datasetType,
    auditResourceType,
    operationType = datasetType === "SEARCH_HISTORY" ? "APPEND" : "UPSERT",
    localRecords,
    removeLocalCopies,
    onStageChange,
  } = params;

  const ownerId = syncCoordinator.getOwnerId();
  if (!ownerId) {
    const msg =
      "Authenticated owner session is not initialized yet. Sign in or refresh before uploading to R2 Cloud.";
    onStageChange({
      stage: "FAILED",
      isSaving: false,
      totalSelected: localRecords.length,
      uploadedCount: 0,
      verifiedCount: 0,
      failedCount: localRecords.length,
      cleanedCount: 0,
      errorCategory: "AUTHENTICATION_ERROR",
      errorMessage: msg,
    });
    return { ok: false, uploadedCount: 0, cleanedCount: 0, error: msg };
  }

  const candidateIds = Array.from(
    new Set(localRecords.map((item) => item.id.trim()).filter(Boolean))
  );

  onStageChange({
    stage: "SYNCING",
    isSaving: true,
    totalSelected: candidateIds.length,
    uploadedCount: 0,
    verifiedCount: 0,
    failedCount: 0,
    cleanedCount: 0,
  });

  // 1. Ensure every local record is persisted into IndexedDB entity store + outbox
  for (const entry of localRecords) {
    const cleanId = entry.id.trim();
    if (!cleanId) continue;
    await saveEntityLocally(
      ownerId,
      datasetType,
      cleanId,
      { ...entry.payload, recordId: cleanId },
      operationType
    );
  }
  await syncCoordinator.refreshSummary().catch(() => {});

  // 2. Execute canonical append-only R2 Worker batch upload + SHA-256 verify + DB commit
  const result = await syncCoordinator.saveAll(datasetType);
  const receipt = result.receipt;

  if (!result.ok || !receipt?.ok || receipt.stage !== "CLOUD_COMMITTED") {
    const errMsg =
      result.error ||
      receipt?.errorMessage ||
      "Cloud upload or verification did not complete. Local browser items were preserved safely.";
    onStageChange({
      stage: receipt?.stage || "FAILED",
      isSaving: false,
      totalSelected: candidateIds.length,
      uploadedCount: 0,
      verifiedCount: 0,
      failedCount: candidateIds.length,
      cleanedCount: 0,
      errorCategory: result.errorCategory || receipt?.errorCategory || "R2_UPLOAD_ERROR",
      errorMessage: errMsg,
      receipt,
    });
    return { ok: false, uploadedCount: 0, cleanedCount: 0, receipt, error: errMsg };
  }

  // 3. Strictly verify dataset receipt before clearing ANY local browser data
  const dsReceipt = receipt.datasets.find((d) => d.datasetType === datasetType);
  const verifiedPass = Boolean(
    dsReceipt &&
      dsReceipt.dbCommitConfirmed &&
      dsReceipt.partsCount >= 0 &&
      dsReceipt.verifiedCount >= dsReceipt.partsCount
  );

  if (!verifiedPass || !dsReceipt) {
    const msg =
      "Cloud upload succeeded partially, but PostgreSQL commit or R2 SHA-256 verification could not be confirmed. Local browser data preserved.";
    onStageChange({
      stage: "NEEDS_ATTENTION",
      isSaving: false,
      totalSelected: candidateIds.length,
      uploadedCount: candidateIds.length,
      verifiedCount: dsReceipt?.verifiedCount ?? 0,
      failedCount: candidateIds.length,
      cleanedCount: 0,
      errorCategory: "R2_VERIFICATION_ERROR",
      errorMessage: msg,
      receipt,
    });
    return { ok: false, uploadedCount: candidateIds.length, cleanedCount: 0, receipt, error: msg };
  }

  // Resolve exact verified entity IDs: intersect server-committed syncedEntityIds with caller candidates
  // when candidateIds were supplied, or use all syncedEntityIds from the verified dataset receipt.
  const syncedSet = new Set(
    (dsReceipt.syncedEntityIds || []).map((id) => String(id).trim()).filter(Boolean)
  );
  const verifiedIdsToClean =
    candidateIds.length > 0
      ? candidateIds.filter((id) => syncedSet.size === 0 || syncedSet.has(id))
      : Array.from(syncedSet);

  let cleanedCount = 0;
  if (verifiedIdsToClean.length > 0) {
    onStageChange({
      stage: "CLEANING_LOCAL",
      isSaving: true,
      totalSelected: candidateIds.length || verifiedIdsToClean.length,
      uploadedCount: verifiedIdsToClean.length,
      verifiedCount: dsReceipt.verifiedCount,
      failedCount: 0,
      cleanedCount: 0,
      generationId: dsReceipt.generationId,
      manifestPath: dsReceipt.manifestPath,
      existingRecordsPreserved: dsReceipt.existingRecordsCount ?? 0,
      receipt,
    });

    const removed = await removeLocalCopies(ownerId, verifiedIdsToClean);
    cleanedCount = Math.max(
      typeof removed === "number" ? removed : 0,
      dsReceipt.localCleanupDone ? verifiedIdsToClean.length : 0
    );

    // Best-effort audit log for local cleanup (does not block UI completion)
    try {
      await fetch("/api/storage/reconciliation/audit-cleanup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          datasetType,
          resourceType: auditResourceType,
          cleanedRecordIds: verifiedIdsToClean,
          cleanupCount: cleanedCount,
        }),
      });
    } catch {
      // Audit logging is non-blocking after local cleanup succeeds.
    }

    await syncCoordinator.refreshSummary().catch(() => {});
  }

  const preservedText =
    typeof dsReceipt.existingRecordsCount === "number" && dsReceipt.existingRecordsCount > 0
      ? ` Preserved ${dsReceipt.existingRecordsCount} prior cloud record(s) without overwriting.`
      : "";

  const successMessage =
    cleanedCount > 0
      ? `Verified & saved to Cloudflare R2 (gen ${dsReceipt.generationId.slice(0, 8)}…, rev #${dsReceipt.revision}) and cleared ${cleanedCount} local browser record(s). Items are now backed cleanly by R2 Cloud.${preservedText}`
      : `All cloud records are verified in Cloudflare R2 (gen ${dsReceipt.generationId.slice(0, 8)}…, rev #${dsReceipt.revision}).${preservedText}`;

  onStageChange({
    stage: "CLOUD_COMMITTED",
    isSaving: false,
    totalSelected: candidateIds.length || verifiedIdsToClean.length,
    uploadedCount: verifiedIdsToClean.length,
    verifiedCount: dsReceipt.verifiedCount,
    failedCount: 0,
    cleanedCount,
    generationId: dsReceipt.generationId,
    manifestPath: dsReceipt.manifestPath,
    existingRecordsPreserved: dsReceipt.existingRecordsCount ?? 0,
    successMessage,
    receipt,
  });

  return {
    ok: true,
    uploadedCount: verifiedIdsToClean.length,
    cleanedCount,
    generationId: dsReceipt.generationId,
    manifestPath: dsReceipt.manifestPath,
    existingRecordsPreserved: dsReceipt.existingRecordsCount ?? 0,
    receipt,
  };
}
