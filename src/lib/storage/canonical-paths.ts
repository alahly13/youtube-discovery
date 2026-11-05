/**
 * ═══════════════════════════════════════════════════════════════════════════
 * YouTube Discovery 2026 — Canonical Storage Path Resolver & Validator
 * ──────────────────────────────────────────────────────────────────────────
 * Scope: The single authoritative specification for all Cloudflare R2 object
 *        keys across NEW and OLD buckets, client repositories, Next.js server
 *        routes, and Cloudflare Workers.
 *
 * Canonical Target Hierarchy (Bucket: new-youtube-discovery-private):
 *   asdy/
 *   ├── persistence/
 *   │   └── <ownerId>/
 *   │       ├── saved-items/
 *   │       │   ├── version.json
 *   │       │   └── generations/<generationId>/
 *   │       │       ├── manifest.json
 *   │       │       └── parts/part-000001.json
 *   │       ├── saved-playlists/
 *   │       ├── saved-search-history/
 *   │       ├── research-queue/
 *   │       └── references/
 *   └── temp/
 *       └── <ownerId>/
 *           └── <syncBatchId>/
 *               ├── saved-items/
 *               └── ...
 *
 * Legacy Compatibility:
 *   Supports reading historical `<ownerId>/persistence/...` objects seamlessly.
 * ═══════════════════════════════════════════════════════════════════════════
 */

export const CANONICAL_DATASET_TYPES = [
  "SAVED_ITEMS",
  "PLAYLIST",
  "SEARCH_HISTORY",
  "RESEARCH_QUEUE",
  "REFERENCES",
] as const;

export type CanonicalDatasetType = (typeof CANONICAL_DATASET_TYPES)[number];

export const DATASET_SLUG_MAP: Record<CanonicalDatasetType, string> = {
  SAVED_ITEMS: "saved-items",
  PLAYLIST: "saved-playlists",
  SEARCH_HISTORY: "saved-search-history",
  RESEARCH_QUEUE: "research-queue",
  REFERENCES: "references",
};

export const SLUG_TO_DATASET_TYPE: Record<string, CanonicalDatasetType> = {
  "saved-items": "SAVED_ITEMS",
  "saved-playlists": "PLAYLIST",
  "saved-search-history": "SEARCH_HISTORY",
  "research-queue": "RESEARCH_QUEUE",
  references: "REFERENCES",
  // Legacy aliases
  SAVED_ITEMS: "SAVED_ITEMS",
  PLAYLIST: "PLAYLIST",
  SEARCH_HISTORY: "SEARCH_HISTORY",
  RESEARCH_QUEUE: "RESEARCH_QUEUE",
  REFERENCES: "REFERENCES",
  playlists: "PLAYLIST",
  savedHistory: "SEARCH_HISTORY",
};

/**
 * Validates and sanitizes an owner identifier (UUID or safe alphanumeric slug).
 */
export function sanitizeOwnerId(ownerId: string): string {
  if (!ownerId || typeof ownerId !== "string") {
    throw new Error("Invalid ownerId: must be a non-empty string.");
  }
  const clean = ownerId.trim().toLowerCase();
  // Allow standard UUID v4 or alphanumeric slug (3 to 64 chars)
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$|^[a-z0-9_-]{3,64}$/.test(clean)) {
    throw new Error(`Invalid ownerId format: '${ownerId}'. Must be a valid UUID or safe slug.`);
  }
  return clean;
}

/**
 * Sanitizes an alphanumeric ID (generationId, batchId, etc.).
 */
export function sanitizeId(id: string, fieldName = "id"): string {
  if (!id || typeof id !== "string") {
    throw new Error(`Invalid ${fieldName}: must be a non-empty string.`);
  }
  const clean = id.trim();
  if (clean.includes("..") || clean.includes("/") || clean.includes("\\")) {
    throw new Error(`Invalid ${fieldName}: path traversal not permitted.`);
  }
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(clean)) {
    throw new Error(`Invalid ${fieldName} characters: '${id}'.`);
  }
  return clean;
}

