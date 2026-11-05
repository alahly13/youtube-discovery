/**
 * ═══════════════════════════════════════════════════════════════════════════
 * Canonical Resource Taxonomy & Contract Verification
 * ──────────────────────────────────────────────────────────────────────────
 * Scope: Proves the rules that protect every storage boundary:
 *   - resource type is distinct from dataset type
 *   - VIDEO_SHORT requires explicit /shorts/ evidence, never duration
 *   - saved searches, search history, user playlists, and YouTube playlists
 *     are never conflated
 *   - stable identity is never derived from titles or array position
 *   - serialized records always carry resourceType + recordId + resourceId
 *
 * The taxonomy module is intentionally runtime-agnostic (no imports), so Node
 * can execute it directly with type stripping.
 * ═══════════════════════════════════════════════════════════════════════════
 */

import {
  RESOURCE_TYPES,
  RESOURCE_SCHEMA_VERSION,
  RESOURCE_TYPE_METADATA,
  classifyResourceRecord,
  normalizeResourceRecord,
  validateResourceRecord,
  summarizeResourceTypes,
  isYouTubeShortsUrl,
  extractYouTubeResourceId,
  resolveRecordId,
  resolveResourceId,
  buildStableRecordId,
} from "../src/lib/resources/resource-taxonomy.ts";

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
console.log("   CANONICAL RESOURCE TAXONOMY & CONTRACT TEST SUITE          ");
console.log("══════════════════════════════════════════════════════════════\n");

// ── Taxonomy completeness ──────────────────────────────────────────────────
const expectedTypes = [
  "VIDEO",
  "VIDEO_SHORT",
  "CHANNEL",
  "YOUTUBE_PLAYLIST",
  "USER_PLAYLIST",
  "SAVED_TITLE",
  "SAVED_LINK",
  "SAVED_SEARCH",
  "UNKNOWN",
];
assert(
  expectedTypes.every((type) => RESOURCE_TYPES.includes(type)),
  "Taxonomy exposes all nine canonical resource types"
);
assert(
  RESOURCE_TYPES.every((type) => RESOURCE_TYPE_METADATA[type]?.label),
  "Every resource type has display metadata"
);
assert(RESOURCE_SCHEMA_VERSION === 2, "Resource schema version is 2");

// ── Shorts evidence ────────────────────────────────────────────────────────
assert(
  isYouTubeShortsUrl("https://www.youtube.com/shorts/abc123XYZ_-") === true,
  "Explicit /shorts/ URL is recognized as Short evidence"
);
assert(
  isYouTubeShortsUrl("https://youtube.com/shorts/abc123") === true,
  "Shorts URL without www is recognized"
);
assert(
  isYouTubeShortsUrl("https://www.youtube.com/watch?v=abc123") === false,
  "Standard watch URL is not Short evidence"
);
assert(
  isYouTubeShortsUrl("https://youtu.be/abc123") === false,
  "youtu.be URL is not automatically Short evidence"
);

const shortFromUrl = classifyResourceRecord({
  url: "https://www.youtube.com/shorts/abc123",
  title: "A vertical clip",
});
assert(
  shortFromUrl.resourceType === "VIDEO_SHORT" && shortFromUrl.source === "AUTHORITATIVE",
  "Explicit /shorts/ URL classifies as authoritative VIDEO_SHORT"
);

// Duration-derived markers must never become VIDEO_SHORT.
const durationShort = classifyResourceRecord({
  itemType: "shorts_like",
  durationSeconds: 22,
  url: "https://www.youtube.com/watch?v=abc123",
  title: "Duration-derived short-like",
});
assert(
  durationShort.resourceType === "VIDEO",
  "itemType=shorts_like with duration but no /shorts/ URL classifies as VIDEO"
);

const entityShorts = classifyResourceRecord({
  entityType: "SHORTS",
  url: "https://www.youtube.com/watch?v=abc123",
  title: "Legacy entity shorts marker",
});
assert(
  entityShorts.resourceType === "VIDEO",
  "entityType=SHORTS without /shorts/ URL classifies as VIDEO"
);

