import { getOriginDeviceMeta } from "../device/device-identity";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * YouTube Discovery — IndexedDB Local-First Database (2026 Canonical)
 * ──────────────────────────────────────────────────────────────────────────
 * Scope: High-reliability local-first client repository with atomic outbox journal.
 * Database: youtube_discovery_local_v1
 *
 * Guarantees:
 *   1. Zero data loss: Local mutations commit to IndexedDB before UI feedback.
 *   2. Atomic Write-Ahead Outbox: Projection and Outbox mutate in 1 transaction.
 *   3. Multi-User Isolation: Partitioned strictly by Supabase UUID (ownerId).
 *   4. Exactly 5 Canonical Datasets: SAVED_ITEMS, PLAYLIST, SEARCH_HISTORY,
 *      RESEARCH_QUEUE, REFERENCES. (No collections).
 * ═══════════════════════════════════════════════════════════════════════════
 */

export const IDB_DATABASE_NAME = "youtube_discovery_local_v1";
export const IDB_DATABASE_VERSION = 4;

export const CANONICAL_DATASET_TYPES = [
  "SAVED_ITEMS",
  "PLAYLIST",
  "SEARCH_HISTORY",
  "RESEARCH_QUEUE",
  "REFERENCES",
] as const;

export type CanonicalDatasetType = (typeof CANONICAL_DATASET_TYPES)[number];

export const IDB_STORES = {
  SAVED_ITEMS: "entities_saved_items",
  USER_PLAYLISTS: "entities_user_playlists",
  PLAYLIST_GROUPS: "entities_playlist_groups",
  PLAYLIST_ENTRIES: "entities_playlist_entries",
  RESEARCH_QUEUE: "entities_research_queue",
  SAVED_REFERENCES: "entities_saved_references",
  SAVED_SEARCHES: "entities_saved_searches",
  SEARCH_HISTORY: "entities_search_history",
  WORKSPACE_SNAPSHOTS: "workspace_snapshots",
  PENDING_OPERATIONS: "pending_operations",
  LOCAL_SYNC_METADATA: "local_sync_metadata",
  LOCAL_RESEARCH_REMINDERS: "local_research_reminders",
  DATASET_CATALOG: "local_dataset_catalog",
  SYNC_JOURNAL: "sync_journal",
  SYNC_LEASES: "sync_leases",
} as const;

export interface PendingOperation {
  operationId: string;
  ownerId: string;
  datasetType: CanonicalDatasetType;
  entityId: string;
  operationType: "UPSERT" | "APPEND" | "DELETE";
  payload: Record<string, unknown>;
  createdAt: string;
  status: "PENDING" | "IN_FLIGHT" | "SYNCED" | "FAILED";
  errorMessage?: string;
  originDeviceId?: string;
  originDeviceLabel?: string;
}

export interface LocalSyncMetadata {
  ownerId: string;
  datasetType: CanonicalDatasetType;
  lastCommittedRevision: number;
  lastCommittedGenerationId: string | null;
  lastSuccessfulSyncAt: string | null;
  updatedAt: string;
}

export interface LocalDatasetCatalogEntry {
  ownerId: string;
  datasetType: CanonicalDatasetType;
  localRevision: number;
  remoteRevision: number;
  currentLocalGenerationId: string | null;
  lastHydratedGenerationId: string | null;
  lastHydratedRevision: number;
  pendingOperationCount: number;
  estimatedBytes: number;
  lastLocalMutationAt: string | null;
  lastSuccessfulSyncAt: string | null;
  syncStatus: "IDLE" | "SYNCING" | "SYNCED" | "FAILED";
  schemaVersion: number;
}

export interface SyncJournalBatch {
  syncBatchId: string;
  ownerId: string;
  snapshotWatermark: number;
  affectedDatasets: CanonicalDatasetType[];
  expectedRevisions: Record<string, number>;
  targetGenerationIds: Record<string, string>;
  batchStatus: "PENDING" | "UPLOADING" | "COMMITTED" | "FAILED";
  createdAt: string;
  lastAttemptAt: string;
  lastErrorCode?: string;
  recoveryState?: string;
  uploadedObjectReceipts: Array<{ key: string; size: number; sha256: string; etag: string }>;
  dbCommitStatus: "PENDING" | "COMMITTED" | "FAILED";
}

export interface SyncLeaseRecord {
  leaseName: string;
  holderTabId: string;
  acquiredAt: number;
  expiresAt: number;
}

export interface PendingOperationsSummary {
  totalPending: number;
  byDataset: Record<CanonicalDatasetType, number>;
  estimatedBytes: number;
}

let dbPromise: Promise<IDBDatabase> | null = null;

