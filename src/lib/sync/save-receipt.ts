/**
 * ═══════════════════════════════════════════════════════════════════════════
 * YouTube Discovery 2026 — Canonical Save Lifecycle, Receipt & Error Taxonomy
 * ──────────────────────────────────────────────────────────────────────────
 * Scope: Shared across syncCoordinator, /api/sync/save-all, SaveCenter, and
 *        page-level Save to Cloud R2 controls.
 *
 * Truthfulness Rules:
 *   1. Every receipt field (generationId, revision, SHA-256, part count,
 *      byte count, verified count) comes strictly from verified runtime
 *      responses. Nothing is ever synthesized or guessed.
 *   2. Explicit separation between local persistence, R2 object upload, R2
 *      read-back SHA verification, PostgreSQL atomic commit, and local
 *      outbox cleanup.
 *   3. When offline or unauthenticated, status clearly reports local deferral
 *      (`LOCAL_SAVED` / `QUEUED_FOR_SYNC`) rather than pretending cloud commit.
 * ═══════════════════════════════════════════════════════════════════════════
 */

import type { CanonicalDatasetType } from "../storage/canonical-paths";

export type SaveStatusStage =
  | "LOCAL_SAVED"
  | "QUEUED_FOR_SYNC"
  | "SYNCING"
  | "UPLOADED_UNVERIFIED"
  | "R2_VERIFIED"
  | "DATABASE_COMMITTING"
  | "CLOUD_COMMITTED"
  | "CLEANUP_PENDING"
  | "FAILED"
  | "NEEDS_ATTENTION"
  | "RECOVERY_REQUIRED";

export type SaveErrorCategory =
  | "LOCAL_STORAGE_ERROR"
  | "NETWORK_ERROR"
  | "AUTHENTICATION_ERROR"
  | "AUTHORIZATION_ERROR"
  | "WORKER_ERROR"
  | "R2_UPLOAD_ERROR"
  | "R2_VERIFICATION_ERROR"
  | "CHECKSUM_MISMATCH"
  | "DATABASE_COMMIT_ERROR"
  | "REVISION_CONFLICT"
  | "MANIFEST_VALIDATION_ERROR"
  | "GENERATION_INCOMPLETE"
  | "RECOVERY_REQUIRED";

export interface SaveDatasetReceipt {
  datasetType: CanonicalDatasetType | string;
  datasetId: string;
  generationId: string;
  revision: number;
  partsCount: number;
  recordsCount: number;
  existingRecordsCount?: number;
  addedRecordsCount?: number;
  bytesUploaded: number;
  aggregateSha256: string;
  verifiedCount: number;
  manifestPath?: string;
  partPaths?: string[];
  versionPointerStatus: "WRITTEN" | "FAILED" | "DEFERRED";
  dbCommitConfirmed: boolean;
  localCleanupDone: boolean;
  idempotentReplay: boolean;
  syncedEntityIds?: string[];
}

export interface SaveReceipt {
  batchId: string;
  stage: SaveStatusStage;
  ok: boolean;
  offlineDeferred?: boolean;
  storageOwnerUuid?: string;
  startedAt: string;
  completedAt: string;
  totalOperationsSynced: number;
  totalRecordsCommitted: number;
  totalExistingRecordsPreserved?: number;
  totalNewRecordsAdded?: number;
  totalBytesUploaded: number;
  datasets: SaveDatasetReceipt[];
  errorCategory?: SaveErrorCategory;
  failedStage?: SaveStatusStage;
  errorMessage?: string;
  recoveryHint?: string;
}

export const SAVE_STAGE_LABELS: Record<SaveStatusStage, string> = {
  LOCAL_SAVED: "Saved locally (IndexedDB)",
  QUEUED_FOR_SYNC: "Queued for cloud sync",
  SYNCING: "Uploading to Cloudflare R2 & PostgreSQL…",
  UPLOADED_UNVERIFIED: "Uploaded — awaiting SHA-256 verification",
  R2_VERIFIED: "R2 objects verified — committing database…",
  DATABASE_COMMITTING: "Committing PostgreSQL registry…",
  CLOUD_COMMITTED: "Committed to Cloud R2 & PostgreSQL",
  CLEANUP_PENDING: "Cloud committed — finalizing local cleanup",
  FAILED: "Cloud sync failed (local edits preserved)",
  NEEDS_ATTENTION: "Needs attention — partial warning",
  RECOVERY_REQUIRED: "Recovery required — inspect sync receipt",
};

