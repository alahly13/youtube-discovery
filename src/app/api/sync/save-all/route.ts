import "server-only";

import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin, assertSameOrigin } from "@/lib/auth/require-auth";
import {
  requireStorageOwnerId,
  resolveProfileId,
} from "@/lib/auth/storage-owner";
import { prisma } from "@/lib/db/prisma";
import { getR2WorkerStorageClient } from "@/lib/storage/r2-worker-storage-client";
import {
  partitionRecordsIntoManifestParts,
  buildGenerationManifestPath,
  buildDatasetVersionPointerPath,
} from "@/lib/storage/manifest-serializer";
import {
  normalizeResourceRecord,
  validateResourceRecord,
  type ResourceType,
} from "@/lib/resources/resource-taxonomy";
import {
  datasetTypeToSlug,
  type CanonicalDatasetType,
} from "@/lib/storage/canonical-paths";
import {
  toEntryUuid,
  toGroupUuid,
  toPlaylistUuid,
} from "@/lib/playlists/playlist-db-service";
import {
  classifyHttpOrErrorCategory,
  type SaveErrorCategory,
  type SaveStatusStage,
} from "@/lib/sync/save-receipt";
import type { Prisma } from "@prisma/client";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * POST /api/sync/save-all — Authoritative Cloud Synchronization Route
 * ──────────────────────────────────────────────────────────────────────────
 * Pipeline (fail-closed):
 *   1. Authenticate the Supabase session and resolve the CANONICAL storage
 *      owner (`user_profiles.storage_owner_uuid`), never the auth user id.
 *   2. Validate the payload with Zod and validate every record against the
 *      canonical resource taxonomy.
 *   3. Build a FULL dataset snapshot. New clients send `snapshotRecords`
 *      (their complete local projection). Legacy clients that send only delta
 *      operations are merged onto the currently committed generation, which
 *      is read back from R2 and SHA-256 verified.
 *   4. Enforce idempotency and optimistic revision checks BEFORE uploading.
 *   5. Upload immutable manifest + parts to R2, then verify every object's
 *      SHA-256 and byte count through the Worker.
 *   6. Commit PostgreSQL registry rows in one transaction, including
 *      relational indexes for saved items, saved references and saved
 *      searches.
 *   7. Only after the database commit succeeds, update the version pointer
 *      and return success so the client may prune its outbox.
 *
 * A successful R2 upload alone is NEVER reported as success. If the database
 * commit fails, the request fails and the outbox is preserved.
 * ═══════════════════════════════════════════════════════════════════════════
 */

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const MAX_REQUEST_BYTES = 64 * 1024 * 1024; // 64 MiB request body ceiling
const MAX_SNAPSHOT_RECORDS = 100_000;
const MAX_OPERATIONS_PER_DATASET = 10_000;

const DatasetTypeSchema = z.enum([
  "SAVED_ITEMS",
  "PLAYLIST",
  "SEARCH_HISTORY",
  "RESEARCH_QUEUE",
  "REFERENCES",
]);

const SyncOperationSchema = z.object({
  operationId: z.string().min(1).max(128),
  entityId: z.string().min(1).max(256),
  operationType: z.enum(["UPSERT", "APPEND", "DELETE"]),
  payload: z.record(z.string(), z.unknown()).default({}),
  originDeviceId: z.string().max(128).optional(),
  originDeviceLabel: z.string().max(128).optional(),
});

const SyncDatasetSchema = z.object({
  datasetType: DatasetTypeSchema,
  idempotencyKey: z.string().min(1).max(128),
  expectedRevision: z.number().int().min(0).optional(),
  originDeviceId: z.string().max(128).optional(),
  originDeviceLabel: z.string().max(128).optional(),
  operations: z.array(SyncOperationSchema).min(1).max(MAX_OPERATIONS_PER_DATASET),
  /**
   * Complete local projection for this dataset. Strongly preferred: it makes
   * every generation a real snapshot and lets hydration replace local state
   * safely. Omitted only by older clients for backward compatibility.
   */
  snapshotRecords: z
    .array(z.record(z.string(), z.unknown()))
    .max(MAX_SNAPSHOT_RECORDS)
    .optional(),
});

const SaveAllBodySchema = z.object({
  batchId: z.string().min(1).max(128).optional(),
  originDeviceId: z.string().max(128).optional(),
  originDeviceLabel: z.string().max(128).optional(),
  datasets: z.array(SyncDatasetSchema).min(1).max(5),
});

export type SyncDatasetPayload = z.infer<typeof SyncDatasetSchema>;
export type SaveAllRequestBody = z.infer<typeof SaveAllBodySchema>;

interface DatasetSyncResult {
  datasetType: string;
  datasetId: string;
  generationId: string;
  revision: number;
  recordsCount: number;
  existingRecordsCount: number;
  addedRecordsCount: number;
  partsCount: number;
  bytesUploaded: number;
  aggregateSha256: string;
  verifiedCount: number;
  manifestPath?: string;
  partPaths?: string[];
  resourceTypeCounts: Partial<Record<ResourceType, number>>;
  syncedOperationIds: string[];
  syncedEntityIds: string[];
  idempotentReplay: boolean;
  versionPointerStatus: "WRITTEN" | "FAILED" | "DEFERRED";
}

class StageSyncError extends Error {
  public readonly errorCategory: SaveErrorCategory;
  public readonly failedStage: SaveStatusStage;
  public readonly httpStatus: number;
  constructor(
    message: string,
    errorCategory: SaveErrorCategory,
    failedStage: SaveStatusStage,
    httpStatus = 500
  ) {
    super(message);
    this.name = "StageSyncError";
    this.errorCategory = errorCategory;
    this.failedStage = failedStage;
    this.httpStatus = httpStatus;
  }
}

class RevisionConflictError extends Error {
  public readonly currentRevision: number;
  constructor(currentRevision: number) {
    super(`Revision conflict: dataset is at revision ${currentRevision}.`);
    this.name = "RevisionConflictError";
    this.currentRevision = currentRevision;
  }
}

function isUuid(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
  );
}

/**
 * Deterministically maps an application record id (which may not be a UUID)
 * to a valid RFC-4122 UUID. This lets PostgreSQL relational indexes use UUID
 * primary keys without losing the original record identity, which is stored
 * separately in `record_id`.
 */
function toDatabaseUuid(seed: string): string {
  const hex = crypto.createHash("sha256").update(seed, "utf8").digest("hex");
  const variant = ((parseInt(hex[16], 16) & 0x3) | 0x8).toString(16);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

function readString(record: Record<string, unknown>, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function readNumber(record: Record<string, unknown>, ...keys: string[]): number | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) {
      return Number(value);
    }
  }
  return null;
}

function parseDate(value: unknown): Date | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * Removes local-only projection fields and guarantees the canonical
 * discriminator/identity before a record enters an immutable manifest.
 */
function sanitizeRecordForStorage(
  raw: Record<string, unknown>,
  datasetType: string,
  fallbackEntityId: string
): Record<string, unknown> {
  const clean: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(raw)) {
    if (key === "_originDeviceId") {
      clean.originDeviceId = value;
      continue;
    }
    if (key === "_originDeviceLabel") {
      clean.originDeviceLabel = value;
      continue;
    }
    // Strip IndexedDB projection metadata only. Real domain fields that start
    // with an underscore are not part of the public record contract.
    if (key.startsWith("_")) continue;
    clean[key] = value;
  }

  if (datasetType === "SAVED_ITEMS") {
    if (!readString(clean, "platformItemId")) {
      const resourceId = readString(clean, "resourceId", "youtubeId", "videoId");
      if (resourceId) clean.platformItemId = resourceId;
      else if (fallbackEntityId) clean.platformItemId = fallbackEntityId;
    }
    if (!readString(clean, "id") && readString(clean, "platformItemId")) {
      clean.id = `youtube:${readString(clean, "platformItemId")}`;
    }
  } else if (!readString(clean, "id") && fallbackEntityId) {
    clean.id = fallbackEntityId;
  }

  const normalized = normalizeResourceRecord(clean, { datasetType });

  // A saved event timestamp is legitimate creation metadata, not identity.
  if (!readString(normalized, "savedAt", "createdAt")) {
    normalized.savedAt = new Date().toISOString();
  }

  return normalized;
}

function recordIdentityKeys(record: Record<string, unknown>): string[] {
  const keys = [
    readString(record, "recordId"),
    readString(record, "id"),
    readString(record, "platformItemId"),
    readString(record, "resourceId"),
  ];
  return keys.filter((key): key is string => Boolean(key));
}

/**
 * Applies delta operations to a base snapshot. Used for legacy clients and to
 * enforce DELETE semantics even when a snapshot is supplied.
 */
function applyOperationsToSnapshot(
  baseRecords: Record<string, unknown>[],
  operations: SyncDatasetPayload["operations"],
  datasetType: string
): Record<string, unknown>[] {
  const byIdentity = new Map<string, Record<string, unknown>>();

  for (const record of baseRecords) {
    const keys = recordIdentityKeys(record);
    if (keys.length === 0) continue;
    byIdentity.set(keys[0], record);
  }

  for (const operation of operations) {
    if (operation.operationType === "DELETE") {
      for (const [key, record] of byIdentity.entries()) {
        if (recordIdentityKeys(record).includes(operation.entityId) || key === operation.entityId) {
          byIdentity.delete(key);
        }
      }
      continue;
    }

    const sanitized = sanitizeRecordForStorage(
      operation.payload,
      datasetType,
      operation.entityId
    );
    const identity = readString(sanitized, "recordId", "id") || operation.entityId;

    // Replace any existing record that shares any identity with the upsert.
    const incomingKeys = new Set(recordIdentityKeys(sanitized));
    incomingKeys.add(operation.entityId);
    for (const [key, record] of byIdentity.entries()) {
      if (key === identity || recordIdentityKeys(record).some((k) => incomingKeys.has(k))) {
        byIdentity.delete(key);
      }
    }

    byIdentity.set(identity, sanitized);
  }

  return Array.from(byIdentity.values());
}

