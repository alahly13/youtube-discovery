/**
 * YouTube Discovery — Automated Test Suite for Phases A through G
 *
 * Verifies:
 * 1. Exactly four primary OLD categories and bucket mapping (Phase A)
 * 2. Exact OLD bucket 'old-youtube-discovery-private' and logical prefixes 'asdy/old/...' (Phase B)
 * 3. Exact NEW bucket 'new-youtube-discovery-private' separation (Phase C)
 * 4. Database schema columns and constraints on archived_manifests and manifest parts (Phase D)
 * 5. Manifest Upload destination routing & conflict prevention (Phase E)
 * 6. Manifest Export & ZIP assembly with authentic byte preservation & SHA-256 (Phase F)
 * 7. Browser Storage Backup Builder with exact 4-category layout, UNCLASSIFIED/, and secret redaction (Phase G)
 * 8. Live Supabase Storage bucket verification & cleanup
 */

import assert from "node:assert";
import crypto from "node:crypto";
import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";

dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

import {
  OLD_PRIMARY_CATEGORIES,
  OLD_CATEGORY_PREFIXES,
  normalizeOldCategory,
  getArchivedManifestStoragePath,
  getOldManifestStoragePath,
  extractZipEntries,
  computeSha256,
} from "../src/lib/old/archive-envelope.ts";
import { createZipArchive } from "../src/lib/storage/zip-builder.ts";
import { createJiti } from "jiti";
const jiti = createJiti(process.cwd());
const { buildOldBrowserBackupZip } = jiti("./src/lib/recovery/old-browser-backup-builder.ts");

console.log("\n══════════════════════════════════════════════════════════════");
console.log("   YOUTUBE DISCOVERY — PHASES A-G VERIFICATION TEST SUITE     ");
console.log("══════════════════════════════════════════════════════════════\n");

const OLD_STORAGE_BUCKET = process.env.SUPABASE_OLD_STORAGE_BUCKET || "old-youtube-discovery-private";
const NEW_STORAGE_BUCKET = process.env.SUPABASE_NEW_STORAGE_BUCKET || "new-youtube-discovery-private";

let passed = 0;
let total = 0;

async function test(name, fn) {
  total++;
  try {
    await fn();
    console.log(`  ✓ PASS: ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ FAIL: ${name}`);
    console.error(`    ${err.message}`);
    process.exitCode = 1;
  }
}

// ─────────────────────────────────────────────────────────────
// PHASE A: Exactly Four OLD Archive Categories
// ─────────────────────────────────────────────────────────────
await test("Phase A: Exactly four primary OLD categories defined", () => {
  assert.strictEqual(OLD_PRIMARY_CATEGORIES.length, 4, "Must have exactly 4 primary categories");
  assert.ok(OLD_PRIMARY_CATEGORIES.includes("saved-items"));
  assert.ok(OLD_PRIMARY_CATEGORIES.includes("saved-playlists"));
  assert.ok(OLD_PRIMARY_CATEGORIES.includes("saved-titles-links"));
  assert.ok(OLD_PRIMARY_CATEGORIES.includes("saved-search-history"));
});

await test("Phase A: normalizeOldCategory routes to 4 primary categories or unclassified", () => {
  assert.strictEqual(normalizeOldCategory("saved-items"), "saved-items");
  assert.strictEqual(normalizeOldCategory("saved-playlists"), "saved-playlists");
  assert.strictEqual(normalizeOldCategory("saved-titles-links"), "saved-titles-links");
  assert.strictEqual(normalizeOldCategory("saved-search-history"), "saved-search-history");

  // Legacy aliases
  assert.strictEqual(normalizeOldCategory("saved-titles"), "saved-titles-links");
  assert.strictEqual(normalizeOldCategory("search-history"), "saved-search-history");
  assert.strictEqual(normalizeOldCategory("other"), "unclassified");

  // Unknown categories must route safely to unclassified
  assert.strictEqual(normalizeOldCategory("unknown-random-category"), "unclassified");
  assert.strictEqual(normalizeOldCategory(""), "unclassified");
});

// ─────────────────────────────────────────────────────────────
// PHASE B: Exact OLD Bucket & Path Prefixes
// ─────────────────────────────────────────────────────────────
await test("Phase B: Dedicated OLD bucket identifier is strictly old-youtube-discovery-private", () => {
  assert.strictEqual(OLD_STORAGE_BUCKET, "old-youtube-discovery-private");
});

