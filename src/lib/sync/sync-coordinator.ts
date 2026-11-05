/**
 * ═══════════════════════════════════════════════════════════════════════════
 * YouTube Discovery — Client Sync Coordinator (2026 Production Architecture)
 * ──────────────────────────────────────────────────────────────────────────
 * Scope: Coordinates local-first IndexedDB outbox mutations with Cloudflare R2
 *        and Supabase PostgreSQL via the Next.js /api/sync/save-all pipeline.
 *
 * Guarantees:
 *   1. Zero data loss: Outbox is NEVER pruned until remote confirms commit.
 *   2. Grouped batching: 20 saved items = 1 generation upload, not 20 calls.
 *   3. 12-Hour automated sync schedule + instant manual "Save All" trigger.
 *   4. Zero-op bypass: When pending = 0, no Worker or database requests occur.
 *   5. Robust Concurrency: navigator.locks with IndexedDB Lease Mutex fallback.
 *   6. Resilient Scheduling: 60s ticker + visibilitychange + online catchup.
 *   7. Full Journaling: Records batch lifecycle in IndexedDB sync_journal.
 *   8. Automatic Hydration: Initiates Cloud Hydration on user identity resolution.
 * ═══════════════════════════════════════════════════════════════════════════
 */

import {
  getPendingOperations,
  getPendingOperationsSummary,
  setOperationsStatus,
  pruneCommittedOperations,
  markEntitiesCommitted,
  reconcileInterruptedSyncJournal,
  exportLocalDisasterRecoveryBackup,
  acquireSyncLease,
  releaseSyncLease,
  recordSyncJournalBatch,
  updateSyncJournalBatch,
  getLocalEntities,
  getDatasetCatalogEntry,
  migrateLocalOwnerId,
  type PendingOperation,
  type PendingOperationsSummary,
  type CanonicalDatasetType,
} from "../storage/indexeddb-store";
import { getOriginDeviceMeta } from "../device/device-identity";
import { cloudHydrationService } from "./cloud-hydration-service";

export type SyncStatus = "IDLE" | "SYNCING" | "SYNCED" | "FAILED" | "OFFLINE";

export interface SyncStateEvent {
  status: SyncStatus;
  summary: PendingOperationsSummary;
  lastSuccessfulSyncAt: string | null;
  nextAutoSyncAt: string | null;
  errorMessage?: string;
}

export type SyncStateListener = (event: SyncStateEvent) => void;

const AUTO_SYNC_INTERVAL_HOURS = 12;
const AUTO_SYNC_INTERVAL_MS = AUTO_SYNC_INTERVAL_HOURS * 60 * 60 * 1000;
const STORAGE_SYNC_KEY = "yt_discovery_sync_meta_v1";
const STORAGE_OWNER_KEY = "yt_discovery_owner_id_v1";
const SYNC_MUTEX_NAME = "sync_coordinator_lease";
const SYNC_LEASE_TTL_MS = 60000; // 60 seconds lease TTL

/**
 * Deterministic, retry-stable idempotency key for a dataset batch.
 *
 * A random key on every retry would create a new generation for the same
 * pending operations after a network timeout, duplicating work. Hashing the
 * sorted operation ids keeps the key stable until the outbox actually changes.
 */
function buildStableIdempotencyKey(
  datasetType: CanonicalDatasetType,
  operations: PendingOperation[]
): string {
  const sortedIds = operations.map((op) => op.operationId).sort();
  let hash = 0x811c9dc5;
  const input = `${datasetType}:${sortedIds.join("|")}`;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return `idem_${datasetType.toLowerCase()}_${(hash >>> 0).toString(16)}_${sortedIds.length}`;
}

