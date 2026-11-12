/**
 * ═══════════════════════════════════════════════════════════════════════════
 * YouTube Discovery 2026 — Professional Global Manifest Naming & Directory Standard
 * ──────────────────────────────────────────────────────────────────────────
 * Scope: Unified, production-grade naming, directory organization, metadata,
 *        and immutable versioning standard across all storage providers:
 *        Cloudflare R2, Supabase PostgreSQL registry, Browser IndexedDB,
 *        Local Disk, and Export archives.
 *
 * Directory Architecture:
 *   Canonical namespace: asdy/
 *   Entity namespaces:
 *     asdy/saved-items/
 *     asdy/playlists/
 *     asdy/saved-searches/
 *     asdy/search-history/
 *     asdy/saved-titles-links/
 *     asdy/collections/
 *     asdy/search-manifests/
 *     asdy/api-keys/
 *     asdy/admin-settings/
 *     asdy/exports/
 *     asdy/temp/
 *
 * Date-based Hierarchy:
 *   {namespace}/{YYYY}/{MM}/{YYYY-MM-DD}/
 *   Example: asdy/saved-items/2026/11/2026-11-09/
 *
 * Filename Grammar:
 *   {entity}_{contentSlug}_{createdAt}_{version}.{extension}
 *   Example: saved_items_ai_research_20261109T153000Z_v001.json
 *
 * Requirements:
 *   - UTC timestamps in filenames (YYYYMMDDTHHmmssZ).
 *   - ISO 8601 UTC timestamps in metadata (YYYY-MM-DDTHH:mm:ss.sssZ).
 *   - Sanitized filesystem-safe slugs (alphanumeric, lowercase, underscores/hyphens).
 *   - Zero-padded sequential version numbers (v001, v002, etc.).
 *   - Sizing ceiling: 40 MiB target, 45 MiB hard application ceiling.
 *   - Seamless legacy resolution without deleting or modifying historical data.
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { sha256Hex } from "../pwa/share-target";

export const STORAGE_NAMING_VERSION = "2026.1" as const;

export const MANIFEST_ENTITIES = [
  "saved_items",
  "playlists",
  "saved_searches",
  "search_history",
  "saved_titles_links",
  "collections",
  "search_manifests",
  "api_keys",
  "admin_settings",
  "exports",
  "temp",
] as const;

export type ManifestEntityType = (typeof MANIFEST_ENTITIES)[number];

export const ENTITY_NAMESPACE_MAP: Record<ManifestEntityType, string> = {
  saved_items: "asdy/saved-items",
  playlists: "asdy/playlists",
  saved_searches: "asdy/saved-searches",
  search_history: "asdy/search-history",
  saved_titles_links: "asdy/saved-titles-links",
  collections: "asdy/collections",
  search_manifests: "asdy/search-manifests",
  api_keys: "asdy/api-keys",
  admin_settings: "asdy/admin-settings",
  exports: "asdy/exports",
  temp: "asdy/temp",
};

export const ENTITY_PAGE_MAP: Record<ManifestEntityType, string> = {
  saved_items: "saved",
  playlists: "playlist-manager",
  saved_searches: "saved-searches",
  search_history: "history",
  saved_titles_links: "saved-titles-links",
  collections: "collections",
  search_manifests: "manifests",
  api_keys: "settings",
  admin_settings: "settings",
  exports: "download-center",
  temp: "temp",
};

export const MANIFEST_SIZE_LIMITS = {
  TARGET_BYTES: 40 * 1024 * 1024,      // 40 MiB = 41,943,040 bytes
  HARD_CEILING_BYTES: 45 * 1024 * 1024, // 45 MiB = 47,185,920 bytes
  DEFAULT_VERSION_PADDING: 3,
} as const;

export type StorageProviderType = "r2" | "disk" | "indexeddb" | "supabase";

/**
 * Metadata envelope that must accompany every persisted manifest document.
 */
export interface ManifestMetadata {
  manifestId: string;
  datasetId: string;
  ownerId: string;
  entityType: ManifestEntityType;
  page: string;
  description: string;
  schemaVersion: number;
  version: number;
  createdAt: string;       // ISO 8601 UTC
  updatedAt: string;       // ISO 8601 UTC
  previousVersionId: string | null;
  parentManifestId: string | null;
  itemCount: number;
  fileSizeBytes: number;
  checksumSha256: string;
  storageProvider: StorageProviderType;
  storagePath: string;
}

