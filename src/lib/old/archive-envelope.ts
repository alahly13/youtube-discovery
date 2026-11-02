import crypto from "node:crypto";
import zlib from "node:zlib";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * OLD Legacy Manifest Archive System — Core Envelope & Parser Engine
 * ──────────────────────────────────────────────────────────────────────────
 * Scope: Workstream B — Phase 1.5
 * - Strictly isolated logical archive format for historical imported manifests.
 * - Supports canonical manifests, generation ZIPs, NDJSON, and legacy JSON exports.
 * - Pure Node.js safe ZIP extractor with Zip-Slip and Zip-Bomb guards.
 * - Preserves authentic historical timestamps; NEVER fabricates source dates.
 * - Provides 4 canonical classification filters: VIDEO, SHORTS, CHANNELS, PLAYLISTS.
 * ═══════════════════════════════════════════════════════════════════════════
 */

export type OldArchiveCategory =
  | "saved-items"
  | "saved-titles"
  | "saved-playlists"
  | "search-history"
  | "other";

export type OldSourceFormat =
  | "canonical_manifest"
  | "generation_zip"
  | "ndjson"
  | "legacy_export"
  | "raw_json";

export type OldItemFilterType =
  | "ALL"
  | "VIDEO"
  | "SHORTS"
  | "CHANNELS"
  | "PLAYLISTS";

export interface FilterSummary {
  total_videos: number;
  total_shorts: number;
  total_channels: number;
  total_playlists: number;
  total_unknown: number;
}

export interface ArchivedManifestMetadata {
  manifest_id: string;
  category: OldArchiveCategory;
  source_format: OldSourceFormat;
  source_created_at: string | null;  // Preserved historical timestamp (never fabricated)
  source_exported_at: string | null; // Preserved historical timestamp (never fabricated)
  imported_at: string;               // Current ISO 8601 timestamp
  byte_count: number;
  record_count: number;
  content_sha256: string;
  filter_summary: FilterSummary;
  provenance: {
    source_system?: string;
    original_filename?: string;
    importer_version: string;
    detected_category?: string;
    notes?: string;
  };
}

export interface ArchivedManifestEnvelope {
  schema_version: "1.0.0";
  manifest_metadata: ArchivedManifestMetadata;
  payload: {
    items: Record<string, unknown>[];
    extra?: Record<string, unknown>;
  };
}

/**
 * Generates canonical physical storage path for an archived manifest.
 * Pattern: ASDY/OLD/<storage_owner_uuid>/<category>/<manifest_id>/manifest.json
 */
export function getArchivedManifestStoragePath(
  storageOwnerUuid: string,
  category: string,
  manifestId: string
): string {
  const safeManifestId = manifestId.replace(/[^a-zA-Z0-9_-]/g, "_");
  return `ASDY/OLD/${storageOwnerUuid}/${category}/${safeManifestId}/manifest.json`;
}

/**
 * Compute lowercase hex SHA-256 digest of Buffer or string.
 */
export function computeSha256(data: Buffer | string): string {
  const hash = crypto.createHash("sha256");
  hash.update(data);
  return hash.digest("hex").toLowerCase();
}

/**
 * YouTube Resource Classification:
 * 1. VIDEO: itemType === 'video' and !isShortsLike and itemType !== 'shorts_like'
 * 2. SHORTS: isShortsLike === true or itemType === 'shorts_like'
 * 3. CHANNELS: itemType === 'channel'
 * 4. PLAYLISTS: itemType === 'playlist'
 */
