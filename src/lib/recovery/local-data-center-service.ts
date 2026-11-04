"use client";

import { IDB_DATABASE_NAME, IDB_STORES } from "@/lib/storage/indexeddb-store";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * Local Data Center Discovery & Storage Service
 * ──────────────────────────────────────────────────────────────────────────
 * Scope: Local Data Center — Unified Client-Side Browser Storage Inventory
 *
 * Responsibilities:
 *  1. Deep, non-destructive enumeration of all application-owned browser storage:
 *     - IndexedDB (`youtube_discovery_local_v1` across all 11 object stores)
 *     - LocalStorage (all application keys, detecting auth vs content)
 *     - Cache Storage (`window.caches`)
 *     - OPFS (Origin Private File System via `navigator.storage.getDirectory()`)
 *  2. Dataset classification into the 5 canonical types:
 *     - SAVED_ITEMS
 *     - PLAYLIST
 *     - SEARCH_HISTORY
 *     - RESEARCH_QUEUE
 *     - REFERENCES
 *     (Strictly: NO Collections feature)
 *  3. Strict Secret Redaction & Protection:
 *     - Identifies auth tokens, sessions, API keys, passwords as PROTECTED
 *     - Redacts all secrets from data previews
 *     - Prohibits deletion or export of protected/system entries
 *  4. High-integrity targeted deletion:
 *     - Strictly validates confirmation phrase "احذف بياناتي المحلية"
 *     - Deletes only confirmed, eligible records
 *     - Never performs broad wipes like `localStorage.clear()`
 * ═══════════════════════════════════════════════════════════════════════════
 */

export type StorageMechanism =
  | "localStorage"
  | "IndexedDB"
  | "Cache Storage"
  | "OPFS"
  | "Other";

export type LocalDatasetCategory =
  | "SAVED_ITEMS"
  | "PLAYLIST"
  | "SEARCH_HISTORY"
  | "RESEARCH_QUEUE"
  | "REFERENCES";

export type OwnershipClassification = "current_user" | "unknown" | "protected";

export type DeletionEligibility = "eligible" | "protected" | "excluded";

export interface DiscoveredLocalEntry {
  id: string;
  name: string;
  category: LocalDatasetCategory;
  mechanism: StorageMechanism;
  storageKey: string;
  storeName?: string;
  mimeType: string;
  recordCount: number;
  sizeBytes: number;
  timestamp?: string;
  ownership: OwnershipClassification;
  backupEligible: boolean;
  deletionEligible: boolean;
  isProtected: boolean;
  protectionReason?: string;
  previewData?: unknown;
  /**
   * Complete raw data for backup export — full depth, full array length.
   * Only populated during backup collection (not normal scanning) to avoid
   * bloating the UI state. Secrets are still redacted, but content is NOT
   * truncated like previewData is.
   */
  fullBackupData?: unknown;
}

export interface StorageOverviewMetrics {
  totalRecords: number;
  totalFiles: number;
  totalSizeBytes: number;
  supportedMechanismsCount: number;
  currentUserRecords: number;
  unassignedRecords: number;
  protectedEntries: number;
  lastScanTimestamp: string;
  scanStatus:
    | "Not scanned"
    | "Scanning"
    | "Ready"
    | "Preparing archive"
    | "Download ready"
    | "Export completed"
    | "Deletion review required"
    | "Deleting"
    | "Completed"
    | "Partially completed"
    | "Failed";
  authenticatedUserId: string;
}

export interface LocalScanResult {
  metrics: StorageOverviewMetrics;
  entries: DiscoveredLocalEntry[];
}

/**
 * Known sensitive field names that must be redacted from data previews.
 */
const SENSITIVE_KEY_REGEX =
  /(token|secret|password|key|auth|session|credential|access_token|refresh_token|private)/i;

/**
 * Deeply sanitizes an object or value, replacing sensitive keys and secrets.
 */
export function sanitizeForPreview(value: unknown, depth = 0): unknown {
  if (depth > 6) return "[Truncated: Max Depth]";
  if (value === null || value === undefined) return value;

  if (typeof value === "string") {
    // Redact JWTs or bearer tokens
    if (/^[A-Za-z0-9-_=]+\.[A-Za-z0-9-_=]+\.?[A-Za-z0-9-_.+/=]*$/.test(value) && value.length > 30) {
      return "[REDACTED_TOKEN]";
    }
    return value.length > 5000 ? value.slice(0, 5000) + " … [Truncated]" : value;
  }

  if (typeof value !== "object") return value;

  if (Array.isArray(value)) {
    return value.slice(0, 50).map((item) => sanitizeForPreview(item, depth + 1));
  }

  const sanitized: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (SENSITIVE_KEY_REGEX.test(k)) {
      sanitized[k] = "[REDACTED_SECRET]";
    } else {
      sanitized[k] = sanitizeForPreview(v, depth + 1);
    }
  }
  return sanitized;
}

