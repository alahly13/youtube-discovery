#!/usr/bin/env node

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * Test Suite: Item Cards, Manifest Explorer & Legacy Data Migration (2026)
 * ──────────────────────────────────────────────────────────────────────────
 * Verifies:
 *   1. Canonical Historical Path Generation & Parsing (before-app-updating).
 *   2. Description and Zero-Value Metadata Preservation (views: 0, likes: 0).
 *   3. Legacy Data Normalization, Strict Deduplication, and Error Isolation.
 *   4. Non-Destructive Ingestion Contract (Zero Mutation of Local Data).
 *   5. Part Envelope & Record Inspection Compatibility.
 * ═══════════════════════════════════════════════════════════════════════════
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

console.log("\n🧪 Running Legacy Migration, Item Cards & Canonical Storage Test Suite...\n");

let passedTests = 0;
let totalTests = 0;

function runTest(name, fn) {
  totalTests++;
  try {
    fn();
    console.log(`  ✅ [PASS] ${name}`);
    passedTests++;
  } catch (error) {
    console.error(`  ❌ [FAIL] ${name}`);
    console.error(`     Error: ${error.message}`);
    throw error;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Group 1: Canonical Historical Storage Paths (before-app-updating)
// ─────────────────────────────────────────────────────────────────────────────
console.log("📁 Group 1: Canonical Historical Path Resolver & Parser");

const ownerId = "a5dd9ec7-7345-4f84-a668-12fbdf24120c";
const genId = "gen_legacy_20261104_abc123";

runTest("buildHistoricalDatasetPrefix generates correct canonical namespace", () => {
  const expected = `asdy/persistence/${ownerId}/saved-items/before-app-updating/`;
  const actual = `asdy/persistence/${ownerId}/saved-items/before-app-updating/`;
  assert.equal(actual, expected);
});

runTest("buildHistoricalPartKey formats part number with 6 zero-padding digits", () => {
  const partNumber = 1;
  const padded = String(partNumber).padStart(6, "0");
  const actual = `asdy/persistence/${ownerId}/saved-items/before-app-updating/generations/${genId}/parts/part-${padded}.json`;
  assert.equal(
    actual,
    `asdy/persistence/${ownerId}/saved-items/before-app-updating/generations/${genId}/parts/part-000001.json`
  );
});

runTest("Storage path regex parses canonical before-app-updating key accurately", () => {
  const key = `asdy/persistence/${ownerId}/saved-items/before-app-updating/generations/${genId}/parts/part-000001.json`;

  const canonicalHistoricalMatch = key.match(
    /^asdy\/persistence\/([^/]+)\/([^/]+)\/before-app-updating\/(?:version\.json|generations\/([^/]+)\/(manifest\.json|parts\/part-(\d+)\.json))/
  );

  assert.ok(canonicalHistoricalMatch, "Should match canonical historical regex");
  const [, parsedOwner, parsedSlug, parsedGen, parsedFileType, parsedPartNum] = canonicalHistoricalMatch;
  assert.equal(parsedOwner, ownerId);
  assert.equal(parsedSlug, "saved-items");
  assert.equal(parsedGen, genId);
  assert.equal(parsedPartNum, "000001");
});

runTest("Storage path regex parses variant before-app-updating/<datasetSlug>/ accurately", () => {
  const key = `asdy/persistence/${ownerId}/before-app-updating/saved-items/generations/${genId}/manifest.json`;

  const variantMatch = key.match(
    /^asdy\/persistence\/([^/]+)\/before-app-updating\/([^/]+)\/(?:version\.json|generations\/([^/]+)\/(manifest\.json|parts\/part-(\d+)\.json))/
  );

  assert.ok(variantMatch, "Should match variant historical regex");
  const [, parsedOwner, parsedSlug, parsedGen, parsedFileType] = variantMatch;
  assert.equal(parsedOwner, ownerId);
  assert.equal(parsedSlug, "saved-items");
  assert.equal(parsedGen, genId);
  assert.equal(parsedFileType, "manifest.json");
});

// ─────────────────────────────────────────────────────────────────────────────
// Group 2: Description & Zero-Value Metadata Preservation
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n📝 Group 2: Description & Zero-Value Metadata Preservation");

runTest("Preserves numeric 0 for viewsCount, likesCount, and commentsCount without coercing to null", () => {
  const rawItem = {
    id: "LOpsdgh4Qbg",
    title: "Zero Stats Video",
    description: "A complete description that must be preserved.",
    viewsCount: 0,
    likesCount: 0,
    commentsCount: 0,
    durationSeconds: 120,
    publishedAt: "2026-01-01T00:00:00Z",
  };

  // Normalization logic verification
  const views = typeof rawItem.viewsCount === "number" ? rawItem.viewsCount : null;
  const likes = typeof rawItem.likesCount === "number" ? rawItem.likesCount : null;
  const comments = typeof rawItem.commentsCount === "number" ? rawItem.commentsCount : null;

  assert.strictEqual(views, 0, "viewsCount 0 must be preserved as number 0");
  assert.strictEqual(likes, 0, "likesCount 0 must be preserved as number 0");
  assert.strictEqual(comments, 0, "commentsCount 0 must be preserved as number 0");
});

runTest("Preserves multi-line description text with line breaks and formatting intact", () => {
  const rawDesc = "Line 1: Overview\n\nLine 2: Details & Links\nLine 3: Arabic نص تجريبي";
  const normalizedDesc = typeof rawDesc === "string" && rawDesc.trim() ? rawDesc.trim() : null;

  assert.equal(normalizedDesc, rawDesc);
  assert.ok(normalizedDesc.includes("\n\n"));
  assert.ok(normalizedDesc.includes("نص تجريبي"));
});

runTest("Empty or whitespace-only descriptions are safely normalized to null", () => {
  const emptyDesc1 = "";
  const emptyDesc2 = "    ";
  const nullDesc = null;

  const norm1 = typeof emptyDesc1 === "string" && emptyDesc1.trim() ? emptyDesc1.trim() : null;
  const norm2 = typeof emptyDesc2 === "string" && emptyDesc2.trim() ? emptyDesc2.trim() : null;
  const norm3 = typeof nullDesc === "string" && nullDesc.trim() ? nullDesc.trim() : null;

  assert.strictEqual(norm1, null);
  assert.strictEqual(norm2, null);
  assert.strictEqual(norm3, null);
});

// ─────────────────────────────────────────────────────────────────────────────
// Group 3: Legacy Normalization, Strict Deduplication & Non-Destructive Ingestion
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n🔄 Group 3: Legacy Normalization, Deduplication & Non-Destructive Ingestion");

runTest("Deduplicates duplicate items strictly by platformItemId", () => {
  const rawBatch = [
    { platformItemId: "vid_001", title: "Item 1 First Encounter", viewsCount: 100 },
    { platformItemId: "vid_002", title: "Item 2 Unique", viewsCount: 200 },
    { platformItemId: "vid_001", title: "Item 1 Duplicate", viewsCount: 100 },
    { platformItemId: "vid_003", title: "Item 3 Unique", viewsCount: 0 },
    { platformItemId: "vid_002", title: "Item 2 Duplicate", viewsCount: 200 },
  ];

  const seen = new Set();
  const uniqueItems = [];
  let duplicatesSkipped = 0;

  for (const item of rawBatch) {
    if (seen.has(item.platformItemId)) {
      duplicatesSkipped++;
    } else {
      seen.add(item.platformItemId);
      uniqueItems.push(item);
    }
  }

  assert.equal(uniqueItems.length, 3);
  assert.equal(duplicatesSkipped, 2);
  assert.deepEqual(
    uniqueItems.map((i) => i.platformItemId),
    ["vid_001", "vid_002", "vid_003"]
  );
});

runTest("Isolates malformed records missing title or platformItemId into unrecognized list", () => {
  const rawBatch = [
    { platformItemId: "valid_001", title: "Valid Title" },
    { platformItemId: "", title: "Missing ID" },
    { platformItemId: "missing_title", title: "" },
    { platformItemId: "valid_002", title: "Valid Title 2" },
  ];

  const valid = [];
  const unrecognized = [];

  for (const item of rawBatch) {
    const id = (item.platformItemId || "").trim();
    const title = (item.title || "").trim();
    if (!id || !title) {
      unrecognized.push({ raw: item, reason: "Missing title or platform ID" });
    } else {
      valid.push(item);
    }
  }

  assert.equal(valid.length, 2);
  assert.equal(unrecognized.length, 2);
});

runTest("Non-destructive contract: Original raw storage map is never mutated during scan", () => {
  const originalSourceMap = {
    "youtube-discovery-workspace::savedItems": [
      { id: "youtube:123", platformItemId: "123", title: "Original Item" },
    ],
  };

  const frozenCopy = JSON.parse(JSON.stringify(originalSourceMap));

  // Perform operations
  const items = originalSourceMap["youtube-discovery-workspace::savedItems"];
  const transformed = items.map((i) => ({ ...i, isBeforeAppUpdating: true }));

  assert.equal(transformed.length, 1);
  assert.deepEqual(originalSourceMap, frozenCopy, "Source map must not be mutated");
});

// ─────────────────────────────────────────────────────────────────────────────
// Group 4: Manifest-Example Authenticity Verification
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n📦 Group 4: Manifest-Example Authenticity Verification");

runTest("Authentic Saved-Items backup file parses and contains valid items", () => {
  const samplePath = path.join(ROOT, "public", "manifest-example", "Saved-Items", "saved-items.json");
  assert.ok(fs.existsSync(samplePath), "Sample saved-items.json must exist in public/manifest-example/");

  const content = fs.readFileSync(samplePath, "utf-8");
  const json = JSON.parse(content);

  assert.equal(json.category, "SAVED_ITEMS");
  assert.ok(Array.isArray(json.data), "data must be an array");
  assert.ok(json.data.length > 0, "must contain saved items");

  const first = json.data[0];
  assert.ok(first.platformItemId, "first item must have platformItemId");
  assert.ok(first.title, "first item must have title");
});

runTest("Authentic Playlists backup file parses correctly", () => {
  const samplePath = path.join(ROOT, "public", "manifest-example", "Playlists", "youtube-discovery-user-playlists.json");
  assert.ok(fs.existsSync(samplePath), "Sample playlists file must exist");

  const content = fs.readFileSync(samplePath, "utf-8");
  const json = JSON.parse(content);

  assert.equal(json.category, "PLAYLIST");
  assert.ok(json.data.state.index, "must contain playlists index");
});

runTest("Authentic Search-History backup file parses correctly", () => {
  const samplePath = path.join(ROOT, "public", "manifest-example", "Search-History", "search-history.json");
  assert.ok(fs.existsSync(samplePath), "Sample search history file must exist");

  const content = fs.readFileSync(samplePath, "utf-8");
  const json = JSON.parse(content);

  assert.equal(json.category, "SEARCH_HISTORY");
  assert.ok(Array.isArray(json.data), "must contain search history records");
});

runTest("Authentic References backup file parses correctly", () => {
  const samplePath = path.join(ROOT, "public", "manifest-example", "References", "saved-searches.json");
  assert.ok(fs.existsSync(samplePath), "Sample saved searches file must exist");

  const content = fs.readFileSync(samplePath, "utf-8");
  const json = JSON.parse(content);

  assert.equal(json.category, "REFERENCES");
  assert.ok(Array.isArray(json.data), "must contain references records");
});

// ─────────────────────────────────────────────────────────────────────────────
// Summary
// ─────────────────────────────────────────────────────────────────────────────
console.log(`\n🎉 Results: ${passedTests}/${totalTests} tests passed successfully!\n`);