function getEntityKey(rec: Record<string, unknown>, datasetType: string): string {
  if (datasetType === "SAVED_ITEMS") {
    const platformId = readString(rec, "platformItemId", "resourceId");
    if (platformId) return platformId;
  }
  const id = readString(rec, "id", "recordId", "platformItemId", "resourceId");
  return id || "";
}

/**
 * Reads all currently committed generations and parts back from R2 and Supabase PostgreSQL.
 * Every part is SHA-256 verified before it is used as a merge base.
/**
 * Parse committed/archived part payloads into raw record objects.
 */
function extractPartRecords(parsed: unknown): Record<string, unknown>[] {
  if (Array.isArray(parsed)) {
    return parsed as Record<string, unknown>[];
  }
  if (parsed && typeof parsed === "object") {
    const obj = parsed as { records?: unknown; items?: unknown };
    if (Array.isArray(obj.records)) return obj.records as Record<string, unknown>[];
    if (Array.isArray(obj.items)) return obj.items as Record<string, unknown>[];
  }
  return [];
}

/**
 * Loads the canonical committed cloud snapshot fail-closed.
 * Guarantees deterministic precedence without letting superseded generations
 * overwrite newer edits or resurrect records removed in later generations:
 *   1. Historical `before-app-updating/` archives (non-overlapping prefix, loaded first).
 *   2. Latest `COMMITTED` generation from PostgreSQL (or single newest generation on R2 if DB has none),
 *      with mandatory SHA-256 verification and fail-closed error propagation on storage/DB failures.
 *   3. For SAVED_ITEMS, `saved_items_index` rows only when missing from R2 snapshot.
 */
async function loadCommittedSnapshot(params: {
  ownerId: string;
  datasetId: string;
  currentGenerationId: string | null;
  storageOwnerUuid: string;
  datasetType?: string;
}): Promise<Record<string, unknown>[]> {
  const r2Client = getR2WorkerStorageClient();
  const historicalRecordsMap = new Map<string, Record<string, unknown>>();
  const committedRecordsMap = new Map<string, Record<string, unknown>>();

  // Phase 1: Query ONLY the authoritative latest COMMITTED generation from PostgreSQL.
  // Do NOT rethrow-swallow DB failures or loop over all superseded generations in ascending order.
  const latestGeneration = params.currentGenerationId
    ? await prisma.storageGeneration.findFirst({
        where: {
          id: params.currentGenerationId,
          owner_id: params.ownerId,
          dataset_id: params.datasetId,
          state: "COMMITTED",
        },
        include: { parts: { orderBy: { part_number: "asc" } } },
      })
    : await prisma.storageGeneration.findFirst({
        where: {
          owner_id: params.ownerId,
          dataset_id: params.datasetId,
          state: "COMMITTED",
        },
        orderBy: { generation_number: "desc" },
        include: { parts: { orderBy: { part_number: "asc" } } },
      });

  if (params.currentGenerationId && !latestGeneration) {
    throw new Error(
      `Authoritative committed generation ${params.currentGenerationId} could not be located in PostgreSQL.`
    );
  }

  if (latestGeneration) {
    for (const part of latestGeneration.parts) {
      const { data, sha256 } = await r2Client.getObject("NEW", part.storage_path, {
        storageOwnerUuid: params.storageOwnerUuid,
      });

      if (part.sha256 && sha256.toLowerCase() !== part.sha256.toLowerCase()) {
        throw new Error(
          `Checksum mismatch reading committed part ${part.storage_path} (expected ${part.sha256}, got ${sha256}).`
        );
      }

      const items = extractPartRecords(JSON.parse(data.toString("utf8")));
      for (const item of items) {
        const key = getEntityKey(item, params.datasetType || "");
        if (key) committedRecordsMap.set(key, item);
      }
    }
  }

  // Phase 2: Read non-overlapping `before-app-updating/` historical archives once,
  // plus recover newest R2 generation ONLY when PostgreSQL has no committed generation yet.
  if (params.datasetType) {
    const datasetSlug = datasetTypeToSlug(params.datasetType as CanonicalDatasetType);
    const historicalPrefix = `asdy/persistence/${params.storageOwnerUuid}/${datasetSlug}/before-app-updating/`;

    let historicalManifestKeys: string[] = [];
    try {
      const histList = await r2Client.listAllObjects("NEW", historicalPrefix, {
        storageOwnerUuid: params.storageOwnerUuid,
      });
      if (histList.truncated || histList.incomplete) {
        throw new Error(`Historical R2 listing truncated for ${historicalPrefix}`);
      }
      historicalManifestKeys = (histList?.objects || [])
        .map((o) => o.key)
        .filter((k) => k.endsWith("/manifest.json") || k.endsWith("manifest.json"))
        .sort();
    } catch (histErr) {
      const errMsg = histErr instanceof Error ? histErr.message : String(histErr);
      // Treat 404/empty prefix safely; fail closed on Worker auth/network/truncation errors.
      if (!errMsg.includes("404") && !errMsg.toLowerCase().includes("not found")) {
        throw histErr;
      }
    }

    for (const manifestKey of historicalManifestKeys) {
      const { data } = await r2Client.getObject("NEW", manifestKey, {
        storageOwnerUuid: params.storageOwnerUuid,
      });
      const manifest = JSON.parse(data.toString("utf8")) as {
        parts?: Array<{ storagePath?: string; sha256?: string }>;
        items?: Record<string, unknown>[];
        records?: Record<string, unknown>[];
      };

      for (const item of extractPartRecords(manifest)) {
        const key = getEntityKey(item, params.datasetType || "");
        if (key) historicalRecordsMap.set(key, item);
      }

      if (Array.isArray(manifest.parts)) {
        for (const p of manifest.parts) {
          if (!p.storagePath) continue;
          const partRes = await r2Client.getObject("NEW", p.storagePath, {
            storageOwnerUuid: params.storageOwnerUuid,
          });
          if (p.sha256 && partRes.sha256.toLowerCase() !== p.sha256.toLowerCase()) {
            throw new Error(`Checksum mismatch on historical part ${p.storagePath}.`);
          }
          for (const item of extractPartRecords(JSON.parse(partRes.data.toString("utf8")))) {
            const key = getEntityKey(item, params.datasetType || "");
            if (key) historicalRecordsMap.set(key, item);
          }
        }
      }
    }

    // Fallback recovery only if DB had NO committed generation yet: read the single newest R2 generation.
    if (!latestGeneration) {
      const generationsPrefix = `asdy/persistence/${params.storageOwnerUuid}/${datasetSlug}/generations/`;
      let genManifestKeys: string[] = [];
      try {
        const genList = await r2Client.listAllObjects("NEW", generationsPrefix, {
          storageOwnerUuid: params.storageOwnerUuid,
        });
        if (genList.truncated || genList.incomplete) {
          throw new Error(`Active generation R2 listing truncated for ${generationsPrefix}`);
        }
        genManifestKeys = (genList?.objects || [])
          .map((o) => o.key)
          .filter((k) => k.endsWith("/manifest.json") || k.endsWith("manifest.json"));
      } catch (genErr) {
        const errMsg = genErr instanceof Error ? genErr.message : String(genErr);
        if (!errMsg.includes("404") && !errMsg.toLowerCase().includes("not found")) {
          throw genErr;
        }
      }

      type CandidateManifest = {
        generationNumber?: number;
        currentRevision?: number;
        generatedAt?: string;
        createdAt?: string;
        parts?: Array<{ storagePath?: string; sha256?: string; partNumber?: number }>;
        items?: Record<string, unknown>[];
        records?: Record<string, unknown>[];
      };

      let newest: CandidateManifest | null = null;
      for (const manifestKey of genManifestKeys) {
        const { data } = await r2Client.getObject("NEW", manifestKey, {
          storageOwnerUuid: params.storageOwnerUuid,
        });
        const candidate = JSON.parse(data.toString("utf8")) as CandidateManifest;
        const candRev = Number(candidate.generationNumber ?? candidate.currentRevision ?? 0);
        const curRev = newest ? Number(newest.generationNumber ?? newest.currentRevision ?? 0) : -1;
        const candDate = String(candidate.generatedAt || candidate.createdAt || "");
        const curDate = newest ? String(newest.generatedAt || newest.createdAt || "") : "";
        if (!newest || candRev > curRev || (candRev === curRev && candDate > curDate)) {
          newest = candidate;
        }
      }

      if (newest) {
        for (const item of extractPartRecords(newest)) {
          const key = getEntityKey(item, params.datasetType || "");
          if (key) committedRecordsMap.set(key, item);
        }
        if (Array.isArray(newest.parts)) {
          const sortedParts = [...newest.parts].sort(
            (a, b) => Number(a.partNumber ?? 0) - Number(b.partNumber ?? 0)
          );
          for (const p of sortedParts) {
            if (!p.storagePath) continue;
            const partRes = await r2Client.getObject("NEW", p.storagePath, {
              storageOwnerUuid: params.storageOwnerUuid,
            });
            if (p.sha256 && partRes.sha256.toLowerCase() !== p.sha256.toLowerCase()) {
              throw new Error(`Checksum mismatch on recovered generation part ${p.storagePath}.`);
            }
            for (const item of extractPartRecords(JSON.parse(partRes.data.toString("utf8")))) {
              const key = getEntityKey(item, params.datasetType || "");
              if (key) committedRecordsMap.set(key, item);
            }
          }
        }
      }
    }
  }

  // Merge deterministically: historical tier first, then latest authoritative committed generation.
  const recordsMap = new Map<string, Record<string, unknown>>(historicalRecordsMap);
  for (const [k, v] of committedRecordsMap.entries()) {
    recordsMap.set(k, v);
  }

  // Phase 3: For SAVED_ITEMS, fill in any committed saved_items_index rows missing from R2 snapshot.
  if (params.datasetType === "SAVED_ITEMS") {
    const existingDbItems = await prisma.savedItemIndex.findMany({
      where: { owner_id: params.ownerId },
    });
    for (const dbItem of existingDbItems) {
      const key = dbItem.platform_item_id;
      if (!recordsMap.has(key)) {
        recordsMap.set(key, {
          platformItemId: dbItem.platform_item_id,
          id: `youtube:${dbItem.platform_item_id}`,
          title: dbItem.title,
          channelTitle: dbItem.channel_title ?? undefined,
          thumbnailUrl: dbItem.thumbnail_url ?? undefined,
          itemType: dbItem.entity_type.toLowerCase(),
          isShortsLike: dbItem.is_shorts_like,
          isAgeRestricted: dbItem.is_age_restricted,
          publishedAt: dbItem.published_at?.toISOString(),
          viewsCount: dbItem.views_count ? Number(dbItem.views_count) : undefined,
          likesCount: dbItem.likes_count ? Number(dbItem.likes_count) : undefined,
          commentsCount: dbItem.comments_count ? Number(dbItem.comments_count) : undefined,
          durationSeconds: dbItem.duration_seconds ?? undefined,
          savedAt: dbItem.saved_at.toISOString(),
          savedDate: dbItem.saved_date,
          originDeviceId: dbItem.origin_device_id ?? undefined,
          originDeviceLabel: dbItem.origin_device_label ?? undefined,
          resourceType: dbItem.resource_type ?? undefined,
          resourceId: dbItem.resource_id ?? dbItem.platform_item_id,
        });
      }
    }
  } else if (params.datasetType === "REFERENCES") {
    const [existingRefs, existingPresets] = await Promise.all([
      prisma.savedReference.findMany({ where: { owner_id: params.ownerId } }),
      prisma.savedSearchPreset.findMany({ where: { owner_id: params.ownerId } }),
    ]);

    for (const ref of existingRefs) {
      const key = ref.record_id || ref.id;
      if (!recordsMap.has(key)) {
        recordsMap.set(key, {
          id: key,
          recordId: key,
          resourceType: ref.resource_type || (ref.url ? "SAVED_LINK" : "SAVED_TITLE"),
          savedKind: ref.resource_type || (ref.url ? "SAVED_LINK" : "SAVED_TITLE"),
          resourceId: ref.resource_id || key,
          title: ref.title,
          url: ref.url ?? undefined,
          notes: ref.notes ?? undefined,
          tags: ref.tags ?? [],
          isPinned: ref.is_pinned,
          savedAt: ref.saved_at.toISOString(),
          createdAt: ref.created_at.toISOString(),
          updatedAt: ref.updated_at.toISOString(),
        });
      }
    }

    for (const preset of existingPresets) {
      const key = preset.record_id || preset.id;
      if (!recordsMap.has(key)) {
        recordsMap.set(key, {
          id: key,
          recordId: key,
          resourceType: "SAVED_SEARCH",
          savedKind: "SAVED_SEARCH",
          resourceId: preset.resource_id || key,
          title: preset.title,
          query: preset.query_text,
          notes: preset.notes ?? undefined,
          settings: preset.search_settings,
          resourceSelection: preset.resource_selection ?? "ALL",
          filters: preset.filter_snapshot ?? undefined,
          isPinned: preset.is_pinned,
          tags: preset.tags ?? [],
          savedAt: preset.saved_at.toISOString(),
          createdAt: preset.created_at.toISOString(),
          updatedAt: preset.updated_at.toISOString(),
        });
      }
    }
  } else if (params.datasetType === "SEARCH_HISTORY") {
    const existingHistory = await prisma.searchHistoryRecord.findMany({
      where: { owner_id: params.ownerId },
      orderBy: { executed_at: "desc" },
      take: 1000,
    });

    for (const hist of existingHistory) {
      const key = hist.record_id || hist.manifest_id || hist.id;
      if (!recordsMap.has(key)) {
        const rawPayload =
          hist.raw_payload_json && typeof hist.raw_payload_json === "object"
            ? (hist.raw_payload_json as Record<string, unknown>)
            : {};
        recordsMap.set(key, {
          ...rawPayload,
          id: key,
          recordId: key,
          title: hist.title || hist.query_text,
          query: hist.query_text,
          status: hist.status || "complete",
          settings: hist.search_settings,
          resourceSelection: hist.resource_selection ?? "ALL",
          filters: hist.filter_snapshot ?? undefined,
          resultsCount: hist.result_count,
          videoCount: hist.video_count,
          channelCount: hist.channel_count,
          playlistCount: hist.playlist_count,
          topThumbnails: hist.top_thumbnails_json,
          quotaCostEstimate: hist.quota_units_consumed,
          manifestId: hist.manifest_id,
          isPinned: hist.is_pinned,
          timestamp: hist.executed_at.toISOString(),
          createdAt: hist.executed_at.toISOString(),
        });
      }
    }
  }

  return Array.from(recordsMap.values());
}