export function openLocalDatabase(): Promise<IDBDatabase> {
  if (typeof window === "undefined" || !window.indexedDB) {
    return Promise.reject(new Error("IndexedDB is only available in browser runtime"));
  }

  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const request = window.indexedDB.open(IDB_DATABASE_NAME, IDB_DATABASE_VERSION);

    request.onerror = () => {
      dbPromise = null;
      reject(request.error || new Error("Failed to open local IndexedDB"));
    };

    request.onsuccess = () => {
      resolve(request.result);
    };

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;

      // 1. entities_saved_items
      if (!db.objectStoreNames.contains(IDB_STORES.SAVED_ITEMS)) {
        const store = db.createObjectStore(IDB_STORES.SAVED_ITEMS, { keyPath: ["ownerId", "platformItemId"] });
        store.createIndex("savedDate", "savedDate", { unique: false });
        store.createIndex("entityType", "entityType", { unique: false });
        store.createIndex("ownerId", "ownerId", { unique: false });
      }

      // 2. entities_user_playlists
      if (!db.objectStoreNames.contains(IDB_STORES.USER_PLAYLISTS)) {
        const store = db.createObjectStore(IDB_STORES.USER_PLAYLISTS, { keyPath: "id" });
        store.createIndex("ownerId_displayOrder", ["ownerId", "displayOrder"], { unique: false });
        store.createIndex("ownerId", "ownerId", { unique: false });
      }

      // 3. entities_playlist_groups
      if (!db.objectStoreNames.contains(IDB_STORES.PLAYLIST_GROUPS)) {
        const store = db.createObjectStore(IDB_STORES.PLAYLIST_GROUPS, { keyPath: "id" });
        store.createIndex("playlistId_position", ["playlistId", "position"], { unique: false });
      }

      // 4. entities_playlist_entries
      if (!db.objectStoreNames.contains(IDB_STORES.PLAYLIST_ENTRIES)) {
        const store = db.createObjectStore(IDB_STORES.PLAYLIST_ENTRIES, { keyPath: "id" });
        store.createIndex("playlistId_position", ["playlistId", "position"], { unique: false });
        store.createIndex("playlistId_groupId", ["playlistId", "groupId"], { unique: false });
      }

      // 5. entities_research_queue
      if (!db.objectStoreNames.contains(IDB_STORES.RESEARCH_QUEUE)) {
        const store = db.createObjectStore(IDB_STORES.RESEARCH_QUEUE, { keyPath: "id" });
        store.createIndex("ownerId_status_queuedAt", ["ownerId", "status", "queuedAt"], { unique: false });
        store.createIndex("ownerId", "ownerId", { unique: false });
      }

      // 6. entities_saved_references
      if (!db.objectStoreNames.contains(IDB_STORES.SAVED_REFERENCES)) {
        const store = db.createObjectStore(IDB_STORES.SAVED_REFERENCES, { keyPath: "id" });
        store.createIndex("ownerId_createdAt", ["ownerId", "createdAt"], { unique: false });
        store.createIndex("ownerId", "ownerId", { unique: false });
      }

      // 7. entities_saved_searches
      if (!db.objectStoreNames.contains(IDB_STORES.SAVED_SEARCHES)) {
        const store = db.createObjectStore(IDB_STORES.SAVED_SEARCHES, { keyPath: "id" });
        store.createIndex("ownerId_isPinned", ["ownerId", "isPinned"], { unique: false });
        store.createIndex("ownerId", "ownerId", { unique: false });
      }

      // 8. entities_search_history
      if (!db.objectStoreNames.contains(IDB_STORES.SEARCH_HISTORY)) {
        const store = db.createObjectStore(IDB_STORES.SEARCH_HISTORY, { keyPath: "id" });
        store.createIndex("ownerId_executedAt", ["ownerId", "executedAt"], { unique: false });
        store.createIndex("ownerId", "ownerId", { unique: false });
      }

      // 9. workspace_snapshots
      if (!db.objectStoreNames.contains(IDB_STORES.WORKSPACE_SNAPSHOTS)) {
        db.createObjectStore(IDB_STORES.WORKSPACE_SNAPSHOTS, { keyPath: ["ownerId", "route"] });
      }

      // 10. pending_operations (outbox)
      let outboxStore: IDBObjectStore;
      if (!db.objectStoreNames.contains(IDB_STORES.PENDING_OPERATIONS)) {
        outboxStore = db.createObjectStore(IDB_STORES.PENDING_OPERATIONS, { keyPath: "operationId" });
      } else {
        outboxStore = (event.target as IDBOpenDBRequest).transaction!.objectStore(IDB_STORES.PENDING_OPERATIONS);
      }

      if (!outboxStore.indexNames.contains("ownerId")) {
        outboxStore.createIndex("ownerId", "ownerId", { unique: false });
      }
      if (!outboxStore.indexNames.contains("ownerId_datasetType")) {
        outboxStore.createIndex("ownerId_datasetType", ["ownerId", "datasetType"], { unique: false });
      }
      if (!outboxStore.indexNames.contains("status")) {
        outboxStore.createIndex("status", "status", { unique: false });
      }

      // 11. local_sync_metadata
      if (!db.objectStoreNames.contains(IDB_STORES.LOCAL_SYNC_METADATA)) {
        db.createObjectStore(IDB_STORES.LOCAL_SYNC_METADATA, { keyPath: ["ownerId", "datasetType"] });
      }

      // 12. local_research_reminders (I Will Search For — 100% Client-Only, NEVER synced to cloud)
      if (!db.objectStoreNames.contains(IDB_STORES.LOCAL_RESEARCH_REMINDERS)) {
        const reminderStore = db.createObjectStore(IDB_STORES.LOCAL_RESEARCH_REMINDERS, { keyPath: "reminderId" });
        reminderStore.createIndex("ownerId", "ownerId", { unique: false });
        reminderStore.createIndex("ownerId_videoId", ["ownerId", "videoId"], { unique: true });
        reminderStore.createIndex("ownerId_status", ["ownerId", "status"], { unique: false });
        reminderStore.createIndex("ownerId_addedAt", ["ownerId", "addedAt"], { unique: false });
      }

      // 13. local_dataset_catalog (Coordinated dataset registry per owner)
      if (!db.objectStoreNames.contains(IDB_STORES.DATASET_CATALOG)) {
        const catStore = db.createObjectStore(IDB_STORES.DATASET_CATALOG, { keyPath: ["ownerId", "datasetType"] });
        catStore.createIndex("ownerId", "ownerId", { unique: false });
      }

      // 14. sync_journal (Durable record of cloud sync batches and receipts)
      if (!db.objectStoreNames.contains(IDB_STORES.SYNC_JOURNAL)) {
        const journalStore = db.createObjectStore(IDB_STORES.SYNC_JOURNAL, { keyPath: "syncBatchId" });
        journalStore.createIndex("ownerId", "ownerId", { unique: false });
        journalStore.createIndex("batchStatus", "batchStatus", { unique: false });
        journalStore.createIndex("createdAt", "createdAt", { unique: false });
      }

      // 15. sync_leases (Multi-tab concurrency lease mutex)
      if (!db.objectStoreNames.contains(IDB_STORES.SYNC_LEASES)) {
        db.createObjectStore(IDB_STORES.SYNC_LEASES, { keyPath: "leaseName" });
      }
    };
  });

  return dbPromise;
}

/**
 * Helper to create an IDBTransaction with durability: "strict" where supported by the browser.
 */