/**
 * Sanitizes a filename, allowing alphanumeric characters, dots, underscores, and dashes.
 */
export function sanitizeFilename(filename: string): string {
  if (!filename || typeof filename !== "string") {
    throw new Error("Invalid filename: must be a non-empty string.");
  }
  const clean = filename.trim();
  if (clean.includes("..") || clean.includes("/") || clean.includes("\\")) {
    throw new Error("Invalid filename: path traversal not permitted.");
  }
  if (!/^[a-zA-Z0-9._-]{1,128}$/.test(clean)) {
    throw new Error(`Invalid filename characters: '${filename}'.`);
  }
  return clean;
}

/**
 * Converts a canonical dataset type to its canonical URL/path slug.
 */
export function datasetTypeToSlug(type: CanonicalDatasetType | string): string {
  const upper = String(type).trim().toUpperCase() as CanonicalDatasetType;
  if (DATASET_SLUG_MAP[upper]) {
    return DATASET_SLUG_MAP[upper];
  }
  const lower = String(type).trim().toLowerCase();
  if (SLUG_TO_DATASET_TYPE[lower]) {
    return DATASET_SLUG_MAP[SLUG_TO_DATASET_TYPE[lower]];
  }
  throw new Error(`Unknown dataset type or slug: '${type}'. Supported: ${CANONICAL_DATASET_TYPES.join(", ")}`);
}

/**
 * Parses a dataset slug or identifier back to its CanonicalDatasetType.
 */