/**
 * Merges incoming record fields over an existing committed cloud record without
 * allowing null/undefined/empty values to clobber richer fields already stored in R2.
 */
function preserveNonEmptyMerge(
  existing: Record<string, unknown>,
  incoming: Record<string, unknown>
): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...existing };
  for (const [k, v] of Object.entries(incoming)) {
    if (v === undefined || v === null) continue;
    if (typeof v === "string" && v.trim() === "" && typeof existing[k] === "string" && existing[k]) {
      continue;
    }
    if (Array.isArray(v) && v.length === 0 && Array.isArray(existing[k]) && (existing[k] as unknown[]).length > 0) {
      continue;
    }
    merged[k] = v;
  }
  return merged;
}

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * CRITICAL DATA-PRESERVATION RULE:
 * Existing Cloud Items + New Local Items Selected for Cloud Save
 *         |
 *         v
 * Append / Add / Idempotent Upsert
 *         |
 *         v
 * Updated Cloud Collection (Existing Cloud Items MUST Remain)
 * ──────────────────────────────────────────────────────────────────────────
 * Never replaces the cloud collection. Always preserves every existing cloud item.
 * Adds genuinely new local items and performs idempotent upserts for existing ones.
 * ═══════════════════════════════════════════════════════════════════════════
 */
function mergeCloudAndIncomingRecords(
  baseRecords: Record<string, unknown>[],
  incomingSnapshot: Record<string, unknown>[],
  operations: SyncDatasetPayload["operations"],
  datasetType: string
): {
  records: Record<string, unknown>[];
  existingRecordsCount: number;
  addedRecordsCount: number;
  updatedRecordsCount: number;
  deletedPlatformItemIds: string[];
  deletedEntityIds: string[];
} {
  const byIdentity = new Map<string, Record<string, unknown>>();
  const existingCloudKeys = new Set<string>();

  // 1. Seed byIdentity with EVERY existing committed cloud record
  for (const record of baseRecords) {
    const key = getEntityKey(record, datasetType);
    if (!key) continue;
    byIdentity.set(key, record);
    existingCloudKeys.add(key);
    for (const altKey of recordIdentityKeys(record)) {
      existingCloudKeys.add(altKey);
    }
  }

  const existingRecordsCount = byIdentity.size;

  // 2. Overlay incoming snapshot records from local projection (idempotent upsert)
  for (let idx = 0; idx < incomingSnapshot.length; idx++) {
    const raw = incomingSnapshot[idx];
    const sanitized = sanitizeRecordForStorage(
      raw,
      datasetType,
      getEntityKey(raw, datasetType) || `snap_${idx}`
    );
    const key = getEntityKey(sanitized, datasetType);
    if (!key) continue;

    if (byIdentity.has(key)) {
      // Idempotent append-safe merge: preserve existing cloud fields & layer newer non-empty data
      const existing = byIdentity.get(key)!;
      byIdentity.set(key, preserveNonEmptyMerge(existing, sanitized));
    } else {
      // Genuinely new record: append to collection
      byIdentity.set(key, sanitized);
    }
  }

  // 3. Process delta operations — STRICTLY APPEND-ONLY CLOUD RULE (2026)
  // Sync uploads must NEVER delete or overwrite prior committed cloud items in R2 or PostgreSQL.
  // Any DELETE operations in a client outbox only affect local browser state and must NOT prune
  // committed R2 cloud snapshots or historical archive records during sync/save-all.
  const deletedPlatformItemIds: string[] = [];
  for (const op of operations) {
    if (op.operationType === "DELETE") {
      // Preserve existing cloud item cleanly; outbox op still clears once committed.
      continue;
    }

    // UPSERT or APPEND: idempotent update or append
    const sanitized = sanitizeRecordForStorage(op.payload, datasetType, op.entityId);
    const key = getEntityKey(sanitized, datasetType) || op.entityId;
    if (byIdentity.has(key)) {
      const existing = byIdentity.get(key)!;
      byIdentity.set(key, preserveNonEmptyMerge(existing, sanitized));
    } else {
      byIdentity.set(key, sanitized);
    }
  }

  const finalRecords = Array.from(byIdentity.values());
  let addedRecordsCount = 0;
  let updatedRecordsCount = 0;

  for (const rec of finalRecords) {
    const key = getEntityKey(rec, datasetType);
    if (existingCloudKeys.has(key)) {
      updatedRecordsCount++;
    } else {
      addedRecordsCount++;
    }
  }

  return {
    records: finalRecords,
    existingRecordsCount,
    addedRecordsCount,
    updatedRecordsCount,
    deletedPlatformItemIds: [],
    deletedEntityIds: [],
  };
}

