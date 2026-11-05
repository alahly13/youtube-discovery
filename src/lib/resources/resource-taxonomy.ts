/**
 * ═══════════════════════════════════════════════════════════════════════════
 * YouTube Discovery 2026 — Canonical Resource Taxonomy & Record Contracts
 * ──────────────────────────────────────────────────────────────────────────
 * Scope: The single authoritative classification layer for every record that
 *        can be saved, serialized, uploaded to R2, registered in PostgreSQL,
 *        hydrated back into IndexedDB, exported, or displayed in the UI.
 *
 * Design rules (do not weaken):
 *   1. A resource type is NOT a dataset type. `VIDEO` is a resource type;
 *      `SAVED_ITEMS` is a dataset type. Both must survive serialization.
 *   2. `VIDEO_SHORT` is assigned ONLY from authoritative evidence such as an
 *      explicit `youtube.com/shorts/<id>` URL or an explicit resourceType
 *      field written by an authoritative producer. Duration and aspect ratio
 *      are NEVER valid Short evidence (`isShortsLike` is duration-derived).
 *   3. Legacy records without an explicit type are classified with the
 *      strongest available evidence and marked INFERRED / LEGACY. Genuinely
 *      ambiguous records stay `UNKNOWN`; we never silently invent a type.
 *   4. Stable identity is never derived from title, filename, URL text,
 *      array index, or the current date. `recordId` is the application record
 *      identity; `resourceId` is the platform or application entity identity.
 *
 * This module is runtime-agnostic (no Node APIs, no server-only imports) so
 * the exact same classifier runs on the server, in the Worker-facing client
 * code, and inside React components such as the Manifest Explorer.
 * ═══════════════════════════════════════════════════════════════════════════
 */

export const RESOURCE_SCHEMA_VERSION = 2 as const;

export const RESOURCE_TYPES = [
  "VIDEO",
  "VIDEO_SHORT",
  "CHANNEL",
  "YOUTUBE_PLAYLIST",
  "USER_PLAYLIST",
  "SAVED_TITLE",
  "SAVED_LINK",
  "SAVED_SEARCH",
  "UNKNOWN",
] as const;

export type ResourceType = (typeof RESOURCE_TYPES)[number];

export const CLASSIFICATION_SOURCES = [
  "AUTHORITATIVE",
  "INFERRED",
  "LEGACY",
  "UNKNOWN",
] as const;

export type ClassificationSource = (typeof CLASSIFICATION_SOURCES)[number];

export interface ResourceTypeDescriptor {
  type: ResourceType;
  label: string;
  shortLabel: string;
  description: string;
  /** Badge tone key used by the shared UI layer. */
  tone: "success" | "primary" | "warning" | "danger" | "neutral";
}

export const RESOURCE_TYPE_METADATA: Record<ResourceType, ResourceTypeDescriptor> = {
  VIDEO: {
    type: "VIDEO",
    label: "Video",
    shortLabel: "VIDEO",
    description: "A standard public YouTube video.",
    tone: "success",
  },
  VIDEO_SHORT: {
    type: "VIDEO_SHORT",
    label: "YouTube Short",
    shortLabel: "SHORT",
    description: "A YouTube Short verified by an explicit /shorts/ URL or authoritative field.",
    tone: "warning",
  },
  CHANNEL: {
    type: "CHANNEL",
    label: "Channel",
    shortLabel: "CHANNEL",
    description: "A YouTube channel resource.",
    tone: "warning",
  },
  YOUTUBE_PLAYLIST: {
    type: "YOUTUBE_PLAYLIST",
    label: "YouTube Playlist",
    shortLabel: "YT PLAYLIST",
    description: "A playlist that exists on YouTube and is referenced by its YouTube playlist ID.",
    tone: "primary",
  },
  USER_PLAYLIST: {
    type: "USER_PLAYLIST",
    label: "User Playlist",
    shortLabel: "MY PLAYLIST",
    description: "A playlist created and owned inside YouTube Discovery. Not a YouTube playlist.",
    tone: "primary",
  },
  SAVED_TITLE: {
    type: "SAVED_TITLE",
    label: "Saved Title",
    shortLabel: "TITLE",
    description: "A user-saved standalone title or reference title.",
    tone: "neutral",
  },
  SAVED_LINK: {
    type: "SAVED_LINK",
    label: "Saved Link",
    shortLabel: "LINK",
    description: "A user-saved external or YouTube link with a canonical URL.",
    tone: "neutral",
  },
  SAVED_SEARCH: {
    type: "SAVED_SEARCH",
    label: "Saved Search",
    shortLabel: "SEARCH",
    description: "A search query deliberately saved by the user. Distinct from search history.",
    tone: "primary",
  },
  UNKNOWN: {
    type: "UNKNOWN",
    label: "Unclassified",
    shortLabel: "UNKNOWN",
    description: "Insufficient evidence to classify this record safely. Preserved for review.",
    tone: "danger",
  },
};

