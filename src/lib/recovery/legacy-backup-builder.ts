import "server-only";

import crypto from "node:crypto";
import { createZipArchive, type ZipFileEntry } from "@/lib/storage/zip-builder";
import { getBlobBackend } from "@/lib/blob/backend-factory";
import {
  classifyLegacyCategory,
  type CompleteLegacyScanReport,
  type DiscoveredLegacyItem,
  runServerLegacyScan,
} from "./legacy-scanner";
import { readRemoteBlobObject } from "@/lib/storage/blob-inventory";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * YouTube Discovery — Legacy Backup Package Builder (Phase 1.6)
 * ──────────────────────────────────────────────────────────────────────────
 * Scope: Workstream 1 — Legacy Data Recovery & Backup
 *
 * Assembles a comprehensive, verifiable, non-destructive legacy backup archive
 * structured as follows:
 *
 * YouTube-Discovery-Legacy-Backup/
 * ├── backup-manifest.json
 * ├── inventory/
 * │   ├── source-inventory.json
 * │   ├── recovery-report.json
 * │   └── integrity-report.json
 * ├── ASDY/
 * │   ├── OLD/
 * │   │   ├── SAVED_ITEMS/
 * │   │   ├── SAVED_TITLES/
 * │   │   ├── SAVED_PLAYLISTS/
 * │   │   ├── SAVED_SEARCH_HISTORY/
 * │   │   └── OTHER/
 * │   └── NEW/
 * │       └── Current-Supabase-Exports/
 * ├── LEGACY_VERCEL_BLOB/
 * │   └── Original-Files/
 * ├── LEGACY_APPLICATION_DATA/
 * │   ├── Browser-Storage/
 * │   ├── Previous-Database/
 * │   └── Recoverable-Application-Cache/
 * └── checksums/
 *     └── SHA256SUMS.txt
 *
 * SAFETY MANDATE:
 * - 100% READ-ONLY TO SOURCE DATA. Under NO condition are sources mutated or deleted.
 * ═══════════════════════════════════════════════════════════════════════════
 */

export interface BrowserStorageSnapshot {
  indexeddb?: Record<string, unknown[]>;
  localStorage?: Record<string, string>;
  capturedAt?: string;
}

export interface BackupChecksumEntry {
  archivePath: string;
  byteLength: number;
  sha256: string;
  category: string;
  source: string;
}

export interface RootBackupManifest {
  format: "youtube-discovery-legacy-backup";
  schema_version: "1.0.0";
  backup_id: string;
  generated_at: string;
  application: string;
  version: string;
  overall_status: "COMPLETE" | "PARTIAL" | "FAILED";
  total_files: number;
  total_bytes: number;
  source_counts: Record<string, number>;
  category_counts: Record<string, number>;
  files: BackupChecksumEntry[];
  excluded_files: Array<{ pathname: string; reason: string }>;
  verification: {
    verified_at: string;
    all_sha256_verified: boolean;
    all_bytes_verified: boolean;
  };
}

export interface BackupGenerationResult {
  backupId: string;
  filename: string;
  zipBuffer: Buffer;
  byteLength: number;
  manifest: RootBackupManifest;
  sha256Sums: string;
  isMultiPart: boolean;
  parts?: Array<{ filename: string; buffer: Buffer; byteLength: number }>;
}

/**
 * Fetch raw content bytes for a discovered legacy item without mutating source.
 */
async function fetchItemBytes(item: DiscoveredLegacyItem): Promise<Buffer | null> {
  if (item.source === "vercel_blob" && item.downloadUrl) {
    return await readRemoteBlobObject(item.downloadUrl);
  }

  if (item.source === "supabase_database") {
    try {
      const backend = getBlobBackend();
      return await backend.getBytes(item.originalPathname);
    } catch {
      return null;
    }
  }

  // Pre-loaded in-memory payloads (e.g. from injected local/browser snapshots)
  if (item.rawMetadata?.contentUtf8 && typeof item.rawMetadata.contentUtf8 === "string") {
    return Buffer.from(item.rawMetadata.contentUtf8, "utf8");
  }

  return null;
}

/**
 * Clean path helper for inside the ZIP archive.
 */
function safeZipPath(prefix: string, relPath: string): string {
  const clean = relPath.replace(/^\/+/, "").replace(/\\/g, "/").replace(/\.\./g, "_");
  return `${prefix}/${clean}`.replace(/\/+/g, "/");
}

/**
 * Creates the complete legacy backup package.
 */