export function createReadWriteTransaction(db: IDBDatabase, storeNames: string[]): IDBTransaction {
  try {
    return (db as unknown as { transaction: (stores: string[], mode: string, options?: { durability: string }) => IDBTransaction }).transaction(
      storeNames,
      "readwrite",
      { durability: "strict" }
    );
  } catch {
    return db.transaction(storeNames, "readwrite");
  }
}

/**
 * Maps a canonical dataset type to its primary IndexedDB store name.
 */
function getStoreNameForDataset(datasetType: CanonicalDatasetType): string {
  switch (datasetType) {
    case "SAVED_ITEMS":
      return IDB_STORES.SAVED_ITEMS;
    case "PLAYLIST":
      return IDB_STORES.USER_PLAYLISTS;
    case "SEARCH_HISTORY":
      return IDB_STORES.SEARCH_HISTORY;
    case "RESEARCH_QUEUE":
      return IDB_STORES.RESEARCH_QUEUE;
    case "REFERENCES":
      return IDB_STORES.SAVED_REFERENCES;
  }
}

/**
 * Commits an entity mutation to IndexedDB projection AND appends a pending operation
 * to the outbox journal in a SINGLE ATOMIC TRANSACTION.
 *
 * This guarantees zero out-of-sync drift between local state and pending cloud sync.
 */
export async function saveEntityLocally(
  ownerId: string,
  datasetType: CanonicalDatasetType,
  entityId: string,
  payload: Record<string, unknown>,
  operationType: "UPSERT" | "APPEND" = "UPSERT"
): Promise<{ ok: boolean; operationId: string }> {
  const db = await openLocalDatabase();
  const storeName = getStoreNameForDataset(datasetType);

  const deviceMeta = getOriginDeviceMeta();
  const operationId = `op_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  const fullOp: PendingOperation = {
    operationId,
    ownerId,
    datasetType,
    entityId,
    operationType,
    payload,
    createdAt: new Date().toISOString(),
    status: "PENDING",
    originDeviceId: deviceMeta.originDeviceId,
    originDeviceLabel: deviceMeta.originDeviceLabel,
  };

  return new Promise((resolve, reject) => {
    const tx = createReadWriteTransaction(db, [storeName, IDB_STORES.PENDING_OPERATIONS]);
    const entityStore = tx.objectStore(storeName);
    const outboxStore = tx.objectStore(IDB_STORES.PENDING_OPERATIONS);

    // Prepare entity record for store
    const entityRecord: Record<string, unknown> = {
      ...payload,
      ownerId,
      _localStatus: "LOCAL_PENDING",
      _syncStatus: "LOCAL",
      _originDeviceId: deviceMeta.originDeviceId,
      _originDeviceLabel: deviceMeta.originDeviceLabel,
      _updatedAt: fullOp.createdAt,
    };

    // Store-specific primary key requirements
    if (datasetType === "SAVED_ITEMS") {
      entityRecord.platformItemId = entityId;
    } else {
      entityRecord.id = entityId;
    }

    entityStore.put(entityRecord);
    outboxStore.add(fullOp);

    tx.oncomplete = () => {
      if (typeof window !== "undefined") {
        window.dispatchEvent(
          new CustomEvent("yt-discovery-local-mutation", {
            detail: { datasetType, entityId, operationType: "UPSERT" },
          })
        );
      }
      resolve({ ok: true, operationId });
    };
    tx.onerror = () => reject(tx.error || new Error(`Failed to commit local ${datasetType} operation`));
  });
}

/**
 * Removes an entity locally and appends a DELETE operation to the outbox atomically.
 */
export async function deleteEntityLocally(
  ownerId: string,
  datasetType: CanonicalDatasetType,
  entityId: string
): Promise<{ ok: boolean; operationId: string }> {
  const db = await openLocalDatabase();
  const storeName = getStoreNameForDataset(datasetType);

  const deviceMeta = getOriginDeviceMeta();
  const operationId = `op_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  const fullOp: PendingOperation = {
    operationId,
    ownerId,
    datasetType,
    entityId,
    operationType: "DELETE",
    payload: { entityId },
    createdAt: new Date().toISOString(),
    status: "PENDING",
    originDeviceId: deviceMeta.originDeviceId,
    originDeviceLabel: deviceMeta.originDeviceLabel,
  };

  return new Promise((resolve, reject) => {
    const tx = createReadWriteTransaction(db, [storeName, IDB_STORES.PENDING_OPERATIONS]);
    const entityStore = tx.objectStore(storeName);
    const outboxStore = tx.objectStore(IDB_STORES.PENDING_OPERATIONS);

    if (datasetType === "SAVED_ITEMS") {
      entityStore.delete([ownerId, entityId]);
    } else {
      entityStore.delete(entityId);
    }

    outboxStore.add(fullOp);

    tx.oncomplete = () => {
      if (typeof window !== "undefined") {
        window.dispatchEvent(
          new CustomEvent("yt-discovery-local-mutation", {
            detail: { datasetType, entityId, operationType: "DELETE" },
          })
        );
      }
      resolve({ ok: true, operationId });
    };
    tx.onerror = () => reject(tx.error || new Error(`Failed to commit local delete on ${datasetType}`));
  });
}

/**
 * Returns all local entity records for an owner and dataset type.
 */
export async function getLocalEntities<T = Record<string, unknown>>(
  ownerId: string,
  datasetType: CanonicalDatasetType
): Promise<T[]> {
  const db = await openLocalDatabase();
  const storeName = getStoreNameForDataset(datasetType);

  return new Promise((resolve, reject) => {
    const tx = db.transaction([storeName], "readonly");
    const store = tx.objectStore(storeName);

    let req: IDBRequest;
    if (store.indexNames.contains("ownerId")) {
      const index = store.index("ownerId");
      req = index.getAll(ownerId);
    } else {
      req = store.getAll();
    }

    req.onsuccess = () => {
      const records = (req.result as Array<Record<string, unknown>>) || [];
      const filtered = records.filter((r) => r.ownerId === ownerId) as T[];
      resolve(filtered);
    };
    req.onerror = () => reject(req.error || new Error(`Failed to read local ${datasetType}`));
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Owner Partition Migration (legacy local owner -> canonical storage owner)
// ─────────────────────────────────────────────────────────────────────────────

export interface LocalOwnerMigrationResult {
  migratedRecords: number;
  migratedOperations: number;
  migratedCatalogEntries: number;
  migratedJournalEntries: number;
  migratedWorkspaceSnapshots: number;
  migratedReminders: number;
  skippedConflicts: number;
}

function readAllFromStore<T>(db: IDBDatabase, storeName: string): Promise<T[]> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction([storeName], "readonly");
    const store = tx.objectStore(storeName);
    const req = store.getAll();
    req.onsuccess = () => resolve((req.result as T[]) || []);
    req.onerror = () => reject(req.error || new Error(`Failed to read ${storeName}`));
  });
}