export function slugToDatasetType(slugOrType: string): CanonicalDatasetType | null {
  if (!slugOrType || typeof slugOrType !== "string") return null;
  const clean = slugOrType.trim();
  return SLUG_TO_DATASET_TYPE[clean] || SLUG_TO_DATASET_TYPE[clean.toLowerCase()] || null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Canonical Path Builders
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns the canonical persistence prefix for an owner:
 * `asdy/persistence/<ownerId>/`
 */
export function buildOwnerPersistencePrefix(ownerId: string): string {
  const cleanOwner = sanitizeOwnerId(ownerId);
  return `asdy/persistence/${cleanOwner}/`;
}

/**
 * Returns the canonical dataset prefix for an owner and dataset:
 * `asdy/persistence/<ownerId>/<datasetSlug>/`
 */
export function buildDatasetPrefix(ownerId: string, datasetType: CanonicalDatasetType | string): string {
  const cleanOwner = sanitizeOwnerId(ownerId);
  const slug = datasetTypeToSlug(datasetType);
  return `asdy/persistence/${cleanOwner}/${slug}/`;
}

/**
 * Returns the canonical generation prefix:
 * `asdy/persistence/<ownerId>/<datasetSlug>/generations/<generationId>/`
 */
export function buildGenerationPrefix(
  ownerId: string,
  datasetType: CanonicalDatasetType | string,
  generationId: string
): string {
  const base = buildDatasetPrefix(ownerId, datasetType);
  const cleanGen = sanitizeId(generationId, "generationId");
  return `${base}generations/${cleanGen}/`;
}

/**
 * Returns the canonical manifest.json key for a generation:
 * `asdy/persistence/<ownerId>/<datasetSlug>/generations/<generationId>/manifest.json`
 */
export function buildManifestKey(
  ownerId: string,
  datasetType: CanonicalDatasetType | string,
  generationId: string
): string {
  return `${buildGenerationPrefix(ownerId, datasetType, generationId)}manifest.json`;
}

/**
 * Returns the canonical part key for an immutable manifest part:
 * `asdy/persistence/<ownerId>/<datasetSlug>/generations/<generationId>/parts/part-<number>.json`
 */
export function buildPartKey(
  ownerId: string,
  datasetType: CanonicalDatasetType | string,
  generationId: string,
  partNumber: number
): string {
  const genPrefix = buildGenerationPrefix(ownerId, datasetType, generationId);
  const padded = String(Math.max(1, Math.floor(partNumber))).padStart(6, "0");
  return `${genPrefix}parts/part-${padded}.json`;
}

/**
 * Returns the canonical version.json pointer key for a dataset:
 * `asdy/persistence/<ownerId>/<datasetSlug>/version.json`
 */
export function buildVersionPointerKey(
  ownerId: string,
  datasetType: CanonicalDatasetType | string
): string {
  return `${buildDatasetPrefix(ownerId, datasetType)}version.json`;
}

/**
 * Returns the derived convenience root manifest key for a dataset:
 * `asdy/persistence/<ownerId>/<datasetSlug>/manifest.json`
 *
 * This is a derived/index object only. Immutable generations remain the
 * authoritative source of truth.
 */
export function buildDatasetRootManifestKey(
  ownerId: string,
  datasetType: CanonicalDatasetType | string
): string {
  return `${buildDatasetPrefix(ownerId, datasetType)}manifest.json`;
}

/**
 * Returns the canonical historical dataset prefix for legacy data migration:
 * `asdy/persistence/<ownerId>/<datasetSlug>/before-app-updating/`
 */
export function buildHistoricalDatasetPrefix(
  ownerId: string,
  datasetType: CanonicalDatasetType | string
): string {
  const base = buildDatasetPrefix(ownerId, datasetType);
  return `${base}before-app-updating/`;
}

/**
 * Returns the canonical historical generation prefix for legacy data migration:
 * `asdy/persistence/<ownerId>/<datasetSlug>/before-app-updating/generations/<generationId>/`
 */
export function buildHistoricalGenerationPrefix(
  ownerId: string,
  datasetType: CanonicalDatasetType | string,
  generationId: string
): string {
  const base = buildHistoricalDatasetPrefix(ownerId, datasetType);
  const cleanGen = sanitizeId(generationId, "generationId");
  return `${base}generations/${cleanGen}/`;
}

/**
 * Returns the canonical historical manifest.json key:
 * `asdy/persistence/<ownerId>/<datasetSlug>/before-app-updating/generations/<generationId>/manifest.json`
 */
export function buildHistoricalManifestKey(
  ownerId: string,
  datasetType: CanonicalDatasetType | string,
  generationId: string
): string {
  return `${buildHistoricalGenerationPrefix(ownerId, datasetType, generationId)}manifest.json`;
}

/**
 * Returns the canonical historical part key:
 * `asdy/persistence/<ownerId>/<datasetSlug>/before-app-updating/generations/<generationId>/parts/part-<number>.json`
 */
export function buildHistoricalPartKey(
  ownerId: string,
  datasetType: CanonicalDatasetType | string,
  generationId: string,
  partNumber: number
): string {
  const genPrefix = buildHistoricalGenerationPrefix(ownerId, datasetType, generationId);
  const padded = String(Math.max(1, Math.floor(partNumber))).padStart(6, "0");
  return `${genPrefix}parts/part-${padded}.json`;
}

/**
 * Returns the canonical historical version.json pointer key:
 * `asdy/persistence/<ownerId>/<datasetSlug>/before-app-updating/version.json`
 */
export function buildHistoricalVersionPointerKey(
  ownerId: string,
  datasetType: CanonicalDatasetType | string
): string {
  return `${buildHistoricalDatasetPrefix(ownerId, datasetType)}version.json`;
}

/**
 * Returns the canonical temporary staging prefix for a sync batch:
 * `asdy/temp/<ownerId>/<syncBatchId>/[<datasetSlug>/]`
 */
export function buildSyncTempPrefix(
  ownerId: string,
  syncBatchId: string,
  datasetType?: CanonicalDatasetType | string
): string {
  const cleanOwner = sanitizeOwnerId(ownerId);
  const cleanBatch = sanitizeId(syncBatchId, "syncBatchId");
  if (datasetType) {
    const slug = datasetTypeToSlug(datasetType);
    return `asdy/temp/${cleanOwner}/${cleanBatch}/${slug}/`;
  }
  return `asdy/temp/${cleanOwner}/${cleanBatch}/`;
}

/**
 * Returns the canonical key for an uncommitted temporary item:
 * `asdy/temp/<ownerId>/<syncBatchId>/<datasetSlug>/<filename>`
 */
export function buildTempItemKey(
  ownerId: string,
  syncBatchId: string,
  datasetType: CanonicalDatasetType | string,
  filename: string
): string {
  const prefix = buildSyncTempPrefix(ownerId, syncBatchId, datasetType);
  const cleanFile = sanitizeFilename(filename);
  return `${prefix}${cleanFile}`;
}

/**
 * Returns the canonical temporary export key for user downloads:
 * `asdy/temp/<ownerId>/exports/<exportId>/<filename>`
 *
 * Exports are always disposable temporary objects; committed generations are
 * never overwritten or deleted by export flows.
 */
export function buildTempExportKey(
  ownerId: string,
  exportId: string,
  filename: string
): string {
  const cleanOwner = sanitizeOwnerId(ownerId);
  const cleanExport = sanitizeId(exportId, "exportId");
  const cleanFile = sanitizeFilename(filename);
  return `asdy/temp/${cleanOwner}/exports/${cleanExport}/${cleanFile}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Legacy Compatibility & Detection Helpers
// ─────────────────────────────────────────────────────────────────────────────

export interface ParsedStoragePath {
  isCanonical: boolean;
  isLegacy: boolean;
  isTemp: boolean;
  isBeforeAppUpdating: boolean;
  ownerId: string;
  datasetType: CanonicalDatasetType | null;
  datasetSlug: string | null;
  generationId: string | null;
  partNumber: number | null;
  isManifest: boolean;
  isVersionPointer: boolean;
  syncBatchId: string | null;
  originalKey: string;
}

/**
 * Determines whether a key follows the canonical `asdy/persistence/...` or `asdy/temp/...` convention.
 */
export function isCanonicalPath(key: string): boolean {
  return typeof key === "string" && (key.startsWith("asdy/persistence/") || key.startsWith("asdy/temp/"));
}

/**
 * Determines whether a key follows the legacy `<ownerId>/persistence/...` or `<ownerId>/temp/...` convention.
 */
export function isLegacyPath(key: string): boolean {
  if (typeof key !== "string" || key.startsWith("asdy/")) return false;
  return key.includes("/persistence/") || key.includes("/temp/");
}

/**
 * Parses any storage key (canonical or legacy) into structured metadata.
 */
export function parseStorageKey(key: string): ParsedStoragePath | null {
  if (!key || typeof key !== "string") return null;
  const clean = key.replace(/^\/+/, "");

  // 1a. Canonical Historical Persistence: asdy/persistence/<ownerId>/<datasetSlug>/before-app-updating/...
  // OR asdy/persistence/<ownerId>/before-app-updating/<datasetSlug>/...
  const canonicalHistoricalMatch =
    clean.match(
      /^asdy\/persistence\/([^/]+)\/([^/]+)\/before-app-updating\/(?:version\.json|generations\/([^/]+)\/(manifest\.json|parts\/part-(\d+)\.json))/
    ) ||
    clean.match(
      /^asdy\/persistence\/([^/]+)\/before-app-updating\/([^/]+)\/(?:version\.json|generations\/([^/]+)\/(manifest\.json|parts\/part-(\d+)\.json))/
    );

  if (canonicalHistoricalMatch) {
    const [, ownerId, slug, generationId, fileType, partNumStr] = canonicalHistoricalMatch;
    const isManifest = fileType === "manifest.json";
    const isVersion = clean.endsWith("/version.json");
    const partNumber = partNumStr ? parseInt(partNumStr, 10) : null;
    return {
      isCanonical: true,
      isLegacy: false,
      isTemp: false,
      isBeforeAppUpdating: true,
      ownerId,
      datasetType: slugToDatasetType(slug),
      datasetSlug: slug,
      generationId: generationId || null,
      partNumber,
      isManifest,
      isVersionPointer: isVersion,
      syncBatchId: null,
      originalKey: clean,
    };
  }

  // 1b. Canonical Persistence: asdy/persistence/<ownerId>/<datasetSlug>/...
  const canonicalPersistMatch = clean.match(
    /^asdy\/persistence\/([^/]+)\/([^/]+)\/(?:version\.json|generations\/([^/]+)\/(manifest\.json|parts\/part-(\d+)\.json))/
  );

  if (canonicalPersistMatch) {
    const [, ownerId, slug, generationId, fileType, partNumStr] = canonicalPersistMatch;
    const isManifest = fileType === "manifest.json";
    const isVersion = clean.endsWith("/version.json");
    const partNumber = partNumStr ? parseInt(partNumStr, 10) : null;
    return {
      isCanonical: true,
      isLegacy: false,
      isTemp: false,
      isBeforeAppUpdating: false,
      ownerId,
      datasetType: slugToDatasetType(slug),
      datasetSlug: slug,
      generationId: generationId || null,
      partNumber,
      isManifest,
      isVersionPointer: isVersion,
      syncBatchId: null,
      originalKey: clean,
    };
  }

  // 2. Canonical Temp: asdy/temp/<ownerId>/<syncBatchId>/...
  const canonicalTempMatch = clean.match(/^asdy\/temp\/([^/]+)\/([^/]+)(?:\/([^/]+))?/);
  if (canonicalTempMatch) {
    const [, ownerId, syncBatchId, slug] = canonicalTempMatch;
    return {
      isCanonical: true,
      isLegacy: false,
      isTemp: true,
      isBeforeAppUpdating: false,
      ownerId,
      datasetType: slug ? slugToDatasetType(slug) : null,
      datasetSlug: slug || null,
      generationId: null,
      partNumber: null,
      isManifest: false,
      isVersionPointer: false,
      syncBatchId,
      originalKey: clean,
    };
  }

  // 3. Legacy Persistence: <ownerId>/persistence/(datasets/)?<datasetType>/...
  const legacyPersistMatch = clean.match(
    /^([^/]+)\/persistence\/(?:datasets\/)?([^/]+)\/(?:version\.json|manifest\.json|generations\/([^/]+)\/(manifest\.json|parts\/part-(\d+)\.json))/
  );

  if (legacyPersistMatch) {
    const [, ownerId, slugOrType, generationId, fileType, partNumStr] = legacyPersistMatch;
    const isManifest = fileType === "manifest.json" || clean.endsWith("/manifest.json");
    const isVersion = clean.endsWith("/version.json");
    const partNumber = partNumStr ? parseInt(partNumStr, 10) : null;
    return {
      isCanonical: false,
      isLegacy: true,
      isTemp: false,
      isBeforeAppUpdating: clean.includes("before-app-updating"),
      ownerId,
      datasetType: slugToDatasetType(slugOrType),
      datasetSlug: slugOrType,
      generationId: generationId || null,
      partNumber,
      isManifest,
      isVersionPointer: isVersion,
      syncBatchId: null,
      originalKey: clean,
    };
  }

  // 4. Legacy Temp: <ownerId>/temp/...
  const legacyTempMatch = clean.match(/^([^/]+)\/temp\/(?:exports\/)?([^/]+)/);
  if (legacyTempMatch) {
    const [, ownerId, batchOrExportId] = legacyTempMatch;
    return {
      isCanonical: false,
      isLegacy: true,
      isTemp: true,
      isBeforeAppUpdating: false,
      ownerId,
      datasetType: null,
      datasetSlug: null,
      generationId: null,
      partNumber: null,
      isManifest: false,
      isVersionPointer: false,
      syncBatchId: batchOrExportId,
      originalKey: clean,
    };
  }

  return null;
}