function mapEntityType(resourceType: ResourceType): "VIDEO" | "CHANNEL" | "PLAYLIST" {
  switch (resourceType) {
    case "CHANNEL":
      return "CHANNEL";
    case "YOUTUBE_PLAYLIST":
    case "USER_PLAYLIST":
      return "PLAYLIST";
    default:
      return "VIDEO";
  }
}

async function indexSavedItems(
  tx: Prisma.TransactionClient,
  params: {
    ownerId: string;
    datasetId: string;
    generationId: string;
    records: Record<string, unknown>[];
    originDeviceId: string | null;
    originDeviceLabel: string | null;
    deletedPlatformItemIds?: string[];
  }
): Promise<void> {
  const { txOwnerId, txDatasetId, txGenerationId } = {
    txOwnerId: params.ownerId,
    txDatasetId: params.datasetId,
    txGenerationId: params.generationId,
  };

  // Only remove items that were explicitly requested for deletion via DELETE operations.
  // NEVER delete items based on non-presence in a local client's snapshot!
  if (params.deletedPlatformItemIds && params.deletedPlatformItemIds.length > 0) {
    await tx.savedItemIndex.deleteMany({
      where: {
        owner_id: txOwnerId,
        platform_item_id: { in: params.deletedPlatformItemIds },
      },
    });
  }

  let position = 0;
  for (const record of params.records) {
    const platformItemId = readString(record, "platformItemId", "resourceId");
    if (!platformItemId) continue;

    const normalized = normalizeResourceRecord(record, { datasetType: "SAVED_ITEMS" });
    const resourceType = normalized.resourceType;
    const entityType = mapEntityType(resourceType);
    const savedAt =
      parseDate(record.savedAt) ||
      parseDate(record.createdAt) ||
      parseDate(record.collectedAt) ||
      new Date();
    const savedDate =
      readString(record, "savedDate") || savedAt.toISOString().slice(0, 10);

    const recordId = readString(record, "id", "recordId");
    const id = isUuid(recordId)
      ? recordId
      : toDatabaseUuid(`saved-item:${txOwnerId}:${entityType}:${platformItemId}`);

    const data = {
      owner_id: txOwnerId,
      entity_type: entityType,
      platform_item_id: platformItemId,
      title: readString(record, "title", "name") || "Untitled item",
      channel_title: readString(record, "channelTitle"),
      thumbnail_url: readString(record, "thumbnailUrl"),
      is_shorts_like: resourceType === "VIDEO_SHORT",
      is_age_restricted: record.isAgeRestricted === true,
      published_at: parseDate(record.publishedAt),
      views_count:
        readNumber(record, "viewsCount", "viewCount") !== null
          ? BigInt(readNumber(record, "viewsCount", "viewCount") as number)
          : null,
      likes_count:
        readNumber(record, "likesCount", "likeCount") !== null
          ? BigInt(readNumber(record, "likesCount", "likeCount") as number)
          : null,
      comments_count:
        readNumber(record, "commentsCount", "commentCount") !== null
          ? BigInt(readNumber(record, "commentsCount", "commentCount") as number)
          : null,
      duration_seconds: readNumber(record, "durationSeconds", "durationSec"),
      saved_at: savedAt,
      saved_date: savedDate,
      origin_device_id:
        readString(record, "originDeviceId") || params.originDeviceId,
      origin_device_label:
        readString(record, "originDeviceLabel") || params.originDeviceLabel,
      dataset_id: txDatasetId,
      generation_id: txGenerationId,
      item_position: position,
      resource_type: resourceType,
      resource_id: platformItemId,
    };

    await tx.savedItemIndex.upsert({
      where: {
        owner_id_entity_type_platform_item_id: {
          owner_id: txOwnerId,
          entity_type: entityType,
          platform_item_id: platformItemId,
        },
      },
      create: { id, ...data },
      update: data,
    });

    position += 1;
  }
}

async function indexReferences(
  tx: Prisma.TransactionClient,
  params: {
    ownerId: string;
    datasetId: string;
    generationId: string;
    manifestKey: string;
    records: Record<string, unknown>[];
    originDeviceId: string | null;
    originDeviceLabel: string | null;
    deletedIds?: string[];
  }
): Promise<void> {
  const referenceIds: string[] = [];
  const searchIds: string[] = [];

  let position = 0;
  for (const record of params.records) {
    const normalized = normalizeResourceRecord(record, { datasetType: "REFERENCES" });
    const recordId = normalized.recordId;
    if (!recordId) continue;

    const savedAt =
      parseDate(record.savedAt) || parseDate(record.createdAt) || new Date();
    const originDeviceId =
      readString(record, "originDeviceId") || params.originDeviceId;
    const originDeviceLabel =
      readString(record, "originDeviceLabel") || params.originDeviceLabel;

    if (normalized.resourceType === "SAVED_SEARCH") {
      const id = toDatabaseUuid(`saved-search:${params.ownerId}:${recordId}`);
      searchIds.push(recordId);

      // Persist full R2 generation provenance alongside canonical search preset metadata
      // so consolidated /saved-titles-links#saved-searches renders rich R2 Cloud cards.
      const data = {
        owner_id: params.ownerId,
        title: readString(record, "title", "name") || "Untitled search",
        query_text: readString(record, "query", "queryText") || "",
        notes: readString(record, "notes", "description"),
        search_settings: (record.settings as Prisma.InputJsonValue) ?? {},
        resource_selection:
          (record.resourceSelection as Prisma.InputJsonValue | undefined) ?? undefined,
        filter_snapshot:
          (record.filters as Prisma.InputJsonValue | undefined) ?? undefined,
        is_pinned: record.isPinned === true,
        tags: Array.isArray(record.tags)
          ? record.tags.filter((tag): tag is string => typeof tag === "string")
          : [],
        dataset_id: params.datasetId,
        generation_id: params.generationId,
        r2_manifest_key: params.manifestKey.slice(0, 1024),
        last_run_at: parseDate(record.lastRunAt) ?? undefined,
        record_id: recordId,
        resource_type: "SAVED_SEARCH",
        resource_id: readString(record, "resourceId") || recordId,
        origin_device_id: originDeviceId,
        origin_device_label: originDeviceLabel,
        saved_at: savedAt,
      };

      await tx.savedSearchPreset.upsert({
        where: { id },
        create: { id, ...data },
        update: data,
      });
    } else if (
      normalized.resourceType === "SAVED_TITLE" ||
      normalized.resourceType === "SAVED_LINK"
    ) {
      const id = toDatabaseUuid(`saved-reference:${params.ownerId}:${recordId}`);
      referenceIds.push(recordId);

      const data = {
        owner_id: params.ownerId,
        title: readString(record, "title", "name") || "Untitled reference",
        url: readString(record, "url", "canonicalUrl"),
        notes: readString(record, "notes", "description"),
        dataset_id: params.datasetId,
        generation_id: params.generationId,
        item_position: position,
        record_id: recordId,
        resource_type: normalized.resourceType,
        resource_id: readString(record, "resourceId") || recordId,
        tags: Array.isArray(record.tags)
          ? record.tags.filter((tag): tag is string => typeof tag === "string")
          : [],
        is_pinned: record.isPinned === true,
        r2_manifest_key: params.manifestKey.slice(0, 1024),
        origin_device_id: originDeviceId,
        origin_device_label: originDeviceLabel,
        saved_at: savedAt,
      };

      await tx.savedReference.upsert({
        where: { id },
        create: { id, ...data },
        update: data,
      });
    }

    position += 1;
  }

  // Preserve existing PostgreSQL projection rows unless explicitly tombstoned.
  // Never run blanket `deleteMany({ notIn })` or wipe all rows when the incoming array is empty,
  // because SAVED_SEARCH / SAVED_TITLE / SAVED_LINK projections share ownership with direct DB writes.
  if (params.deletedIds && params.deletedIds.length > 0) {
    const refUuids = params.deletedIds.map((rid) =>
      toDatabaseUuid(`saved-reference:${params.ownerId}:${rid}`)
    );
    const searchUuids = params.deletedIds.map((rid) =>
      toDatabaseUuid(`saved-search:${params.ownerId}:${rid}`)
    );

    await tx.savedReference.deleteMany({
      where: {
        owner_id: params.ownerId,
        dataset_id: params.datasetId,
        OR: [
          { record_id: { in: params.deletedIds } },
          { id: { in: refUuids } },
        ],
      },
    });

    await tx.savedSearchPreset.deleteMany({
      where: {
        owner_id: params.ownerId,
        OR: [
          { record_id: { in: params.deletedIds } },
          { id: { in: searchUuids } },
        ],
      },
    });
  }
}