class SyncCoordinator {
  private status: SyncStatus = "IDLE";
  private listeners = new Set<SyncStateListener>();
  private autoSyncTimer: NodeJS.Timeout | null = null;
  private tickerInterval: NodeJS.Timeout | null = null;
  private retryTimer: NodeJS.Timeout | null = null;
  private retryCount = 0;
  private lastSuccessfulSyncAt: string | null = null;
  private nextAutoSyncAt: string | null = null;
  private broadcastChannel: BroadcastChannel | null = null;
  /**
   * Canonical local/storage owner. Empty until `/api/auth/status` resolves;
   * there is deliberately no shared "asdy-admin" fallback because writing
   * local data under a fake owner makes it invisible to the canonical sync
   * and hydration pipeline.
   */
  private ownerId: string = "";
  private hasHydrated = false;
  private latestSummary: PendingOperationsSummary = {
    totalPending: 0,
    byDataset: {
      SAVED_ITEMS: 0,
      PLAYLIST: 0,
      SEARCH_HISTORY: 0,
      RESEARCH_QUEUE: 0,
      REFERENCES: 0,
    },
    estimatedBytes: 0,
  };

  constructor() {
    if (typeof window !== "undefined") {
      this.initStoragePersistence();
      this.restoreTimestamps();
      this.restoreOwnerId();
      this.initBroadcastChannel();
      this.initAutoSyncScheduler();
      this.initTabProtection();
      this.initNetworkListeners();
      this.autoResolveOwnerId();
      if (this.ownerId) {
        reconcileInterruptedSyncJournal(this.ownerId).catch((err) => {
          console.warn("[sync] Interrupted sync journal reconciliation check deferred:", err);
        });
      }
    }
  }

  private restoreOwnerId() {
    try {
      const stored = localStorage.getItem(STORAGE_OWNER_KEY);
      if (stored && stored.trim() && stored.trim() !== "asdy-admin") {
        this.ownerId = stored.trim();
      }
    } catch {
      // Ignore storage access failures.
    }
  }

  /**
   * Resolves the canonical owner from the authenticated session and migrates
   * any local data previously written under a legacy owner identifier.
   */
  private autoResolveOwnerId() {
    if (typeof fetch === "undefined") return;

    fetch("/api/auth/status", { headers: { "Cache-Control": "no-cache" } })
      .then((res) => (res.ok ? res.json() : null))
      .then(async (data) => {
        const canonical = String(data?.storageOwnerUuid || data?.userId || "").trim();
        if (!canonical) return;

        // Legacy partitions that may still hold unsynced local data.
        const legacyCandidates = new Set<string>(["asdy-admin"]);
        if (this.ownerId) legacyCandidates.add(this.ownerId);
        if (data?.userId) legacyCandidates.add(String(data.userId).trim());
        legacyCandidates.delete(canonical);

        for (const legacy of legacyCandidates) {
          if (!legacy) continue;
          try {
            const migration = await migrateLocalOwnerId(legacy, canonical);
            if (
              migration.migratedRecords > 0 ||
              migration.migratedOperations > 0 ||
              migration.migratedCatalogEntries > 0
            ) {
              console.info(
                `[sync] Migrated local owner partition '${legacy}' to canonical owner '${canonical}'.`
              );
            }
          } catch (err) {
            console.warn(`[sync] Local owner migration '${legacy}' -> '${canonical}' failed:`, err);
          }
        }

        this.setOwnerId(canonical);
      })
      .catch(() => {
        // Offline or unauthenticated: keep the restored owner if available.
      })
      .finally(() => {
        this.triggerInitialHydration();
      });
  }

  private triggerInitialHydration() {
    if (this.hasHydrated || !this.ownerId) return;
    this.hasHydrated = true;

    // Run hydration asynchronously in background
    setTimeout(() => {
      cloudHydrationService
        .hydrateAllDatasets(this.ownerId)
        .then((res) => {
          if (res.restoredRecords > 0) {
            console.info(`[sync] Initial hydration restored ${res.restoredRecords} records.`);
            this.refreshSummary();
          }
        })
        .catch((err) => {
          console.warn("[sync] Initial background hydration check deferred:", err);
        });
    }, 500);
  }