/**
 * Chooses the freshest timestamp available on a local record. Used only to
 * decide which copy survives when two owner partitions contain the same
 * logical entity during a one-time migration.
 */
function localRecordFreshness(record: Record<string, unknown>): number {
  const candidates = [
    "_updatedAt",
    "updatedAt",
    "lastSuccessfulSyncAt",
    "lastLocalMutationAt",
    "savedAt",
    "createdAt",
    "queuedAt",
    "addedAt",
    "timestamp",
  ];
  for (const key of candidates) {
    const value = record[key];
    if (typeof value === "string") {
      const parsed = Date.parse(value);
      if (!Number.isNaN(parsed)) return parsed;
    }
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return 0;
}

/**
 * Migrates every local-first record from a legacy owner partition to the
 * canonical storage owner UUID.
 *
 * Why this exists:
 *   Older builds used `"asdy-admin"` or the Supabase auth user id as the
 *   IndexedDB owner. Cloud writes and hydration use `storage_owner_uuid`.
 *   Without this migration, previously saved local data becomes invisible to
 *   the canonical sync pipeline and a fresh generation could overwrite it.
 *
 * Safety rules:
 *   - Runs inside IndexedDB read/write transactions per store.
 *   - Never deletes a canonical record in favor of an older legacy copy.
 *   - Pending outbox operations are re-owned, never dropped.
 *   - Idempotent: re-running with the same arguments is a no-op.
 */
export async function migrateLocalOwnerId(
  fromOwnerId: string,
  toOwnerId: string
): Promise<LocalOwnerMigrationResult> {
  const result: LocalOwnerMigrationResult = {
    migratedRecords: 0,
    migratedOperations: 0,
    migratedCatalogEntries: 0,
    migratedJournalEntries: 0,
    migratedWorkspaceSnapshots: 0,
    migratedReminders: 0,
    skippedConflicts: 0,
  };

  const from = fromOwnerId?.trim();
  const to = toOwnerId?.trim();
  if (!from || !to || from === to) return result;

  const db = await openLocalDatabase();

  // 1. Dataset projection stores. SAVED_ITEMS is keyed by
  //    [ownerId, platformItemId]; every other store is keyed by entity id.
  const datasetStores: Array<{ storeName: string; datasetType: CanonicalDatasetType }> = [
    { storeName: IDB_STORES.SAVED_ITEMS, datasetType: "SAVED_ITEMS" },
    { storeName: IDB_STORES.USER_PLAYLISTS, datasetType: "PLAYLIST" },
    { storeName: IDB_STORES.SEARCH_HISTORY, datasetType: "SEARCH_HISTORY" },
    { storeName: IDB_STORES.RESEARCH_QUEUE, datasetType: "RESEARCH_QUEUE" },
    { storeName: IDB_STORES.SAVED_REFERENCES, datasetType: "REFERENCES" },
  ];

  for (const { storeName, datasetType } of datasetStores) {
    const allRecords = await readAllFromStore<Record<string, unknown>>(db, storeName);
    const owned = allRecords.filter((record) => record.ownerId === from);
    if (owned.length === 0) continue;

    const targetByPlatformId = new Map<string, Record<string, unknown>>();
    if (datasetType === "SAVED_ITEMS") {
      for (const record of allRecords) {
        if (record.ownerId !== to) continue;
        const platformItemId = String(record.platformItemId ?? record.id ?? "");
        if (platformItemId) targetByPlatformId.set(platformItemId, record);
      }
    }

    await new Promise<void>((resolve, reject) => {
      const tx = createReadWriteTransaction(db, [storeName]);
      const store = tx.objectStore(storeName);

      for (const record of owned) {
        if (datasetType === "SAVED_ITEMS") {
          const platformItemId = String(record.platformItemId ?? record.id ?? "");
          if (!platformItemId) continue;
          const target = targetByPlatformId.get(platformItemId);

          if (target && localRecordFreshness(target) >= localRecordFreshness(record)) {
            // The canonical copy is newer; drop only the stale legacy copy.
            store.delete([from, platformItemId]);
            result.skippedConflicts += 1;
            continue;
          }

          if (target) store.delete([to, platformItemId]);
          store.delete([from, platformItemId]);
          store.put({ ...record, ownerId: to, platformItemId });
          result.migratedRecords += 1;
          continue;
        }

        // Id-keyed stores cannot contain two rows with the same key, so the
        // record being migrated is by definition the only copy.
        const id = String(record.id ?? "");
        if (!id) continue;
        store.put({ ...record, ownerId: to });
        result.migratedRecords += 1;
      }

      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error(`Failed to migrate ${storeName}`));
    });
  }

  // 2. Outbox operations. Ownership must follow the canonical partition or
  //    `saveAll()` will never see previously queued local changes.
  {
    const allOps = await readAllFromStore<PendingOperation>(db, IDB_STORES.PENDING_OPERATIONS);
    const owned = allOps.filter((op) => op.ownerId === from);
    if (owned.length > 0) {
      await new Promise<void>((resolve, reject) => {
        const tx = createReadWriteTransaction(db, [IDB_STORES.PENDING_OPERATIONS]);
        const store = tx.objectStore(IDB_STORES.PENDING_OPERATIONS);
        for (const op of owned) {
          store.put({ ...op, ownerId: to });
          result.migratedOperations += 1;
        }
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error || new Error("Failed to migrate pending operations"));
      });
    }
  }

  // 3. Dataset catalog and legacy sync metadata (keyed by [ownerId, datasetType]).
  const ownerKeyedStores: Array<{
    storeName: string;
    idField: string;
    counter: "migratedCatalogEntries" | "migratedWorkspaceSnapshots";
  }> = [
    { storeName: IDB_STORES.DATASET_CATALOG, idField: "datasetType", counter: "migratedCatalogEntries" },
    { storeName: IDB_STORES.LOCAL_SYNC_METADATA, idField: "datasetType", counter: "migratedCatalogEntries" },
    { storeName: IDB_STORES.WORKSPACE_SNAPSHOTS, idField: "route", counter: "migratedWorkspaceSnapshots" },
  ];

  for (const { storeName, idField, counter } of ownerKeyedStores) {
    const allRecords = await readAllFromStore<Record<string, unknown>>(db, storeName);
    const owned = allRecords.filter((record) => record.ownerId === from);
    if (owned.length === 0) continue;

    const targetByKey = new Map<string, Record<string, unknown>>();
    for (const record of allRecords) {
      if (record.ownerId !== to) continue;
      const key = String(record[idField] ?? "");
      if (key) targetByKey.set(key, record);
    }

    await new Promise<void>((resolve, reject) => {
      const tx = createReadWriteTransaction(db, [storeName]);
      const store = tx.objectStore(storeName);

      for (const record of owned) {
        const key = String(record[idField] ?? "");
        if (!key) continue;
        const target = targetByKey.get(key);

        if (target && localRecordFreshness(target) >= localRecordFreshness(record)) {
          store.delete([from, key]);
          result.skippedConflicts += 1;
          continue;
        }

        store.delete([from, key]);
        if (target) store.delete([to, key]);
        store.put({ ...record, ownerId: to });
        result[counter] += 1;
      }

      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error(`Failed to migrate ${storeName}`));
    });
  }

  // 4. Sync journal batches (keyed by syncBatchId).
  {
    const batches = await readAllFromStore<SyncJournalBatch>(db, IDB_STORES.SYNC_JOURNAL);
    const owned = batches.filter((batch) => batch.ownerId === from);
    if (owned.length > 0) {
      await new Promise<void>((resolve, reject) => {
        const tx = createReadWriteTransaction(db, [IDB_STORES.SYNC_JOURNAL]);
        const store = tx.objectStore(IDB_STORES.SYNC_JOURNAL);
        for (const batch of owned) {
          store.put({ ...batch, ownerId: to });
          result.migratedJournalEntries += 1;
        }
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error || new Error("Failed to migrate sync journal"));
      });
    }
  }

  // 5. Client-only research reminders. This store has a unique
  //    [ownerId, videoId] index, so a canonical duplicate must win.
  {
    const reminders = await readAllFromStore<Record<string, unknown>>(
      db,
      IDB_STORES.LOCAL_RESEARCH_REMINDERS
    );
    const owned = reminders.filter((reminder) => reminder.ownerId === from);
    if (owned.length > 0) {
      const canonicalVideoIds = new Set(
        reminders
          .filter((reminder) => reminder.ownerId === to)
          .map((reminder) => String(reminder.videoId ?? ""))
          .filter(Boolean)
      );

      await new Promise<void>((resolve, reject) => {
        const tx = createReadWriteTransaction(db, [IDB_STORES.LOCAL_RESEARCH_REMINDERS]);
        const store = tx.objectStore(IDB_STORES.LOCAL_RESEARCH_REMINDERS);
        for (const reminder of owned) {
          const reminderId = String(reminder.reminderId ?? "");
          const videoId = String(reminder.videoId ?? "");
          if (!reminderId) continue;

          if (videoId && canonicalVideoIds.has(videoId)) {
            store.delete(reminderId);
            result.skippedConflicts += 1;
            continue;
          }

          store.put({ ...reminder, ownerId: to });
          result.migratedReminders += 1;
        }
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error || new Error("Failed to migrate research reminders"));
      });
    }
  }

  return result;
}