async function indexPlaylists(
  tx: Prisma.TransactionClient,
  params: {
    ownerId: string;
    records: Record<string, unknown>[];
    deletedIds?: string[];
  }
): Promise<void> {
  const activePlaylistUuids: string[] = [];

  for (let pIdx = 0; pIdx < params.records.length; pIdx++) {
    const rec = params.records[pIdx];
    const playlistMeta =
      rec.playlist && typeof rec.playlist === "object"
        ? (rec.playlist as Record<string, unknown>)
        : rec;
    const rawId = readString(playlistMeta, "id", "recordId") || readString(rec, "id", "recordId");
    if (!rawId) continue;

    const playlistUuid = toPlaylistUuid(rawId);
    activePlaylistUuids.push(playlistUuid);

    const groups = Array.isArray(rec.groups)
      ? (rec.groups as Array<Record<string, unknown>>)
      : [];
    const items = Array.isArray(rec.items)
      ? (rec.items as Array<Record<string, unknown>>)
      : [];

    const thumbnails: string[] = [];
    for (const it of items) {
      const snap = it.snapshot as Record<string, unknown> | undefined;
      const thumb = snap ? readString(snap, "thumbnailUrl") : null;
      if (thumb && !thumbnails.includes(thumb) && thumbnails.length < 4) {
        thumbnails.push(thumb);
      }
    }

    const title = (readString(playlistMeta, "name", "title") || "Untitled Playlist").slice(0, 255);
    const description = readString(playlistMeta, "description");
    const createdAt = parseDate(playlistMeta.createdAt) || new Date();
    const updatedAt = parseDate(playlistMeta.updatedAt) || new Date();

    const isUuidPlaylistId = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(rawId);

    await tx.userPlaylist.upsert({
      where: { owner_id_id: { owner_id: params.ownerId, id: playlistUuid } },
      create: {
        id: playlistUuid,
        owner_id: params.ownerId,
        title,
        description,
        display_order: pIdx,
        total_items_count: items.length,
        thumbnail_urls: thumbnails,
        created_at: createdAt,
        updated_at: updatedAt,
        record_id: rawId.slice(0, 128),
      },
      update: {
        title,
        description,
        display_order: pIdx,
        total_items_count: items.length,
        thumbnail_urls: thumbnails,
        updated_at: updatedAt,
        // Preserve canonical client ID (e.g. `upl_*`) when syncing across devices.
        ...(isUuidPlaylistId ? {} : { record_id: rawId.slice(0, 128) }),
      },
    });

    const activeGroupUuids: string[] = [];
    for (let gIdx = 0; gIdx < groups.length; gIdx++) {
      const g = groups[gIdx];
      const gId = readString(g, "id");
      if (!gId) continue;
      const gUuid = toGroupUuid(gId);
      activeGroupUuids.push(gUuid);
      const gTitle = (readString(g, "title", "name") || "Section").slice(0, 255);
      const gNotes = readString(g, "description", "notes");
      const gPos = typeof g.position === "number" ? g.position : gIdx;

      await tx.userPlaylistGroup.upsert({
        where: { playlist_id_id: { playlist_id: playlistUuid, id: gUuid } },
        create: {
          id: gUuid,
          owner_id: params.ownerId,
          playlist_id: playlistUuid,
          title: gTitle,
          notes: gNotes,
          position: gPos,
          is_collapsed: Boolean(g.isCollapsed),
          created_at: parseDate(g.createdAt) || createdAt,
          updated_at: parseDate(g.updatedAt) || updatedAt,
          record_id: gId.slice(0, 128),
        },
        update: {
          title: gTitle,
          notes: gNotes,
          position: gPos,
          is_collapsed: Boolean(g.isCollapsed),
          updated_at: parseDate(g.updatedAt) || updatedAt,
          record_id: gId.slice(0, 128),
        },
      });
    }

    await tx.userPlaylistGroup.deleteMany({
      where: {
        owner_id: params.ownerId,
        playlist_id: playlistUuid,
        ...(activeGroupUuids.length > 0 ? { id: { notIn: activeGroupUuids } } : {}),
      },
    });

    const activeEntryUuids: string[] = [];
    for (let eIdx = 0; eIdx < items.length; eIdx++) {
      const it = items[eIdx];
      const entryId = readString(it, "entryId", "id");
      if (!entryId) continue;
      const entryUuid = toEntryUuid(entryId);
      activeEntryUuids.push(entryUuid);

      const rawGroupId = readString(it, "groupId");
      const mappedGroupUuid = rawGroupId ? toGroupUuid(rawGroupId) : null;
      const validGroupUuid =
        mappedGroupUuid && activeGroupUuids.includes(mappedGroupUuid) ? mappedGroupUuid : null;

      const isYoutube = it.kind === "youtube";
      const yKind = readString(it, "youtubeKind");
      let entityType: "VIDEO" | "CHANNEL" | "PLAYLIST" | "CUSTOM" = "CUSTOM";
      if (isYoutube) {
        if (yKind === "channel") entityType = "CHANNEL";
        else if (yKind === "youtube_playlist") entityType = "PLAYLIST";
        else entityType = "VIDEO";
      }

      const snap = (it.snapshot as Record<string, unknown> | undefined) ?? undefined;
      const platformItemId = isYoutube && snap ? readString(snap, "platformItemId") : null;
      const customTitle = isYoutube ? null : (readString(it, "title") || "").slice(0, 512) || null;
      const customUrl = (isYoutube && snap ? readString(snap, "url") : readString(it, "url"))?.slice(0, 1024) ?? null;
      const notes = readString(it, "customNote", "note");
      const pos = typeof it.position === "number" ? it.position : eIdx;
      const snapshotJson = (
        isYoutube
          ? {
              kind: "youtube",
              youtubeKind: yKind || "video",
              snapshot: snap ?? null,
              note: readString(it, "note"),
            }
          : {
              kind: "custom",
              customNote: readString(it, "customNote"),
              note: readString(it, "note"),
            }
      ) as Prisma.InputJsonValue;

      await tx.userPlaylistEntry.upsert({
        where: { id: entryUuid },
        create: {
          id: entryUuid,
          owner_id: params.ownerId,
          playlist_id: playlistUuid,
          group_id: validGroupUuid,
          entity_type: entityType,
          platform_item_id: platformItemId?.slice(0, 64) ?? null,
          custom_title: customTitle,
          custom_url: customUrl,
          notes,
          position: pos,
          added_at: parseDate(it.addedAt) || new Date(),
          record_id: entryId.slice(0, 128),
          snapshot_json: snapshotJson,
        },
        update: {
          group_id: validGroupUuid,
          entity_type: entityType,
          platform_item_id: platformItemId?.slice(0, 64) ?? null,
          custom_title: customTitle,
          custom_url: customUrl,
          notes,
          position: pos,
          record_id: entryId.slice(0, 128),
          snapshot_json: snapshotJson,
        },
      });
    }

    await tx.userPlaylistEntry.deleteMany({
      where: {
        owner_id: params.ownerId,
        playlist_id: playlistUuid,
        ...(activeEntryUuids.length > 0 ? { id: { notIn: activeEntryUuids } } : {}),
      },
    });
  }

  // Only delete explicitly tombstoned playlists (never wipe unrepresented DB rows).
  const deletePlaylistIds = (params.deletedIds || []).map((id) => toPlaylistUuid(id));
  if (deletePlaylistIds.length > 0) {
    await tx.userPlaylistEntry.deleteMany({
      where: {
        owner_id: params.ownerId,
        playlist_id: { in: deletePlaylistIds },
      },
    });
    await tx.userPlaylistGroup.deleteMany({
      where: {
        owner_id: params.ownerId,
        playlist_id: { in: deletePlaylistIds },
      },
    });
    await tx.userPlaylist.deleteMany({
      where: {
        owner_id: params.ownerId,
        id: { in: deletePlaylistIds },
      },
    });
  }
}

async function indexResearchQueue(
  tx: Prisma.TransactionClient,
  params: {
    ownerId: string;
    datasetId: string;
    generationId: string;
    records: Record<string, unknown>[];
    deletedIds?: string[];
  }
): Promise<void> {
  let pos = 0;

  for (const record of params.records) {
    const rawId = readString(record, "id", "recordId");
    const queryText = (readString(record, "query", "queryText", "title") || "").slice(0, 512);
    if (!rawId || !queryText) continue;

    const id = toDatabaseUuid(`research-queue:${params.ownerId}:${rawId}`);

    const rawStatus = (readString(record, "status") || "PENDING").toUpperCase();
    const status: "PENDING" | "REVIEWED" | "DISMISSED" =
      rawStatus === "REVIEWED" || rawStatus === "DISMISSED" ? rawStatus : "PENDING";

    const data = {
      owner_id: params.ownerId,
      query_text: queryText,
      source_origin: (readString(record, "sourceOrigin", "source") || "workspace").slice(0, 64),
      source_entity_id: readString(record, "sourceEntityId", "platformItemId")?.slice(0, 64) ?? null,
      status,
      priority: readNumber(record, "priority") ?? 0,
      dataset_id: params.datasetId,
      generation_id: params.generationId,
      item_position: pos++,
      queued_at: parseDate(record.queuedAt) || parseDate(record.createdAt) || new Date(),
      reviewed_at: parseDate(record.reviewedAt),
    };

    await tx.researchQueueItem.upsert({
      where: { id },
      create: { id, ...data },
      update: data,
    });
  }

  // Only delete explicitly tombstoned research queue items (never wipe all rows).
  const deletedQueueIds = params.deletedIds || [];
  if (deletedQueueIds.length > 0) {
    const deletedQueueUuids = deletedQueueIds.map((rawId) =>
      toDatabaseUuid(`research-queue:${params.ownerId}:${rawId}`)
    );
    await tx.researchQueueItem.deleteMany({
      where: {
        owner_id: params.ownerId,
        dataset_id: params.datasetId,
        OR: [
          { id: { in: deletedQueueUuids } },
          { source_entity_id: { in: deletedQueueIds } },
        ],
      },
    });
  }
}

