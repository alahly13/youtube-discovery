/**
 * ═══════════════════════════════════════════════════════════════════════════
 * Manifest Naming & Directory Standard Verification Test Suite (2026)
 * ──────────────────────────────────────────────────────────────────────────
 * Scope: Automated verification for:
 *   1. Canonical directory hierarchy ({namespace}/{YYYY}/{MM}/{YYYY-MM-DD}/)
 *   2. Canonical filename grammar ({entity}_{contentSlug}_{createdAt}_{version}.{extension})
 *   3. Strict slug sanitization & filesystem safety
 *   4. UTC timestamp formatting (compact for filename, ISO 8601 for metadata)
 *   5. Zero-padded sequential version numbering
 *   6. ManifestMetadata envelope builder & validator
 *   7. Exact byte size measurement & 40/45 MiB sizing constraints
 *   8. Universal legacy path resolver (preserving historical archives)
 *   9. Browser storage structured key generator
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { compileTsEntries } from "./lib/compile-ts-entry.mjs";

const compiled = compileTsEntries([
  "src/lib/storage/manifest-naming.ts",
  "src/lib/pwa/share-target.ts",
  "src/lib/saved-references/link-identity.ts",
]);

const {
  STORAGE_NAMING_VERSION,
  MANIFEST_ENTITIES,
  ENTITY_NAMESPACE_MAP,
  ENTITY_PAGE_MAP,
  MANIFEST_SIZE_LIMITS,
  formatUtcDateComponents,
  formatUtcTimestampCompact,
  formatIso8601Utc,
  formatVersion,
  parseVersion,
  sanitizeContentSlug,
  buildCanonicalDirectoryPath,
  buildCanonicalManifestFilename,
  buildCanonicalManifestStoragePath,
  buildBrowserStorageKey,
  createManifestDocument,
  validateManifestMetadataEnvelope,
  resolveManifestPath,
} = compiled.load("lib/storage/manifest-naming.js");

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
console.log("   MANIFEST NAMING & DIRECTORY STANDARD TEST SUITE (2026)      ");
console.log("══════════════════════════════════════════════════════════════\n");

// ─────────────────────────────────────────────────────────────────────────────
// Group 1: Entities, Namespaces & Version Constants
// ─────────────────────────────────────────────────────────────────────────────
console.log("── Group 1: Entities, Namespaces & Constants ──────────────────");

assert(STORAGE_NAMING_VERSION === "2026.1", "Standard naming version is 2026.1");
assert(MANIFEST_ENTITIES.length >= 10, "Defines all standard manifest entities");
assert(MANIFEST_ENTITIES.includes("saved_items"), "Includes saved_items");
assert(MANIFEST_ENTITIES.includes("playlists"), "Includes playlists");
assert(MANIFEST_ENTITIES.includes("saved_searches"), "Includes saved_searches");
assert(MANIFEST_ENTITIES.includes("search_history"), "Includes search_history");
assert(MANIFEST_ENTITIES.includes("saved_titles_links"), "Includes saved_titles_links");
assert(MANIFEST_ENTITIES.includes("collections"), "Includes collections");
assert(MANIFEST_ENTITIES.includes("search_manifests"), "Includes search_manifests");
assert(MANIFEST_ENTITIES.includes("api_keys"), "Includes api_keys");
assert(MANIFEST_ENTITIES.includes("admin_settings"), "Includes admin_settings");
assert(MANIFEST_ENTITIES.includes("exports"), "Includes exports");
assert(MANIFEST_ENTITIES.includes("temp"), "Includes temp");

assert(ENTITY_NAMESPACE_MAP.saved_items === "asdy/saved-items", "saved_items maps to asdy/saved-items");
assert(ENTITY_NAMESPACE_MAP.playlists === "asdy/playlists", "playlists maps to asdy/playlists");
assert(ENTITY_NAMESPACE_MAP.saved_titles_links === "asdy/saved-titles-links", "saved_titles_links maps to asdy/saved-titles-links");
assert(ENTITY_PAGE_MAP.saved_items === "saved", "saved_items maps to saved page");
assert(ENTITY_PAGE_MAP.saved_titles_links === "saved-titles-links", "saved_titles_links maps to saved-titles-links page");

// ─────────────────────────────────────────────────────────────────────────────
// Group 2: UTC Timestamp & Version Formatting
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n── Group 2: UTC Timestamp & Version Formatting ────────────────");

const testDate = new Date("2026-11-09T15:30:45.123Z");
const dateParts = formatUtcDateComponents(testDate);
assert(dateParts.year === "2026", "Year component is 2026");
assert(dateParts.month === "11", "Month component is 11");
assert(dateParts.day === "09", "Day component is 09");
assert(dateParts.isoDate === "2026-11-09", "ISO date is 2026-11-09");

const compactTimestamp = formatUtcTimestampCompact(testDate);
assert(compactTimestamp === "20261109T153045Z", "Compact UTC timestamp matches YYYYMMDDTHHmmssZ");

const isoTimestamp = formatIso8601Utc(testDate);
assert(isoTimestamp === "2026-11-09T15:30:45.123Z", "ISO timestamp matches ISO 8601 UTC format");

assert(formatVersion(1) === "v001", "Version 1 formats as v001");
assert(formatVersion(42) === "v042", "Version 42 formats as v042");
assert(formatVersion(105) === "v105", "Version 105 formats as v105");
assert(parseVersion("v003") === 3, "parseVersion extracts 3 from v003");
assert(parseVersion("v42") === 42, "parseVersion extracts 42 from v42");
assert(parseVersion(5) === 5, "parseVersion preserves integer");

// ─────────────────────────────────────────────────────────────────────────────
// Group 3: Slug Sanitization & Filesystem Safety
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n── Group 3: Slug Sanitization ─────────────────────────────────");

assert(sanitizeContentSlug("AI Research & Discoveries") === "ai_research_discoveries", "Converts spaces & symbols to underscores");
assert(sanitizeContentSlug("Molecular Biology: Part 1") === "molecular_biology_part_1", "Strips colons & non-alphanumerics");
assert(sanitizeContentSlug("قائمة تشغيل الفيديوهات") === "general", "Non-ASCII / Arabic safely falls back to general slug");
assert(sanitizeContentSlug("   multiple   spaces  ") === "multiple_spaces", "Collapses consecutive whitespace");
assert(sanitizeContentSlug("__leading_trailing__") === "leading_trailing", "Trims leading and trailing underscores");
assert(sanitizeContentSlug("") === "general", "Empty string falls back to general");
assert(sanitizeContentSlug("A".repeat(100), 20).length === 20, "Enforces maxLength constraint");

// ─────────────────────────────────────────────────────────────────────────────
// Group 4: Directory Path & Filename Generation
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n── Group 4: Canonical Directory & Filename Builders ───────────");

const dirStandard = buildCanonicalDirectoryPath({
  entity: "saved_items",
  createdAt: testDate,
});
assert(
  dirStandard === "asdy/saved-items/2026/11/2026-11-09/",
  "Permanent directory path matches {namespace}/{YYYY}/{MM}/{YYYY-MM-DD}/"
);

const dirPlaylist = buildCanonicalDirectoryPath({
  entity: "playlists",
  createdAt: testDate,
  entityId: "science_lectures_2026",
});
assert(
  dirPlaylist === "asdy/playlists/science_lectures_2026/2026/11/2026-11-09/",
  "Playlist directory preserves stable playlist identity in path"
);

const dirTemp = buildCanonicalDirectoryPath({
  entity: "temp",
  createdAt: testDate,
  entityId: "imports",
  uploadId: "staging_batch_99",
});
assert(
  dirTemp === "asdy/temp/imports/staging_batch_99/",
  "Temp directory builds under asdy/temp/{entityType}/{uploadId}/"
);

const filename = buildCanonicalManifestFilename({
  entity: "saved_items",
  contentSlug: "AI Research",
  createdAt: testDate,
  version: 1,
});
assert(
  filename === "saved_items_ai_research_20261109T153045Z_v001.json",
  "Filename matches {entity}_{contentSlug}_{createdAt}_{version}.json"
);

const fullStoragePath = buildCanonicalManifestStoragePath({
  entity: "saved_items",
  contentSlug: "AI Research",
  createdAt: testDate,
  version: 1,
});
assert(
  fullStoragePath === "asdy/saved-items/2026/11/2026-11-09/saved_items_ai_research_20261109T153045Z_v001.json",
  "Full canonical storage path correctly combines directory and filename"
);

const browserKey = buildBrowserStorageKey("saved_items", "AI Research", 1);
assert(
  browserKey === "yd:manifest:saved_items:ai_research:v001",
  "Browser storage key matches yd:manifest:{entity}:{slug}:{version}"
);

// ─────────────────────────────────────────────────────────────────────────────
// Group 5: ManifestMetadata Envelope & Byte Verification
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n── Group 5: ManifestMetadata Envelope & Checksums ─────────────");

const sampleItems = [
  { id: "vid-1", title: "Quantum Computing Today", url: "https://youtube.com/watch?v=1" },
  { id: "vid-2", title: "Superconductivity in 2026", url: "https://youtube.com/watch?v=2" },
];

const created = createManifestDocument({
  manifestId: "mnf_12345678-1234-1234-1234-123456789abc",
  datasetId: "dst_98765432-4321-4321-4321-cba987654321",
  ownerId: "usr_55555555-5555-5555-5555-555555555555",
  entityType: "saved_items",
  contentSlug: "Quantum Research",
  description: "Saved YouTube items for quantum research",
  items: sampleItems,
  version: 1,
  createdAt: testDate,
});

assert(created.document.metadata.entityType === "saved_items", "Metadata contains entityType");
assert(created.document.metadata.page === "saved", "Metadata contains page");
assert(created.document.metadata.version === 1, "Metadata contains version 1");
assert(created.document.metadata.itemCount === 2, "Metadata itemCount matches sample item count");
assert(created.document.metadata.checksumSha256.length === 64, "Checksum is 64-character hex");
assert(created.fileSizeBytes > 0, "fileSizeBytes is positive integer");
assert(created.document.items.length === 2, "Items preserved in envelope");

const validation = validateManifestMetadataEnvelope(created.document);
assert(validation.valid === true, "Generated manifest document passes strict envelope validation");

// ─────────────────────────────────────────────────────────────────────────────
// Group 6: Universal Legacy Resolver (Zero-Deletion Compatibility)
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n── Group 6: Universal Legacy Resolver ─────────────────────────");

// Test standard 2026 format
const resolvedStandard = resolveManifestPath(
  "asdy/saved-items/2026/11/2026-11-09/saved_items_ai_research_20261109T153000Z_v001.json"
);
assert(
  resolvedStandard.classification === "CANONICAL_2026_STANDARD",
  "Recognizes CANONICAL_2026_STANDARD format"
);
assert(resolvedStandard.entity === "saved_items", "Resolves saved_items entity");
assert(resolvedStandard.contentSlug === "ai_research", "Resolves contentSlug");
assert(resolvedStandard.version === 1, "Resolves version 1");
assert(resolvedStandard.isImmutable === true, "Standard versioned object is immutable");

// Test canonical generation V2
const resolvedGenV2 = resolveManifestPath(
  "asdy/persistence/e7b0c442-98fc-4c14-9afb-f4c8996fb924/saved-items/generations/gen_01JBCDEF/manifest.json"
);
assert(
  resolvedGenV2.classification === "CANONICAL_GENERATION_V2",
  "Recognizes CANONICAL_GENERATION_V2 format"
);
assert(resolvedGenV2.isImmutable === true, "Generation manifest is immutable");

// Test historical before-app-updating
const resolvedHistorical = resolveManifestPath(
  "asdy/persistence/e7b0c442-98fc-4c14-9afb-f4c8996fb924/saved-items/before-app-updating/generations/gen_01/manifest.json"
);
assert(
  resolvedHistorical.classification === "CANONICAL_HISTORICAL_V2",
  "Recognizes CANONICAL_HISTORICAL_V2 format"
);

// Test OLD historical archive
const resolvedOld = resolveManifestPath(
  "asdy/old/saved-items/archive_123/manifest.json"
);
assert(
  resolvedOld.classification === "OLD_ARCHIVE",
  "Recognizes OLD_ARCHIVE format without mutation"
);

// Test browser storage key
const resolvedBrowser = resolveManifestPath(
  "yd:manifest:saved_items:ai_research:v001"
);
assert(
  resolvedBrowser.classification === "BROWSER_STORAGE",
  "Recognizes BROWSER_STORAGE key"
);

// Test legacy owner persistence
const resolvedLegacy = resolveManifestPath(
  "e7b0c442-98fc-4c14-9afb-f4c8996fb924/persistence/saved_items/manifest.json"
);
assert(
  resolvedLegacy.classification === "LEGACY_PERSISTENCE",
  "Recognizes LEGACY_PERSISTENCE key for backward compatibility"
);

console.log("\n══════════════════════════════════════════════════════════════");
console.log(`   TEST RESULT: ${passed} PASSED, ${failed} FAILED (TOTAL: ${passed + failed})`);
console.log("══════════════════════════════════════════════════════════════\n");

if (failed > 0) {
  process.exit(1);
}