/**
 * Deeply sanitizes for backup export: redacts secrets and tokens but preserves
 * full array lengths, full string content, and deep nesting — unlike the UI
 * preview sanitizer which aggressively truncates for display performance.
 *
 * Depth is capped at 20 (vs 6 for preview) to handle complex nested structures
 * like Zustand-persisted workspace state with full manifest items.
 */
export function sanitizeForBackup(value: unknown, depth = 0): unknown {
  if (depth > 20) return "[Truncated: Max Depth]";
  if (value === null || value === undefined) return value;

  if (typeof value === "string") {
    // Redact JWTs or bearer tokens (same logic as preview)
    if (/^[A-Za-z0-9-_=]+\.[A-Za-z0-9-_=]+\.?[A-Za-z0-9-_.+/=]*$/.test(value) && value.length > 30) {
      return "[REDACTED_TOKEN]";
    }
    // NO string truncation for backup — full content preserved
    return value;
  }

  if (typeof value !== "object") return value;

  if (Array.isArray(value)) {
    // NO array slicing for backup — all items preserved
    return value.map((item) => sanitizeForBackup(item, depth + 1));
  }

  const sanitized: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (SENSITIVE_KEY_REGEX.test(k)) {
      sanitized[k] = "[REDACTED_SECRET]";
    } else {
      sanitized[k] = sanitizeForBackup(v, depth + 1);
    }
  }
  return sanitized;
}

/**
 * Helper to compute size in bytes of a string or JSON-serializable item.
 */
function estimateByteSize(val: unknown): number {
  if (val === null || val === undefined) return 0;
  try {
    const str = typeof val === "string" ? val : JSON.stringify(val);
    return new Blob([str]).size;
  } catch {
    return 64;
  }
}

/**
 * Extracts the inner state object from a Zustand persist envelope.
 * Zustand persist stores data as: { state: { ... }, version: N }
 * Returns the state object if valid, or null.
 */
export function extractZustandState(data: unknown): Record<string, unknown> | null {
  if (!data || typeof data !== "object") return null;
  const obj = data as Record<string, unknown>;
  if ("state" in obj && typeof obj.state === "object" && obj.state !== null) {
    return obj.state as Record<string, unknown>;
  }
  return null;
}

/**
 * Scans all client-side browser storage mechanisms and returns a unified inventory.
 */