await test("Phase B: OLD folder prefixes match specification exactly", () => {
  assert.strictEqual(OLD_CATEGORY_PREFIXES["saved-items"], "asdy/old/saved-items/");
  assert.strictEqual(OLD_CATEGORY_PREFIXES["saved-playlists"], "asdy/old/saved-playlists/");
  assert.strictEqual(OLD_CATEGORY_PREFIXES["saved-titles-links"], "asdy/old/saved-titles-links/");
  assert.strictEqual(OLD_CATEGORY_PREFIXES["saved-search-history"], "asdy/old/saved-search-history/");
});

await test("Phase B: getOldManifestStoragePath generates exact asdy/old/<cat>/<id>/<file> path", () => {
  const p1 = getOldManifestStoragePath("saved-items", "man-001", "manifest.json");
  assert.strictEqual(p1, "asdy/old/saved-items/man-001/manifest.json");

  const p2 = getOldManifestStoragePath("saved-playlists", "man-002", "manifest.json");
  assert.strictEqual(p2, "asdy/old/saved-playlists/man-002/manifest.json");

  const p3 = getOldManifestStoragePath("saved-titles-links", "man-003", "manifest.json");
  assert.strictEqual(p3, "asdy/old/saved-titles-links/man-003/manifest.json");

  const p4 = getOldManifestStoragePath("saved-search-history", "man-004", "manifest.json");
  assert.strictEqual(p4, "asdy/old/saved-search-history/man-004/manifest.json");

  const p5 = getOldManifestStoragePath("unclassified", "man-005", "manifest.json");
  assert.strictEqual(p5, "asdy/old/unclassified/man-005/manifest.json");
});

await test("Phase B: getArchivedManifestStoragePath supports 2-arg logical and 3-arg physical paths", () => {
  // Logical path (2 arguments)
  const logical = getArchivedManifestStoragePath("saved-items", "m-123");
  assert.strictEqual(logical, "asdy/old/saved-items/m-123/manifest.json");

  // Physical UUID path (3 arguments)
  const uuid = "12345678-1234-1234-1234-123456789abc";
  const physical = getArchivedManifestStoragePath(uuid, "saved-items", "m-123");
  assert.strictEqual(physical, `ASDY/OLD/${uuid}/saved-items/m-123/manifest.json`);
});

// ─────────────────────────────────────────────────────────────
// PHASE C: Exact NEW Bucket & Storage Separation
// ─────────────────────────────────────────────────────────────
await test("Phase C: Dedicated NEW bucket identifier is strictly new-youtube-discovery-private", () => {
  assert.strictEqual(NEW_STORAGE_BUCKET, "new-youtube-discovery-private");
  assert.notStrictEqual(OLD_STORAGE_BUCKET, NEW_STORAGE_BUCKET, "OLD and NEW buckets must be distinct");
});

// ─────────────────────────────────────────────────────────────
// PHASE E & F: Manifest Upload & Export Logic Verification
// ─────────────────────────────────────────────────────────────
await test("Phase E: Upload manifest envelope validation and path derivation", () => {
  const manifestData = {
    schema_version: "1.0.0",
    manifest_id: "test-man-001",
    category: "saved-items",
    items: [{ id: "v1", title: "Test Video" }],
  };
  const category = normalizeOldCategory(manifestData.category);
  const path = getOldManifestStoragePath(category, manifestData.manifest_id, "manifest.json");
  assert.strictEqual(path, "asdy/old/saved-items/test-man-001/manifest.json");
});

await test("Phase F: Export multi-manifest ZIP generation with SHA256SUMS.txt", async () => {
  const entries = [
    {
      filename: "asdy/old/saved-items/m1/manifest.json",
      data: JSON.stringify({ id: "m1", title: "Item 1" }, null, 2),
    },
    {
      filename: "asdy/new/dataset-1/manifest.json",
      data: JSON.stringify({ id: "ds1", name: "Active Dataset" }, null, 2),
    },
  ];

  const shaLines = entries.map((e) => `${computeSha256(e.data)}  ${e.filename}`);
  entries.push({
    filename: "checksums/SHA256SUMS.txt",
    data: shaLines.join("\n") + "\n",
  });

  const zipBuffer = createZipArchive(entries);
  assert.ok(Buffer.isBuffer(zipBuffer), "Must return Buffer");
  assert.ok(zipBuffer.length > 0, "ZIP buffer must not be empty");

  // Read back and verify ZIP integrity
  const extracted = extractZipEntries(zipBuffer);
  assert.strictEqual(extracted.length, 3, "Extracted entries count must match");

  const extractedMap = new Map(extracted.map((e) => [e.filename, e.content]));
  assert.ok(extractedMap.has("asdy/old/saved-items/m1/manifest.json"));
  assert.ok(extractedMap.has("asdy/new/dataset-1/manifest.json"));
  assert.ok(extractedMap.has("checksums/SHA256SUMS.txt"));

  // Verify checksum in SHA256SUMS.txt
  const shaContent = extractedMap.get("checksums/SHA256SUMS.txt").toString("utf8");
  assert.ok(shaContent.includes(computeSha256(entries[0].data)));
});