export interface ResourceClassification {
  resourceType: ResourceType;
  source: ClassificationSource;
  /** Short machine-readable explanation of the evidence used. */
  evidence: string;
  /** Set when a stored discriminator existed but was not a supported value. */
  invalidExplicitType?: string;
}

export interface ResourceClassificationContext {
  /** Parent dataset type, when known. Helps disambiguate REFERENCES vs SEARCH_HISTORY. */
  datasetType?: string | null;
}

export interface NormalizedResourceFields {
  recordId: string;
  resourceType: ResourceType;
  resourceId: string;
  resourceSchemaVersion: number;
  classificationSource: ClassificationSource;
}

export interface ResourceValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

const RESOURCE_TYPE_SET: ReadonlySet<string> = new Set(RESOURCE_TYPES);

export function isResourceType(value: unknown): value is ResourceType {
  return typeof value === "string" && RESOURCE_TYPE_SET.has(value);
}

export function isClassificationSource(value: unknown): value is ClassificationSource {
  return typeof value === "string" && (CLASSIFICATION_SOURCES as readonly string[]).includes(value);
}

export function resourceTypeLabel(type: ResourceType | string | null | undefined): string {
  if (!isResourceType(type)) return RESOURCE_TYPE_METADATA.UNKNOWN.label;
  return RESOURCE_TYPE_METADATA[type].label;
}

export function resourceTypeShortLabel(type: ResourceType | string | null | undefined): string {
  if (!isResourceType(type)) return RESOURCE_TYPE_METADATA.UNKNOWN.shortLabel;
  return RESOURCE_TYPE_METADATA[type].shortLabel;
}

export function resourceTypeTone(
  type: ResourceType | string | null | undefined
): ResourceTypeDescriptor["tone"] {
  if (!isResourceType(type)) return "danger";
  return RESOURCE_TYPE_METADATA[type].tone;
}

/**
 * Returns true only when the URL is an explicit YouTube Shorts URL.
 * Example: https://www.youtube.com/shorts/abc123
 *
 * This deliberately does NOT look at duration, aspect ratio, `isShortsLike`,
 * or any other heuristic. Those signals are not authoritative.
 */
export function isYouTubeShortsUrl(url: unknown): boolean {
  if (typeof url !== "string" || !url.trim()) return false;
  try {
    const parsed = new URL(url.trim());
    const host = parsed.hostname.toLowerCase().replace(/^www\.|^m\./, "");
    if (host !== "youtube.com" && host !== "youtu.be") return false;
    return /^\/shorts\/[A-Za-z0-9_-]{3,}/.test(parsed.pathname);
  } catch {
    return false;
  }
}

/**
 * Extracts a YouTube resource identifier from a URL without guessing type.
 * Returns null when the URL is not a recognizable YouTube resource URL.
 */
export function extractYouTubeResourceId(url: unknown): string | null {
  if (typeof url !== "string" || !url.trim()) return null;
  try {
    const parsed = new URL(url.trim());
    const host = parsed.hostname.toLowerCase().replace(/^www\.|^m\./, "");

    if (host === "youtu.be") {
      const id = parsed.pathname.split("/").filter(Boolean)[0];
      return id || null;
    }

    if (host !== "youtube.com") return null;

    const shorts = parsed.pathname.match(/^\/shorts\/([A-Za-z0-9_-]+)/);
    if (shorts) return shorts[1] || null;

    const embed = parsed.pathname.match(/^\/embed\/([A-Za-z0-9_-]+)/);
    if (embed) return embed[1] || null;

    if (parsed.pathname === "/watch") {
      return parsed.searchParams.get("v");
    }

    if (parsed.pathname === "/playlist") {
      return parsed.searchParams.get("list");
    }

    const channel = parsed.pathname.match(/^\/channel\/([A-Za-z0-9_-]+)/);
    if (channel) return channel[1] || null;

    return null;
  } catch {
    return null;
  }
}

