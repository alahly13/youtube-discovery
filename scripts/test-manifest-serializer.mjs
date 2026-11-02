import crypto from "node:crypto";
import {
  computePartSha256,
  computeAggregateGenerationSha256,
  buildManifestPartStoragePath,
  buildDerivedRootManifestPath,
  buildTemporaryExportPath,
  partitionRecordsIntoManifestParts,
} from "../src/lib/storage/manifest-serializer.ts";

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    passed++;
    console.log(`  ✓ PASS: ${message}`);
  } else {
    failed++;
    console.error(`  ✗ FAIL: ${message}`);
  }
}

console.log("\n══════════════════════════════════════════════════════════════");
console.log("   MANIFEST SERIALIZER & STORAGE LIFECYCLE TEST SUITE          ");
console.log("══════════════════════════════════════════════════════════════\n");

// Test 1: Path generation with storageOwnerUuid
const storageOwnerUuid = "e7b0c442-98fc-4c14-9afb-f4c8996fb924";
const datasetId = "b1f7c3e2-89a1-4321-9988-123456789abc";
const genId = "gen_01JBCDEF1234567890ABCDEF";

const partPath1 = buildManifestPartStoragePath(storageOwnerUuid, datasetId, genId, 1);
assert(
  partPath1 === `${storageOwnerUuid}/persistence/datasets/${datasetId}/generations/${genId}/parts/part-000001.json`,
  "Part path matches canonical <storage_owner_uuid>/persistence/... structure"
);

const rootPath = buildDerivedRootManifestPath(storageOwnerUuid, datasetId);
assert(
  rootPath === `${storageOwnerUuid}/persistence/datasets/${datasetId}/manifest.json`,
  "Root manifest path matches canonical structure"
);

const exportPath = buildTemporaryExportPath(storageOwnerUuid, "job_123", "export.zip");
assert(
  exportPath === `${storageOwnerUuid}/temp/exports/job_123/export.zip`,
  "Temporary export path matches <storage_owner_uuid>/temp/exports/... structure"
);

// Test 2: Individual Part SHA-256
const sampleContent = '{"test": true}';
const expectedSha = crypto.createHash("sha256").update(sampleContent).digest("hex");
assert(computePartSha256(sampleContent) === expectedSha, "Part SHA-256 computes matching hex digest");

// Test 3: Binary Aggregate Generation SHA-256 Determinism
const partsList = [
  { partNumber: 1, byteCount: 4000, recordCount: 10, sha256: crypto.createHash("sha256").update("part1").digest("hex") },
  { partNumber: 2, byteCount: 3000, recordCount: 8, sha256: crypto.createHash("sha256").update("part2").digest("hex") },
];

const agg1 = computeAggregateGenerationSha256(partsList);
// Reverse order input: should produce identical aggregate SHA because it sorts by partNumber
const agg2 = computeAggregateGenerationSha256([partsList[1], partsList[0]]);
assert(agg1 === agg2, "Aggregate SHA-256 is deterministic and independent of input array ordering");
assert(agg1.length === 64, "Aggregate SHA-256 produces 64-char lowercase hexadecimal digest");

// Test 4: Partitioning logic with simulated small target bytes
const sampleRecords = Array.from({ length: 50 }, (_, i) => ({
  id: `video_${i}`,
  title: `Sample Video Item ${i} with long descriptive text to test chunk boundaries`,
  views: i * 1000,
}));

const genDesc = partitionRecordsIntoManifestParts({
  datasetId,
  datasetType: "SAVED_ITEMS",
  ownerId: "profile_01",
  storageOwnerUuid,
  generationId: genId,
  records: sampleRecords,
  targetBytes: 1500, // Small target to force multiple chunks
});

assert(genDesc.parts.length > 1, `Records split into multiple parts (${genDesc.parts.length} parts)`);
assert(genDesc.totalRecords === 50, "Total record count matches input count exactly");
assert(genDesc.aggregateSha256.length === 64, "Generated generation descriptor has valid aggregate SHA-256");

for (const p of genDesc.parts) {
  assert(p.rawJson.includes('"totalPartsInGeneration":' + genDesc.parts.length), `Part ${p.partNumber} envelope has correct totalParts`);
  assert(computePartSha256(p.rawJson) === p.sha256, `Part ${p.partNumber} sha256 matches serialized content`);
  assert(Buffer.byteLength(p.rawJson, "utf8") === p.byteCount, `Part ${p.partNumber} byteCount matches Buffer byteLength`);
}

console.log("\n══════════════════════════════════════════════════════════════");
console.log(`   TEST RESULT: ${passed} PASSED, ${failed} FAILED (TOTAL: ${passed + failed})`);
console.log("══════════════════════════════════════════════════════════════\n");

if (failed > 0) process.exit(1);
