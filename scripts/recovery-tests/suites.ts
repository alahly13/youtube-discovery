import assert from "node:assert";
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import {
  classifyLegacyCategory,
  evaluateCaches,
  scanDiskCache,
} from "../../src/lib/recovery/legacy-scanner";
import {
  createLegacyBackupPackage,
} from "../../src/lib/recovery/legacy-backup-builder";
import {
  getDownloadCenterInventory,
  generateNewManifestPayload,
  createDownloadCenterExport,
} from "../../src/lib/download-center/download-center-service";
import { extractZipEntries } from "../../src/lib/old/archive-envelope";

let passed = 0;
export function check(name: string, cond: boolean, detail = ""): void {
  if (!cond) throw new Error(`FAIL: ${name}${detail ? ` — ${detail}` : ""}`);
  passed += 1;
  console.log(`  ok: ${name}`);
}
export function passCount(): number {
  return passed;
}

export async function runAllSuites() {
  console.log("\n[ 1. Legacy Category Classification across 8 Canonical Types ]");
  check("SAVED_ITEMS categorized from path", classifyLegacyCategory("youtube-discovery/v1/saved-items.json") === "SAVED_ITEMS");
  check("SAVED_ITEMS categorized from alternate name", classifyLegacyCategory("backup/saved-videos.json") === "SAVED_ITEMS");
  check("SAVED_TITLES categorized from path", classifyLegacyCategory("saved-searches/title_bookmarks.json") === "SAVED_TITLES");
  check("SAVED_PLAYLISTS categorized from path", classifyLegacyCategory("user-playlists/index.json") === "SAVED_PLAYLISTS");
  check("SAVED_SEARCH_HISTORY categorized from path", classifyLegacyCategory("search-history/2026-11-02.json") === "SAVED_SEARCH_HISTORY");
  check("RESEARCH_QUEUE categorized from path", classifyLegacyCategory("research-queue/items.json") === "RESEARCH_QUEUE");
  check("SAVED_REFERENCES categorized from path", classifyLegacyCategory("references/saved_articles.json") === "SAVED_REFERENCES");
  check("SEARCH_PRESETS categorized from path", classifyLegacyCategory("presets/video_search_presets.json") === "SEARCH_PRESETS");
  check("OTHER categorized for unknown path", classifyLegacyCategory("misc/unknown_data.bin") === "OTHER");

  console.log("\n[ 2. Cache Discovery & Technical Classification Rationale ]");
  const { runtimeCache, nextDataCache } = evaluateCaches();
  check("Runtime Cache identified", Boolean(runtimeCache));
  check("Runtime Cache marked non-enumerable", runtimeCache.recoveryCapability === "NOT_ENUMERABLE");
  check("Runtime Cache includes technical rationale in notes", Boolean(runtimeCache.notes));
  check("Next.js Data Cache identified", Boolean(nextDataCache));
  check("Next.js Data Cache marked non-enumerable", nextDataCache.recoveryCapability === "NOT_ENUMERABLE");
  check("Next.js Data Cache includes technical rationale in notes", Boolean(nextDataCache.notes));

  console.log("\n[ 3. Local Application Disk Storage Discovery & Architectural Separation ]");
  const serverDiskSummary = await scanDiskCache();
  check("Server disk cache returns summary", serverDiskSummary.source === "disk_cache");
  check("Server disk cache reports ACCESS_UNAVAILABLE in web runtime", serverDiskSummary.status === "ACCESS_UNAVAILABLE");
  check("Server disk cache reports honest Vercel runtime rationale", Boolean(serverDiskSummary.notes?.includes("LOCAL_FILESYSTEM_NOT_AVAILABLE_ON_VERCEL")));
  check("Server disk cache has zero discovered items in web runtime", serverDiskSummary.discoveredCount === 0);

  // Verify caller injection support for pre-scanned items
  const injectedSummary = await scanDiskCache([
    {
      id: "disk_injected_1",
      source: "disk_cache",
      category: "SAVED_ITEMS",
      originalPathname: "data/storage/saved_items.json",
      originalFilename: "saved_items.json",
      byteLength: 120,
      sourceCreatedAt: null,
      sourceExportedAt: null,
      isRecoverable: true,
      isExcluded: false,
    },
  ]);
  check("Injected disk cache returns AVAILABLE", injectedSummary.status === "AVAILABLE");
  check("Injected disk cache contains injected item", injectedSummary.discoveredCount === 1);

  // Verify standalone offline local filesystem recovery CLI scanner
  const cliScript = path.resolve(process.cwd(), "scripts/recovery/local-filesystem-scanner.mjs");
  const cliOutput = execFileSync(process.execPath, [cliScript, "--json"], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
  const localScan = JSON.parse(cliOutput);
  check("CLI local scan returns summary", localScan.source === "disk_cache");
  check("CLI local scan status is AVAILABLE", localScan.status === "AVAILABLE");
  check("CLI local scan items is array", Array.isArray(localScan.items));
  for (const item of localScan.items) {
    check(`CLI local item ${item.originalPathname} has valid sha256`, Boolean(item.sha256 && item.sha256.length === 64));
  }

  // Verify security boundary against path traversal in local scanner
  let securityViolationCaught = false;
  try {
    execFileSync(process.execPath, [cliScript, "--dir=../../etc"], {
      cwd: process.cwd(),
      stdio: "pipe",
    });
  } catch {
    securityViolationCaught = true;
  }
  check("Local scanner rejects directory outside allowed root", securityViolationCaught);

  let forbiddenDirCaught = false;
  try {
    execFileSync(process.execPath, [cliScript, "--dir=node_modules"], {
      cwd: process.cwd(),
      stdio: "pipe",
    });
  } catch {
    forbiddenDirCaught = true;
  }
  check("Local scanner rejects forbidden directory (node_modules)", forbiddenDirCaught);

  console.log("\n[ 4. Canonical Self-Describing Manifest Envelope ]");
  const dummyOwnerId = "admin_owner_local_test";
  const { filename, envelope } = await generateNewManifestPayload(dummyOwnerId, "current_saved_items");
  check("Generated filename ends in .json", filename.endsWith(".json"));
  check("Envelope format is youtube-discovery-manifest", envelope.format === "youtube-discovery-manifest");
  check("Envelope schema_version is 1.0.0", envelope.schema_version === "1.0.0");
  check("Envelope category is SAVED_ITEMS", envelope.category === "SAVED_ITEMS");
  check("Envelope has payload with items", Array.isArray(envelope.payload?.items));

  console.log("\n[ 5. Download Center Unified Inventory ]");
  const dummyStorageUuid = "00000000-0000-0000-0000-000000000001";
  const inventory = await getDownloadCenterInventory(dummyOwnerId, dummyStorageUuid);
  check("Inventory object returned", Boolean(inventory));
  check("Inventory totalManifests is number", typeof inventory.totalManifests === "number");
  check("Inventory items list is array", Array.isArray(inventory.items));
  check("Inventory categoryCounts object exists", typeof inventory.categoryCounts === "object");

  console.log("\n[ 6. Download Center Multi-Manifest ZIP Export Assembly ]");
  const selectedManifestIds = ["new_saved_items", "new_playlist_pl1"];
  const exportPackage = await createDownloadCenterExport(dummyOwnerId, dummyStorageUuid, selectedManifestIds);
  check("Export creates zipBuffer Buffer", exportPackage.zipBuffer instanceof Buffer && exportPackage.zipBuffer.length > 0);
  check("Export filename ends in .zip", exportPackage.filename.endsWith(".zip"));
  check("Export sha256Sums string exists", Boolean(exportPackage.sha256Sums));

  const zipEntries = await extractZipEntries(exportPackage.zipBuffer);
  const entryNames = zipEntries.map((e) => e.filename);
  check("Export contains ASDY/export-manifest.json", entryNames.includes("ASDY/export-manifest.json"));
  check("Export contains ASDY/SHA256SUMS.txt", entryNames.includes("ASDY/SHA256SUMS.txt"));
  check("Export contains ASDY/NEW/SAVED_ITEMS entry", entryNames.some((n) => n.startsWith("ASDY/NEW/SAVED_ITEMS/")));
  check("Export contains ASDY/NEW/SAVED_PLAYLISTS entry", entryNames.some((n) => n.startsWith("ASDY/NEW/SAVED_PLAYLISTS/")));

  const checksumEntry = zipEntries.find((e) => e.filename === "ASDY/SHA256SUMS.txt");
  assert(checksumEntry, "checksumEntry must exist");
  const checksumText = checksumEntry.content.toString("utf8");
  check("SHA256SUMS.txt contains sha256 formatted lines", /^[a-f0-9]{64}\s+/m.test(checksumText));

  console.log("\n[ 7. Legacy Backup Package Assembly ]");
  const dummyBrowserData = {
    indexeddb: {
      savedItemsStore: [{ id: "legacy_1", title: "Legacy Video 1" }],
    },
    localStorage: {
      "youtube-discovery-workspace": JSON.stringify({ view: "saved" }),
    },
  };
  const backupResult = await createLegacyBackupPackage(dummyOwnerId, dummyBrowserData);
  check("Backup package creates zipBuffer", backupResult.zipBuffer instanceof Buffer && backupResult.zipBuffer.length > 0);
  check("Backup filename is populated", Boolean(backupResult.filename));
  check("Backup manifest all_sha256_verified is true", backupResult.manifest.verification.all_sha256_verified === true);

  const backupEntries = await extractZipEntries(backupResult.zipBuffer);
  const backupNames = backupEntries.map((e) => e.filename);
  check("Backup contains root backup-manifest.json", backupNames.includes("YouTube-Discovery-Legacy-Backup/backup-manifest.json"));
  check("Backup contains source-inventory.json", backupNames.includes("YouTube-Discovery-Legacy-Backup/inventory/source-inventory.json"));
  check("Backup contains recovery-report.json", backupNames.includes("YouTube-Discovery-Legacy-Backup/inventory/recovery-report.json"));
  check("Backup contains integrity-report.json", backupNames.includes("YouTube-Discovery-Legacy-Backup/inventory/integrity-report.json"));
  check("Backup contains checksums/SHA256SUMS.txt", backupNames.includes("YouTube-Discovery-Legacy-Backup/checksums/SHA256SUMS.txt"));
  check("Backup contains IndexedDB snapshot", backupNames.includes("YouTube-Discovery-Legacy-Backup/LEGACY_APPLICATION_DATA/Browser-Storage/IndexedDB/savedItemsStore.json"));

  console.log("\n[ 8. Proof of Non-Destructive Source Preservation ]");
  const filesToCheck = [
    "src/lib/recovery/legacy-scanner.ts",
    "src/lib/recovery/legacy-backup-builder.ts",
    "src/lib/recovery/client-browser-scanner.ts",
    "src/lib/download-center/download-center-service.ts",
    "src/app/api/download-center/legacy-recovery/backup/route.ts",
    "src/app/api/download-center/legacy-recovery/scan/route.ts",
    "src/app/api/download-center/export/route.ts",
    "src/app/api/download-center/inventory/route.ts",
    "scripts/recovery/local-filesystem-scanner.mjs",
  ];
  for (const f of filesToCheck) {
    const code = await fs.readFile(f, "utf8");
    check(`${f} has no storage del()`, !code.includes("del("));
    check(`${f} has no storage .delete()`, !code.includes(".delete("));
    check(`${f} has no rmdir`, !code.includes("rmdir"));
    check(`${f} has no unlink`, !code.includes("unlink"));
    check(`${f} has no DELETE FROM`, !code.includes("DELETE FROM"));
    check(`${f} has no TRUNCATE`, !code.includes("TRUNCATE"));
  }
}