export async function scanAllLocalData(authenticatedUserId = "unknown"): Promise<LocalScanResult> {
  const entries: DiscoveredLocalEntry[] = [];
  const mechanismsPresent = new Set<StorageMechanism>();
  let totalRecords = 0;
  let totalFiles = 0;
  let totalSizeBytes = 0;
  let currentUserRecords = 0;
  let unassignedRecords = 0;
  let protectedEntries = 0;

  if (typeof window === "undefined") {
    return {
      metrics: {
        totalRecords: 0,
        totalFiles: 0,
        totalSizeBytes: 0,
        supportedMechanismsCount: 0,
        currentUserRecords: 0,
        unassignedRecords: 0,
        protectedEntries: 0,
        lastScanTimestamp: new Date().toISOString(),
        scanStatus: "Ready",
        authenticatedUserId,
      },
      entries: [],
    };
  }

  // 1. Scan LocalStorage
  try {
    if (window.localStorage) {
      mechanismsPresent.add("localStorage");
      const storageLength = window.localStorage.length;

      for (let i = 0; i < storageLength; i++) {
        const key = window.localStorage.key(i);
        if (!key) continue;

        // Skip browser-internal or non-application keys
        const isAppKey =
          key.startsWith("youtube-discovery") ||
          key.startsWith("yd_") ||
          key.startsWith("sb-") ||
          key.includes("supabase");

        if (!isAppKey) continue;

        const rawValue = window.localStorage.getItem(key);
        const sizeBytes = estimateByteSize(rawValue);
        totalSizeBytes += sizeBytes;

        // Detect system / auth / protected keys
        const isProtectedAuth =
          key.startsWith("sb-") ||
          key.includes("supabase.auth") ||
          key === "youtube-discovery-theme";

        let category: LocalDatasetCategory = "SAVED_ITEMS";
        if (key.includes("playlist")) category = "PLAYLIST";
        else if (key.includes("history") || key.includes("search")) category = "SEARCH_HISTORY";
        else if (key.includes("queue")) category = "RESEARCH_QUEUE";
        else if (key.includes("ref")) category = "REFERENCES";

        let parsedData: unknown = rawValue;
        try {
          if (rawValue) parsedData = JSON.parse(rawValue);
        } catch {
          // Leave as plain text
        }

        const isProtected = isProtectedAuth;
        const ownership: OwnershipClassification = isProtected
          ? "protected"
          : authenticatedUserId !== "unknown"
          ? "current_user"
          : "unknown";

        if (isProtected) {
          protectedEntries++;
          totalRecords++;
          totalFiles++;

          entries.push({
            id: `ls-${key}`,
            name: key,
            category,
            mechanism: "localStorage",
            storageKey: key,
            mimeType: typeof parsedData === "object" ? "application/json" : "text/plain",
            recordCount: Array.isArray(parsedData) ? parsedData.length : 1,
            sizeBytes,
            timestamp: new Date().toISOString(),
            ownership,
            backupEligible: false,
            deletionEligible: false,
            isProtected: true,
            protectionReason: "Authentication session token or core application configuration protected from deletion.",
            previewData: null,
          });
          continue;
        }

        // Check if this is a Zustand persisted store with structured datasets
        const zustandState = extractZustandState(parsedData);

        if (zustandState && key === "youtube-discovery-workspace") {
          const datasetExtractors: Array<{
            field: string;
            category: LocalDatasetCategory;
            label: string;
          }> = [
            { field: "savedItems", category: "SAVED_ITEMS", label: "Saved Items (Videos, Channels, Playlists)" },
            { field: "savedSearches", category: "REFERENCES", label: "Saved Searches" },
            { field: "searchHistory", category: "SEARCH_HISTORY", label: "Search History" },
            { field: "savedManifestIds", category: "SAVED_ITEMS", label: "Saved Manifest IDs" },
          ];

          let unpackedAny = false;
          for (const { field, category: cat, label } of datasetExtractors) {
            const fieldData = zustandState[field];
            if (!fieldData || (Array.isArray(fieldData) && fieldData.length === 0)) continue;

            unpackedAny = true;
            const fieldSize = estimateByteSize(fieldData);
            const recordCount = Array.isArray(fieldData) ? fieldData.length : 1;

            totalRecords += recordCount;
            totalFiles++;
            if (ownership === "current_user") {
              currentUserRecords += recordCount;
            } else {
              unassignedRecords += recordCount;
            }

            entries.push({
              id: `ls-workspace-${field}`,
              name: `${label} (${recordCount} items)`,
              category: cat,
              mechanism: "localStorage",
              storageKey: `${key}::${field}`,
              mimeType: "application/json",
              recordCount,
              sizeBytes: fieldSize,
              timestamp: new Date().toISOString(),
              ownership,
              backupEligible: true,
              deletionEligible: true,
              isProtected: false,
              previewData: sanitizeForPreview(fieldData),
            });
          }

          if (!unpackedAny) {
            totalRecords++;
            totalFiles++;
            if (ownership === "current_user") currentUserRecords++;
            else unassignedRecords++;

            entries.push({
              id: `ls-${key}`,
              name: `${key} (workspace state)`,
              category: "SAVED_ITEMS",
              mechanism: "localStorage",
              storageKey: key,
              mimeType: "application/json",
              recordCount: 1,
              sizeBytes,
              timestamp: new Date().toISOString(),
              ownership,
              backupEligible: true,
              deletionEligible: true,
              isProtected: false,
              previewData: sanitizeForPreview(parsedData),
            });
          }
        } else if (zustandState && key === "youtube-discovery-user-playlists") {
          let unpackedAny = false;
          if (Array.isArray(zustandState.index) && zustandState.index.length > 0) {
            unpackedAny = true;
            const idxCount = zustandState.index.length;
            totalRecords += idxCount;
            totalFiles++;
            if (ownership === "current_user") currentUserRecords += idxCount;
            else unassignedRecords += idxCount;

            entries.push({
              id: "ls-user-playlists-index",
              name: `User Playlists Index (${idxCount} playlists)`,
              category: "PLAYLIST",
              mechanism: "localStorage",
              storageKey: `${key}::index`,
              mimeType: "application/json",
              recordCount: idxCount,
              sizeBytes: estimateByteSize(zustandState.index),
              timestamp: new Date().toISOString(),
              ownership,
              backupEligible: true,
              deletionEligible: true,
              isProtected: false,
              previewData: sanitizeForPreview(zustandState.index),
            });
          }

          if (zustandState.manifests && typeof zustandState.manifests === "object") {
            const manifestKeys = Object.keys(zustandState.manifests);
            if (manifestKeys.length > 0) {
              unpackedAny = true;
              const manifestCount = manifestKeys.length;
              totalRecords += manifestCount;
              totalFiles++;
              if (ownership === "current_user") currentUserRecords += manifestCount;
              else unassignedRecords += manifestCount;

              entries.push({
                id: "ls-user-playlists-manifests",
                name: `User Playlist Manifests (${manifestCount} manifests)`,
                category: "PLAYLIST",
                mechanism: "localStorage",
                storageKey: `${key}::manifests`,
                mimeType: "application/json",
                recordCount: manifestCount,
                sizeBytes: estimateByteSize(zustandState.manifests),
                timestamp: new Date().toISOString(),
                ownership,
                backupEligible: true,
                deletionEligible: true,
                isProtected: false,
                previewData: sanitizeForPreview(zustandState.manifests),
              });
            }
          }

          if (!unpackedAny) {
            totalRecords++;
            totalFiles++;
            if (ownership === "current_user") currentUserRecords++;
            else unassignedRecords++;

            entries.push({
              id: `ls-${key}`,
              name: `${key} (playlists state)`,
              category: "PLAYLIST",
              mechanism: "localStorage",
              storageKey: key,
              mimeType: "application/json",
              recordCount: 1,
              sizeBytes,
              timestamp: new Date().toISOString(),
              ownership,
              backupEligible: true,
              deletionEligible: true,
              isProtected: false,
              previewData: sanitizeForPreview(parsedData),
            });
          }
        } else {
          if (ownership === "current_user") {
            currentUserRecords++;
          } else {
            unassignedRecords++;
          }

          totalRecords++;
          totalFiles++;

          entries.push({
            id: `ls-${key}`,
            name: key,
            category,
            mechanism: "localStorage",
            storageKey: key,
            mimeType: typeof parsedData === "object" ? "application/json" : "text/plain",
            recordCount: Array.isArray(parsedData) ? parsedData.length : 1,
            sizeBytes,
            timestamp: new Date().toISOString(),
            ownership,
            backupEligible: true,
            deletionEligible: true,
            isProtected: false,
            previewData: sanitizeForPreview(parsedData),
          });
        }
      }
    }
  } catch (err) {
    console.warn("[LocalDataCenter] LocalStorage scan warning:", err);
  }

  // 2. Scan IndexedDB
  try {
    if (window.indexedDB) {
      mechanismsPresent.add("IndexedDB");

      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const req = window.indexedDB.open(IDB_DATABASE_NAME);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error || new Error("Failed to open IndexedDB"));
      });

      const storeNames = Object.values(IDB_STORES) as string[];
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

          if (records.length === 0) continue;

          // Map store to category
          let category: LocalDatasetCategory = "SAVED_ITEMS";
          if (
            storeName === IDB_STORES.USER_PLAYLISTS ||
            storeName === IDB_STORES.PLAYLIST_GROUPS ||
            storeName === IDB_STORES.PLAYLIST_ENTRIES
          ) {
            category = "PLAYLIST";
          } else if (
            storeName === IDB_STORES.SEARCH_HISTORY ||
            storeName === IDB_STORES.SAVED_SEARCHES
          ) {
            category = "SEARCH_HISTORY";
          } else if (
            storeName === IDB_STORES.RESEARCH_QUEUE ||
            storeName === IDB_STORES.WORKSPACE_SNAPSHOTS ||
            storeName === IDB_STORES.LOCAL_RESEARCH_REMINDERS
          ) {
            category = "RESEARCH_QUEUE";
          } else if (storeName === IDB_STORES.SAVED_REFERENCES) {
            category = "REFERENCES";
          }

          const sizeBytes = estimateByteSize(records);
          totalSizeBytes += sizeBytes;
          totalRecords += records.length;
          totalFiles++;

          const isProtected = storeName === IDB_STORES.LOCAL_SYNC_METADATA;
          const isLocalOnly = storeName === IDB_STORES.LOCAL_RESEARCH_REMINDERS;
          const ownership: OwnershipClassification = isProtected
            ? "protected"
            : authenticatedUserId !== "unknown"
            ? "current_user"
            : "unknown";

          if (isProtected) {
            protectedEntries++;
          } else if (ownership === "current_user") {
            currentUserRecords += records.length;
          } else {
            unassignedRecords += records.length;
          }

          const displayName = isLocalOnly
            ? `local_research_reminders (${records.length} records) [LOCAL ONLY — NOT CLOUD SYNCED]`
            : `${storeName} (${records.length} records)`;

          entries.push({
            id: `idb-${storeName}`,
            name: displayName,
            category,
            mechanism: "IndexedDB",
            storageKey: `${IDB_DATABASE_NAME}:${storeName}`,
            storeName,
            mimeType: "application/json",
            recordCount: records.length,
            sizeBytes,
            timestamp: new Date().toISOString(),
            ownership,
            backupEligible: !isProtected,
            deletionEligible: !isProtected,
            isProtected,
            protectionReason: isProtected
              ? "Internal synchronization metadata protected from deletion."
              : isLocalOnly
              ? "Local-only research reminders (never cloud-synced)."
              : undefined,
            previewData: isProtected ? null : sanitizeForPreview(records),
          });
        } catch (storeErr) {
          console.warn(`[LocalDataCenter] IndexedDB store ${storeName} read warning:`, storeErr);
        }
      }
      db.close();
    }
  } catch (idbErr) {
    console.warn("[LocalDataCenter] IndexedDB scan warning:", idbErr);
  }

  // 3. Scan Cache Storage
  try {
    if (typeof window !== "undefined" && "caches" in window) {
      mechanismsPresent.add("Cache Storage");
      const cacheNames = await window.caches.keys();

      for (const cacheName of cacheNames) {
        try {
          const cache = await window.caches.open(cacheName);
          const requests = await cache.keys();

          if (requests.length === 0) continue;

          let category: LocalDatasetCategory = "SAVED_ITEMS";
          if (cacheName.includes("playlist")) category = "PLAYLIST";
          else if (cacheName.includes("search")) category = "SEARCH_HISTORY";

          const sizeBytes = requests.length * 2048; // Estimate cached entry size
          totalSizeBytes += sizeBytes;
          totalRecords += requests.length;
          totalFiles++;

          const isProtected = cacheName.includes("next") || cacheName.includes("static");

          if (isProtected) {
            protectedEntries++;
          } else {
            currentUserRecords += requests.length;
          }

          entries.push({
            id: `cache-${cacheName}`,
            name: `Cache: ${cacheName} (${requests.length} URLs)`,
            category,
            mechanism: "Cache Storage",
            storageKey: cacheName,
            mimeType: "application/x-http-cache",
            recordCount: requests.length,
            sizeBytes,
            timestamp: new Date().toISOString(),
            ownership: isProtected ? "protected" : "current_user",
            backupEligible: !isProtected,
            deletionEligible: !isProtected,
            isProtected,
            protectionReason: isProtected ? "Framework static cache protected from deletion." : undefined,
            previewData: requests.slice(0, 20).map((r) => r.url),
          });
        } catch {
          // Skip unreadable cache
        }
      }
    }
  } catch (cacheErr) {
    console.warn("[LocalDataCenter] Cache Storage scan warning:", cacheErr);
  }

  // 4. Scan OPFS (Origin Private File System)
  try {
    if (typeof navigator !== "undefined" && navigator.storage && "getDirectory" in navigator.storage) {
      mechanismsPresent.add("OPFS");
      try {
        const rootDir = await navigator.storage.getDirectory();
        // Traverse root entries if supported
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const anyDir = rootDir as any;
        if (typeof anyDir.values === "function") {
          for await (const entry of anyDir.values()) {
            if (entry.kind === "file") {
              const fileHandle = entry as FileSystemFileHandle;
              const file = await fileHandle.getFile();
              totalSizeBytes += file.size;
              totalRecords++;
              totalFiles++;
              currentUserRecords++;

              entries.push({
                id: `opfs-${file.name}`,
                name: file.name,
                category: "SAVED_ITEMS",
                mechanism: "OPFS",
                storageKey: file.name,
                mimeType: file.type || "application/octet-stream",
                recordCount: 1,
                sizeBytes: file.size,
                timestamp: new Date(file.lastModified).toISOString(),
                ownership: "current_user",
                backupEligible: true,
                deletionEligible: true,
                isProtected: false,
                previewData: `[OPFS Binary File: ${file.name}, ${file.size} bytes]`,
              });
            }
          }
        }
      } catch {
        // OPFS permission or empty
      }
    }
  } catch (opfsErr) {
    console.warn("[LocalDataCenter] OPFS scan warning:", opfsErr);
  }

  return {
    metrics: {
      totalRecords,
      totalFiles,
      totalSizeBytes,
      supportedMechanismsCount: mechanismsPresent.size,
      currentUserRecords,
      unassignedRecords,
      protectedEntries,
      lastScanTimestamp: new Date().toISOString(),
      scanStatus: "Ready",
      authenticatedUserId,
    },
    entries,
  };
}

