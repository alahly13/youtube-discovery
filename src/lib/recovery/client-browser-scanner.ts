"use client";

import { IDB_DATABASE_NAME, IDB_STORES } from "@/lib/storage/indexeddb-store";

export interface BrowserScanResult {
  indexeddb: Record<string, unknown[]>;
  localStorage: Record<string, string>;
  totalRecords: number;
  totalBytes: number;
  capturedAt: string;
}

/**
 * Scans all client-side IndexedDB stores and localStorage keys in the administrator's browser.
 * Completely read-only and safe.
 */
export async function scanBrowserStorage(): Promise<BrowserScanResult> {
  const result: BrowserScanResult = {
    indexeddb: {},
    localStorage: {},
    totalRecords: 0,
    totalBytes: 0,
    capturedAt: new Date().toISOString(),
  };

  if (typeof window === "undefined") {
    return result;
  }

  // 1. Scan IndexedDB stores
  try {
    if (window.indexedDB) {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const req = window.indexedDB.open(IDB_DATABASE_NAME);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error || new Error("Failed to open IndexedDB"));
      });

      const storeNames = Object.values(IDB_STORES);
      for (const storeName of storeNames) {
        if (!db.objectStoreNames.contains(storeName)) continue;

        try {
          const records = await new Promise<unknown[]>((resolve, reject) => {
            const tx = db.transaction(storeName, "readonly");
            const store = tx.objectStore(storeName);
            const getAllReq = store.getAll();
            getAllReq.onsuccess = () => resolve(getAllReq.result || []);
            getAllReq.onerror = () => reject(getAllReq.error);
          });

          if (records.length > 0) {
            result.indexeddb[storeName] = records;
            result.totalRecords += records.length;
            const sizeStr = JSON.stringify(records);
            result.totalBytes += new Blob([sizeStr]).size;
          }
        } catch {
          // Skip unreadable store
        }
      }
      db.close();
    }
  } catch {
    // IndexedDB not yet created or blocked by permissions
  }

  // 2. Scan LocalStorage for application-specific keys
  try {
    const appKeys = [
      "youtube-discovery-workspace",
      "youtube-discovery-user-playlists",
      "youtube-discovery-theme",
    ];

    for (const key of appKeys) {
      const val = window.localStorage.getItem(key);
      if (val) {
        result.localStorage[key] = val;
        result.totalRecords++;
        result.totalBytes += new Blob([val]).size;
      }
    }
  } catch {
    // LocalStorage blocked
  }

  return result;
}