/**
 * Compatibility helper matching search-storage-archive's historical UUID layout
 * so canonical save-all upserts never create duplicate search_history_records rows.
 */
function toLegacyArchiveHistoryUuid(seed: string): string {
  const hex = crypto.createHash("sha256").update(seed, "utf8").digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

async function indexSearchHistory(
  tx: Prisma.TransactionClient,
  params: {
    ownerId: string;
    generationId: string;
    manifestKey: string;
    records: Record<string, unknown>[];
    deletedIds?: string[];
  }
): Promise<void> {
  for (const record of params.records) {
    const rawId = readString(record, "id", "recordId");
    const queryText = (readString(record, "query", "queryText") || "").slice(0, 512);
    if (!rawId || !queryText) continue;

    const v5Uuid = toDatabaseUuid(`search-history:${params.ownerId}:${rawId}`);
    const v4ArchiveUuid = toLegacyArchiveHistoryUuid(`search-history:${params.ownerId}:${rawId}`);
    const manifestId = (readString(record, "manifestId") || rawId).slice(0, 64);

    // Resolve any existing PostgreSQL archive row first (created via either /api/search-storage
    // or a previous /api/sync/save-all run) so metadata upgrades never duplicate rows or drop manifest payloads.
    const existing = await tx.searchHistoryRecord.findFirst({
      where: {
        owner_id: params.ownerId,
        OR: [
          { record_id: rawId.slice(0, 128) },
          { id: v5Uuid },
          { id: v4ArchiveUuid },
          { manifest_id: manifestId },
        ],
      },
      select: {
        id: true,
        raw_payload_json: true,
        is_pinned: true,
      },
    });

    const targetId = existing?.id ?? v5Uuid;
    const existingRaw =
      existing?.raw_payload_json && typeof existing.raw_payload_json === "object"
        ? (existing.raw_payload_json as Record<string, unknown>)
        : null;

    const topThumbnails = Array.isArray(record.topThumbnails)
      ? record.topThumbnails
          .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
          .slice(0, 8)
      : [];

    const resultsCount = Math.max(
      0,
      Math.floor(readNumber(record, "resultsCount", "resultCount", "itemCount") ?? 0)
    );
    const title = (readString(record, "title") || queryText).slice(0, 512);
    const status = (readString(record, "status") || (resultsCount === 0 ? "empty" : "complete")).slice(0, 32);

    const mergedRawPayload: Record<string, unknown> = {
      ...(existingRaw ?? {}),
      id: rawId,
      recordId: rawId,
      title,
      query: queryText,
      resourceSelection: record.resourceSelection ?? existingRaw?.resourceSelection ?? "ALL",
      settings: (record.settings as Record<string, unknown> | undefined) ?? existingRaw?.settings ?? {},
      resultsCount,
      videoCount: Math.max(0, Math.floor(readNumber(record, "videoCount") ?? 0)),
      channelCount: Math.max(0, Math.floor(readNumber(record, "channelCount") ?? 0)),
      playlistCount: Math.max(0, Math.floor(readNumber(record, "playlistCount") ?? 0)),
      topThumbnails,
      quotaCostEstimate: Math.max(
        0,
        Math.floor(readNumber(record, "quotaUnits", "quotaCostEstimate") ?? 100)
      ),
      status,
      timestamp:
        readString(record, "timestamp", "executedAt", "createdAt") ||
        (typeof existingRaw?.createdAt === "string" ? existingRaw.createdAt : new Date().toISOString()),
      manifestId,
    };

    const data = {
      owner_id: params.ownerId,
      title,
      query_text: queryText,
      status,
      search_settings: (record.settings as Prisma.InputJsonValue) ?? {},
      result_count: resultsCount,
      video_count: Math.max(0, Math.floor(readNumber(record, "videoCount") ?? 0)),
      channel_count: Math.max(0, Math.floor(readNumber(record, "channelCount") ?? 0)),
      playlist_count: Math.max(0, Math.floor(readNumber(record, "playlistCount") ?? 0)),
      top_thumbnails_json: topThumbnails as Prisma.InputJsonValue,
      quota_units_consumed: Math.max(
        0,
        Math.floor(readNumber(record, "quotaUnits", "quotaCostEstimate") ?? 100)
      ),
      manifest_id: manifestId,
      generation_id: params.generationId,
      r2_manifest_key: params.manifestKey.slice(0, 1024),
      is_pinned: record.isPinned === true || existing?.is_pinned === true,
      record_id: rawId.slice(0, 128),
      resource_selection: (record.resourceSelection as Prisma.InputJsonValue | undefined) ?? "ALL",
      filter_snapshot: (record.filters as Prisma.InputJsonValue | undefined) ?? undefined,
      raw_payload_json: mergedRawPayload as Prisma.InputJsonValue,
      executed_at:
        parseDate(record.timestamp) ||
        parseDate(record.executedAt) ||
        parseDate(record.createdAt) ||
        new Date(),
    };

    await tx.searchHistoryRecord.upsert({
      where: { id: targetId },
      create: { id: targetId, ...data },
      update: data,
    });
  }

  // Only delete explicitly tombstoned history records (never wipe all rows).
  const deletedHistoryIds = params.deletedIds || [];
  if (deletedHistoryIds.length > 0) {
    const deletedHistoryUuids = deletedHistoryIds.flatMap((rawId) => [
      toDatabaseUuid(`search-history:${params.ownerId}:${rawId}`),
      toLegacyArchiveHistoryUuid(`search-history:${params.ownerId}:${rawId}`),
    ]);
    await tx.searchHistoryRecord.deleteMany({
      where: {
        owner_id: params.ownerId,
        OR: [
          { id: { in: deletedHistoryUuids } },
          { record_id: { in: deletedHistoryIds } },
          { manifest_id: { in: deletedHistoryIds } },
        ],
      },
    });
  }
}

export async function POST(request: Request) {
  const originError = assertSameOrigin(request);
  if (originError) return originError;

  const auth = await requireAdmin(request);
  if (!auth.ok) return auth.response;

  const storageOwnerUuid = requireStorageOwnerId(auth.admin);
  const profileIdFromAuth = resolveProfileId(auth.admin);
  const r2Client = getR2WorkerStorageClient();

  try {
    const contentLength = Number(request.headers.get("content-length") || 0);
    if (contentLength > MAX_REQUEST_BYTES) {
      return NextResponse.json(
        {
          ok: false,
          error: `Request body exceeds the ${MAX_REQUEST_BYTES} byte limit. Reduce the snapshot size or split the sync batch.`,
        },
        { status: 413 }
      );
    }

    const rawBody = await request.text();
    if (Buffer.byteLength(rawBody, "utf8") > MAX_REQUEST_BYTES) {
      return NextResponse.json(
        { ok: false, error: "Request body exceeds the allowed limit." },
        { status: 413 }
      );
    }

    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(rawBody);
    } catch {
      return NextResponse.json({ ok: false, error: "Malformed JSON request body." }, { status: 400 });
    }

    const parsed = SaveAllBodySchema.safeParse(parsedJson);
    if (!parsed.success) {
      return NextResponse.json(
        {
          ok: false,
          error: "Invalid synchronization payload.",
          issues: parsed.error.issues.map((issue) => ({
            path: issue.path.join("."),
            message: issue.message,
          })),
        },
        { status: 422 }
      );
    }

    const body = parsed.data;
    const batchId =
      body.batchId || `batch_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`;

    // Resolve the authoritative profile. There is no shared demo fallback.
    const profile = await prisma.userProfile.findFirst({
      where: {
        OR: [
          { storage_owner_uuid: storageOwnerUuid },
          ...(profileIdFromAuth ? [{ id: profileIdFromAuth }] : []),
          ...(auth.admin.userId ? [{ auth_user_id: auth.admin.userId }] : []),
        ],
      },
    });

    if (!profile) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "Authoritative storage owner profile was not found. Refusing to acknowledge changes that were not persisted.",
        },
        { status: 500 }
      );
    }

    const requestSha256 = crypto.createHash("sha256").update(rawBody).digest("hex");
    const results: DatasetSyncResult[] = [];

    for (const datasetInput of body.datasets) {
      const datasetType = datasetInput.datasetType;
      const operations = datasetInput.operations;

      const batchOriginDeviceId =
        datasetInput.originDeviceId || body.originDeviceId || null;
      const batchOriginDeviceLabel =
        datasetInput.originDeviceLabel || body.originDeviceLabel || null;

      // Find or create the logical dataset. Creating an empty dataset row
      // before upload is safe and gives every manifest a real dataset UUID.
      let dataset = await prisma.storageDataset.findFirst({
        where: { owner_id: profile.id, dataset_type: datasetType },
      });

      if (!dataset) {
        dataset = await prisma.storageDataset.create({
          data: {
            owner_id: profile.id,
            dataset_type: datasetType,
            display_name: `User ${datasetType}`,
            current_revision: BigInt(0),
          },
        });
      }

      // Optimistic revision handling & automatic non-destructive rebase:
      // If the client's expectedRevision is behind a newer server revision (baseRevision > expectedRevision),
      // mergeCloudAndIncomingRecords automatically rebases incoming items onto the latest committed base snapshot,
      // guaranteeing zero data loss. If baseRevision is 0 or expectedRevision >= baseRevision, no conflict exists.
      const baseRevision = Number(dataset.current_revision);
      if (
        datasetInput.expectedRevision !== undefined &&
        baseRevision > 0 &&
        datasetInput.expectedRevision < baseRevision
      ) {
        console.info(
          `[sync/save-all] Auto-rebasing dataset ${datasetType}: client expected rev ${datasetInput.expectedRevision}, server at rev ${baseRevision}. Proceeding with non-destructive merge onto latest committed cloud base.`
        );
      }

      // Idempotent replay: a committed batch with the same key is returned
      // without re-uploading or creating another generation.
      const existingBatch = await prisma.saveSyncBatch.findUnique({
        where: {
          owner_id_dataset_id_idempotency_key: {
            owner_id: profile.id,
            dataset_id: dataset.id,
            idempotency_key: datasetInput.idempotencyKey,
          },
        },
        include: {
          generations: {
            include: { parts: { orderBy: { part_number: "asc" } } },
          },
        },
      });

      if (existingBatch && existingBatch.state === "COMMITTED") {
        const generation = existingBatch.generations[0];
        results.push({
          datasetType,
          datasetId: dataset.id,
          generationId: generation?.id || "",
          revision: Number(existingBatch.committed_revision ?? baseRevision),
          recordsCount: generation?.total_records ?? 0,
          existingRecordsCount: generation?.total_records ?? 0,
          addedRecordsCount: 0,
          partsCount: generation?.total_parts ?? 0,
          bytesUploaded: Number(generation?.total_bytes ?? 0),
          aggregateSha256: generation?.aggregate_sha256 || "",
          verifiedCount: generation?.parts.length ?? 0,
          partPaths: generation?.parts.map((p) => p.storage_path) ?? [],
          resourceTypeCounts: {},
          syncedOperationIds: operations.map((op) => op.operationId),
          syncedEntityIds: operations.map((op) => op.entityId),
          idempotentReplay: true,
          versionPointerStatus: "DEFERRED",
        });
        continue;
      }

      // Build the full snapshot with GUARANTEED append-only persistence.
      // Load all previously committed cloud records so that new local items are
      // added/appended, and existing cloud items are NEVER deleted or overwritten.
      let baseRecords: Record<string, unknown>[] = [];
      try {
        baseRecords = await loadCommittedSnapshot({
          ownerId: profile.id,
          datasetId: dataset.id,
          currentGenerationId: dataset.current_generation_id,
          storageOwnerUuid,
          datasetType,
        });
      } catch (baseErr) {
        console.error(
          `[sync/save-all] Failed to load committed snapshot for ${datasetType}:`,
          baseErr
        );
        throw new StageSyncError(
          `Unable to load existing cloud records for ${datasetType} to guarantee append-only preservation: ${
            baseErr instanceof Error ? baseErr.message : String(baseErr)
          }`,
          "R2_VERIFICATION_ERROR",
          "SYNCING",
          500
        );
      }

      // Merge existing cloud records with new incoming items:
      // Existing Cloud Items + New Local Items -> Append / Add / Idempotent Upsert -> Updated Cloud Collection
      const mergedSnapshot = mergeCloudAndIncomingRecords(
        baseRecords,
        datasetInput.snapshotRecords || [],
        operations,
        datasetType
      );

      const snapshotRecords = mergedSnapshot.records;

      // Validate every record before any upload. Invalid records fail closed.
      const invalidRecords: Array<{ index: number; recordId: string; errors: string[] }> = [];
      for (let index = 0; index < snapshotRecords.length; index += 1) {
        const record = snapshotRecords[index];
        const validation = validateResourceRecord(record, { datasetType });
        if (!validation.valid) {
          invalidRecords.push({
            index,
            recordId: readString(record, "recordId", "id") || "",
            errors: validation.errors,
          });
        }
      }

      if (invalidRecords.length > 0) {
        return NextResponse.json(
          {
            ok: false,
            error: "One or more records violate the canonical resource contract.",
            code: "INVALID_RESOURCE_RECORDS",
            datasetType,
            invalidRecords: invalidRecords.slice(0, 50),
            invalidCount: invalidRecords.length,
          },
          { status: 422 }
        );
      }

      const generationId = crypto.randomUUID();
      const generationNumber = baseRevision + 1;

      // Immutable generation content. `datasetId` is the real dataset UUID and
      // `datasetType` drives the canonical path slug.
      const generationDesc = partitionRecordsIntoManifestParts({
        datasetId: dataset.id,
        datasetType,
        ownerId: profile.id,
        storageOwnerUuid,
        generationId,
        records: snapshotRecords,
        createdAt: new Date().toISOString(),
      });

      const manifestKey = buildGenerationManifestPath(
        storageOwnerUuid,
        datasetType,
        generationId
      );

      const manifestPayload = {
        $schema: "https://youtube-discovery.app/schemas/dataset-manifest-v2.json",
        schemaVersion: 2,
        resourceSchemaVersion: 2,
        datasetType,
        datasetId: dataset.id,
        ownerId: profile.id,
        storageOwnerUuid,
        generationId,
        generationNumber,
        totalParts: generationDesc.parts.length,
        totalRecords: generationDesc.totalRecords,
        totalBytes: generationDesc.totalBytes,
        aggregateSha256: generationDesc.aggregateSha256,
        resourceTypeCounts: generationDesc.resourceTypeCounts,
        committedAt: new Date().toISOString(),
        originDeviceId: batchOriginDeviceId,
        originDeviceLabel: batchOriginDeviceLabel,
        parts: generationDesc.parts.map((part) => {
          const envelope = JSON.parse(part.rawJson) as {
            resourceTypeCounts?: Partial<Record<ResourceType, number>>;
          };
          return {
            partNumber: part.partNumber,
            storagePath: part.storagePath,
            byteCount: part.byteCount,
            recordCount: part.recordCount,
            sha256: part.sha256,
            resourceTypeCounts: envelope.resourceTypeCounts || {},
          };
        }),
      };

      const manifestJson = JSON.stringify(manifestPayload, null, 2);
      const manifestSha256 = crypto
        .createHash("sha256")
        .update(manifestJson)
        .digest("hex");

      const uploadItems = [
        {
          key: manifestKey,
          data: manifestJson,
          contentType: "application/json",
          sha256: manifestSha256,
        },
        ...generationDesc.parts.map((part) => ({
          key: part.storagePath,
          data: part.rawJson,
          contentType: "application/json",
          sha256: part.sha256,
        })),
      ];

      // Upload immutable objects only. The version pointer is written after
      // the database commit so it can never advertise an uncommitted state.
      let uploadResult;
      try {
        uploadResult = await r2Client.uploadBatch(batchId, datasetType, uploadItems, {
          storageOwnerUuid,
          targetPrefix: `asdy/persistence/${storageOwnerUuid}`,
        });
      } catch (uploadErr) {
        const msg = uploadErr instanceof Error ? uploadErr.message : String(uploadErr);
        const cls = classifyHttpOrErrorCategory({ message: msg });
        const category =
          cls.errorCategory === "DATABASE_COMMIT_ERROR" ? "R2_UPLOAD_ERROR" : cls.errorCategory;
        throw new StageSyncError(
          `R2 batch upload failed for ${datasetType}: ${msg}`,
          category,
          "SYNCING",
          502
        );
      }

      if (uploadResult.uploadedCount !== uploadItems.length) {
        throw new StageSyncError(
          `R2 batch upload acknowledged ${uploadResult.uploadedCount} of ${uploadItems.length} objects for ${datasetType}.`,
          "GENERATION_INCOMPLETE",
          "UPLOADED_UNVERIFIED",
          502
        );
      }

      let verification;
      try {
        verification = await r2Client.verifyBatch(batchId, uploadItems, {
          storageOwnerUuid,
          targetPrefix: `asdy/persistence/${storageOwnerUuid}`,
        });
      } catch (verifyErr) {
        const msg = verifyErr instanceof Error ? verifyErr.message : String(verifyErr);
        throw new StageSyncError(
          `R2 verification request failed for ${datasetType}: ${msg}`,
          "R2_VERIFICATION_ERROR",
          "UPLOADED_UNVERIFIED",
          502
        );
      }

      if (!verification.ok) {
        const hasChecksumFailure = verification.failures.some((f) =>
          f.reason.includes("sha256")
        );
        throw new StageSyncError(
          `R2 verification failed for ${verification.failedCount} object(s): ${verification.failures
            .map((failure) => `${failure.key} (${failure.reason})`)
            .join(", ")}`,
          hasChecksumFailure ? "CHECKSUM_MISMATCH" : "R2_VERIFICATION_ERROR",
          "UPLOADED_UNVERIFIED",
          502
        );
      }

      // PostgreSQL commit gate. Nothing is acknowledged before this succeeds.
      try {
        await prisma.$transaction(async (tx) => {
          const syncBatch = await tx.saveSyncBatch.create({
            data: {
              owner_id: profile.id,
              dataset_id: dataset.id,
              idempotency_key: datasetInput.idempotencyKey,
              request_sha256: requestSha256,
              expected_revision: BigInt(baseRevision),
              committed_revision: BigInt(generationNumber),
              origin_device_id: batchOriginDeviceId,
              origin_device_label: batchOriginDeviceLabel,
              state: "COMMITTED",
              completed_at: new Date(),
            },
          });

          await tx.storageGeneration.create({
            data: {
              // The DB generation id and the R2 generation id are the SAME UUID.
              // This keeps generation identity consistent across every layer.
              id: generationId,
              owner_id: profile.id,
              dataset_id: dataset.id,
              source_batch_id: syncBatch.id,
              parent_generation_id: dataset.current_generation_id || null,
              generation_number: generationNumber,
              state: "COMMITTED",
              total_parts: generationDesc.parts.length,
              total_records: generationDesc.totalRecords,
              total_bytes: BigInt(generationDesc.totalBytes),
              aggregate_sha256: generationDesc.aggregateSha256,
              origin_device_id: batchOriginDeviceId,
              origin_device_label: batchOriginDeviceLabel,
              committed_at: new Date(),
            },
          });

          for (const part of generationDesc.parts) {
            await tx.storageManifestPart.create({
              data: {
                owner_id: profile.id,
                dataset_id: dataset.id,
                generation_id: generationId,
                part_number: part.partNumber,
                storage_path: part.storagePath,
                bucket_id: "new-youtube-discovery-private",
                byte_count: BigInt(part.byteCount),
                record_count: part.recordCount,
                sha256: part.sha256,
              },
            });
          }

          // Optimistic concurrency gate: only one writer may advance from the
          // same base revision. If another device won, the whole transaction
          // (including batch/generation rows) rolls back.
          const advanced = await tx.storageDataset.updateMany({
            where: {
              id: dataset.id,
              owner_id: profile.id,
              current_revision: BigInt(baseRevision),
            },
            data: {
              current_revision: BigInt(generationNumber),
              current_generation_id: generationId,
            },
          });

          if (advanced.count !== 1) {
            const fresh = await tx.storageDataset.findUnique({
              where: { id: dataset.id },
              select: { current_revision: true },
            });
            throw new RevisionConflictError(Number(fresh?.current_revision ?? baseRevision));
          }

          if (datasetType === "SAVED_ITEMS") {
            await indexSavedItems(tx, {
              ownerId: profile.id,
              datasetId: dataset.id,
              generationId,
              records: snapshotRecords,
              originDeviceId: batchOriginDeviceId,
              originDeviceLabel: batchOriginDeviceLabel,
              deletedPlatformItemIds: mergedSnapshot.deletedPlatformItemIds,
            });
          } else if (datasetType === "REFERENCES") {
            await indexReferences(tx, {
              ownerId: profile.id,
              datasetId: dataset.id,
              generationId,
              manifestKey,
              records: snapshotRecords,
              originDeviceId: batchOriginDeviceId,
              originDeviceLabel: batchOriginDeviceLabel,
              deletedIds: mergedSnapshot.deletedEntityIds,
            });
          } else if (datasetType === "PLAYLIST") {
            await indexPlaylists(tx, {
              ownerId: profile.id,
              records: snapshotRecords,
              deletedIds: mergedSnapshot.deletedEntityIds,
            });
          } else if (datasetType === "RESEARCH_QUEUE") {
            await indexResearchQueue(tx, {
              ownerId: profile.id,
              datasetId: dataset.id,
              generationId,
              records: snapshotRecords,
              deletedIds: mergedSnapshot.deletedEntityIds,
            });
          } else if (datasetType === "SEARCH_HISTORY") {
            await indexSearchHistory(tx, {
              ownerId: profile.id,
              generationId,
              manifestKey,
              records: snapshotRecords,
              deletedIds: mergedSnapshot.deletedEntityIds,
            });
          }

          // Workstream 1 & 5: Supabase Audit Synchronization
          // Documents each successfully completed cloud synchronization operation in audit_logs
          try {
            await tx.auditLog.create({
              data: {
                actor_profile_id: profile.id,
                subject_owner_id: profile.id,
                action: "CLOUD_SYNC_COMMIT",
                entity_type: datasetType,
                entity_id: syncBatch.id,
                details: {
                  batchId,
                  idempotencyKey: datasetInput.idempotencyKey,
                  generationId,
                  generationNumber,
                  bucket: "new-youtube-discovery-private",
                  manifestPath: manifestKey,
                  aggregateSha256: generationDesc.aggregateSha256,
                  totalRecords: generationDesc.totalRecords,
                  newRecordsAdded: mergedSnapshot.addedRecordsCount,
                  existingRecordsPreserved: mergedSnapshot.existingRecordsCount,
                  syncedOperationIds: operations.map((op) => op.operationId),
                  syncedEntityIds: operations.map((op) => op.entityId),
                  originDeviceId: batchOriginDeviceId,
                  schemaVersion: 2,
                },
              },
            });
          } catch (auditErr) {
            console.warn("[sync/save-all] Supabase audit log record note:", auditErr);
          }
        });
      } catch (dbErr) {
        if (dbErr instanceof RevisionConflictError) throw dbErr;
        const msg = dbErr instanceof Error ? dbErr.message : String(dbErr);
        throw new StageSyncError(
          `Database commit failed after R2 upload (${datasetType} rev ${generationNumber}): ${msg}. Local changes remain queued safely.`,
          "DATABASE_COMMIT_ERROR",
          "DATABASE_COMMITTING",
          500
        );
      }

      // Version pointer is a convenience read index. The database is already
      // authoritative; a pointer failure is reported but does not invalidate
      // the committed generation.
      let versionPointerStatus: DatasetSyncResult["versionPointerStatus"] = "DEFERRED";
      try {
        const versionKey = buildDatasetVersionPointerPath(storageOwnerUuid, datasetType);
        const versionPayload = {
          $schema: "https://youtube-discovery.app/schemas/dataset-version-v2.json",
          schemaVersion: 2,
          datasetType,
          datasetId: dataset.id,
          ownerId: profile.id,
          storageOwnerUuid,
          currentGenerationId: generationId,
          currentRevision: generationNumber,
          aggregateSha256: generationDesc.aggregateSha256,
          totalRecords: generationDesc.totalRecords,
          resourceTypeCounts: generationDesc.resourceTypeCounts,
          lastSyncedAt: new Date().toISOString(),
        };
        const versionJson = JSON.stringify(versionPayload, null, 2);
        await r2Client.putObject("NEW", versionKey, Buffer.from(versionJson, "utf8"), {
          contentType: "application/json",
          storageOwnerUuid,
        });
        versionPointerStatus = "WRITTEN";
      } catch (pointerError) {
        versionPointerStatus = "FAILED";
        console.warn(
          `[sync/save-all] Generation ${generationId} committed, but version pointer update failed:`,
          pointerError
        );
      }

      results.push({
        datasetType,
        datasetId: dataset.id,
        generationId,
        revision: generationNumber,
        recordsCount: generationDesc.totalRecords,
        existingRecordsCount: mergedSnapshot.existingRecordsCount,
        addedRecordsCount: mergedSnapshot.addedRecordsCount,
        partsCount: generationDesc.parts.length,
        bytesUploaded: generationDesc.totalBytes,
        aggregateSha256: generationDesc.aggregateSha256,
        verifiedCount: verification.verifiedCount,
        manifestPath: manifestKey,
        partPaths: generationDesc.parts.map((p) => p.storagePath),
        resourceTypeCounts: generationDesc.resourceTypeCounts,
        syncedOperationIds: operations.map((op) => op.operationId),
        syncedEntityIds: operations.map((op) => op.entityId),
        idempotentReplay: false,
        versionPointerStatus,
      });
    }

    return NextResponse.json({
      ok: true,
      batchId,
      timestamp: new Date().toISOString(),
      storageOwnerUuid,
      syncedDatasetsCount: results.length,
      results,
    });
  } catch (error) {
    if (error instanceof RevisionConflictError) {
      return NextResponse.json(
        {
          ok: false,
          error: error.message,
          code: "REVISION_CONFLICT",
          errorCategory: "REVISION_CONFLICT",
          failedStage: "DATABASE_COMMITTING",
          currentRevision: error.currentRevision,
        },
        { status: 409 }
      );
    }

    if (error instanceof StageSyncError) {
      return NextResponse.json(
        {
          ok: false,
          error: error.message,
          code: error.errorCategory,
          errorCategory: error.errorCategory,
          failedStage: error.failedStage,
        },
        { status: error.httpStatus }
      );
    }

    console.error("[sync/save-all] Fatal error during sync:", error);
    const classified = classifyHttpOrErrorCategory({
      message: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      {
        ok: false,
        error:
          "Synchronization failed before the database commit completed. Local changes remain queued.",
        code: classified.errorCategory,
        errorCategory: classified.errorCategory,
        failedStage: classified.failedStage,
      },
      { status: 500 }
    );
  }
}