const explicitShortType = classifyResourceRecord({
  resourceType: "VIDEO_SHORT",
  resourceId: "abc123",
  title: "Producer-declared Short",
});
assert(
  explicitShortType.resourceType === "VIDEO_SHORT" &&
    explicitShortType.source === "AUTHORITATIVE",
  "An explicit authoritative resourceType=VIDEO_SHORT is preserved"
);

// ── Dataset-aware classification ──────────────────────────────────────────
const savedTitle = classifyResourceRecord(
  { title: "A research title" },
  { datasetType: "REFERENCES" }
);
assert(
  savedTitle.resourceType === "SAVED_TITLE",
  "REFERENCES record with title only classifies as SAVED_TITLE"
);

const savedLink = classifyResourceRecord(
  { title: "Docs", url: "https://example.com/docs" },
  { datasetType: "REFERENCES" }
);
assert(
  savedLink.resourceType === "SAVED_LINK",
  "REFERENCES record with HTTP(S) URL classifies as SAVED_LINK"
);

const savedSearch = classifyResourceRecord(
  { queryText: "documentary editing" },
  { datasetType: "REFERENCES" }
);
assert(
  savedSearch.resourceType === "SAVED_SEARCH",
  "REFERENCES record with query text classifies as SAVED_SEARCH"
);

const searchHistory = classifyResourceRecord(
  { queryText: "documentary editing" },
  { datasetType: "SEARCH_HISTORY" }
);
assert(
  searchHistory.resourceType === "UNKNOWN" && searchHistory.source === "LEGACY",
  "SEARCH_HISTORY is never promoted to SAVED_SEARCH"
);

const userPlaylist = classifyResourceRecord(
  { title: "My research queue", entries: [{ id: "a" }] },
  { datasetType: "PLAYLIST" }
);
assert(
  userPlaylist.resourceType === "USER_PLAYLIST",
  "PLAYLIST dataset record classifies as USER_PLAYLIST"
);

const youtubePlaylist = classifyResourceRecord({
  title: "Uploads",
  url: "https://www.youtube.com/playlist?list=PL123",
  platformItemId: "PL123",
  itemType: "playlist",
});
assert(
  youtubePlaylist.resourceType === "YOUTUBE_PLAYLIST",
  "Playlist URL with list= classifies as YOUTUBE_PLAYLIST"
);

const channel = classifyResourceRecord({
  title: "A channel",
  url: "https://www.youtube.com/channel/UC123",
});
assert(channel.resourceType === "CHANNEL", "Channel URL shape classifies as CHANNEL");

const savedItemWithoutType = classifyResourceRecord(
  { title: "Legacy saved item", platformItemId: "abc123" },
  { datasetType: "SAVED_ITEMS" }
);
assert(
  savedItemWithoutType.resourceType === "UNKNOWN",
  "Saved item without itemType or platform URL is not silently relabeled as SAVED_TITLE"
);

const invalidExplicit = classifyResourceRecord({
  resourceType: "SHORTS",
  itemType: "video",
  platformItemId: "abc123",
});
assert(
  invalidExplicit.resourceType === "VIDEO" && invalidExplicit.invalidExplicitType === "SHORTS",
  "Unsupported stored resourceType is reported and reclassified from stronger evidence"
);

// ── Stable identity ───────────────────────────────────────────────────────
assert(
  resolveRecordId({ recordId: "rec_1", id: "legacy_1" }, "VIDEO", "abc") === "rec_1",
  "Existing recordId wins over all other identity fields"
);
assert(
  resolveRecordId({ id: "legacy_1" }, "VIDEO", "abc") === "legacy_1",
  "Legacy id is preserved as record identity"
);
assert(
  resolveRecordId({ title: "Only a title" }, "SAVED_TITLE", "") === "",
  "A title alone never becomes record identity"
);
assert(
  resolveResourceId({ platformItemId: "vid123", videoId: "vid123" }) === "vid123",
  "Platform item id is the preferred resource identity"
);
assert(
  resolveResourceId({ url: "https://www.youtube.com/watch?v=vid123" }) === "vid123",
  "Resource id is extracted from a canonical URL when no explicit id exists"
);
assert(
  buildStableRecordId("SAVED_TITLE", "ref_123") === "saved_title:ref_123",
  "Deterministic fallback id is derived from resource type + resource id"
);

