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
export const IDB_DATABASE_VERSION = 3;

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
}

export interface LocalSyncMetadata {
  ownerId: string;
  datasetType: CanonicalDatasetType;
  lastCommittedRevision: number;
  lastCommittedGenerationId: string | null;
  lastSuccessfulSyncAt: string | null;
  updatedAt: string;
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
  };

  return new Promise((resolve, reject) => {
    const tx = createReadWriteTransaction(db, [storeName, IDB_STORES.PENDING_OPERATIONS]);
    const entityStore = tx.objectStore(storeName);
    const outboxStore = tx.objectStore(IDB_STORES.PENDING_OPERATIONS);

    // Prepare entity record for store
    const entityRecord: Record<string, unknown> = {
      ...payload,
      ownerId,
      _localStatus: "PENDING_SYNC",
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

    tx.oncomplete = () => resolve({ ok: true, operationId });
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

    tx.oncomplete = () => resolve({ ok: true, operationId });
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