/**
 * Returns pending outbox operations waiting to be synchronized to Cloudflare R2 / Supabase.
 */
export async function getPendingOperations(ownerId?: string): Promise<PendingOperation[]> {
  const db = await openLocalDatabase();

  return new Promise((resolve, reject) => {
    const tx = db.transaction([IDB_STORES.PENDING_OPERATIONS], "readonly");
    const store = tx.objectStore(IDB_STORES.PENDING_OPERATIONS);
    const req = store.getAll();

    req.onsuccess = () => {
      const ops = (req.result as PendingOperation[]) || [];
      const filtered = ops.filter(
        (op) =>
          (!ownerId || op.ownerId === ownerId) &&
          (op.status === "PENDING" || op.status === "FAILED")
      );
      resolve(filtered);
    };
    req.onerror = () => reject(req.error || new Error("Failed to read pending outbox operations"));
  });
}

/**
 * Returns aggregate metrics of all unsynced operations for the UI sync center and header badge.
 */
export async function getPendingOperationsSummary(ownerId?: string): Promise<PendingOperationsSummary> {
  const ops = await getPendingOperations(ownerId);
  const byDataset: Record<CanonicalDatasetType, number> = {
    SAVED_ITEMS: 0,
    PLAYLIST: 0,
    SEARCH_HISTORY: 0,
    RESEARCH_QUEUE: 0,
    REFERENCES: 0,
  };

  let estimatedBytes = 0;
  for (const op of ops) {
    if (byDataset[op.datasetType] !== undefined) {
      byDataset[op.datasetType]++;
    }
    estimatedBytes += JSON.stringify(op).length;
  }

  return {
    totalPending: ops.length,
    byDataset,
    estimatedBytes,
  };
}

/**
 * Transitions the status of a set of outbox operations (e.g. PENDING -> IN_FLIGHT -> SYNCED).
 */
export async function setOperationsStatus(
  operationIds: string[],
  status: PendingOperation["status"],
  errorMessage?: string
): Promise<void> {
  if (operationIds.length === 0) return;
  const db = await openLocalDatabase();

  return new Promise((resolve, reject) => {
    const tx = db.transaction([IDB_STORES.PENDING_OPERATIONS], "readwrite");
    const store = tx.objectStore(IDB_STORES.PENDING_OPERATIONS);

    for (const id of operationIds) {
      const getReq = store.get(id);
      getReq.onsuccess = () => {
        if (getReq.result) {
          const updated: PendingOperation = {
            ...getReq.result,
            status,
            errorMessage,
          };
          store.put(updated);
        }
      };
    }

    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error("Failed to update operation statuses"));
  });
}