export function classifyItemType(item: unknown): "VIDEO" | "SHORTS" | "CHANNELS" | "PLAYLISTS" | "UNKNOWN" {
  if (!item || typeof item !== "object") return "UNKNOWN";
  const rec = item as Record<string, unknown>;

  const rawType = String(rec.itemType || rec.type || rec.entityType || rec.entity_type || "").toLowerCase().trim();
  const isShortsLike =
    rec.isShortsLike === true ||
    rec.is_shorts_like === true ||
    rawType === "shorts_like" ||
    rawType === "short" ||
    rawType === "shorts";

  if (isShortsLike) {
    return "SHORTS";
  }

  if (rawType === "video") {
    return "VIDEO";
  }

  if (rawType === "channel") {
    return "CHANNELS";
  }

  if (rawType === "playlist") {
    return "PLAYLISTS";
  }

  // Fallback heuristics based on ID shapes
  if (rec.videoId || rec.video_id) {
    return isShortsLike ? "SHORTS" : "VIDEO";
  }
  if (rec.channelId || rec.channel_id) {
    return "CHANNELS";
  }
  if (rec.playlistId || rec.playlist_id) {
    return "PLAYLISTS";
  }

  return "UNKNOWN";
}

/**
 * Compute breakdown summary across 4 filters.
 */
export function computeFilterSummary(items: unknown[]): FilterSummary {
  const summary: FilterSummary = {
    total_videos: 0,
    total_shorts: 0,
    total_channels: 0,
    total_playlists: 0,
    total_unknown: 0,
  };

  for (const item of items) {
    const classification = classifyItemType(item);
    switch (classification) {
      case "VIDEO":
        summary.total_videos++;
        break;
      case "SHORTS":
        summary.total_shorts++;
        break;
      case "CHANNELS":
        summary.total_channels++;
        break;
      case "PLAYLISTS":
        summary.total_playlists++;
        break;
      default:
        summary.total_unknown++;
        break;
    }
  }

  return summary;
}

/**
 * Filter items by classification.
 */
export function filterEnvelopeItems<T = Record<string, unknown>>(items: T[], filter: OldItemFilterType): T[] {
  if (filter === "ALL") return items;
  return items.filter((item) => classifyItemType(item) === filter);
}

/**
 * Automatically detects category from filename and content structure.
 */
export function detectArchiveCategory(filename: string, sampleItems: unknown[], rootObj?: unknown): OldArchiveCategory {
  const lowerName = filename.toLowerCase();

  // Explicit filename signals
  if (lowerName.includes("saved-item") || lowerName.includes("saved_item") || lowerName.includes("saveditem") || lowerName.includes("library")) {
    return "saved-items";
  }
  if (lowerName.includes("playlist") || lowerName.includes("user_playlist")) {
    return "saved-playlists";
  }
  if (lowerName.includes("search_history") || lowerName.includes("search-history") || lowerName.includes("query_history") || lowerName.includes("history")) {
    return "search-history";
  }
  if (lowerName.includes("title") || lowerName.includes("preset") || lowerName.includes("saved_search")) {
    return "saved-titles";
  }

  // Content inspection heuristics
  if (rootObj && typeof rootObj === "object") {
    const rootRec = rootObj as Record<string, unknown>;
    if (Array.isArray(rootRec.searches) || Array.isArray(rootRec.history) || Array.isArray(rootRec.queries)) {
      return "search-history";
    }
    const firstSample = sampleItems[0] as Record<string, unknown> | undefined;
    if (Array.isArray(rootRec.playlists) || (sampleItems.length > 0 && firstSample?.entries && firstSample?.title)) {
      return "saved-playlists";
    }
  }

  if (sampleItems.length > 0) {
    const first = sampleItems[0];
    if (typeof first === "string") {
      return "saved-titles";
    }
    if (first && typeof first === "object") {
      const firstRec = first as Record<string, unknown>;
      if (firstRec.query_text || firstRec.queryText || firstRec.quota_units_consumed !== undefined) {
        return "search-history";
      }
      if (firstRec.platform_item_id || firstRec.videoId || firstRec.channelId || firstRec.playlistId || firstRec.itemType || firstRec.entityType) {
        return "saved-items";
      }
    }
  }

  return "other";
}

/**
 * CRC32 checksum for ZIP verification.
 */