/**
 * Expected strict Arabic confirmation phrase for permanent deletion.
 */
export const REQUIRED_DELETION_PHRASE = "احذف بياناتي المحلية";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * Full Backup Data Collector
 * ──────────────────────────────────────────────────────────────────────────
 * Performs a deep, non-truncated extraction of all eligible browser storage
 * for complete backup export. Unlike scanAllLocalData() which populates
 * `previewData` with truncated snippets (50 items, 5000 chars, depth 6),
 * this function populates `fullBackupData` with complete content (all items,
 * full strings, depth 20) while still redacting secrets and auth tokens.
 *
 * Key differences from scan preview:
 *   - Zustand `savedItems` arrays: ALL items exported (not limited to 50)
 *   - Long descriptions/notes: full text preserved (not cut at 5000 chars)
 *   - Deep nested manifests: full depth traversal (20 vs 6)
 *   - IndexedDB stores: ALL records exported with complete payloads
 *
 * Safety: Protected entries (auth tokens, sessions) are ALWAYS excluded.
 * ═══════════════════════════════════════════════════════════════════════════
 */
export async function collectFullBackupData(
  authenticatedUserId = "unknown"
): Promise<DiscoveredLocalEntry[]> {
  const entries: DiscoveredLocalEntry[] = [];

  if (typeof window === "undefined") return entries;

  // 1. Collect full localStorage data
  try {
    if (window.localStorage) {
      const storageLength = window.localStorage.length;

      for (let i = 0; i < storageLength; i++) {
        const key = window.localStorage.key(i);
        if (!key) continue;

        // Same app-key filter as scanner
        const isAppKey =
          key.startsWith("youtube-discovery") ||
          key.startsWith("yd_") ||
          key.startsWith("sb-") ||
          key.includes("supabase");

        if (!isAppKey) continue;

        const rawValue = window.localStorage.getItem(key);
        const sizeBytes = estimateByteSize(rawValue);

        // Same protected-key detection as scanner
        const isProtectedAuth =
          key.startsWith("sb-") ||
          key.includes("supabase.auth") ||
          key === "youtube-discovery-theme";

        if (isProtectedAuth) continue; // Skip protected entries entirely for backup

        let category: LocalDatasetCategory = "SAVED_ITEMS";
        if (key.includes("playlist")) category = "PLAYLIST";
        else if (key.includes("history") || key.includes("search")) category = "SEARCH_HISTORY";
        else if (key.includes("queue")) category = "RESEARCH_QUEUE";
        else if (key.includes("ref")) category = "REFERENCES";

        let parsedData: unknown = rawValue;
        try {
          if (rawValue) parsedData = JSON.parse(rawValue);
        } catch {
          // Leave as plain text
        }

        // For Zustand stores, extract specific dataset arrays for cleaner backup structure.
        // The "youtube-discovery-workspace" key contains savedItems, savedSearches, etc.
        // wrapped in a Zustand persist envelope: { state: { savedItems: [...], ... }, version: N }
        const zustandState = extractZustandState(parsedData);

        if (zustandState && key === "youtube-discovery-workspace") {
          // Emit separate entries for each meaningful dataset within the Zustand store
          const datasetExtractors: Array<{
            field: string;
            category: LocalDatasetCategory;
            label: string;
          }> = [
            { field: "savedItems", category: "SAVED_ITEMS", label: "Saved Items (Videos, Channels, Playlists)" },
            { field: "savedSearches", category: "REFERENCES", label: "Saved Search Titles & Queries" },
            { field: "searchHistory", category: "SEARCH_HISTORY", label: "Search History Records" },
            { field: "savedManifestIds", category: "SAVED_ITEMS", label: "Saved Manifest IDs" },
          ];

          for (const { field, category: cat, label } of datasetExtractors) {
            const fieldData = zustandState[field];
            if (!fieldData || (Array.isArray(fieldData) && fieldData.length === 0)) continue;

            const fieldSize = estimateByteSize(fieldData);
            const recordCount = Array.isArray(fieldData) ? fieldData.length : 1;

            entries.push({
              id: `ls-workspace-${field}`,
              name: `${label} (from workspace store)`,
              category: cat,
              mechanism: "localStorage",
              storageKey: `${key}::${field}`,
              mimeType: "application/json",
              recordCount,
              sizeBytes: fieldSize,
              timestamp: new Date().toISOString(),
              ownership: authenticatedUserId !== "unknown" ? "current_user" : "unknown",
              backupEligible: true,
              deletionEligible: true,
              isProtected: false,
              previewData: sanitizeForPreview(fieldData),
              fullBackupData: sanitizeForBackup(fieldData),
            });
          }

          // Also export the complete workspace state as a single entry for full restore capability
          entries.push({
            id: `ls-${key}-full`,
            name: `${key} (complete workspace state)`,
            category: "SAVED_ITEMS",
            mechanism: "localStorage",
            storageKey: key,
            mimeType: "application/json",
            recordCount: Array.isArray(zustandState.savedItems) ? zustandState.savedItems.length : 1,
            sizeBytes,
            timestamp: new Date().toISOString(),
            ownership: authenticatedUserId !== "unknown" ? "current_user" : "unknown",
            backupEligible: true,
            deletionEligible: true,
            isProtected: false,
            previewData: sanitizeForPreview(parsedData),
            fullBackupData: sanitizeForBackup(parsedData),
          });
        } else if (zustandState && key === "youtube-discovery-user-playlists") {
          if (Array.isArray(zustandState.index) && zustandState.index.length > 0) {
            const idxCount = zustandState.index.length;
            entries.push({
              id: "ls-user-playlists-index",
              name: `User Playlists Index (${idxCount} playlists)`,
              category: "PLAYLIST",
              mechanism: "localStorage",
              storageKey: `${key}::index`,
              mimeType: "application/json",
              recordCount: idxCount,
              sizeBytes: estimateByteSize(zustandState.index),
              timestamp: new Date().toISOString(),
              ownership: authenticatedUserId !== "unknown" ? "current_user" : "unknown",
              backupEligible: true,
              deletionEligible: true,
              isProtected: false,
              previewData: sanitizeForPreview(zustandState.index),
              fullBackupData: sanitizeForBackup(zustandState.index),
            });
          }

          if (zustandState.manifests && typeof zustandState.manifests === "object") {
            const manifestCount = Object.keys(zustandState.manifests).length;
            if (manifestCount > 0) {
              entries.push({
                id: "ls-user-playlists-manifests",
                name: `User Playlist Manifests (${manifestCount} manifests)`,
                category: "PLAYLIST",
                mechanism: "localStorage",
                storageKey: `${key}::manifests`,
                mimeType: "application/json",
                recordCount: manifestCount,
                sizeBytes: estimateByteSize(zustandState.manifests),
                timestamp: new Date().toISOString(),
                ownership: authenticatedUserId !== "unknown" ? "current_user" : "unknown",
                backupEligible: true,
                deletionEligible: true,
                isProtected: false,
                previewData: sanitizeForPreview(zustandState.manifests),
                fullBackupData: sanitizeForBackup(zustandState.manifests),
              });
            }
          }

          entries.push({
            id: `ls-${key}-full`,
            name: `${key} (complete playlists store)`,
            category: "PLAYLIST",
            mechanism: "localStorage",
            storageKey: key,
            mimeType: "application/json",
            recordCount: Array.isArray(zustandState.index) ? zustandState.index.length : 1,
            sizeBytes,
            timestamp: new Date().toISOString(),
            ownership: authenticatedUserId !== "unknown" ? "current_user" : "unknown",
            backupEligible: true,
            deletionEligible: true,
            isProtected: false,
            previewData: sanitizeForPreview(parsedData),
            fullBackupData: sanitizeForBackup(parsedData),
          });
        } else {
          // Non-Zustand localStorage key — export as single entry with full data
          entries.push({
            id: `ls-${key}`,
            name: key,
            category,
            mechanism: "localStorage",
            storageKey: key,
            mimeType: typeof parsedData === "object" ? "application/json" : "text/plain",
            recordCount: Array.isArray(parsedData) ? parsedData.length : 1,
            sizeBytes,
            timestamp: new Date().toISOString(),
            ownership: authenticatedUserId !== "unknown" ? "current_user" : "unknown",
            backupEligible: true,
            deletionEligible: true,
            isProtected: false,
            previewData: sanitizeForPreview(parsedData),
            fullBackupData: sanitizeForBackup(parsedData),
          });
        }
      }
    }
  } catch (err) {
    console.warn("[LocalDataCenter] Backup localStorage collection warning:", err);
  }

  // 2. Collect full IndexedDB data
  try {
    if (window.indexedDB) {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const req = window.indexedDB.open(IDB_DATABASE_NAME);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error || new Error("Failed to open IndexedDB"));
      });

      const storeNames = Object.values(IDB_STORES) as string[];
      for (const storeName of storeNames) {
        if (!db.objectStoreNames.contains(storeName)) continue;

        // Skip sync metadata — protected internal state
        if (storeName === IDB_STORES.LOCAL_SYNC_METADATA) continue;

        try {
          const records = await new Promise<unknown[]>((resolve, reject) => {
            const tx = db.transaction(storeName, "readonly");
            const store = tx.objectStore(storeName);
            const getAllReq = store.getAll();
            getAllReq.onsuccess = () => resolve(getAllReq.result || []);
            getAllReq.onerror = () => reject(getAllReq.error);
          });

          if (records.length === 0) continue;

          // Map store to category (same logic as scanner)
          let category: LocalDatasetCategory = "SAVED_ITEMS";
          if (
            storeName === IDB_STORES.USER_PLAYLISTS ||
            storeName === IDB_STORES.PLAYLIST_GROUPS ||
            storeName === IDB_STORES.PLAYLIST_ENTRIES
          ) {
            category = "PLAYLIST";
          } else if (
            storeName === IDB_STORES.SEARCH_HISTORY ||
            storeName === IDB_STORES.SAVED_SEARCHES
          ) {
            category = "SEARCH_HISTORY";
          } else if (
            storeName === IDB_STORES.RESEARCH_QUEUE ||
            storeName === IDB_STORES.WORKSPACE_SNAPSHOTS ||
            storeName === IDB_STORES.LOCAL_RESEARCH_REMINDERS
          ) {
            category = "RESEARCH_QUEUE";
          } else if (storeName === IDB_STORES.SAVED_REFERENCES) {
            category = "REFERENCES";
          }

          const sizeBytes = estimateByteSize(records);

          entries.push({
            id: `idb-${storeName}`,
            name: `${storeName} (${records.length} records)`,
            category,
            mechanism: "IndexedDB",
            storageKey: `${IDB_DATABASE_NAME}:${storeName}`,
            storeName,
            mimeType: "application/json",
            recordCount: records.length,
            sizeBytes,
            timestamp: new Date().toISOString(),
            ownership: authenticatedUserId !== "unknown" ? "current_user" : "unknown",
            backupEligible: true,
            deletionEligible: true,
            isProtected: false,
            previewData: sanitizeForPreview(records),
            fullBackupData: sanitizeForBackup(records),
          });
        } catch (storeErr) {
          console.warn(`[LocalDataCenter] Backup IndexedDB store ${storeName} read warning:`, storeErr);
        }
      }
      db.close();
    }
  } catch (idbErr) {
    console.warn("[LocalDataCenter] Backup IndexedDB collection warning:", idbErr);
  }

  return entries;
}