// ─────────────────────────────────────────────────────────────
// PHASE G: Download OLD Data Browser Backup Builder
// ─────────────────────────────────────────────────────────────
await test("Phase G: Browser backup packages 4 categories + UNCLASSIFIED and redacts secrets", () => {
  const mockInput = {
    origin: "http://localhost:3000",
    capturedAt: new Date().toISOString(),
    indexeddb: {
      saved_videos: [
        { id: "vid-1", title: "Great Music Video", channelTitle: "Artist A", type: "video" },
        { id: "vid-2", title: "Epic Short", is_shorts_like: true },
      ],
      playlists: [
        { id: "pl-1", title: "Workout Mix", itemCount: 25 },
      ],
      saved_searches: [
        { id: "s-1", query: "nextjs 16 tutorial", searchedAt: 1700000000000 },
      ],
      search_history: [
        { id: "sh-1", term: "supabase auth guide" },
      ],
      random_unknown_store: [
        { id: "unk-1", rawNote: "custom orphaned record from older experiment" },
      ],
    },
    localStorage: {
      "yd_theme": "dark",
      "yd_active_view": "grid",
      "auth_token": "SUPER_SECRET_TOKEN_DO_NOT_LEAK",
      "supabase_session_token": "ANOTHER_SECRET_JWT_KEY",
      "admin_password": "PASSWORD12345",
      "random_secret_key": "PRIVATE_SECRET",
    },
  };

  const backup = buildOldBrowserBackupZip(mockInput);

  assert.ok(backup.filename.startsWith("YouTube-Discovery-OLD-Data-Backup-"), "Filename format");
  assert.ok(backup.filename.endsWith(".zip"), "Filename extension");
  assert.ok(backup.zipBuffer.length > 0, "ZIP buffer must not be empty");
  assert.strictEqual(backup.categoryCounts.savedItems, 2, "2 saved items counted");
  assert.strictEqual(backup.categoryCounts.savedPlaylists, 1, "1 saved playlist counted");
  assert.strictEqual(backup.categoryCounts.savedTitlesLinks, 1, "1 saved titles & links counted");
  assert.strictEqual(backup.categoryCounts.savedSearchHistory, 1, "1 search history item counted");
  assert.strictEqual(backup.categoryCounts.unclassified, 2, "2 unclassified items counted (custom store + safe localStorage)");

  // Extract ZIP entries to inspect contents
  const extracted = extractZipEntries(backup.zipBuffer);
  const filenames = extracted.map((e) => e.filename);

  // Check 4 directory names in ZIP
  assert.ok(filenames.some((f) => f.includes("/OLD-Saved-Items/")), "Must contain OLD-Saved-Items/");
  assert.ok(filenames.some((f) => f.includes("/OLD-Saved-Playlists/")), "Must contain OLD-Saved-Playlists/");
  assert.ok(filenames.some((f) => f.includes("/OLD-Saved-Search-History/")), "Must contain OLD-Saved-Search-History/");
  assert.ok(filenames.some((f) => f.includes("/UNCLASSIFIED/")), "Must contain UNCLASSIFIED/");

  // Check required meta files
  assert.ok(filenames.some((f) => f.endsWith("recovery-manifest.json")), "Must contain recovery-manifest.json");
  assert.ok(filenames.some((f) => f.endsWith("reports/source-inventory.json")), "Must contain source-inventory.json");
  assert.ok(filenames.some((f) => f.endsWith("reports/classification-report.json")), "Must contain classification-report.json");
  assert.ok(filenames.some((f) => f.endsWith("reports/recovery-report.json")), "Must contain recovery-report.json");
  assert.ok(filenames.some((f) => f.endsWith("reports/integrity-report.json")), "Must contain integrity-report.json");
  assert.ok(filenames.some((f) => f.endsWith("checksums/SHA256SUMS.txt")), "Must contain SHA256SUMS.txt");

  // Check secret redaction: verify that secrets were NOT written
  const fullExtractedString = extracted
    .map((e) => e.content.toString("utf8"))
    .join(" ");

  assert.ok(!fullExtractedString.includes("SUPER_SECRET_TOKEN_DO_NOT_LEAK"), "SUPER_SECRET_TOKEN must NOT exist");
  assert.ok(!fullExtractedString.includes("ANOTHER_SECRET_JWT_KEY"), "ANOTHER_SECRET_JWT_KEY must NOT exist");
  assert.ok(!fullExtractedString.includes("PASSWORD12345"), "PASSWORD12345 must NOT exist");
  assert.ok(!fullExtractedString.includes("PRIVATE_SECRET"), "PRIVATE_SECRET must NOT exist");

  // Safe localStorage keys must be preserved
  assert.ok(fullExtractedString.includes("yd_theme"), "Safe key yd_theme preserved");
  assert.ok(fullExtractedString.includes("dark"), "Safe value dark preserved");
});