assert(
  extractYouTubeResourceId("https://www.youtube.com/shorts/abc123") === "abc123",
  "Shorts URL extracts the platform id"
);
assert(
  extractYouTubeResourceId("https://www.youtube.com/playlist?list=PL123") === "PL123",
  "Playlist URL extracts the list id"
);
assert(
  extractYouTubeResourceId("https://www.youtube.com/channel/UC123") === "UC123",
  "Channel URL extracts the channel id"
);

// ── Normalization contract ────────────────────────────────────────────────
const normalized = normalizeResourceRecord({
  id: "rec_video_1",
  platformItemId: "vid123",
  itemType: "video",
  title: "A video",
  durationSeconds: 30,
});
assert(
  normalized.recordId === "rec_video_1" &&
    normalized.resourceId === "vid123" &&
    normalized.resourceType === "VIDEO" &&
    normalized.resourceSchemaVersion === 2 &&
    normalized.classificationSource === "AUTHORITATIVE",
  "normalizeResourceRecord adds recordId, resourceId, resourceType, schema version, and source"
);
assert(
  normalized.title === "A video" && normalized.durationSeconds === 30,
  "Normalization preserves every original field"
);

const normalizedReference = normalizeResourceRecord({
  id: "ref_1",
  savedKind: "SAVED_LINK",
  title: "Docs",
  url: "https://example.com",
});
assert(
  normalizedReference.resourceType === "SAVED_LINK" &&
    normalizedReference.classificationSource === "AUTHORITATIVE",
  "Explicit savedKind discriminator survives normalization"
);

// ── Validation contract ───────────────────────────────────────────────────
assert(
  validateResourceRecord({ itemType: "video", platformItemId: "vid123" }).valid === true,
  "VIDEO with platform resource id passes validation"
);
assert(
  validateResourceRecord({ itemType: "video" }).valid === false,
  "VIDEO without platform resource id fails validation"
);
assert(
  validateResourceRecord({ savedKind: "SAVED_LINK", title: "No URL" }).valid === false,
  "SAVED_LINK without a valid HTTP(S) URL fails validation"
);
assert(
  validateResourceRecord({ id: "ref_link_1", savedKind: "SAVED_LINK", title: "Docs", url: "https://example.com" }).valid === true,
  "SAVED_LINK with a valid HTTP(S) URL passes validation"
);
assert(
  validateResourceRecord({ id: "ref_title_1", savedKind: "SAVED_TITLE", title: "A title" }).valid === true,
  "SAVED_TITLE with a title passes validation"
);
assert(
  validateResourceRecord({ id: "ref_title_2", savedKind: "SAVED_TITLE", title: "" }).valid === false,
  "SAVED_TITLE without a title fails validation"
);
const unknownValidation = validateResourceRecord(
  { title: "ambiguous", platformItemId: "abc" },
  { datasetType: "SAVED_ITEMS" }
);
assert(
  unknownValidation.valid === true && unknownValidation.warnings.length > 0,
  "UNKNOWN records are preserved with a warning rather than rejected"
);

// ── Aggregation ───────────────────────────────────────────────────────────
const counts = summarizeResourceTypes(
  [
    { itemType: "video", platformItemId: "v1" },
    { itemType: "video", platformItemId: "v2" },
    { url: "https://www.youtube.com/shorts/s1abc", title: "Short" },
    { url: "https://www.youtube.com/channel/UC1", title: "Channel" },
  ],
  { datasetType: "SAVED_ITEMS" }
);
assert(
  counts.VIDEO === 2 && counts.VIDEO_SHORT === 1 && counts.CHANNEL === 1,
  "summarizeResourceTypes counts canonical types across a mixed batch"
);

console.log("\n══════════════════════════════════════════════════════════════");
console.log(`   TEST RESULT: ${passed} PASSED, ${failed} FAILED (TOTAL: ${passed + failed})`);
console.log("══════════════════════════════════════════════════════════════\n");

if (failed > 0) process.exit(1);