function readString(record: Record<string, unknown>, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function isHttpUrl(value: string | null): boolean {
  if (!value) return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Classifies any record shape used across the app (saved items, references,
 * saved searches, user playlists, legacy manifest records).
 *
 * Precedence:
 *   1. Explicit canonical `resourceType` (authoritative).
 *   2. Explicit saved-kind discriminator (authoritative).
 *   3. Explicit Shorts URL (authoritative evidence for VIDEO_SHORT).
 *   4. Existing itemType/entityType/kind fields (inferred/legacy).
 *   5. Dataset-aware structural inference (inferred).
 *   6. URL shape inference (inferred).
 *   7. UNKNOWN.
 */
export function classifyResourceRecord(
  record: Record<string, unknown>,
  context: ResourceClassificationContext = {}
): ResourceClassification {
  const explicitType = record.resourceType;
  if (isResourceType(explicitType)) {
    const storedSource = record.classificationSource;
    return {
      resourceType: explicitType,
      source: isClassificationSource(storedSource) ? storedSource : "AUTHORITATIVE",
      evidence: "explicit resourceType discriminator",
    };
  }

  const invalidExplicitType =
    typeof explicitType === "string" && explicitType.trim() ? explicitType.trim() : undefined;

  // Deliberate saved-reference discriminator. This is the canonical way for
  // the Saved Titles & Links workspace to distinguish title-only records from
  // link records and saved searches without guessing from strings.
  const savedKind = readString(record, "savedKind", "referenceKind", "savedReferenceType");
  if (savedKind) {
    const normalized = savedKind.trim().toUpperCase().replace(/[\s-]+/g, "_");
    if (
      normalized === "SAVED_TITLE" ||
      normalized === "SAVED_LINK" ||
      normalized === "SAVED_SEARCH"
    ) {
      return {
        resourceType: normalized,
        source: "AUTHORITATIVE",
        evidence: `explicit saved kind '${normalized}'`,
        invalidExplicitType,
      };
    }
  }

  const url = readString(record, "url", "canonicalUrl", "link", "webUrl", "originalUrl");
  const title = readString(record, "title", "name", "customTitle");
  const query = readString(record, "query", "queryText", "searchQuery");

  // Authoritative Short evidence. Never duration-based.
  if (isYouTubeShortsUrl(url)) {
    return {
      resourceType: "VIDEO_SHORT",
      source: "AUTHORITATIVE",
      evidence: "explicit /shorts/ URL",
      invalidExplicitType,
    };
  }

  const itemType = readString(record, "itemType", "youtubeType");
  const entityType = readString(record, "entityType");
  const kind = readString(record, "kind", "type");
  const normalizedItemType = itemType?.toLowerCase() ?? null;
  const normalizedEntityType = entityType?.toUpperCase() ?? null;
  const normalizedKind = kind?.toLowerCase() ?? null;

  if (normalizedItemType === "channel" || normalizedEntityType === "CHANNEL") {
    return {
      resourceType: "CHANNEL",
      source: itemType || entityType ? "AUTHORITATIVE" : "INFERRED",
      evidence: "channel discriminator",
      invalidExplicitType,
    };
  }

  const isUserPlaylist =
    record.isUserPlaylist === true ||
    normalizedKind === "user_playlist" ||
    normalizedKind === "user-playlist" ||
    normalizedItemType === "user_playlist" ||
    normalizedEntityType === "USER_PLAYLIST";

  if (isUserPlaylist) {
    return {
      resourceType: "USER_PLAYLIST",
      source: "AUTHORITATIVE",
      evidence: "application-owned playlist discriminator",
      invalidExplicitType,
    };
  }

  if (
    normalizedItemType === "playlist" ||
    normalizedEntityType === "PLAYLIST" ||
    normalizedKind === "playlist" ||
    normalizedKind === "youtube_playlist"
  ) {
    // A record with an application-owned playlist id but no YouTube playlist
    // id is a user playlist, not a YouTube playlist.
    const platformId = readString(record, "platformItemId", "playlistId", "youtubePlaylistId");
    const hasYouTubeEvidence =
      Boolean(record.isYouTubePlaylist) ||
      (url ? /[?&]list=/.test(url) : false) ||
      Boolean(readString(record, "youtubePlaylistId"));
    const looksApplicationOwned =
      Boolean(readString(record, "entries", "groups")) ||
      (record.isUserPlaylist !== false && !hasYouTubeEvidence && !platformId);

    return {
      resourceType: looksApplicationOwned ? "USER_PLAYLIST" : "YOUTUBE_PLAYLIST",
      source: "INFERRED",
      evidence: looksApplicationOwned
        ? "playlist record without YouTube playlist evidence"
        : "YouTube playlist discriminator",
      invalidExplicitType,
    };
  }

  if (
    normalizedItemType === "video" ||
    normalizedItemType === "live" ||
    normalizedItemType === "upcoming" ||
    normalizedItemType === "completed_live" ||
    normalizedEntityType === "VIDEO" ||
    normalizedEntityType === "SHORTS"
  ) {
    // IMPORTANT: `shorts_like` and `entityType: SHORTS` are historically
    // duration-derived. They must not produce VIDEO_SHORT without an explicit
    // /shorts/ URL, which was checked above.
    return {
      resourceType: "VIDEO",
      source: itemType || entityType ? "AUTHORITATIVE" : "INFERRED",
      evidence: "video discriminator (duration is not Short evidence)",
      invalidExplicitType,
    };
  }

  if (normalizedItemType === "shorts_like") {
    return {
      resourceType: "VIDEO",
      source: "LEGACY",
      evidence: "legacy duration-derived shorts_like marker; classified as VIDEO",
      invalidExplicitType,
    };
  }

  const datasetType = (context.datasetType || "").toUpperCase();

  // REFERENCES deliberately hosts saved titles, saved links, and saved
  // searches. SEARCH_HISTORY is NOT a saved search and must not be promoted.
  if (datasetType === "REFERENCES") {
    if (query) {
      return {
        resourceType: "SAVED_SEARCH",
        source: "INFERRED",
        evidence: "REFERENCES record with query text",
        invalidExplicitType,
      };
    }
    if (isHttpUrl(url)) {
      return {
        resourceType: "SAVED_LINK",
        source: "INFERRED",
        evidence: "REFERENCES record with canonical URL",
        invalidExplicitType,
      };
    }
    if (title) {
      return {
        resourceType: "SAVED_TITLE",
        source: "INFERRED",
        evidence: "REFERENCES record with title only",
        invalidExplicitType,
      };
    }
  }

  if (datasetType === "PLAYLIST") {
    return {
      resourceType: "USER_PLAYLIST",
      source: "INFERRED",
      evidence: "PLAYLIST dataset record",
      invalidExplicitType,
    };
  }

  // Search history is an operational log, not a saved resource. It must never
  // be promoted to SAVED_SEARCH merely because it contains query text.
  if (datasetType === "SEARCH_HISTORY") {
    return {
      resourceType: "UNKNOWN",
      source: "LEGACY",
      evidence: "search history record is not a saved search resource",
      invalidExplicitType,
    };
  }

  // Structural fallbacks for legacy exports and OLD archives.
  if (query) {
    return {
      resourceType: "SAVED_SEARCH",
      source: "INFERRED",
      evidence: "query text without a dataset discriminator",
      invalidExplicitType,
    };
  }

  if (isHttpUrl(url)) {
    const path = (() => {
      try {
        return new URL(url!).pathname;
      } catch {
        return "";
      }
    })();
    if (path === "/watch" || path.startsWith("/embed/") || /youtu\.be\//.test(url!)) {
      return {
        resourceType: "VIDEO",
        source: "INFERRED",
        evidence: "YouTube video URL shape",
        invalidExplicitType,
      };
    }
    if (path.startsWith("/channel/") || path.startsWith("/@")) {
      return {
        resourceType: "CHANNEL",
        source: "INFERRED",
        evidence: "YouTube channel URL shape",
        invalidExplicitType,
      };
    }
    if (path === "/playlist" && /[?&]list=/.test(url!)) {
      return {
        resourceType: "YOUTUBE_PLAYLIST",
        source: "INFERRED",
        evidence: "YouTube playlist URL shape",
        invalidExplicitType,
      };
    }
    return {
      resourceType: "SAVED_LINK",
      source: "INFERRED",
      evidence: "non-YouTube HTTP(S) URL",
      invalidExplicitType,
    };
  }

  // A saved item without an explicit item type and without a recognizable
  // platform URL is genuinely ambiguous. It must not be silently relabeled as
  // a SAVED_TITLE just because it happens to have a title field.
  if (datasetType === "SAVED_ITEMS") {
    return {
      resourceType: "UNKNOWN",
      source: "LEGACY",
      evidence: "saved item without explicit item type or recognizable platform URL",
      invalidExplicitType,
    };
  }

  if (title) {
    return {
      resourceType: "SAVED_TITLE",
      source: "INFERRED",
      evidence: "title without platform identity",
      invalidExplicitType,
    };
  }

  return {
    resourceType: "UNKNOWN",
    source: "UNKNOWN",
    evidence: "insufficient classification evidence",
    invalidExplicitType,
  };
}

/**
 * Returns a stable application record identity. Existing `recordId` values win.
 * For legacy records, the existing `id` is preserved because it is already the
 * IndexedDB/outbox identity. Only when no identity exists do we derive a
 * deterministic id from resource type + resource id (never from title).
 */
export function resolveRecordId(
  record: Record<string, unknown>,
  resourceType: ResourceType,
  resourceId: string
): string {
  const existing = readString(record, "recordId", "id");
  if (existing) return existing;
  if (resourceId) return `${resourceType.toLowerCase()}:${resourceId}`;
  return "";
}

export function resolveResourceId(record: Record<string, unknown>): string {
  const platformId = readString(
    record,
    "platformItemId",
    "youtubeId",
    "videoId",
    "playlistId",
    "channelId",
    "resourceId"
  );
  if (platformId) return platformId;

  // Saved references and user playlists are application-owned entities.
  const appId = readString(record, "id", "entryId", "referenceId");
  if (appId) return appId;

  return extractYouTubeResourceId(readString(record, "url", "canonicalUrl")) || "";
}

/**
 * Adds the canonical discriminator and stable identity fields while preserving
 * every original field. This is the function every producer should use before
 * writing a record to IndexedDB, a manifest part, an export, or an API payload.
 */
export function normalizeResourceRecord<T extends Record<string, unknown>>(
  record: T,
  context: ResourceClassificationContext = {}
): T & NormalizedResourceFields {
  const classification = classifyResourceRecord(record, context);
  const resourceId = resolveResourceId(record);
  const recordId = resolveRecordId(record, classification.resourceType, resourceId);

  return {
    ...record,
    recordId,
    resourceId,
    resourceType: classification.resourceType,
    resourceSchemaVersion: RESOURCE_SCHEMA_VERSION,
    classificationSource: classification.source,
  };
}

/**
 * Validates the canonical record contract. Structural identity is mandatory.
 * Type-specific requirements are enforced so a malformed saved link or saved
 * search cannot silently enter the manifest pipeline.
 */
export function validateResourceRecord(
  record: Record<string, unknown>,
  context: ResourceClassificationContext = {}
): ResourceValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  const classification = classifyResourceRecord(record, context);
  const normalized = normalizeResourceRecord(record, context);

  if (!normalized.recordId) {
    errors.push("Missing stable recordId.");
  }

  if (classification.invalidExplicitType) {
    warnings.push(
      `Stored resourceType '${classification.invalidExplicitType}' is not supported; classified as ${classification.resourceType} from available evidence.`
    );
  }

  switch (classification.resourceType) {
    case "VIDEO":
    case "VIDEO_SHORT":
    case "CHANNEL":
    case "YOUTUBE_PLAYLIST":
      if (!normalized.resourceId) {
        errors.push(`${classification.resourceType} requires a platform resourceId.`);
      }
      break;
    case "USER_PLAYLIST":
      if (!normalized.resourceId) {
        errors.push("USER_PLAYLIST requires an application-owned playlist resourceId.");
      }
      break;
    case "SAVED_LINK": {
      const url = readString(record, "url", "canonicalUrl", "link");
      if (!isHttpUrl(url)) {
        errors.push("SAVED_LINK requires a valid absolute HTTP(S) URL.");
      }
      break;
    }
    case "SAVED_SEARCH": {
      const query = readString(record, "query", "queryText", "searchQuery");
      if (!query) {
        errors.push("SAVED_SEARCH requires query text.");
      }
      break;
    }
    case "SAVED_TITLE": {
      const title = readString(record, "title", "name", "customTitle");
      if (!title) {
        errors.push("SAVED_TITLE requires a title.");
      }
      break;
    }
    case "UNKNOWN":
      warnings.push("Record could not be classified and will be preserved as UNKNOWN.");
      break;
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Aggregates resource type counts for a manifest part or generation. UNKNOWN
 * is included so consumers can detect records that need manual review.
 */
export function summarizeResourceTypes(
  records: Array<Record<string, unknown>>,
  context: ResourceClassificationContext = {}
): Partial<Record<ResourceType, number>> {
  const counts: Partial<Record<ResourceType, number>> = {};
  for (const record of records) {
    const { resourceType } = classifyResourceRecord(record, context);
    counts[resourceType] = (counts[resourceType] || 0) + 1;
  }
  return counts;
}

/**
 * Builds a deterministic fallback record id for newly created application
 * entities. Prefer `crypto.randomUUID()` at creation time for user-created
 * records; this helper exists for deterministic imports and tests.
 */
export function buildStableRecordId(resourceType: ResourceType, resourceId: string): string {
  const cleanType = resourceType.toLowerCase();
  const cleanId = resourceId.trim();
  if (!cleanId) throw new Error("buildStableRecordId requires a non-empty resourceId.");
  return `${cleanType}:${cleanId}`;
}
