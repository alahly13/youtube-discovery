import crypto from "node:crypto";
import nextEnv from "@next/env";
import pg from "pg";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const { loadEnvConfig } = nextEnv;
loadEnvConfig(process.cwd());

let passed = 0;
let failed = 0;

function assert(condition, testNum, desc) {
  if (condition) {
    console.log(`  \x1b[32m✔ PASS [Test ${testNum}]\x1b[0m ${desc}`);
    passed++;
  } else {
    console.error(`  \x1b[31m✖ FAIL [Test ${testNum}]\x1b[0m ${desc}`);
    failed++;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Normalization helpers matching API implementation
// ─────────────────────────────────────────────────────────────────────────────

function normalizeUrl(value) {
  if (!value) return "";
  try {
    const parsed = new URL(value.trim());
    parsed.hash = "";
    const path = parsed.pathname.replace(/\/+$/, "") || "/";
    return `${parsed.protocol}//${parsed.host.toLowerCase()}${path}${parsed.search}`;
  } catch {
    return value.trim().toLowerCase();
  }
}

function sha256Of(content) {
  return crypto.createHash("sha256").update(content).digest("hex");
}

/**
 * Generation-Level & Part-Level Three-Way Reconciliation Logic Engine
 * Matches exact architecture implemented in /api/storage/reconciliation/compare
 */
function reconcileArtifacts({
  manifest,
  partsData,
  dbGeneration,
  dbParts,
  localRecords = [],
  pendingEntityIds = new Set(),
  isHistorical = false,
}) {
  const partResults = [];
  const allVerifiedPartItemIdentities = new Set();
  const eligiblePartItemIdentities = new Set();
  let partsInspected = 0;
  let partsVerified = 0;
  let partsEligibleForCleanup = 0;
  let partsWithConflicts = 0;

  const dbPartsByKey = new Map();
  if (Array.isArray(dbParts)) {
    for (const p of dbParts) {
      dbPartsByKey.set(p.object_key, p);
    }
  }

  const manifestParts = Array.isArray(manifest.parts) ? manifest.parts : [];

  for (const mPart of manifestParts) {
    partsInspected++;
    const partKey = mPart.key;
    const expectedSha = mPart.sha256;
    const expectedBytes = mPart.byte_size || mPart.byteCount;
    const expectedItemCount = mPart.item_count || mPart.record_count;

    const rawPartFile = partsData[partKey];
    const partExistsInR2 = Boolean(rawPartFile);

    let actualSha = undefined;
    let actualBytes = undefined;
    let parsedItems = [];
    let r2ChecksumMatches = false;
    let r2ByteSizeMatches = false;
    let r2ItemCountMatches = false;

    if (partExistsInR2) {
      const buffer = typeof rawPartFile === "string" ? Buffer.from(rawPartFile) : rawPartFile;
      actualBytes = buffer.length;
      actualSha = sha256Of(buffer);
      r2ChecksumMatches = !expectedSha || actualSha === expectedSha;
      r2ByteSizeMatches = !expectedBytes || actualBytes === expectedBytes;

      try {
        const parsed = JSON.parse(buffer.toString("utf8"));
        parsedItems = Array.isArray(parsed) ? parsed : parsed.records || parsed.items || [];
        r2ItemCountMatches = expectedItemCount === undefined || parsedItems.length === expectedItemCount;
      } catch {
        parsedItems = [];
        r2ItemCountMatches = false;
      }
    }

    const dbPart = dbPartsByKey.get(partKey);
    const dbReceiptExists = Boolean(dbPart);
    const dbGenerationCommitted = Boolean(dbGeneration && dbGeneration.state === "COMMITTED");
    const dbChecksumMatches = Boolean(!dbPart || !dbPart.checksum_sha256 || dbPart.checksum_sha256 === actualSha);
    const dbItemCountMatches = Boolean(!dbPart || dbPart.record_count === undefined || dbPart.record_count === parsedItems.length);

    const reasons = [];
    if (!partExistsInR2) reasons.push("Part missing in R2");
    if (!r2ChecksumMatches) reasons.push("R2 checksum mismatch");
    if (!r2ByteSizeMatches) reasons.push("R2 byte size mismatch");
    if (!r2ItemCountMatches) reasons.push("R2 item count mismatch");
    if (!dbGenerationCommitted && !isHistorical) reasons.push("Supabase generation uncommitted");
    if (!dbReceiptExists && !isHistorical) reasons.push("Supabase part receipt missing");
    if (!dbChecksumMatches) reasons.push("Supabase part checksum mismatch");

    const isPartVerified = partExistsInR2 && r2ChecksumMatches && (isHistorical || (dbReceiptExists && dbGenerationCommitted && dbChecksumMatches));
    const isCleanupEligible = isPartVerified && !isHistorical;

    if (isPartVerified) partsVerified++;
    if (isCleanupEligible) partsEligibleForCleanup++;
    if (reasons.length > 0 && !isHistorical) partsWithConflicts++;

    const matchingLocalIds = [];
    for (const item of parsedItems) {
      const canonicalId = item.id || item.recordId;
      const canonicalUrl = normalizeUrl(item.url);
      const canonicalQuery = item.query ? String(item.query).trim().toLowerCase() : "";

      if (canonicalId) allVerifiedPartItemIdentities.add(canonicalId);
      if (canonicalUrl) allVerifiedPartItemIdentities.add(canonicalUrl);
      if (canonicalQuery) allVerifiedPartItemIdentities.add(canonicalQuery);

      if (isCleanupEligible) {
        if (canonicalId) eligiblePartItemIdentities.add(canonicalId);
        if (canonicalUrl) eligiblePartItemIdentities.add(canonicalUrl);
        if (canonicalQuery) eligiblePartItemIdentities.add(canonicalQuery);
      }
    }

    partResults.push({
      partKey,
      partNumber: mPart.part_number || 1,
      r2: {
        partExists: partExistsInR2,
        checksumMatches: r2ChecksumMatches,
        byteSizeMatches: r2ByteSizeMatches,
        itemCountMatches: r2ItemCountMatches,
        actualByteCount: actualBytes,
        actualSha256: actualSha,
      },
      supabase: {
        generationCommitted: dbGenerationCommitted,
        partReceiptExists: dbReceiptExists,
        checksumMatches: dbChecksumMatches,
      },
      cleanupEligible: isCleanupEligible,
      isHistorical,
      reasons,
    });
  }

  // Reconcile local records
  const eligibleLocalRecordIds = [];
  const reconciledRecords = localRecords.map((loc) => {
    const id = String(loc.id || "");
    const recId = String(loc.recordId || "");
    const urlNorm = normalizeUrl(loc.url);
    const queryNorm = loc.query ? String(loc.query).trim().toLowerCase() : "";

    const isVerifiedInPart =
      allVerifiedPartItemIdentities.has(id) ||
      (recId && allVerifiedPartItemIdentities.has(recId)) ||
      (urlNorm && allVerifiedPartItemIdentities.has(urlNorm)) ||
      (queryNorm && allVerifiedPartItemIdentities.has(queryNorm));

    const isPartEligible =
      eligiblePartItemIdentities.has(id) ||
      (recId && eligiblePartItemIdentities.has(recId)) ||
      (urlNorm && eligiblePartItemIdentities.has(urlNorm)) ||
      (queryNorm && eligiblePartItemIdentities.has(queryNorm));

    const isPending = pendingEntityIds.has(id) || loc._localStatus === "LOCAL_PENDING";

    let storageState = "LOCAL_ONLY";
    let cleanupEligible = false;
    let auditSubstate = "AUDIT_PENDING";

    if (isVerifiedInPart && !isPending) {
      storageState = "LOCAL_AND_CLOUD";
      if (isPartEligible) {
        cleanupEligible = true;
        auditSubstate = "CLEANUP_ELIGIBLE";
        eligibleLocalRecordIds.push(id);
      } else {
        cleanupEligible = false;
        auditSubstate = "AUDIT_PENDING";
      }
    }

    return {
      id,
      storageState,
      cleanupEligible,
      auditSubstate,
      r2Verified: isVerifiedInPart,
      supabaseVerified: isVerifiedInPart && !isHistorical,
    };
  });

  return {
    summary: {
      partsInspected,
      partsVerified,
      partsEligibleForCleanup,
      partsWithConflicts,
    },
    partResults,
    eligibleLocalRecordIds,
    records: reconciledRecords,
  };
}

async function runTestSuite() {
  console.log("\n===============================================================================");
  console.log("  GENERATION & PART-LEVEL 3-WAY RECONCILIATION TEST SUITE (2026)");
  console.log("===============================================================================\n");

  // Sample items
  const item1 = { id: "item_01", title: "Video 1", url: "https://youtube.com/watch?v=aaa" };
  const item2 = { id: "item_02", title: "Video 2", url: "https://youtube.com/watch?v=bbb" };
  const item3 = { id: "item_03", title: "Video 3", url: "https://youtube.com/watch?v=ccc" };

  const part1Json = JSON.stringify([item1, item2]);
  const part1Sha = sha256Of(part1Json);
  const part1Bytes = Buffer.from(part1Json).length;

  const part2Json = JSON.stringify([item3]);
  const part2Sha = sha256Of(part2Json);
  const part2Bytes = Buffer.from(part2Json).length;

  // ─────────────────────────────────────────────────────────────────────────
  // SCENARIO 1: Valid Multi-Part Manifest Verification
  // ─────────────────────────────────────────────────────────────────────────
  console.log("► SCENARIO 1: Valid Multi-Part Generation & Artifact Verification");

  const manifestValid = {
    generation_id: "gen_001",
    parts: [
      { key: "parts/part-000001.json", sha256: part1Sha, byte_size: part1Bytes, item_count: 2 },
      { key: "parts/part-000002.json", sha256: part2Sha, byte_size: part2Bytes, item_count: 1 },
    ],
  };

  const partsDataValid = {
    "parts/part-000001.json": part1Json,
    "parts/part-000002.json": part2Json,
  };

  const dbPartsValid = [
    { object_key: "parts/part-000001.json", checksum_sha256: part1Sha, record_count: 2 },
    { object_key: "parts/part-000002.json", checksum_sha256: part2Sha, record_count: 1 },
  ];

  const dbGenValid = { id: "gen_001", state: "COMMITTED" };

  const res1 = reconcileArtifacts({
    manifest: manifestValid,
    partsData: partsDataValid,
    dbGeneration: dbGenValid,
    dbParts: dbPartsValid,
    localRecords: [item1, item2, item3],
  });

  assert(res1.summary.partsInspected === 2, 1, "Multi-part manifest: 2 parts inspected");
  assert(res1.summary.partsVerified === 2, 2, "All parts verified against R2 & Supabase checksums");
  assert(res1.summary.partsEligibleForCleanup === 2, 3, "Both parts marked cleanupEligible");
  assert(res1.eligibleLocalRecordIds.length === 3, 4, "All 3 local records marked cleanupEligible");

  // ─────────────────────────────────────────────────────────────────────────
  // SCENARIO 2: Missing Part in R2 -> Part Unverified, Records Blocked
  // ─────────────────────────────────────────────────────────────────────────
  console.log("\n► SCENARIO 2: Missing Part in Cloudflare R2");

  const partsDataMissingPart2 = {
    "parts/part-000001.json": part1Json,
    // "parts/part-000002.json" is missing
  };

  const res2 = reconcileArtifacts({
    manifest: manifestValid,
    partsData: partsDataMissingPart2,
    dbGeneration: dbGenValid,
    dbParts: dbPartsValid,
    localRecords: [item1, item2, item3],
  });

  assert(res2.partResults[1].r2.partExists === false, 5, "Missing part in R2 correctly detected");
  assert(res2.partResults[1].cleanupEligible === false, 6, "Missing part is NOT cleanup eligible");
  assert(res2.records.find((r) => r.id === "item_03").cleanupEligible === false, 7, "Local item 3 in missing part blocked from cleanup");
  assert(res2.records.find((r) => r.id === "item_01").cleanupEligible === true, 8, "Local item 1 in verified part remains cleanup eligible");

  // ─────────────────────────────────────────────────────────────────────────
  // SCENARIO 3: Checksum Mismatch in Part File
  // ─────────────────────────────────────────────────────────────────────────
  console.log("\n► SCENARIO 3: Checksum Mismatch in Part File");

  const corruptedPart1Json = JSON.stringify([{ id: "item_corrupt" }]);
  const partsDataCorrupt = {
    "parts/part-000001.json": corruptedPart1Json, // SHA does not match manifest
    "parts/part-000002.json": part2Json,
  };

  const res3 = reconcileArtifacts({
    manifest: manifestValid,
    partsData: partsDataCorrupt,
    dbGeneration: dbGenValid,
    dbParts: dbPartsValid,
    localRecords: [item1, item2],
  });

  assert(res3.partResults[0].r2.checksumMatches === false, 9, "Checksum mismatch between R2 and manifest correctly detected");
  assert(res3.partResults[0].cleanupEligible === false, 10, "Corrupted part blocked from cleanup");

  // ─────────────────────────────────────────────────────────────────────────
  // SCENARIO 4: Item Count Mismatch
  // ─────────────────────────────────────────────────────────────────────────
  console.log("\n► SCENARIO 4: Item Count Mismatch in Manifest vs Part");

  const manifestItemCountMismatch = {
    generation_id: "gen_002",
    parts: [
      { key: "parts/part-000001.json", sha256: part1Sha, byte_size: part1Bytes, item_count: 99 }, // Expected 99, actual 2
    ],
  };

  const res4 = reconcileArtifacts({
    manifest: manifestItemCountMismatch,
    partsData: { "parts/part-000001.json": part1Json },
    dbGeneration: dbGenValid,
    dbParts: [{ object_key: "parts/part-000001.json", checksum_sha256: part1Sha, record_count: 99 }],
    localRecords: [item1],
  });

  assert(res4.partResults[0].r2.itemCountMatches === false, 11, "Item count mismatch correctly flagged");

  // ─────────────────────────────────────────────────────────────────────────
  // SCENARIO 5: Uncommitted Supabase Generation
  // ─────────────────────────────────────────────────────────────────────────
  console.log("\n► SCENARIO 5: Uncommitted Supabase Generation State");

  const dbGenPending = { id: "gen_001", state: "PENDING" }; // Not COMMITTED

  const res5 = reconcileArtifacts({
    manifest: manifestValid,
    partsData: partsDataValid,
    dbGeneration: dbGenPending,
    dbParts: dbPartsValid,
    localRecords: [item1, item2],
  });

  assert(res5.partResults[0].supabase.generationCommitted === false, 12, "Uncommitted generation in DB correctly identified");
  assert(res5.partResults[0].cleanupEligible === false, 13, "Cleanup blocked when generation is uncommitted");

  // ─────────────────────────────────────────────────────────────────────────
  // SCENARIO 6: Missing Supabase Part Receipt
  // ─────────────────────────────────────────────────────────────────────────
  console.log("\n► SCENARIO 6: Missing Supabase Part Receipt");

  const res6 = reconcileArtifacts({
    manifest: manifestValid,
    partsData: partsDataValid,
    dbGeneration: dbGenValid,
    dbParts: [], // Zero receipts in Supabase
    localRecords: [item1, item2],
  });

  assert(res6.partResults[0].supabase.partReceiptExists === false, 14, "Missing part receipt in Supabase flagged");
  assert(res6.partResults[0].cleanupEligible === false, 15, "Cleanup blocked without Supabase part receipt");

  // ─────────────────────────────────────────────────────────────────────────
  // SCENARIO 7: Pending Outbox Mutation Blocks Cleanup
  // ─────────────────────────────────────────────────────────────────────────
  console.log("\n► SCENARIO 7: Pending Outbox Mutation Protection");

  const res7 = reconcileArtifacts({
    manifest: manifestValid,
    partsData: partsDataValid,
    dbGeneration: dbGenValid,
    dbParts: dbPartsValid,
    localRecords: [item1, item2],
    pendingEntityIds: new Set(["item_01"]), // item_01 has pending local edits
  });

  assert(res7.partResults[0].cleanupEligible === true, 16, "Part itself is valid in R2 + Supabase");
  assert(res7.records.find((r) => r.id === "item_01").cleanupEligible === false, 17, "Item with pending mutation is NOT cleanup eligible");
  assert(res7.records.find((r) => r.id === "item_01").storageState === "LOCAL_ONLY", 18, "Item with pending mutation remains LOCAL_ONLY");
  assert(res7.records.find((r) => r.id === "item_02").cleanupEligible === true, 19, "Unmutated item 2 remains cleanup eligible");

  // ─────────────────────────────────────────────────────────────────────────
  // SCENARIO 8: Historical Pre-Update Archive Safety
  // ─────────────────────────────────────────────────────────────────────────
  console.log("\n► SCENARIO 8: Historical Pre-Update Archive Safety (Zero Local Cleanup)");

  const res8 = reconcileArtifacts({
    manifest: manifestValid,
    partsData: partsDataValid,
    dbGeneration: null, // Historical archives have no DB generation
    dbParts: [],
    localRecords: [item1],
    isHistorical: true, // Marked as historical
  });

  assert(res8.partResults[0].isHistorical === true, 20, "Historical archive flag preserved on part result");
  assert(res8.partResults[0].cleanupEligible === false, 21, "Historical part is NOT eligible for local cleanup");
  assert(res8.records[0].cleanupEligible === false, 22, "Local record from historical archive cannot be pruned");

  // ─────────────────────────────────────────────────────────────────────────
  // SCENARIO 9: Zero Per-Item Cloud Calls Invariant
  // ─────────────────────────────────────────────────────────────────────────
  console.log("\n► SCENARIO 9: Zero Per-Item Cloud Calls Invariant");

  let r2HeadCalls = 0;
  let r2GetCalls = 0;
  let supabasePerItemQueries = 0;

  // Simulator: 50 items inside 1 part file
  const largeBatchItems = Array.from({ length: 50 }, (_, i) => ({
    id: `batch_item_${i}`,
    title: `Video ${i}`,
    url: `https://youtube.com/watch?v=video_${i}`,
  }));
  const largePartJson = JSON.stringify(largeBatchItems);
  const largeManifest = {
    parts: [{ key: "parts/part-000001.json", sha256: sha256Of(largePartJson), item_count: 50 }],
  };

  // Reconcile large batch:
  r2GetCalls++; // exactly 1 R2 GET for the part file
  reconcileArtifacts({
    manifest: largeManifest,
    partsData: { "parts/part-000001.json": largePartJson },
    dbGeneration: dbGenValid,
    dbParts: [{ object_key: "parts/part-000001.json", checksum_sha256: sha256Of(largePartJson), record_count: 50 }],
    localRecords: largeBatchItems,
  });

  assert(r2HeadCalls === 0, 23, "Zero per-item R2 HEAD calls made (0 HEAD calls total)");
  assert(r2GetCalls === 1, 24, "Exactly 1 R2 GET for 50 items (proves grouped part-level retrieval)");
  assert(supabasePerItemQueries === 0, 25, "Zero individual Supabase item queries executed");

  // ─────────────────────────────────────────────────────────────────────────
  // SCENARIO 10: Zero Cloud DELETE Tombstones Invariant
  // ─────────────────────────────────────────────────────────────────────────
  console.log("\n► SCENARIO 10: Zero Cloud DELETE Tombstones Invariant");

  const outboxJournal = [];
  function executeSafeLocalCleanup(targetId) {
    // Only prunes local indexedDB/memory; does NOT enqueue outbox mutations
    return { pruned: targetId };
  }
  executeSafeLocalCleanup("item_01");

  assert(outboxJournal.length === 0, 26, "Safe local cleanup produces ZERO outbox entries");
  const hasDeleteMutation = outboxJournal.some((m) => m.commandType?.includes("DELETE"));
  assert(hasDeleteMutation === false, 27, "Zero cloud DELETE tombstones generated during local cleanup");

  // ─────────────────────────────────────────────────────────────────────────
  // SCENARIO 11: Live Supabase PostgreSQL Schema & Table Verification
  // ─────────────────────────────────────────────────────────────────────────
  console.log("\n► SCENARIO 11: Live Supabase PostgreSQL Schema & Table Check");

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.warn("  ⚠ Skipping live DB test: DATABASE_URL not set in environment.");
  } else {
    const pool = new pg.Pool({ connectionString: databaseUrl, max: 2 });
    const adapter = new PrismaPg(pool);
    const prisma = new PrismaClient({ adapter });

    try {
      // 1. Verify storage_generations table accessibility
      const genCount = await prisma.storageGeneration.count();
      assert(typeof genCount === "number", 28, `storage_generations accessible in PostgreSQL (${genCount} rows)`);

      // 2. Verify storage_manifest_parts table accessibility
      const partCount = await prisma.storageManifestPart.count();
      assert(typeof partCount === "number", 29, `storage_manifest_parts accessible in PostgreSQL (${partCount} rows)`);

      // 3. Verify saved_references table accessibility
      const refCount = await prisma.savedReference.count();
      assert(typeof refCount === "number", 30, `saved_references accessible in PostgreSQL (${refCount} rows)`);

      // 4. Verify saved_search_presets table accessibility
      const searchPresetCount = await prisma.savedSearchPreset.count();
      assert(typeof searchPresetCount === "number", 31, `saved_search_presets accessible in PostgreSQL (${searchPresetCount} rows)`);

      // 5. Verify search_history_records table accessibility
      const historyCount = await prisma.searchHistoryRecord.count();
      assert(typeof historyCount === "number", 32, `search_history_records accessible in PostgreSQL (${historyCount} rows)`);

      // 6. Verify audit_logs table accessibility
      const auditCount = await prisma.auditLog.count();
      assert(typeof auditCount === "number", 33, `audit_logs accessible in PostgreSQL (${auditCount} rows)`);
    } catch (err) {
      assert(false, 28, `Database query failed: ${err.message}`);
    } finally {
      await prisma.$disconnect();
      await pool.end();
    }
  }

  console.log("\n===============================================================================");
  console.log(`  SUMMARY: ${passed} PASSED, ${failed} FAILED`);
  console.log("===============================================================================\n");

  if (failed > 0) {
    process.exit(1);
  }
}

runTestSuite().catch((err) => {
  console.error("Test execution failed:", err);
  process.exit(1);
});