export interface DeletionResult {
  success: boolean;
  deletedRecordsCount: number;
  deletedKeysCount: number;
  deletedFilesCount?: number;
  freedBytes: number;
  errors: string[];
}

/**
 * Executes confirmed permanent deletion of selected eligible local entries.
 * Strictly verifies the confirmation phrase and re-scans items before deletion.
 */
export async function deleteConfirmedLocalEntries(
  selectedEntryIds: string[],
  confirmedPhrase: string
): Promise<DeletionResult> {
  const result: DeletionResult = {
    success: false,
    deletedRecordsCount: 0,
    deletedKeysCount: 0,
    freedBytes: 0,
    errors: [],
  };

  // 1. Strict phrase guard
  if (confirmedPhrase.trim() !== REQUIRED_DELETION_PHRASE) {
    result.errors.push(`Confirmation phrase mismatch. Expected: "${REQUIRED_DELETION_PHRASE}"`);
    return result;
  }

  if (selectedEntryIds.length === 0) {
    result.errors.push("No entries selected for deletion.");
    return result;
  }

  if (typeof window === "undefined") {
    result.errors.push("Browser window environment unavailable.");
    return result;
  }

  // 2. Perform live re-scan to verify ownership and eligibility
  const freshScan = await scanAllLocalData();
  const entryMap = new Map(freshScan.entries.map((e) => [e.id, e]));

  for (const id of selectedEntryIds) {
    const entry = entryMap.get(id);
    if (!entry) {
      // Entry already absent or removed
      continue;
    }

    if (entry.isProtected || !entry.deletionEligible) {
      result.errors.push(`Skipped protected entry: ${entry.name}`);
      continue;
    }

    try {
      if (entry.mechanism === "localStorage") {
        if (entry.storageKey.includes("::")) {
          const [parentKey, field] = entry.storageKey.split("::");
          const raw = window.localStorage.getItem(parentKey);
          if (raw) {
            try {
              const parsed = JSON.parse(raw);
              if (parsed && typeof parsed === "object" && "state" in parsed && typeof (parsed as { state: unknown }).state === "object") {
                const stateObj = (parsed as { state: Record<string, unknown> }).state;
                if (field in stateObj) {
                  if (Array.isArray(stateObj[field])) {
                    stateObj[field] = [];
                  } else {
                    delete stateObj[field];
                  }
                  window.localStorage.setItem(parentKey, JSON.stringify(parsed));
                  result.deletedRecordsCount += entry.recordCount;
                  result.freedBytes += entry.sizeBytes;
                }
              }
            } catch {
              // fallback to normal deletion if JSON parse fails
            }
          }
        } else {
          window.localStorage.removeItem(entry.storageKey);
          result.deletedKeysCount++;
          result.freedBytes += entry.sizeBytes;
        }
      } else if (entry.mechanism === "IndexedDB" && entry.storeName) {
        if (window.indexedDB) {
          const db = await new Promise<IDBDatabase>((resolve, reject) => {
            const req = window.indexedDB.open(IDB_DATABASE_NAME);
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
          });

          if (db.objectStoreNames.contains(entry.storeName)) {
            await new Promise<void>((resolve, reject) => {
              const tx = db.transaction(entry.storeName!, "readwrite");
              const store = tx.objectStore(entry.storeName!);
              const clearReq = store.clear();
              clearReq.onsuccess = () => resolve();
              clearReq.onerror = () => reject(clearReq.error);
            });
            result.deletedRecordsCount += entry.recordCount;
            result.freedBytes += entry.sizeBytes;
          }
          db.close();
        }
      } else if (entry.mechanism === "Cache Storage") {
        if ("caches" in window) {
          await window.caches.delete(entry.storageKey);
          result.deletedKeysCount++;
          result.freedBytes += entry.sizeBytes;
        }
      } else if (entry.mechanism === "OPFS") {
        if (navigator.storage && "getDirectory" in navigator.storage) {
          const rootDir = await navigator.storage.getDirectory();
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          await (rootDir as any).removeEntry(entry.storageKey);
          result.deletedFilesCount = (result.deletedKeysCount || 0) + 1;
          result.freedBytes += entry.sizeBytes;
        }
      }
    } catch (err) {
      result.errors.push(`Error deleting ${entry.name}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  result.success = result.errors.length === 0;
  return result;
}