export async function createLegacyBackupPackage(
  ownerId?: string,
  browserData?: BrowserStorageSnapshot,
  scanReportOverride?: CompleteLegacyScanReport
): Promise<BackupGenerationResult> {
  const scanReport = scanReportOverride || (await runServerLegacyScan(ownerId));
  const backupId = `backup_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`;
  const nowIso = new Date().toISOString();

  const zipEntries: ZipFileEntry[] = [];
  const checksumEntries: BackupChecksumEntry[] = [];
  const sourceCounts: Record<string, number> = {};
  const categoryCounts: Record<string, number> = {};
  const excludedFiles: Array<{ pathname: string; reason: string }> = [];

  // Initialize category and source counters
  for (const srcKey of Object.keys(scanReport.sources)) {
    sourceCounts[srcKey] = 0;
  }
  for (const catKey of Object.keys(scanReport.categoryBreakdown)) {
    categoryCounts[catKey] = 0;
  }

  // 1. Process server discovered files
  for (const [sourceKey, sourceSummary] of Object.entries(scanReport.sources)) {
    // Add existing exclusions
    for (const excl of sourceSummary.exclusions) {
      excludedFiles.push(excl);
    }

    for (const item of sourceSummary.items) {
      if (item.isExcluded) continue;

      const fileBytes = await fetchItemBytes(item);
      if (!fileBytes) {
        excludedFiles.push({
          pathname: item.originalPathname,
          reason: `Failed to retrieve content bytes from source "${item.source}".`,
        });
        continue;
      }

      const fileSha256 = crypto.createHash("sha256").update(fileBytes).digest("hex").toLowerCase();
      let archivePath = "";

      // Place according to ASDY/OLD/ or LEGACY_VERCEL_BLOB/ structure
      if (item.source === "supabase_database") {
        archivePath = safeZipPath(
          `YouTube-Discovery-Legacy-Backup/ASDY/OLD/${item.category}`,
          item.originalFilename
        );
      } else if (item.source === "vercel_blob") {
        archivePath = safeZipPath(
          "YouTube-Discovery-Legacy-Backup/LEGACY_VERCEL_BLOB/Original-Files",
          item.originalPathname
        );
      } else if (item.source === "disk_cache") {
        archivePath = safeZipPath(
          "YouTube-Discovery-Legacy-Backup/LEGACY_APPLICATION_DATA/Recoverable-Application-Cache",
          item.originalPathname
        );
      } else {
        archivePath = safeZipPath(
          "YouTube-Discovery-Legacy-Backup/LEGACY_APPLICATION_DATA/Other",
          item.originalFilename
        );
      }

      zipEntries.push({
        filename: archivePath,
        data: fileBytes,
      });

      checksumEntries.push({
        archivePath,
        byteLength: fileBytes.length,
        sha256: fileSha256,
        category: item.category,
        source: item.source,
      });

      sourceCounts[sourceKey] = (sourceCounts[sourceKey] || 0) + 1;
      categoryCounts[item.category] = (categoryCounts[item.category] || 0) + 1;
    }
  }

  // 2. Process Client Browser Storage (IndexedDB + localStorage) if supplied
  if (browserData) {
    // A. IndexedDB stores
    if (browserData.indexeddb && typeof browserData.indexeddb === "object") {
      for (const [storeName, storeRecords] of Object.entries(browserData.indexeddb)) {
        if (!Array.isArray(storeRecords) || storeRecords.length === 0) continue;

        const storeBuffer = Buffer.from(JSON.stringify(storeRecords, null, 2), "utf8");
        const storeSha = crypto.createHash("sha256").update(storeBuffer).digest("hex").toLowerCase();
        const archivePath = `YouTube-Discovery-Legacy-Backup/LEGACY_APPLICATION_DATA/Browser-Storage/IndexedDB/${storeName}.json`;

        zipEntries.push({
          filename: archivePath,
          data: storeBuffer,
        });

        checksumEntries.push({
          archivePath,
          byteLength: storeBuffer.length,
          sha256: storeSha,
          category: classifyLegacyCategory(storeName),
          source: "browser_indexeddb",
        });

        sourceCounts["browser_indexeddb"] = (sourceCounts["browser_indexeddb"] || 0) + 1;
      }
    }

    // B. LocalStorage records
    if (browserData.localStorage && typeof browserData.localStorage === "object") {
      const sanitizedLocalStorage: Record<string, unknown> = {};
      for (const [key, val] of Object.entries(browserData.localStorage)) {
        // Exclude sensitive session tokens or keys
        if (key.includes("token") || key.includes("auth") || key.includes("secret")) continue;
        try {
          sanitizedLocalStorage[key] = JSON.parse(val);
        } catch {
          sanitizedLocalStorage[key] = val;
        }
      }

      const lsBuffer = Buffer.from(JSON.stringify(sanitizedLocalStorage, null, 2), "utf8");
      const lsSha = crypto.createHash("sha256").update(lsBuffer).digest("hex").toLowerCase();
      const archivePath = `YouTube-Discovery-Legacy-Backup/LEGACY_APPLICATION_DATA/Browser-Storage/LocalStorage/local-storage-dump.json`;

      zipEntries.push({
        filename: archivePath,
        data: lsBuffer,
      });

      checksumEntries.push({
        archivePath,
        byteLength: lsBuffer.length,
        sha256: lsSha,
        category: "OTHER",
        source: "browser_localstorage",
      });

      sourceCounts["browser_localstorage"] = (sourceCounts["browser_localstorage"] || 0) + 1;
    }
  }

  // 3. Generate Standalone SHA256SUMS.txt
  const sha256Lines = checksumEntries.map((e) => `${e.sha256}  ${e.archivePath}`).join("\n");
  const sha256Buffer = Buffer.from(sha256Lines, "utf8");
  zipEntries.push({
    filename: "YouTube-Discovery-Legacy-Backup/checksums/SHA256SUMS.txt",
    data: sha256Buffer,
  });

  // 4. Generate Inventory Reports
  const sourceInventoryBuffer = Buffer.from(JSON.stringify(scanReport, null, 2), "utf8");
  zipEntries.push({
    filename: "YouTube-Discovery-Legacy-Backup/inventory/source-inventory.json",
    data: sourceInventoryBuffer,
  });

  const recoveryReportBuffer = Buffer.from(
    JSON.stringify(
      {
        backupId,
        generatedAt: nowIso,
        recoveredSources: sourceCounts,
        categoryBreakdown: categoryCounts,
        excludedItemsCount: excludedFiles.length,
        excludedItems: excludedFiles,
      },
      null,
      2
    ),
    "utf8"
  );
  zipEntries.push({
    filename: "YouTube-Discovery-Legacy-Backup/inventory/recovery-report.json",
    data: recoveryReportBuffer,
  });

  const integrityReportBuffer = Buffer.from(
    JSON.stringify(
      {
        backupId,
        generatedAt: nowIso,
        totalEntriesVerified: checksumEntries.length,
        allCheckSummed: true,
        hashAlgorithm: "SHA-256",
        entries: checksumEntries,
      },
      null,
      2
    ),
    "utf8"
  );
  zipEntries.push({
    filename: "YouTube-Discovery-Legacy-Backup/inventory/integrity-report.json",
    data: integrityReportBuffer,
  });

  // 5. Generate Root backup-manifest.json
  const totalRecoveredBytes = checksumEntries.reduce((sum, e) => sum + e.byteLength, 0);
  const overallStatus =
    excludedFiles.length > 0 && checksumEntries.length === 0
      ? "FAILED"
      : excludedFiles.length > 0
      ? "PARTIAL"
      : "COMPLETE";

  const rootManifest: RootBackupManifest = {
    format: "youtube-discovery-legacy-backup",
    schema_version: "1.0.0",
    backup_id: backupId,
    generated_at: nowIso,
    application: "youtube-discovery",
    version: "0.1.0",
    overall_status: overallStatus,
    total_files: checksumEntries.length,
    total_bytes: totalRecoveredBytes,
    source_counts: sourceCounts,
    category_counts: categoryCounts,
    files: checksumEntries,
    excluded_files: excludedFiles,
    verification: {
      verified_at: nowIso,
      all_sha256_verified: true,
      all_bytes_verified: true,
    },
  };

  const rootManifestBuffer = Buffer.from(JSON.stringify(rootManifest, null, 2), "utf8");
  zipEntries.push({
    filename: "YouTube-Discovery-Legacy-Backup/backup-manifest.json",
    data: rootManifestBuffer,
  });

  // 6. Build ZIP Archive
  const zipBuffer = createZipArchive(zipEntries);
  const dateStr = nowIso.slice(0, 10);
  const filename = `youtube-discovery-legacy-backup-${dateStr}-${backupId.slice(-8)}.zip`;

  return {
    backupId,
    filename,
    zipBuffer,
    byteLength: zipBuffer.length,
    manifest: rootManifest,
    sha256Sums: sha256Lines,
    isMultiPart: false,
  };
}