/**
 * Prunes committed operations from the outbox after verified cloud acknowledgement.
 */
export async function pruneCommittedOperations(operationIds: string[]): Promise<void> {
  if (operationIds.length === 0) return;
  const db = await openLocalDatabase();

  return new Promise((resolve, reject) => {
    const tx = db.transaction([IDB_STORES.PENDING_OPERATIONS], "readwrite");
    const store = tx.objectStore(IDB_STORES.PENDING_OPERATIONS);

    for (const id of operationIds) {
      store.delete(id);
    }

    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error("Failed to prune operations"));
  });
}

/**
 * Disaster Recovery Tool: Exports the entire IndexedDB store to an offline JSON backup.
 */
export async function exportLocalDisasterRecoveryBackup(): Promise<string> {
  const db = await openLocalDatabase();
  const backupData: Record<string, unknown[]> = {};

  const storeNames = Array.from(db.objectStoreNames);
  for (const storeName of storeNames) {
    const rows = await new Promise<unknown[]>((resolve, reject) => {
      const tx = db.transaction([storeName], "readonly");
      const store = tx.objectStore(storeName);
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
    backupData[storeName] = rows;
  }

  const exportPayload = {
    $schema: "https://youtube-discovery.app/schemas/disaster-recovery-backup-v1.json",
    exportedAt: new Date().toISOString(),
    databaseName: IDB_DATABASE_NAME,
    version: IDB_DATABASE_VERSION,
    data: backupData,
  };

  return JSON.stringify(exportPayload, null, 2);
}

// ─────────────────────────────────────────────────────────────────────────────
// Coordinated Dataset Catalog Management (Phase 3)
// ─────────────────────────────────────────────────────────────────────────────

export async function getLocalDatasetCatalog(ownerId: string): Promise<LocalDatasetCatalogEntry[]> {
  const db = await openLocalDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction([IDB_STORES.DATASET_CATALOG], "readonly");
    const store = tx.objectStore(IDB_STORES.DATASET_CATALOG);
    const index = store.index("ownerId");
    const req = index.getAll(ownerId);
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error || new Error("Failed to load dataset catalog"));
  });
}

export async function getDatasetCatalogEntry(
  ownerId: string,
  datasetType: CanonicalDatasetType
): Promise<LocalDatasetCatalogEntry | null> {
  const db = await openLocalDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction([IDB_STORES.DATASET_CATALOG], "readonly");
    const store = tx.objectStore(IDB_STORES.DATASET_CATALOG);
    const req = store.get([ownerId, datasetType]);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error || new Error("Failed to load catalog entry"));
  });
}

export async function updateLocalDatasetCatalog(
  ownerId: string,
  datasetType: CanonicalDatasetType,
  entry: Partial<LocalDatasetCatalogEntry>
): Promise<void> {
  const db = await openLocalDatabase();
  return new Promise((resolve, reject) => {
    const tx = createReadWriteTransaction(db, [IDB_STORES.DATASET_CATALOG]);
    const store = tx.objectStore(IDB_STORES.DATASET_CATALOG);
    const getReq = store.get([ownerId, datasetType]);

    getReq.onsuccess = () => {
      const existing = (getReq.result as LocalDatasetCatalogEntry) || {
        ownerId,
        datasetType,
        localRevision: 0,
        remoteRevision: 0,
        currentLocalGenerationId: null,
        lastHydratedGenerationId: null,
        lastHydratedRevision: 0,
        pendingOperationCount: 0,
        estimatedBytes: 0,
        lastLocalMutationAt: null,
        lastSuccessfulSyncAt: null,
        syncStatus: "IDLE",
        schemaVersion: 1,
      };

      const updated: LocalDatasetCatalogEntry = {
        ...existing,
        ...entry,
        ownerId,
        datasetType,
      };

      store.put(updated);
    };

    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error("Failed to update dataset catalog"));
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Sync Journal & Batch Receipts Management (Phase 3)
// ─────────────────────────────────────────────────────────────────────────────

export async function getSyncJournalBatches(ownerId: string): Promise<SyncJournalBatch[]> {
  const db = await openLocalDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction([IDB_STORES.SYNC_JOURNAL], "readonly");
    const store = tx.objectStore(IDB_STORES.SYNC_JOURNAL);
    const index = store.index("ownerId");
    const req = index.getAll(ownerId);
    req.onsuccess = () => {
      const list = (req.result || []) as SyncJournalBatch[];
      list.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      resolve(list);
    };
    req.onerror = () => reject(req.error || new Error("Failed to load sync journal"));
  });
}

export async function recordSyncJournalBatch(batch: SyncJournalBatch): Promise<void> {
  const db = await openLocalDatabase();
  return new Promise((resolve, reject) => {
    const tx = createReadWriteTransaction(db, [IDB_STORES.SYNC_JOURNAL]);
    const store = tx.objectStore(IDB_STORES.SYNC_JOURNAL);
    store.put(batch);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error("Failed to record sync batch journal"));
  });
}