export interface ManifestDocument<T = unknown> {
  metadata: ManifestMetadata;
  items: T[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Timestamp & Slug Sanitization Utilities
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Formats a Date or timestamp string into UTC date components:
 * { year: "2026", month: "11", day: "09", isoDate: "2026-11-09" }
 */
export function formatUtcDateComponents(dateInput: Date | string | number = new Date()): {
  year: string;
  month: string;
  day: string;
  isoDate: string;
} {
  const date = typeof dateInput === "object" && dateInput instanceof Date
    ? dateInput
    : new Date(dateInput);

  if (!Number.isFinite(date.getTime())) {
    throw new Error(`Invalid date input for manifest timestamp: ${String(dateInput)}`);
  }

  const year = String(date.getUTCFullYear());
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  const isoDate = `${year}-${month}-${day}`;

  return { year, month, day, isoDate };
}

/**
 * Returns UTC compact timestamp for filenames: `YYYYMMDDTHHmmssZ` (e.g. `20261109T153000Z`)
 */
export function formatUtcTimestampCompact(dateInput: Date | string | number = new Date()): string {
  const date = typeof dateInput === "object" && dateInput instanceof Date
    ? dateInput
    : new Date(dateInput);

  if (!Number.isFinite(date.getTime())) {
    throw new Error(`Invalid date input for manifest timestamp: ${String(dateInput)}`);
  }

  const Y = String(date.getUTCFullYear());
  const M = String(date.getUTCMonth() + 1).padStart(2, "0");
  const D = String(date.getUTCDate()).padStart(2, "0");
  const h = String(date.getUTCHours()).padStart(2, "0");
  const m = String(date.getUTCMinutes()).padStart(2, "0");
  const s = String(date.getUTCSeconds()).padStart(2, "0");

  return `${Y}${M}${D}T${h}${m}${s}Z`;
}

/**
 * Formats ISO 8601 UTC timestamp for document metadata: `YYYY-MM-DDTHH:mm:ss.sssZ`
 */
export function formatIso8601Utc(dateInput: Date | string | number = new Date()): string {
  const date = typeof dateInput === "object" && dateInput instanceof Date
    ? dateInput
    : new Date(dateInput);

  if (!Number.isFinite(date.getTime())) {
    throw new Error(`Invalid date input for manifest ISO timestamp: ${String(dateInput)}`);
  }

  return date.toISOString();
}

/**
 * Formats a version number into zero-padded string: `v001`, `v002`, `v010`, etc.
 */
export function formatVersion(versionNumber: number, padding: number = MANIFEST_SIZE_LIMITS.DEFAULT_VERSION_PADDING): string {
  const num = Math.max(1, Math.floor(versionNumber || 1));
  return `v${String(num).padStart(padding, "0")}`;
}

/**
 * Parses a version identifier like `v001`, `v2`, or `3` back to integer.
 */
export function parseVersion(versionStr: string | number): number {
  if (typeof versionStr === "number") return Math.max(1, Math.floor(versionStr));
  if (typeof versionStr !== "string") return 1;
  const match = versionStr.trim().match(/^v?(\d+)$/i);
  return match ? Math.max(1, parseInt(match[1], 10)) : 1;
}

/**
 * Sanitizes a title or topic into a filesystem-safe, URL-safe, lowercase ASCII slug.
 * Removes spaces, Arabic/Unicode diacritics in storage keys, path traversal dots, and special characters.
 */
export function sanitizeContentSlug(rawSlug: string, maxLength: number = 64): string {
  if (!rawSlug || typeof rawSlug !== "string") return "general";

  let slug = rawSlug
    .trim()
    .toLowerCase()
    .normalize("NFD")
    // Remove diacritics
    .replace(/[\u0300-\u036f]/g, "")
    // Replace spaces and special symbols with underscores
    .replace(/[^a-z0-9_-]+/g, "_")
    // Collapse consecutive underscores or dashes
    .replace(/[_-]{2,}/g, "_")
    // Trim leading/trailing underscores and dashes
    .replace(/^[_-]+|[_-]+$/g, "");

  if (!slug) slug = "general";
  if (slug.length > maxLength) slug = slug.slice(0, maxLength).replace(/[_-]+$/, "");
  return slug || "general";
}

// ─────────────────────────────────────────────────────────────────────────────
// Directory Path Builders
// ─────────────────────────────────────────────────────────────────────────────

export interface CanonicalDirectoryParams {
  entity: ManifestEntityType;
  createdAt: Date | string | number;
  entityId?: string; // Required for playlists: playlistId
  uploadId?: string; // Required for temp: uploadId
}

/**
 * Builds the canonical directory path according to the 2026 standard:
 * Permanent: {namespace}/{YYYY}/{MM}/{YYYY-MM-DD}/
 *   e.g. asdy/saved-items/2026/11/2026-11-09/
 * Playlist: asdy/playlists/{playlistId}/{YYYY}/{MM}/{YYYY-MM-DD}/
 * Temp: asdy/temp/{entityType}/{uploadId}/
 */
export function buildCanonicalDirectoryPath(params: CanonicalDirectoryParams): string {
  const { entity, createdAt, entityId, uploadId } = params;

  if (entity === "temp") {
    const safeUploadId = sanitizeContentSlug(uploadId || "upload_unknown", 64);
    const subEntity = entityId ? sanitizeContentSlug(entityId, 32) : "staging";
    return `asdy/temp/${subEntity}/${safeUploadId}/`;
  }

  const { year, month, isoDate } = formatUtcDateComponents(createdAt);
  const namespace = ENTITY_NAMESPACE_MAP[entity] || `asdy/${entity}`;

  if (entity === "playlists" && entityId) {
    const safePlaylistId = sanitizeContentSlug(entityId, 64);
    return `asdy/playlists/${safePlaylistId}/${year}/${month}/${isoDate}/`;
  }

  return `${namespace}/${year}/${month}/${isoDate}/`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Filename & Storage Path Builders
// ─────────────────────────────────────────────────────────────────────────────

export interface CanonicalFilenameParams {
  entity: ManifestEntityType;
  contentSlug: string;
  createdAt: Date | string | number;
  version: number | string;
  extension?: "json" | "ndjson" | "zip";
}

/**
 * Builds the canonical filename:
 * `{entity}_{contentSlug}_{createdAt}_{version}.{extension}`
 * Example: `saved_items_ai_research_20261109T153000Z_v001.json`
 */
export function buildCanonicalManifestFilename(params: CanonicalFilenameParams): string {
  const { entity, contentSlug, createdAt, version, extension = "json" } = params;

  const safeEntity = entity;
  const safeSlug = sanitizeContentSlug(contentSlug, 48);
  const timestamp = formatUtcTimestampCompact(createdAt);
  const versionStr = typeof version === "number" ? formatVersion(version) : formatVersion(parseVersion(version));

  return `${safeEntity}_${safeSlug}_${timestamp}_${versionStr}.${extension}`;
}

export interface CanonicalStoragePathParams extends CanonicalFilenameParams {
  entityId?: string;
  uploadId?: string;
}

/**
 * Builds the full canonical storage path combining directory and filename:
 * `{directory}/{filename}`
 * Example: `asdy/saved-items/2026/11/2026-11-09/saved_items_ai_research_20261109T153000Z_v001.json`
 */
export function buildCanonicalManifestStoragePath(params: CanonicalStoragePathParams): string {
  const dir = buildCanonicalDirectoryPath({
    entity: params.entity,
    createdAt: params.createdAt,
    entityId: params.entityId,
    uploadId: params.uploadId,
  });

  const filename = buildCanonicalManifestFilename({
    entity: params.entity,
    contentSlug: params.contentSlug,
    createdAt: params.createdAt,
    version: params.version,
    extension: params.extension,
  });

  return `${dir}${filename}`;
}

/**
 * Builds a structured browser storage key (for IndexedDB or localStorage):
 * `yd:manifest:{entity}:{contentSlug}:{version}`
 * Example: `yd:manifest:saved_items:ai_research:v001`
 */
export function buildBrowserStorageKey(
  entity: ManifestEntityType,
  contentSlug: string,
  version: number | string
): string {
  const safeSlug = sanitizeContentSlug(contentSlug, 32);
  const versionStr = typeof version === "number" ? formatVersion(version) : formatVersion(parseVersion(version));
  return `yd:manifest:${entity}:${safeSlug}:${versionStr}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Metadata Envelope Creation & Verification
// ─────────────────────────────────────────────────────────────────────────────

export interface CreateManifestDocumentParams<T = unknown> {
  manifestId: string;
  datasetId: string;
  ownerId: string;
  entityType: ManifestEntityType;
  contentSlug: string;
  description: string;
  items: T[];
  version?: number;
  createdAt?: Date | string | number;
  updatedAt?: Date | string | number;
  previousVersionId?: string | null;
  parentManifestId?: string | null;
  storageProvider?: StorageProviderType;
  entityId?: string;
}

/**
 * Creates a fully validated, compliant ManifestDocument envelope.
 * Measures exact serialized UTF-8 bytes and computes authentic SHA-256 checksum.
 */
export function createManifestDocument<T = unknown>(
  params: CreateManifestDocumentParams<T>
): {
  document: ManifestDocument<T>;
  serializedJson: string;
  fileSizeBytes: number;
  checksumSha256: string;
  storagePath: string;
} {
  const now = new Date();
  const createdAtIso = formatIso8601Utc(params.createdAt || now);
  const updatedAtIso = formatIso8601Utc(params.updatedAt || now);
  const version = Math.max(1, params.version || 1);
  const storageProvider = params.storageProvider || "r2";
  const page = ENTITY_PAGE_MAP[params.entityType] || "saved";

  const storagePath = buildCanonicalManifestStoragePath({
    entity: params.entityType,
    contentSlug: params.contentSlug,
    createdAt: params.createdAt || now,
    version,
    entityId: params.entityId,
  });

  // Calculate authentic items serialized JSON to compute bytes and checksum
  const itemsJson = JSON.stringify(params.items || []);
  const itemsSha256 = sha256Hex(itemsJson);

  // Preliminary metadata (size and checksum will be finalized for the full document)
  const preliminaryDoc: ManifestDocument<T> = {
    metadata: {
      manifestId: params.manifestId,
      datasetId: params.datasetId,
      ownerId: params.ownerId,
      entityType: params.entityType,
      page,
      description: params.description || `YouTube Discovery ${params.entityType} manifest`,
      schemaVersion: 1,
      version,
      createdAt: createdAtIso,
      updatedAt: updatedAtIso,
      previousVersionId: params.previousVersionId || null,
      parentManifestId: params.parentManifestId || null,
      itemCount: Array.isArray(params.items) ? params.items.length : 0,
      fileSizeBytes: 0,
      checksumSha256: itemsSha256,
      storageProvider,
      storagePath,
    },
    items: params.items || [],
  };

  const serialized = JSON.stringify(preliminaryDoc, null, 2);
  const bytes = new TextEncoder().encode(serialized);
  const fileSizeBytes = bytes.byteLength;
  const checksumSha256 = sha256Hex(serialized);

  // Update with exact final bytes and full document checksum
  preliminaryDoc.metadata.fileSizeBytes = fileSizeBytes;
  preliminaryDoc.metadata.checksumSha256 = checksumSha256;

  const finalizedJson = JSON.stringify(preliminaryDoc, null, 2);

  return {
    document: preliminaryDoc,
    serializedJson: finalizedJson,
    fileSizeBytes,
    checksumSha256,
    storagePath,
  };
}

/**
 * Validates a manifest document metadata envelope. Returns true if fully compliant.
 */
export function validateManifestMetadataEnvelope(
  doc: unknown
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!doc || typeof doc !== "object") {
    return { valid: false, errors: ["Document must be a non-null object."] };
  }

  const record = doc as Record<string, unknown>;
  if (!record.metadata || typeof record.metadata !== "object") {
    errors.push("Missing required 'metadata' envelope object.");
    return { valid: false, errors };
  }

  const meta = record.metadata as Record<string, unknown>;

  if (!meta.manifestId || typeof meta.manifestId !== "string") {
    errors.push("metadata.manifestId is required and must be a string.");
  }
  if (!meta.datasetId || typeof meta.datasetId !== "string") {
    errors.push("metadata.datasetId is required and must be a string.");
  }
  if (!meta.ownerId || typeof meta.ownerId !== "string") {
    errors.push("metadata.ownerId is required and must be a string.");
  }
  if (!meta.entityType || typeof meta.entityType !== "string") {
    errors.push("metadata.entityType is required and must be a valid entity type.");
  }
  if (typeof meta.version !== "number" || meta.version < 1) {
    errors.push("metadata.version must be a positive integer.");
  }
  if (!meta.createdAt || typeof meta.createdAt !== "string") {
    errors.push("metadata.createdAt must be an ISO 8601 UTC timestamp.");
  }
  if (!meta.updatedAt || typeof meta.updatedAt !== "string") {
    errors.push("metadata.updatedAt must be an ISO 8601 UTC timestamp.");
  }
  if (typeof meta.itemCount !== "number" || meta.itemCount < 0) {
    errors.push("metadata.itemCount must be a non-negative integer.");
  }
  if (!meta.checksumSha256 || typeof meta.checksumSha256 !== "string" || !/^[a-f0-9]{64}$/i.test(meta.checksumSha256)) {
    errors.push("metadata.checksumSha256 must be a 64-character hexadecimal SHA-256 digest.");
  }
  if (!meta.storagePath || typeof meta.storagePath !== "string") {
    errors.push("metadata.storagePath is required.");
  }

  if (!Array.isArray(record.items)) {
    errors.push("Document 'items' must be an array.");
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Universal Path & Legacy Compatibility Resolver
// ─────────────────────────────────────────────────────────────────────────────

export interface ResolvedManifestPathInfo {
  classification:
    | "CANONICAL_2026_STANDARD"
    | "CANONICAL_GENERATION_V2"
    | "CANONICAL_HISTORICAL_V2"
    | "OLD_ARCHIVE"
    | "LEGACY_PERSISTENCE"
    | "BROWSER_STORAGE"
    | "UNKNOWN";
  entity: ManifestEntityType | string;
  contentSlug?: string;
  version?: number;
  createdAt?: string;
  originalPath: string;
  isImmutable: boolean;
}

/**
 * Universal resolver that classifies any storage key or filename (new or legacy)
 * without deleting or modifying existing historical data.
 */
export function resolveManifestPath(key: string): ResolvedManifestPathInfo {
  if (!key || typeof key !== "string") {
    return {
      classification: "UNKNOWN",
      entity: "unknown",
      originalPath: String(key),
      isImmutable: false,
    };
  }

  const clean = key.replace(/^\/+/, "");

  // 1. 2026 Standard Canonical Format:
  // asdy/{namespace}/{YYYY}/{MM}/{YYYY-MM-DD}/{entity}_{slug}_{timestamp}_v{version}.json
  const standardDirMatch = clean.match(
    /^asdy\/([^/]+)\/(?:(?:[^/]+\/)?\d{4}\/\d{2}\/\d{4}-\d{2}-\d{2})\/([^/]+)$/i
  );
  if (standardDirMatch) {
    const [, , filename] = standardDirMatch;
    for (const entity of MANIFEST_ENTITIES) {
      const prefix = `${entity}_`;
      if (filename.startsWith(prefix)) {
        const remainder = filename.slice(prefix.length);
        const fileMatch = remainder.match(/^(.+)_(\d{8}T\d{6}Z)_v(\d+)\.(json|ndjson|zip)$/i);
        if (fileMatch) {
          const [, slug, timestamp, versionStr] = fileMatch;
          return {
            classification: "CANONICAL_2026_STANDARD",
            entity,
            contentSlug: slug,
            version: parseInt(versionStr, 10),
            createdAt: timestamp,
            originalPath: clean,
            isImmutable: true,
          };
        }
      }
    }
  }

  // 2. Canonical Generation V2: asdy/persistence/<ownerId>/<datasetSlug>/generations/<genId>/manifest.json
  const genV2Match = clean.match(
    /^asdy\/persistence\/([^/]+)\/([^/]+)\/generations\/([^/]+)\/(manifest\.json|parts\/part-\d+\.json)/
  );
  if (genV2Match) {
    const [, , slug, genId] = genV2Match;
    return {
      classification: "CANONICAL_GENERATION_V2",
      entity: slug,
      contentSlug: genId,
      originalPath: clean,
      isImmutable: true,
    };
  }

  // 3. Canonical Historical Before-App-Updating: asdy/persistence/.../before-app-updating/...
  if (clean.startsWith("asdy/persistence/") && clean.includes("before-app-updating")) {
    return {
      classification: "CANONICAL_HISTORICAL_V2",
      entity: "before-app-updating",
      originalPath: clean,
      isImmutable: true,
    };
  }

  // 4. OLD Historical Archive: asdy/old/...
  if (clean.startsWith("asdy/old/")) {
    return {
      classification: "OLD_ARCHIVE",
      entity: "old-archive",
      originalPath: clean,
      isImmutable: true,
    };
  }

  // 5. Browser storage key: yd:manifest:{entity}:{slug}:{version}
  const browserMatch = clean.match(/^yd:manifest:([^:]+):([^:]+):v?(\d+)$/i);
  if (browserMatch) {
    const [, entity, slug, versionStr] = browserMatch;
    return {
      classification: "BROWSER_STORAGE",
      entity: entity as ManifestEntityType,
      contentSlug: slug,
      version: parseInt(versionStr, 10),
      originalPath: clean,
      isImmutable: false,
    };
  }

  // 6. Legacy Persistence: <ownerId>/persistence/...
  if (clean.includes("/persistence/")) {
    return {
      classification: "LEGACY_PERSISTENCE",
      entity: "legacy-dataset",
      originalPath: clean,
      isImmutable: true,
    };
  }

  return {
    classification: "UNKNOWN",
    entity: "unknown",
    originalPath: clean,
    isImmutable: false,
  };
}