function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buffer.length; i++) {
    const byte = buffer[i];
    crc ^= byte;
    for (let j = 0; j < 8; j++) {
      const mask = -(crc & 1);
      crc = (crc >>> 1) ^ (0xedb88320 & mask);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/**
 * Pure Node.js ZIP archive entry extractor with strict Zip-Slip and Zip-Bomb protections.
 */
export function extractZipEntries(zipBuffer: Buffer): Array<{ filename: string; content: Buffer }> {
  const MAX_TOTAL_UNCOMPRESSED_BYTES = 200 * 1024 * 1024; // 200 MiB ceiling
  const MAX_COMPRESSION_RATIO = 100;                      // 100:1 ratio limit
  const MAX_ZIP_ENTRIES = 500;                            // Max 500 files

  // Locate End of Central Directory Record (EOCD signature 0x06054b50)
  let eocdOffset = -1;
  for (let i = zipBuffer.length - 22; i >= Math.max(0, zipBuffer.length - 65557); i--) {
    if (zipBuffer.readUInt32LE(i) === 0x06054b50) {
      eocdOffset = i;
      break;
    }
  }

  if (eocdOffset === -1) {
    throw new Error("Invalid ZIP archive: End of Central Directory record not found.");
  }

  const totalEntries = zipBuffer.readUInt16LE(eocdOffset + 10);
  const cdSize = zipBuffer.readUInt32LE(eocdOffset + 12);
  const cdOffset = zipBuffer.readUInt32LE(eocdOffset + 16);

  if (totalEntries > MAX_ZIP_ENTRIES) {
    throw new Error(`ZIP archive contains too many entries (${totalEntries} > ${MAX_ZIP_ENTRIES}).`);
  }

  if (cdOffset + cdSize > eocdOffset) {
    throw new Error("Invalid ZIP archive: Central directory boundaries corrupted.");
  }

  const entries: Array<{ filename: string; content: Buffer }> = [];
  let currentCdOffset = cdOffset;
  let totalExtractedBytes = 0;

  for (let idx = 0; idx < totalEntries; idx++) {
    if (currentCdOffset + 46 > zipBuffer.length) {
      throw new Error("Corrupted ZIP central directory header.");
    }

    const cdSig = zipBuffer.readUInt32LE(currentCdOffset);
    if (cdSig !== 0x02014b50) {
      throw new Error(`Corrupted central directory signature at offset ${currentCdOffset}`);
    }

    const compressionMethod = zipBuffer.readUInt16LE(currentCdOffset + 10);
    const expectedCrc = zipBuffer.readUInt32LE(currentCdOffset + 16);
    const compressedSize = zipBuffer.readUInt32LE(currentCdOffset + 20);
    const uncompressedSize = zipBuffer.readUInt32LE(currentCdOffset + 24);
    const fileNameLen = zipBuffer.readUInt16LE(currentCdOffset + 28);
    const extraLen = zipBuffer.readUInt16LE(currentCdOffset + 30);
    const commentLen = zipBuffer.readUInt16LE(currentCdOffset + 32);
    const localHeaderOffset = zipBuffer.readUInt32LE(currentCdOffset + 42);

    const fileNameBytes = zipBuffer.subarray(currentCdOffset + 46, currentCdOffset + 46 + fileNameLen);
    const entryName = fileNameBytes.toString("utf8");

    // Advance CD pointer
    currentCdOffset += 46 + fileNameLen + extraLen + commentLen;

    // Skip directory entries
    if (entryName.endsWith("/") || entryName.endsWith("\\")) {
      continue;
    }

    // Zip-Slip Protection: reject traversal, absolute paths, and drive specs
    if (
      entryName.includes("..") ||
      entryName.startsWith("/") ||
      entryName.startsWith("\\") ||
      /^[a-zA-Z]:/.test(entryName)
    ) {
      throw new Error(`Security Violation: Zip entry contains unsafe path traversal "${entryName}".`);
    }

    // Zip-Bomb Protection: check individual ratio and cumulative byte count
    if (compressedSize > 0 && uncompressedSize / compressedSize > MAX_COMPRESSION_RATIO) {
      throw new Error(`Security Violation: Compression ratio exceeds limit (${entryName}). Potential zip bomb.`);
    }

    totalExtractedBytes += uncompressedSize;
    if (totalExtractedBytes > MAX_TOTAL_UNCOMPRESSED_BYTES) {
      throw new Error(`Security Violation: Total uncompressed ZIP contents exceed ${MAX_TOTAL_UNCOMPRESSED_BYTES} bytes.`);
    }

    // Read Local File Header
    if (localHeaderOffset + 30 > zipBuffer.length) {
      throw new Error(`Corrupted local file header at offset ${localHeaderOffset}`);
    }
    const localSig = zipBuffer.readUInt32LE(localHeaderOffset);
    if (localSig !== 0x04034b50) {
      throw new Error(`Invalid local file header signature at offset ${localHeaderOffset}`);
    }
    const localNameLen = zipBuffer.readUInt16LE(localHeaderOffset + 26);
    const localExtraLen = zipBuffer.readUInt16LE(localHeaderOffset + 28);
    const dataOffset = localHeaderOffset + 30 + localNameLen + localExtraLen;

    if (dataOffset + compressedSize > zipBuffer.length) {
      throw new Error(`ZIP entry ${entryName} data exceeds file bounds.`);
    }

    const compressedData = zipBuffer.subarray(dataOffset, dataOffset + compressedSize);
    let extractedContent: Buffer;

    if (compressionMethod === 0) {
      // Stored (no compression)
      extractedContent = Buffer.from(compressedData);
    } else if (compressionMethod === 8) {
      // Deflate
      try {
        extractedContent = zlib.inflateRawSync(compressedData);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        throw new Error(`Failed to decompress ZIP entry "${entryName}": ${msg}`);
      }
    } else {
      throw new Error(`Unsupported ZIP compression method ${compressionMethod} in "${entryName}".`);
    }

    // Verify CRC32
    const actualCrc = crc32(extractedContent);
    if (expectedCrc !== 0 && actualCrc !== expectedCrc) {
      throw new Error(`CRC32 mismatch in ZIP entry "${entryName}" (expected: ${expectedCrc}, got: ${actualCrc}).`);
    }

    entries.push({
      filename: entryName,
      content: extractedContent,
    });
  }

  return entries;
}

/**
 * Universal Parser that converts any supported legacy file format into
 * a canonical ArchivedManifestEnvelope.
 *
 * @param buffer Raw uploaded file bytes
 * @param originalFilename Uploaded file name
 * @param categoryOverride Optional user category selection
 */
export async function parseRawBufferToEnvelope(
  buffer: Buffer,
  originalFilename: string,
  categoryOverride?: OldArchiveCategory
): Promise<ArchivedManifestEnvelope> {
  const contentSha256 = computeSha256(buffer);
  const nowIso = new Date().toISOString();

  // 1. Detect if buffer is a ZIP file (PK.. signature 0x04034b50)
  if (buffer.length >= 4 && buffer.readUInt32LE(0) === 0x04034b50) {
    const entries = extractZipEntries(buffer);
    const jsonEntries = entries.filter((e) => e.filename.toLowerCase().endsWith(".json"));

    if (jsonEntries.length === 0) {
      throw new Error("The uploaded ZIP archive contains no JSON manifest files.");
    }

    // Find root manifest if present, else aggregate part files
    let rootEntry = jsonEntries.find((e) =>
      e.filename.toLowerCase().includes("manifest.json") ||
      !e.filename.toLowerCase().includes("part-")
    );
    if (!rootEntry) rootEntry = jsonEntries[0];

    const aggregatedItems: Record<string, unknown>[] = [];
    let detectedSourceCreated: string | null = null;
    let detectedSourceExported: string | null = null;
    let originalManifestId: string | null = null;

    for (const entry of jsonEntries) {
      try {
        const parsed = JSON.parse(entry.content.toString("utf8")) as unknown;
        if (Array.isArray(parsed)) {
          for (const it of parsed) {
            if (it && typeof it === "object") aggregatedItems.push(it as Record<string, unknown>);
          }
        } else if (parsed && typeof parsed === "object") {
          const rec = parsed as Record<string, unknown>;
          if (Array.isArray(rec.items)) {
            for (const it of rec.items) {
              if (it && typeof it === "object") aggregatedItems.push(it as Record<string, unknown>);
            }
          } else if (Array.isArray(rec.records)) {
            for (const it of rec.records) {
              if (it && typeof it === "object") aggregatedItems.push(it as Record<string, unknown>);
            }
          }
          if (!originalManifestId && rec.manifestId) {
            originalManifestId = String(rec.manifestId);
          }
          const metaRec = rec.metadata as Record<string, unknown> | undefined;
          if (!detectedSourceCreated) {
            detectedSourceCreated = (metaRec?.fetchedAt || rec.createdAt || rec.created_at || null) as string | null;
          }
          if (!detectedSourceExported) {
            detectedSourceExported = (metaRec?.exportedAt || rec.exportedAt || rec.exported_at || null) as string | null;
          }
        }
      } catch {
        // Skip non-parseable JSON chunks
      }
    }

    const detectedCat = categoryOverride || detectArchiveCategory(originalFilename, aggregatedItems);
    const filterSummary = computeFilterSummary(aggregatedItems);

    return {
      schema_version: "1.0.0",
      manifest_metadata: {
        manifest_id: originalManifestId || `old_${contentSha256.slice(0, 16)}`,
        category: detectedCat,
        source_format: "generation_zip",
        source_created_at: detectedSourceCreated,
        source_exported_at: detectedSourceExported,
        imported_at: nowIso,
        byte_count: buffer.length,
        record_count: aggregatedItems.length,
        content_sha256: contentSha256,
        filter_summary: filterSummary,
        provenance: {
          original_filename: originalFilename,
          importer_version: "1.5.0",
          detected_category: detectedCat,
          notes: `Extracted from ZIP containing ${entries.length} entries (${jsonEntries.length} JSON chunks).`,
        },
      },
      payload: {
        items: aggregatedItems,
      },
    };
  }

  // 2. Try parsing as standard JSON
  const textContent = buffer.toString("utf8").trim();
  if (textContent.startsWith("{") || textContent.startsWith("[")) {
    try {
      const parsed = JSON.parse(textContent) as unknown;

      // Check if already an ArchivedManifestEnvelope
      if (
        parsed &&
        typeof parsed === "object" &&
        (parsed as Record<string, unknown>).schema_version === "1.0.0" &&
        (parsed as Record<string, unknown>).manifest_metadata &&
        (parsed as Record<string, unknown>).payload
      ) {
        const env = parsed as ArchivedManifestEnvelope;
        const meta = env.manifest_metadata;
        const items = Array.isArray(env.payload.items) ? env.payload.items : [];
        const detectedCat = categoryOverride || meta.category || detectArchiveCategory(originalFilename, items);
        const filterSummary = computeFilterSummary(items);

        return {
          schema_version: "1.0.0",
          manifest_metadata: {
            manifest_id: meta.manifest_id || `old_${contentSha256.slice(0, 16)}`,
            category: detectedCat,
            source_format: meta.source_format || "canonical_manifest",
            source_created_at: meta.source_created_at || null,
            source_exported_at: meta.source_exported_at || null,
            imported_at: nowIso,
            byte_count: buffer.length,
            record_count: items.length,
            content_sha256: contentSha256,
            filter_summary: filterSummary,
            provenance: {
              ...meta.provenance,
              original_filename: originalFilename,
              importer_version: "1.5.0",
              detected_category: detectedCat,
            },
          },
          payload: {
            items,
            extra: env.payload.extra,
          },
        };
      }

      // Check if YouTubeManifest or generic object
      if (!Array.isArray(parsed) && parsed && typeof parsed === "object") {
        const rec = parsed as Record<string, unknown>;
        const rawItems = Array.isArray(rec.items)
          ? rec.items
          : Array.isArray(rec.records)
          ? rec.records
          : Array.isArray(rec.data)
          ? rec.data
          : Array.isArray(rec.results)
          ? rec.results
          : [];

        const items: Record<string, unknown>[] = [];
        for (const it of rawItems) {
          if (it && typeof it === "object") items.push(it as Record<string, unknown>);
          else items.push({ value: it });
        }

        const detectedCat = categoryOverride || detectArchiveCategory(originalFilename, items, rec);
        const filterSummary = computeFilterSummary(items);

        const metaObj = rec.metadata as Record<string, unknown> | undefined;
        const sourceCreated = (metaObj?.fetchedAt || rec.createdAt || rec.created_at || null) as string | null;
        const sourceExported = (metaObj?.exportedAt || rec.exportedAt || rec.exported_at || null) as string | null;

        return {
          schema_version: "1.0.0",
          manifest_metadata: {
            manifest_id: String(rec.manifestId || rec.id || `old_${contentSha256.slice(0, 16)}`),
            category: detectedCat,
            source_format: rec.manifestId ? "canonical_manifest" : "legacy_export",
            source_created_at: sourceCreated ? new Date(sourceCreated).toISOString() : null,
            source_exported_at: sourceExported ? new Date(sourceExported).toISOString() : null,
            imported_at: nowIso,
            byte_count: buffer.length,
            record_count: items.length,
            content_sha256: contentSha256,
            filter_summary: filterSummary,
            provenance: {
              original_filename: originalFilename,
              importer_version: "1.5.0",
              detected_category: detectedCat,
              notes: rec.settingsSnapshot ? "Parsed from YouTube search manifest with settings snapshot." : undefined,
            },
          },
          payload: {
            items,
            extra: {
              settingsSnapshot: rec.settingsSnapshot as Record<string, unknown> | undefined,
              provenance: rec.provenance as Record<string, unknown> | undefined,
              metadata: rec.metadata as Record<string, unknown> | undefined,
            },
          },
        };
      }

      // JSON Array
      if (Array.isArray(parsed)) {
        const items: Record<string, unknown>[] = [];
        for (const it of parsed) {
          if (it && typeof it === "object") items.push(it as Record<string, unknown>);
          else items.push({ value: it });
        }
        const detectedCat = categoryOverride || detectArchiveCategory(originalFilename, items);
        const filterSummary = computeFilterSummary(items);

        return {
          schema_version: "1.0.0",
          manifest_metadata: {
            manifest_id: `old_${contentSha256.slice(0, 16)}`,
            category: detectedCat,
            source_format: "raw_json",
            source_created_at: null,
            source_exported_at: null,
            imported_at: nowIso,
            byte_count: buffer.length,
            record_count: items.length,
            content_sha256: contentSha256,
            filter_summary: filterSummary,
            provenance: {
              original_filename: originalFilename,
              importer_version: "1.5.0",
              detected_category: detectedCat,
            },
          },
          payload: {
            items,
          },
        };
      }
    } catch {
      // Fall through to NDJSON parser
    }
  }

  // 3. Try parsing as NDJSON / JSONL
  const lines = textContent.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length > 0) {
    const ndjsonItems: Record<string, unknown>[] = [];
    let parseErrors = 0;

    for (const line of lines) {
      try {
        const it = JSON.parse(line) as unknown;
        if (it && typeof it === "object") ndjsonItems.push(it as Record<string, unknown>);
        else ndjsonItems.push({ value: it });
      } catch {
        parseErrors++;
      }
    }

    if (ndjsonItems.length > 0 && parseErrors <= lines.length / 2) {
      const detectedCat = categoryOverride || detectArchiveCategory(originalFilename, ndjsonItems);
      const filterSummary = computeFilterSummary(ndjsonItems);

      return {
        schema_version: "1.0.0",
        manifest_metadata: {
          manifest_id: `old_${contentSha256.slice(0, 16)}`,
          category: detectedCat,
          source_format: "ndjson",
          source_created_at: null,
          source_exported_at: null,
          imported_at: nowIso,
          byte_count: buffer.length,
          record_count: ndjsonItems.length,
          content_sha256: contentSha256,
          filter_summary: filterSummary,
          provenance: {
            original_filename: originalFilename,
            importer_version: "1.5.0",
            detected_category: detectedCat,
            notes: `Parsed NDJSON (${ndjsonItems.length} lines, ${parseErrors} skipped lines).`,
          },
        },
        payload: {
          items: ndjsonItems,
        },
      };
    }
  }

  throw new Error(`Unsupported archive file format. File "${originalFilename}" could not be parsed as JSON, ZIP, or NDJSON.`);
}