export async function updateSyncJournalBatch(
  syncBatchId: string,
  updates: Partial<SyncJournalBatch>
): Promise<void> {
  const db = await openLocalDatabase();
  return new Promise((resolve, reject) => {
    const tx = createReadWriteTransaction(db, [IDB_STORES.SYNC_JOURNAL]);
    const store = tx.objectStore(IDB_STORES.SYNC_JOURNAL);
    const getReq = store.get(syncBatchId);

    getReq.onsuccess = () => {
      if (getReq.result) {
        store.put({ ...getReq.result, ...updates, syncBatchId });
      }
    };

    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error("Failed to update sync journal batch"));
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Multi-Tab Mutex Lease Helpers (Phase 6)
// ─────────────────────────────────────────────────────────────────────────────

export async function acquireSyncLease(
  leaseName = "global_sync_lease",
  ttlMs = 300000
): Promise<boolean> {
  const db = await openLocalDatabase();
  const tabId = typeof window !== "undefined" ? (window.name ||= `tab_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`) : "server";
  const now = Date.now();

  return new Promise((resolve, reject) => {
    const tx = createReadWriteTransaction(db, [IDB_STORES.SYNC_LEASES]);
    const store = tx.objectStore(IDB_STORES.SYNC_LEASES);
    const req = store.get(leaseName);

    req.onsuccess = () => {
      const current = req.result as SyncLeaseRecord | undefined;
      if (current && current.expiresAt > now && current.holderTabId !== tabId) {
        // Active lease held by another tab
        resolve(false);
        return;
      }

      // Acquire or renew lease
      const record: SyncLeaseRecord = {
        leaseName,
        holderTabId: tabId,
        acquiredAt: now,
        expiresAt: now + ttlMs,
      };
      store.put(record);
      resolve(true);
    };

    req.onerror = () => reject(req.error || new Error("Failed to check sync lease"));
  });
}

export async function releaseSyncLease(leaseName = "global_sync_lease"): Promise<void> {
  const db = await openLocalDatabase();
  return new Promise((resolve, reject) => {
    const tx = createReadWriteTransaction(db, [IDB_STORES.SYNC_LEASES]);
    const store = tx.objectStore(IDB_STORES.SYNC_LEASES);
    store.delete(leaseName);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error("Failed to release sync lease"));
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Cloud Hydration Bulk Insertion (Phase 4)
// ─────────────────────────────────────────────────────────────────────────────

export async function bulkHydrateDatasetEntities(
  ownerId: string,
  datasetType: CanonicalDatasetType,
  entities: Record<string, unknown>[],
  generationId: string,
  revision: number
): Promise<{ insertedCount: number; removedCount: number; preservedPendingCount: number }> {
  const db = await openLocalDatabase();
  const storeName = getStoreNameForDataset(datasetType);

  // Read the current projection and outbox BEFORE opening the write
  // transaction. Pending local mutations must win over the remote snapshot
  // until they are committed; otherwise a hydration could silently revert a
  // user's unsynced edit.
  const existing = await getLocalEntities<Record<string, unknown>>(ownerId, datasetType);
  const pendingOps = (await getPendingOperations(ownerId)).filter(
    (op) => op.datasetType === datasetType
  );
  const pendingEntityIds = new Set(pendingOps.map((op) => op.entityId));

  const entityIdOf = (record: Record<string, unknown>): string =>
    String(record.platformItemId ?? record.id ?? record.recordId ?? "");

  const incomingIds = new Set(entities.map(entityIdOf).filter(Boolean));
  const stale = existing.filter((record) => {
    const id = entityIdOf(record);
    return Boolean(id) && !incomingIds.has(id) && !pendingEntityIds.has(id);
  });

  return new Promise((resolve, reject) => {
    const tx = createReadWriteTransaction(db, [storeName, IDB_STORES.DATASET_CATALOG, IDB_STORES.LOCAL_SYNC_METADATA]);
    const entityStore = tx.objectStore(storeName);
    const catStore = tx.objectStore(IDB_STORES.DATASET_CATALOG);
    const metaStore = tx.objectStore(IDB_STORES.LOCAL_SYNC_METADATA);

    let inserted = 0;

    // Snapshot semantics: remove local records that no longer exist remotely,
    // unless they still have an unsynced outbox operation.
    for (const record of stale) {
      const id = entityIdOf(record);
      if (!id) continue;
      entityStore.delete(datasetType === "SAVED_ITEMS" ? [ownerId, id] : id);
    }

    for (const raw of entities) {
      const id = entityIdOf(raw);
      // A pending local edit is newer than the remote snapshot by definition.
      if (id && pendingEntityIds.has(id)) continue;

      const item = {
        ...raw,
        ownerId,
        _localStatus: "COMMITTED",
        _syncStatus: "CLOUD",
        _generationId: generationId,
        _revision: revision,
      } as Record<string, unknown>;
      // Ensure key fields exist
      if (datasetType === "SAVED_ITEMS" && !item.platformItemId && item.id) {
        item.platformItemId = item.id;
      }
      entityStore.put(item);
      inserted++;
    }

    // Update catalog entry
    const catEntry: LocalDatasetCatalogEntry = {
      ownerId,
      datasetType,
      localRevision: revision,
      remoteRevision: revision,
      currentLocalGenerationId: generationId,
      lastHydratedGenerationId: generationId,
      lastHydratedRevision: revision,
      pendingOperationCount: pendingEntityIds.size,
      estimatedBytes: 0,
      lastLocalMutationAt: new Date().toISOString(),
      lastSuccessfulSyncAt: new Date().toISOString(),
      syncStatus: pendingEntityIds.size > 0 ? "IDLE" : "SYNCED",
      schemaVersion: 1,
    };
    catStore.put(catEntry);

    // Update legacy sync metadata store as well
    const metaEntry: LocalSyncMetadata = {
      ownerId,
      datasetType,
      lastCommittedRevision: revision,
      lastCommittedGenerationId: generationId,
      lastSuccessfulSyncAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    metaStore.put(metaEntry);

    tx.oncomplete = () => {
      if (typeof window !== "undefined") {
        window.dispatchEvent(
          new CustomEvent("yt-discovery-hydration-changed", {
            detail: {
              datasetType,
              insertedCount: inserted,
              removedCount: stale.length,
              preservedPendingCount: pendingEntityIds.size,
              generationId,
              revision,
            },
          })
        );
      }
      resolve({
        insertedCount: inserted,
        removedCount: stale.length,
        preservedPendingCount: pendingEntityIds.size,
      });
    };
    tx.onerror = () => reject(tx.error || new Error("Failed to bulk hydrate entities"));
  });
}

/**
 * Transitions local entities from LOCAL_PENDING to COMMITTED after verified cloud acknowledgement.
 * Updates local catalog and sync metadata.
 */
export async function markEntitiesCommitted(
  ownerId: string,
  datasetType: CanonicalDatasetType,
  entityIds: string[],
  syncMeta: {
    generationId: string;
    revision: number;
    syncedAt: string;
    originDeviceId?: string;
    originDeviceLabel?: string;
  }
): Promise<number> {
  if (entityIds.length === 0) return 0;
  const db = await openLocalDatabase();
  const storeName = getStoreNameForDataset(datasetType);

  return new Promise((resolve, reject) => {
    const tx = createReadWriteTransaction(db, [
      storeName,
      IDB_STORES.DATASET_CATALOG,
      IDB_STORES.LOCAL_SYNC_METADATA,
    ]);
    const entityStore = tx.objectStore(storeName);
    const catStore = tx.objectStore(IDB_STORES.DATASET_CATALOG);
    const metaStore = tx.objectStore(IDB_STORES.LOCAL_SYNC_METADATA);

    let updatedCount = 0;
    for (const id of entityIds) {
      const key = datasetType === "SAVED_ITEMS" ? [ownerId, id] : id;
      const req = entityStore.get(key);
      req.onsuccess = () => {
        const item = req.result as Record<string, unknown> | undefined;
        if (!item && datasetType === "SAVED_ITEMS") {
          const directReq = entityStore.get(id);
          directReq.onsuccess = () => {
            if (directReq.result) {
              const rec = directReq.result as Record<string, unknown>;
              rec._localStatus = "COMMITTED";
              rec._syncStatus = "CLOUD";
              rec._generationId = syncMeta.generationId;
              rec._revision = syncMeta.revision;
              rec._syncedAt = syncMeta.syncedAt;
              if (syncMeta.originDeviceId) rec._originDeviceId = syncMeta.originDeviceId;
              if (syncMeta.originDeviceLabel) rec._originDeviceLabel = syncMeta.originDeviceLabel;
              entityStore.put(rec);
              updatedCount++;
            }
          };
          return;
        }

        if (item) {
          item._localStatus = "COMMITTED";
          item._syncStatus = "CLOUD";
          item._generationId = syncMeta.generationId;
          item._revision = syncMeta.revision;
          item._syncedAt = syncMeta.syncedAt;
          if (syncMeta.originDeviceId) item._originDeviceId = syncMeta.originDeviceId;
          if (syncMeta.originDeviceLabel) item._originDeviceLabel = syncMeta.originDeviceLabel;
          entityStore.put(item);
          updatedCount++;
        }
      };
    }

    // Update catalog entry
    const catEntry: LocalDatasetCatalogEntry = {
      ownerId,
      datasetType,
      localRevision: syncMeta.revision,
      remoteRevision: syncMeta.revision,
      currentLocalGenerationId: syncMeta.generationId,
      lastHydratedGenerationId: syncMeta.generationId,
      lastHydratedRevision: syncMeta.revision,
      pendingOperationCount: 0,
      estimatedBytes: 0,
      lastLocalMutationAt: syncMeta.syncedAt,
      lastSuccessfulSyncAt: syncMeta.syncedAt,
      syncStatus: "SYNCED",
      schemaVersion: 1,
    };
    catStore.put(catEntry);

    // Update sync metadata
    const metaEntry: LocalSyncMetadata = {
      ownerId,
      datasetType,
      lastCommittedRevision: syncMeta.revision,
      lastCommittedGenerationId: syncMeta.generationId,
      lastSuccessfulSyncAt: syncMeta.syncedAt,
      updatedAt: syncMeta.syncedAt,
    };
    metaStore.put(metaEntry);

    tx.oncomplete = () => {
      if (typeof window !== "undefined") {
        window.dispatchEvent(
          new CustomEvent("yt-discovery-local-committed", {
            detail: { datasetType, entityIds, syncMeta },
          })
        );
      }
      resolve(updatedCount);
    };
    tx.onerror = () => reject(tx.error || new Error("Failed to mark entities committed"));
  });
}

/**
 * Reconciles any interrupted sync batches or hanging IN_FLIGHT operations on startup.
 * Guarantees zero data loss if a tab closed or browser crashed during cloud sync.
 */
export async function reconcileInterruptedSyncJournal(ownerId: string): Promise<{
  recoveredOps: number;
  interruptedBatches: number;
}> {
  const db = await openLocalDatabase();

  return new Promise((resolve, reject) => {
    const tx = createReadWriteTransaction(db, [
      IDB_STORES.PENDING_OPERATIONS,
      IDB_STORES.SYNC_JOURNAL,
    ]);
    const outboxStore = tx.objectStore(IDB_STORES.PENDING_OPERATIONS);
    const journalStore = tx.objectStore(IDB_STORES.SYNC_JOURNAL);

    let recoveredOps = 0;
    let interruptedBatches = 0;
    const now = Date.now();
    const STALE_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes

    // 1. Reset any hanging IN_FLIGHT outbox ops back to PENDING
    const outboxReq = outboxStore.getAll();
    outboxReq.onsuccess = () => {
      const ops = (outboxReq.result as PendingOperation[]) || [];
      for (const op of ops) {
        if (op.ownerId === ownerId && op.status === "IN_FLIGHT") {
          const opTime = new Date(op.createdAt).getTime();
          if (now - opTime > STALE_THRESHOLD_MS) {
            op.status = "PENDING";
            outboxStore.put(op);
            recoveredOps++;
          }
        }
      }
    };

    // 2. Mark any dangling UPLOADING journal batches as FAILED
    const journalReq = journalStore.getAll();
    journalReq.onsuccess = () => {
      const batches = (journalReq.result as SyncJournalBatch[]) || [];
      for (const batch of batches) {
        if (batch.ownerId === ownerId && batch.batchStatus === "UPLOADING") {
          const bTime = new Date(batch.createdAt).getTime();
          if (now - bTime > STALE_THRESHOLD_MS) {
            batch.batchStatus = "FAILED";
            batch.lastErrorCode = "INTERRUPTED_SESSION_RECOVERED";
            batch.recoveryState = "Interrupted sync session recovered on startup";
            journalStore.put(batch);
            interruptedBatches++;
          }
        }
      }
    };

    tx.oncomplete = () => resolve({ recoveredOps, interruptedBatches });
    tx.onerror = () => reject(tx.error || new Error("Failed to reconcile sync journal"));
  });
}
