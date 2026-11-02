/**
 * ═══════════════════════════════════════════════════════════════════════════
 * YouTube Discovery — IndexedDB Local-First Database (v1.4)
 * ──────────────────────────────────────────────────────────────────────────
 * Database: youtube_discovery_local_v1
 * Stores:
 *   - entities_saved_items
 *   - entities_user_playlists
 *   - entities_playlist_groups
 *   - entities_playlist_entries
 *   - entities_research_queue
 *   - entities_saved_references
 *   - entities_saved_searches
 *   - entities_search_history
 *   - workspace_snapshots
 *   - pending_operations (atomic write-ahead outbox journal)
 *   - local_sync_metadata
 * ═══════════════════════════════════════════════════════════════════════════
 */

export const IDB_DATABASE_NAME = "youtube_discovery_local_v1";
export const IDB_DATABASE_VERSION = 1;

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
} as const;

export interface PendingOperation {
  operationId: string;
  ownerId: string;
  datasetId: string;
  sequenceNumber: number;
  entityType: string;
  operationType: "INSERT" | "UPDATE" | "DELETE";
  payload: Record<string, unknown>;
  createdAt: string;
  status: "PENDING" | "PROCESSING" | "COMMITTED" | "FAILED";
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
      }

      // 2. entities_user_playlists
      if (!db.objectStoreNames.contains(IDB_STORES.USER_PLAYLISTS)) {
        const store = db.createObjectStore(IDB_STORES.USER_PLAYLISTS, { keyPath: "id" });
        store.createIndex("ownerId_displayOrder", ["ownerId", "displayOrder"], { unique: false });
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
      }

      // 6. entities_saved_references
      if (!db.objectStoreNames.contains(IDB_STORES.SAVED_REFERENCES)) {
        const store = db.createObjectStore(IDB_STORES.SAVED_REFERENCES, { keyPath: "id" });
        store.createIndex("ownerId_createdAt", ["ownerId", "createdAt"], { unique: false });
      }

      // 7. entities_saved_searches
      if (!db.objectStoreNames.contains(IDB_STORES.SAVED_SEARCHES)) {
        const store = db.createObjectStore(IDB_STORES.SAVED_SEARCHES, { keyPath: "id" });
        store.createIndex("ownerId_isPinned", ["ownerId", "isPinned"], { unique: false });
      }

      // 8. entities_search_history
      if (!db.objectStoreNames.contains(IDB_STORES.SEARCH_HISTORY)) {
        const store = db.createObjectStore(IDB_STORES.SEARCH_HISTORY, { keyPath: "id" });
        store.createIndex("ownerId_executedAt", ["ownerId", "executedAt"], { unique: false });
      }

      // 9. workspace_snapshots
      if (!db.objectStoreNames.contains(IDB_STORES.WORKSPACE_SNAPSHOTS)) {
        db.createObjectStore(IDB_STORES.WORKSPACE_SNAPSHOTS, { keyPath: ["ownerId", "route"] });
      }

      // 10. pending_operations (outbox)
      if (!db.objectStoreNames.contains(IDB_STORES.PENDING_OPERATIONS)) {
        const store = db.createObjectStore(IDB_STORES.PENDING_OPERATIONS, { keyPath: "operationId" });
        store.createIndex("ownerId_datasetId", ["ownerId", "datasetId"], { unique: false });
        store.createIndex("status", "status", { unique: false });
      }

      // 11. local_sync_metadata
      if (!db.objectStoreNames.contains(IDB_STORES.LOCAL_SYNC_METADATA)) {
        db.createObjectStore(IDB_STORES.LOCAL_SYNC_METADATA, { keyPath: ["ownerId", "datasetId"] });
      }
    };
  });

  return dbPromise;
}

/**
 * Appends a pending operation to the local write-ahead outbox in an atomic transaction.
 */
export async function appendPendingOperation(operation: Omit<PendingOperation, "operationId" | "createdAt" | "status">): Promise<PendingOperation> {
  const db = await openLocalDatabase();
  const fullOp: PendingOperation = {
    ...operation,
    operationId: `op_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
    createdAt: new Date().toISOString(),
    status: "PENDING",
  };

  return new Promise((resolve, reject) => {
    const tx = db.transaction([IDB_STORES.PENDING_OPERATIONS], "readwrite");
    const store = tx.objectStore(IDB_STORES.PENDING_OPERATIONS);
    const req = store.add(fullOp);

    req.onsuccess = () => resolve(fullOp);
    req.onerror = () => reject(req.error || new Error("Failed to write to outbox journal"));
  });
}

/**
 * Returns all pending outbox operations waiting to be synchronized to the cloud.
 */
export async function getPendingOperations(): Promise<PendingOperation[]> {
  const db = await openLocalDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction([IDB_STORES.PENDING_OPERATIONS], "readonly");
    const store = tx.objectStore(IDB_STORES.PENDING_OPERATIONS);
    const req = store.getAll();

    req.onsuccess = () => {
      const ops = (req.result as PendingOperation[]) || [];
      resolve(ops.filter((op) => op.status === "PENDING" || op.status === "FAILED"));
    };
    req.onerror = () => reject(req.error || new Error("Failed to read pending outbox operations"));
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