export const SAVE_ERROR_LABELS: Record<SaveErrorCategory, string> = {
  LOCAL_STORAGE_ERROR: "Local Browser Storage Error (IndexedDB)",
  NETWORK_ERROR: "Network / Offline Reachability Error",
  AUTHENTICATION_ERROR: "Authentication Required (Session Expired or Signed Out)",
  AUTHORIZATION_ERROR: "Authorization Rejected (Scope / Owner Mismatch)",
  WORKER_ERROR: "Cloudflare R2 Worker Error",
  R2_UPLOAD_ERROR: "Cloudflare R2 Upload Failure",
  R2_VERIFICATION_ERROR: "Cloudflare R2 Read-Back Verification Failure",
  CHECKSUM_MISMATCH: "SHA-256 Integrity Checksum Mismatch",
  DATABASE_COMMIT_ERROR: "PostgreSQL Transaction Commit Failure",
  REVISION_CONFLICT: "Revision Conflict (Newer Cloud Generation Exists)",
  MANIFEST_VALIDATION_ERROR: "Manifest Schema / Resource Validation Error",
  GENERATION_INCOMPLETE: "Incomplete Generation Parts",
  RECOVERY_REQUIRED: "Interrupted Batch Recovery Required",
};

export function classifyHttpOrErrorCategory(params: {
  httpStatus?: number;
  code?: string;
  message?: string;
}): { errorCategory: SaveErrorCategory; failedStage: SaveStatusStage } {
  const code = (params.code || "").toUpperCase();
  const msg = (params.message || "").toLowerCase();

  if (code === "REVISION_CONFLICT" || params.httpStatus === 409) {
    return { errorCategory: "REVISION_CONFLICT", failedStage: "DATABASE_COMMITTING" };
  }
  if (code === "AUTHENTICATION_ERROR" || params.httpStatus === 401 || msg.includes("unauthorized")) {
    return { errorCategory: "AUTHENTICATION_ERROR", failedStage: "QUEUED_FOR_SYNC" };
  }
  if (code === "AUTHORIZATION_ERROR" || params.httpStatus === 403 || msg.includes("forbidden") || msg.includes("origin") || msg.includes("owner")) {
    return { errorCategory: "AUTHORIZATION_ERROR", failedStage: "QUEUED_FOR_SYNC" };
  }
  if (code === "INVALID_RESOURCE_RECORDS" || code === "MANIFEST_VALIDATION_ERROR" || params.httpStatus === 422) {
    return { errorCategory: "MANIFEST_VALIDATION_ERROR", failedStage: "SYNCING" };
  }
  if (code === "CHECKSUM_MISMATCH" || code === "WORKER_CHECKSUM_MISMATCH" || msg.includes("sha-256") || msg.includes("checksum")) {
    return { errorCategory: "CHECKSUM_MISMATCH", failedStage: "UPLOADED_UNVERIFIED" };
  }
  if (code === "R2_VERIFICATION_ERROR" || msg.includes("verification failed")) {
    return { errorCategory: "R2_VERIFICATION_ERROR", failedStage: "UPLOADED_UNVERIFIED" };
  }
  if (code === "R2_UPLOAD_ERROR" || msg.includes("batch upload")) {
    return { errorCategory: "R2_UPLOAD_ERROR", failedStage: "SYNCING" };
  }
  if (code === "WORKER_ERROR" || msg.includes("worker")) {
    return { errorCategory: "WORKER_ERROR", failedStage: "SYNCING" };
  }
  if (code === "GENERATION_INCOMPLETE" || msg.includes("incomplete")) {
    return { errorCategory: "GENERATION_INCOMPLETE", failedStage: "UPLOADED_UNVERIFIED" };
  }
  if (code === "DATABASE_COMMIT_ERROR" || msg.includes("database") || msg.includes("prisma") || msg.includes("postgres")) {
    return { errorCategory: "DATABASE_COMMIT_ERROR", failedStage: "DATABASE_COMMITTING" };
  }
  if (code === "RECOVERY_REQUIRED") {
    return { errorCategory: "RECOVERY_REQUIRED", failedStage: "RECOVERY_REQUIRED" };
  }
  if (
    msg.includes("failed to fetch") ||
    msg.includes("network") ||
    msg.includes("offline") ||
    msg.includes("timeout")
  ) {
    return { errorCategory: "NETWORK_ERROR", failedStage: "QUEUED_FOR_SYNC" };
  }
  if (msg.includes("indexeddb") || msg.includes("idb") || msg.includes("quotaexceeded")) {
    return { errorCategory: "LOCAL_STORAGE_ERROR", failedStage: "LOCAL_SAVED" };
  }

  return { errorCategory: "DATABASE_COMMIT_ERROR", failedStage: "FAILED" };
}