  public setOwnerId(ownerId: string) {
    const clean = ownerId?.trim();
    if (!clean || clean === "asdy-admin") return;

    const changed = clean !== this.ownerId;
    this.ownerId = clean;

    try {
      localStorage.setItem(STORAGE_OWNER_KEY, clean);
    } catch {
      // Ignore storage access failures.
    }

    if (changed) {
      reconcileInterruptedSyncJournal(clean).catch((err) => {
        console.warn("[sync] Interrupted sync journal reconciliation check deferred:", err);
      });
    }

    this.refreshSummary();

    if (changed && typeof window !== "undefined") {
      window.dispatchEvent(
        new CustomEvent("yt-discovery-owner-changed", { detail: { ownerId: clean } })
      );
    }
  }

  public getOwnerId(): string {
    return this.ownerId;
  }

  public subscribe(listener: SyncStateListener): () => void {
    this.listeners.add(listener);
    this.emitCurrentState(listener);
    return () => this.listeners.delete(listener);
  }

  public getStatus(): SyncStatus {
    return this.status;
  }

  private async emitCurrentState(targetListener?: SyncStateListener) {
    let summary: PendingOperationsSummary = {
      totalPending: 0,
      byDataset: {
        SAVED_ITEMS: 0,
        PLAYLIST: 0,
        SEARCH_HISTORY: 0,
        RESEARCH_QUEUE: 0,
        REFERENCES: 0,
      },
      estimatedBytes: 0,
    };

    try {
      summary = await getPendingOperationsSummary(this.ownerId);
    } catch {
      // Fallback
    }

    this.latestSummary = summary;

    const event: SyncStateEvent = {
      status: this.status,
      summary,
      lastSuccessfulSyncAt: this.lastSuccessfulSyncAt,
      nextAutoSyncAt: this.nextAutoSyncAt,
    };

    if (targetListener) {
      targetListener(event);
    } else {
      for (const listener of this.listeners) {
        listener(event);
      }
    }
  }

  public async refreshSummary() {
    await this.emitCurrentState();
  }

  private initStoragePersistence() {
    if (typeof navigator !== "undefined" && navigator.storage && navigator.storage.persist) {
      navigator.storage
        .persist()
        .then((persistent) => {
          if (persistent) {
            console.debug("[sync] Storage persistence granted by browser.");
          }
        })
        .catch(() => {});
    }
  }

  private restoreTimestamps() {
    try {
      const raw = localStorage.getItem(STORAGE_SYNC_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        this.lastSuccessfulSyncAt = parsed.lastSuccessfulSyncAt || null;
        this.nextAutoSyncAt = parsed.nextAutoSyncAt || null;
      }
    } catch {
      // Ignore
    }

    if (!this.nextAutoSyncAt) {
      const next = new Date(Date.now() + AUTO_SYNC_INTERVAL_MS).toISOString();
      this.nextAutoSyncAt = next;
    }
  }

  private persistTimestamps() {
    try {
      localStorage.setItem(
        STORAGE_SYNC_KEY,
        JSON.stringify({
          lastSuccessfulSyncAt: this.lastSuccessfulSyncAt,
          nextAutoSyncAt: this.nextAutoSyncAt,
        })
      );
    } catch {
      // Ignore
    }
  }

  private initBroadcastChannel() {
    try {
      this.broadcastChannel = new BroadcastChannel("youtube_discovery_sync_channel");
      this.broadcastChannel.onmessage = (msg) => {
        if (msg.data?.type === "SYNC_COMPLETED") {
          this.lastSuccessfulSyncAt = msg.data.lastSuccessfulSyncAt;
          this.nextAutoSyncAt = msg.data.nextAutoSyncAt;
          this.status = "SYNCED";
          this.emitCurrentState();
        }
      };
    } catch {
      // Not supported in environment
    }
  }