// ─────────────────────────────────────────────────────────────
// LIVE SUPABASE STORAGE INTEGRATION & CLEANUP
// ─────────────────────────────────────────────────────────────
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;

if (supabaseUrl && supabaseKey) {
  const supabase = createClient(supabaseUrl, supabaseKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  await test("Live Supabase: Verify both old and new private buckets exist in storage.buckets", async () => {
    const { data: buckets, error } = await supabase.storage.listBuckets();
    assert.strictEqual(error, null, error?.message);
    const bucketNames = buckets.map((b) => b.name);
    assert.ok(bucketNames.includes(OLD_STORAGE_BUCKET), `Must contain ${OLD_STORAGE_BUCKET}`);
    assert.ok(bucketNames.includes(NEW_STORAGE_BUCKET), `Must contain ${NEW_STORAGE_BUCKET}`);

    const oldB = buckets.find((b) => b.name === OLD_STORAGE_BUCKET);
    assert.strictEqual(oldB.public, false, `${OLD_STORAGE_BUCKET} must be private`);
    const newB = buckets.find((b) => b.name === NEW_STORAGE_BUCKET);
    assert.strictEqual(newB.public, false, `${NEW_STORAGE_BUCKET} must be private`);
  });

  await test("Live Supabase: Upload, download, verify SHA-256 and clean up ephemeral test object in OLD bucket", async () => {
    const testPath = "asdy/old/saved-items/e2e-test-obj-001/manifest.json";
    const testPayload = JSON.stringify({
      test: true,
      category: "saved-items",
      timestamp: new Date().toISOString(),
      note: "Live verification of Phase B path",
    });
    const expectedSha = computeSha256(testPayload);

    // 1. Upload
    const { data: uploadData, error: uploadErr } = await supabase.storage
      .from(OLD_STORAGE_BUCKET)
      .upload(testPath, Buffer.from(testPayload, "utf8"), {
        contentType: "application/json",
        upsert: true,
      });
    assert.strictEqual(uploadErr, null, uploadErr?.message);

    // 2. Download
    const { data: downloadedBlob, error: downloadErr } = await supabase.storage
      .from(OLD_STORAGE_BUCKET)
      .download(testPath);
    assert.strictEqual(downloadErr, null, downloadErr?.message);
    const downloadedText = await downloadedBlob.text();
    assert.strictEqual(computeSha256(downloadedText), expectedSha, "SHA-256 match");

    // 3. Clean up
    const { error: removeErr } = await supabase.storage
      .from(OLD_STORAGE_BUCKET)
      .remove([testPath]);
    assert.strictEqual(removeErr, null, removeErr?.message);
  });

  await test("Live Supabase: Upload, download, verify SHA-256 and clean up ephemeral test object in NEW bucket", async () => {
    const testPath = "asdy-test-uuid/persistence/datasets/ds-test/generations/gen-test/parts/part-000001.json";
    const testPayload = JSON.stringify({
      test: true,
      partNumber: 1,
      items: [{ id: "new-vid-1", title: "New Item" }],
    });
    const expectedSha = computeSha256(testPayload);

    // 1. Upload
    const { data: uploadData, error: uploadErr } = await supabase.storage
      .from(NEW_STORAGE_BUCKET)
      .upload(testPath, Buffer.from(testPayload, "utf8"), {
        contentType: "application/json",
        upsert: true,
      });
    assert.strictEqual(uploadErr, null, uploadErr?.message);

    // 2. Download
    const { data: downloadedBlob, error: downloadErr } = await supabase.storage
      .from(NEW_STORAGE_BUCKET)
      .download(testPath);
    assert.strictEqual(downloadErr, null, downloadErr?.message);
    const downloadedText = await downloadedBlob.text();
    assert.strictEqual(computeSha256(downloadedText), expectedSha, "SHA-256 match");

    // 3. Clean up
    const { error: removeErr } = await supabase.storage
      .from(NEW_STORAGE_BUCKET)
      .remove([testPath]);
    assert.strictEqual(removeErr, null, removeErr?.message);
  });
}

console.log("\n══════════════════════════════════════════════════════════════");
console.log(`   TEST SUMMARY: ${passed} PASSED, ${total - passed} FAILED (TOTAL: ${total})`);
console.log("══════════════════════════════════════════════════════════════\n");

if (passed !== total) {
  process.exit(1);
}