  private initAutoSyncScheduler() {
    if (this.autoSyncTimer) clearTimeout(this.autoSyncTimer);

    const now = Date.now();
    const nextSyncTime = this.nextAutoSyncAt ? new Date(this.nextAutoSyncAt).getTime() : now;
    const delay = Math.max(1000, nextSyncTime - now);

    this.autoSyncTimer = setTimeout(() => {
      this.saveAll().catch(() => {});
    }, delay);

    // Periodic 60s ticker to prevent sleep/tab throttling drift
    if (this.tickerInterval) clearInterval(this.tickerInterval);
    this.tickerInterval = setInterval(() => {
      this.checkAndCatchUpOverdueSync();
    }, 60000);

    // Visibility / focus listener to catch up if overdue
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") {
          this.checkAndCatchUpOverdueSync();
        }
      });
    }
  }

  private initNetworkListeners() {
    if (typeof window !== "undefined") {
      window.addEventListener("online", () => {
        console.info("[sync] Network online detected. Checking for overdue synchronization.");
        if (this.status === "OFFLINE") {
          this.status = "IDLE";
        }
        this.checkAndCatchUpOverdueSync();
      });

      window.addEventListener("offline", () => {
        console.warn("[sync] Network offline detected. Local changes preserved safely in IndexedDB.");
        this.status = "OFFLINE";
        this.emitCurrentState();
      });
    }
  }

  private checkAndCatchUpOverdueSync() {
    if (!this.nextAutoSyncAt) return;
    const nextTime = new Date(this.nextAutoSyncAt).getTime();
    if (Date.now() >= nextTime && this.status !== "SYNCING") {
      console.info("[sync] Overdue 12-hour sync trigger activated.");
      this.saveAll().catch(() => {});
    }
  }

  private initTabProtection() {
    if (typeof window !== "undefined") {
      window.addEventListener("beforeunload", (e) => {
        if (this.status === "SYNCING") {
          e.preventDefault();
          e.returnValue = "Cloud synchronization is currently in progress. Exiting may interrupt the upload.";
          return e.returnValue;
        }
        if (this.latestSummary && this.latestSummary.totalPending > 0) {
          e.preventDefault();
          e.returnValue = `You have ${this.latestSummary.totalPending} unsynchronized change(s) saved locally in your browser. They are preserved safely in IndexedDB, but have not yet reached the cloud.`;
          return e.returnValue;
        }
      });
    }
  }

  /**
   * Executes the full atomic multi-dataset synchronization saga.
   *
   * Guarantees:
   *  - Zero calls to Worker/database if pending operations == 0.
   *  - Cross-tab concurrency control via navigator.locks + IndexedDB lease mutex.
   *  - Never prunes Outbox until remote server confirms commit.
   *  - Records batch lifecycle in sync_journal.
   */
  public async saveAll(): Promise<{ ok: boolean; syncedCount: number; error?: string }> {
    if (typeof window === "undefined") {
      return { ok: false, syncedCount: 0 };
    }

    if (!navigator.onLine) {
      this.status = "OFFLINE";
      await this.emitCurrentState();
      return { ok: false, syncedCount: 0, error: "Offline: changes preserved locally in IndexedDB" };
    }

    if (this.status === "SYNCING") {
      return { ok: false, syncedCount: 0, error: "Sync already in progress" };
    }

    // Fail closed until the canonical owner is known. Syncing under a guessed
    // owner would either miss pending data or write into the wrong partition.
    if (!this.ownerId) {
      this.status = "FAILED";
      await this.emitCurrentState();
      this.scheduleRetry();
      return {
        ok: false,
        syncedCount: 0,
        error: "Canonical storage owner has not resolved yet. Sign in again or retry shortly.",
      };
    }

    // Pre-check pending operations: zero-op bypass
    let summary: PendingOperationsSummary;
    try {
      summary = await getPendingOperationsSummary(this.ownerId);
    } catch {
      summary = this.latestSummary;
    }

    if (summary.totalPending === 0) {
      console.debug("[sync] No pending operations in outbox. Advancing 12-hour schedule (no-op).");
      this.status = "SYNCED";
      this.lastSuccessfulSyncAt = new Date().toISOString();
      this.nextAutoSyncAt = new Date(Date.now() + AUTO_SYNC_INTERVAL_MS).toISOString();
      this.persistTimestamps();
      this.initAutoSyncScheduler();
      await this.emitCurrentState();
      return { ok: true, syncedCount: 0 };
    }

    // Concurrency control: Try Web Lock first, fallback to IndexedDB lease mutex
    if (typeof navigator !== "undefined" && navigator.locks) {
      return navigator.locks.request("yt_discovery_sync_lock", { ifAvailable: true }, async (lock) => {
        if (!lock) {
          console.debug("[sync] Another tab holds Web Lock. Deferring execution.");
          return { ok: false, syncedCount: 0, error: "Another tab is currently syncing" };
        }
        return this.executeWithLeaseMutex();
      });
    }

    return this.executeWithLeaseMutex();
  }

  /**
   * Acquires the IndexedDB fallback lease mutex before executing the internal sync saga.
   */
  private async executeWithLeaseMutex(): Promise<{ ok: boolean; syncedCount: number; error?: string }> {
    const acquired = await acquireSyncLease(SYNC_MUTEX_NAME, SYNC_LEASE_TTL_MS);

    if (!acquired) {
      console.debug("[sync] Another tab holds the IndexedDB sync lease. Deferring.");
      return { ok: false, syncedCount: 0, error: "Another tab holds the sync lease" };
    }

    try {
      return await this.executeSyncInternal();
    } finally {
      await releaseSyncLease(SYNC_MUTEX_NAME);
    }
  }

  private async executeSyncInternal(): Promise<{ ok: boolean; syncedCount: number; error?: string }> {
    this.status = "SYNCING";
    await this.emitCurrentState();

    const batchId = `batch_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

    try {
      const pendingOps = await getPendingOperations(this.ownerId);

      if (pendingOps.length === 0) {
        this.status = "SYNCED";
        this.lastSuccessfulSyncAt = new Date().toISOString();
        this.nextAutoSyncAt = new Date(Date.now() + AUTO_SYNC_INTERVAL_MS).toISOString();
        this.persistTimestamps();
        this.initAutoSyncScheduler();
        await this.emitCurrentState();
        return { ok: true, syncedCount: 0 };
      }

      // Group operations by datasetType
      const datasetGroups = new Map<CanonicalDatasetType, PendingOperation[]>();
      for (const op of pendingOps) {
        const list = datasetGroups.get(op.datasetType) || [];
        list.push(op);
        datasetGroups.set(op.datasetType, list);
      }

      const allOpIds = pendingOps.map((op) => op.operationId);
      await setOperationsStatus(allOpIds, "IN_FLIGHT");

      const deviceMeta = getOriginDeviceMeta();

      // Build a FULL local snapshot per dataset. The server treats
      // `snapshotRecords` as authoritative and applies DELETE operations on
      // top. Sending deltas only would make every generation a partial dataset
      // and hydration would incorrectly replace the local projection with it.
      const datasetPayloads: Array<{
        datasetType: CanonicalDatasetType;
        idempotencyKey: string;
        expectedRevision?: number;
        originDeviceId: string;
        originDeviceLabel: string;
        operations: Array<{
          operationId: string;
          entityId: string;
          operationType: PendingOperation["operationType"];
          payload: Record<string, unknown>;
          originDeviceId?: string;
          originDeviceLabel?: string;
        }>;
        snapshotRecords: Record<string, unknown>[];
      }> = [];

      for (const [datasetType, ops] of datasetGroups.entries()) {
        const [snapshotRecords, catalog] = await Promise.all([
          getLocalEntities<Record<string, unknown>>(this.ownerId, datasetType),
          getDatasetCatalogEntry(this.ownerId, datasetType).catch(() => null),
        ]);

        // Only send an expected revision when this device has actually
        // hydrated a generation. Otherwise the server would reject a
        // legitimate first sync from a fresh browser.
        const expectedRevision =
          catalog && catalog.lastHydratedGenerationId
            ? catalog.lastHydratedRevision
            : undefined;

        datasetPayloads.push({
          datasetType,
          idempotencyKey: buildStableIdempotencyKey(datasetType, ops),
          expectedRevision,
          originDeviceId: deviceMeta.originDeviceId,
          originDeviceLabel: deviceMeta.originDeviceLabel,
          operations: ops.map((op) => ({
            operationId: op.operationId,
            entityId: op.entityId,
            operationType: op.operationType,
            payload: op.payload,
            originDeviceId: op.originDeviceId || deviceMeta.originDeviceId,
            originDeviceLabel: op.originDeviceLabel || deviceMeta.originDeviceLabel,
          })),
          snapshotRecords,
        });
      }

      const expectedRevisions: Record<string, number> = {};
      for (const payload of datasetPayloads) {
        if (payload.expectedRevision !== undefined) {
          expectedRevisions[payload.datasetType] = payload.expectedRevision;
        }
      }

      // Record sync journal batch in IndexedDB
      await recordSyncJournalBatch({
        syncBatchId: batchId,
        ownerId: this.ownerId,
        snapshotWatermark: Date.now(),
        affectedDatasets: Array.from(datasetGroups.keys()),
        expectedRevisions,
        targetGenerationIds: {},
        batchStatus: "UPLOADING",
        createdAt: new Date().toISOString(),
        lastAttemptAt: new Date().toISOString(),
        uploadedObjectReceipts: [],
        dbCommitStatus: "PENDING",
      });

      const res = await fetch("/api/sync/save-all", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          batchId,
          originDeviceId: deviceMeta.originDeviceId,
          originDeviceLabel: deviceMeta.originDeviceLabel,
          datasets: datasetPayloads,
        }),
      });

      if (res.status === 409) {
        const conflictText = await res.text();
        await updateSyncJournalBatch(batchId, {
          batchStatus: "FAILED",
          dbCommitStatus: "FAILED",
          lastErrorCode: "REVISION_CONFLICT",
          lastAttemptAt: new Date().toISOString(),
        });

        // Another device advanced the dataset. Pull the committed snapshot
        // before retrying; pending local operations are preserved by
        // bulkHydrateDatasetEntities and will be rebased on the next attempt.
        await cloudHydrationService.hydrateAllDatasets(this.ownerId, true);
        throw new Error(
          `Revision conflict: the dataset changed on another device. Latest cloud snapshot restored; local changes remain queued. ${conflictText.slice(0, 300)}`
        );
      }

      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`Sync API rejected with status ${res.status}: ${errText}`);
      }

      const syncResult = (await res.json()) as {
        ok?: boolean;
        results?: Array<{
          datasetType: string;
          generationId: string;
          revision: number;
          syncedOperationIds: string[];
          syncedEntityIds: string[];
        }>;
      };

      if (syncResult.ok !== true || !Array.isArray(syncResult.results) || syncResult.results.length === 0) {
        throw new Error(
          "Sync API returned success without committed dataset results. Outbox preserved."
        );
      }

      // Collect all successfully acknowledged operation IDs
      const committedOpIds: string[] = [];
      let primaryGenerationId: string | undefined;

      for (const r of syncResult.results) {
        if (Array.isArray(r.syncedOperationIds)) {
          committedOpIds.push(...r.syncedOperationIds);
        }
        if (r.generationId && !primaryGenerationId) {
          primaryGenerationId = r.generationId;
        }
        // Mark local entities committed and update catalog/revision
        if (Array.isArray(r.syncedEntityIds) && r.syncedEntityIds.length > 0) {
          await markEntitiesCommitted(this.ownerId, r.datasetType as CanonicalDatasetType, r.syncedEntityIds, {
            generationId: r.generationId,
            revision: r.revision || 1,
            syncedAt: new Date().toISOString(),
            originDeviceId: deviceMeta.originDeviceId,
            originDeviceLabel: deviceMeta.originDeviceLabel,
          });
        }
      }

      if (committedOpIds.length === 0) {
        throw new Error(
          "Sync API acknowledged no committed operations. Outbox preserved to prevent data loss."
        );
      }

      // ONLY AFTER entity state transition, prune confirmed committed operations from IndexedDB Outbox
      await pruneCommittedOperations(committedOpIds);

      // Update sync journal to COMMITTED
      await updateSyncJournalBatch(batchId, {
        batchStatus: "COMMITTED",
        dbCommitStatus: "COMMITTED",
        lastAttemptAt: new Date().toISOString(),
        targetGenerationIds: primaryGenerationId ? { primary: primaryGenerationId } : {},
      });

      // Update timestamps
      const now = new Date().toISOString();
      this.lastSuccessfulSyncAt = now;
      this.nextAutoSyncAt = new Date(Date.now() + AUTO_SYNC_INTERVAL_MS).toISOString();
      this.persistTimestamps();
      this.retryCount = 0; // Reset retry counter on success

      this.status = "SYNCED";
      await this.emitCurrentState();

      // Broadcast to other tabs
      if (this.broadcastChannel) {
        this.broadcastChannel.postMessage({
          type: "SYNC_COMPLETED",
          lastSuccessfulSyncAt: this.lastSuccessfulSyncAt,
          nextAutoSyncAt: this.nextAutoSyncAt,
          syncedCount: pendingOps.length,
        });
      }

      // Reset auto-sync timer for 12 hours
      this.initAutoSyncScheduler();

      return { ok: true, syncedCount: pendingOps.length };
    } catch (err) {
      console.error("[sync] Sync failed, preserving outbox for retry:", err);
      this.status = "FAILED";
      const message = err instanceof Error ? err.message : "Sync failed";

      try {
        const pendingOps = await getPendingOperations(this.ownerId);
        const opIds = pendingOps.map((op) => op.operationId);
        await setOperationsStatus(opIds, "FAILED", message);

        // Update sync journal to FAILED
        await updateSyncJournalBatch(batchId, {
          batchStatus: "FAILED",
          dbCommitStatus: "FAILED",
          lastErrorCode: message,
          lastAttemptAt: new Date().toISOString(),
        });
      } catch {
        // Best effort
      }

      await this.emitCurrentState();

      // Schedule exponential backoff retry without advancing 12-hour schedule
      this.scheduleRetry();

      return { ok: false, syncedCount: 0, error: message };
    }
  }

  /**
   * Exponential backoff retry handler (15s, 30s, 60s, max 5 min).
   * Does NOT advance lastSuccessfulSyncAt or nextAutoSyncAt.
   */
  private scheduleRetry() {
    if (this.retryTimer) clearTimeout(this.retryTimer);

    const backoffMs = Math.min(300000, 15000 * Math.pow(2, this.retryCount));
    this.retryCount++;

    console.info(`[sync] Scheduling retry attempt #${this.retryCount} in ${Math.round(backoffMs / 1000)}s.`);
    this.retryTimer = setTimeout(() => {
      if (this.status !== "SYNCING" && navigator.onLine) {
        this.saveAll().catch(() => {});
      }
    }, backoffMs);
  }

  /**
   * Disaster recovery JSON export
   */
  public async exportOfflineBackup(): Promise<void> {
    const json = await exportLocalDisasterRecoveryBackup();
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `youtube-discovery-offline-backup-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }
}

// Global Client Singleton
export const syncCoordinator = new SyncCoordinator();
