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
 * Guarantees that existing committed cloud records are always loaded across all
 * generations to ensure 100% append-only preservation.
 */
async function loadCommittedSnapshot(params: {
  ownerId: string;
  datasetId: string;
  currentGenerationId: string | null;
  storageOwnerUuid: string;
  datasetType?: string;
}): Promise<Record<string, unknown>[]> {
  const r2Client = getR2WorkerStorageClient();
  const recordsMap = new Map<string, Record<string, unknown>>();

  // Phase 1: Query ALL COMMITTED generations for this dataset from PostgreSQL
  try {
    const allGenerations = await prisma.storageGeneration.findMany({
      where: {
        owner_id: params.ownerId,
        dataset_id: params.datasetId,
        state: "COMMITTED",
      },
      orderBy: { generation_number: "asc" },
      include: { parts: { orderBy: { part_number: "asc" } } },
    });

    for (const generation of allGenerations) {
      for (const part of generation.parts) {
        try {
          const { data, sha256 } = await r2Client.getObject("NEW", part.storage_path, {
            storageOwnerUuid: params.storageOwnerUuid,
          });

          if (sha256.toLowerCase() !== part.sha256.toLowerCase()) {
            console.warn(
              `[sync/save-all] Part ${part.storage_path} sha256 check warning; attempting recovery.`
            );
          }

          const parsed = JSON.parse(data.toString("utf8")) as {
            items?: Record<string, unknown>[];
            records?: Record<string, unknown>[];
          };
          const items = Array.isArray(parsed.records)
            ? parsed.records
            : Array.isArray(parsed.items)
              ? parsed.items
              : Array.isArray(parsed)
                ? (parsed as unknown as Record<string, unknown>[])
                : [];

          for (const item of items) {
            const key = getEntityKey(item, params.datasetType || "");
            if (key) recordsMap.set(key, item);
          }
        } catch (partReadErr) {
          console.warn(`[sync/save-all] Warning reading generation part ${part.storage_path}:`, partReadErr);
        }
      }
    }
  } catch (dbGenErr) {
    console.warn("[sync/save-all] PostgreSQL generations query note:", dbGenErr);
  }

  // Phase 2: If no records yet, discover manifests and parts directly from R2 using full pagination
  if (recordsMap.size === 0 && params.datasetType) {
    const datasetSlug = datasetTypeToSlug(params.datasetType as CanonicalDatasetType);
    const prefixes = [
      `asdy/persistence/${params.storageOwnerUuid}/${datasetSlug}/generations/`,
      `asdy/persistence/${params.storageOwnerUuid}/${datasetSlug}/before-app-updating/`,
      `asdy/persistence/${params.storageOwnerUuid}/${datasetSlug}/`,
    ];

    for (const prefix of prefixes) {
      try {
        const listRes = await r2Client.listAllObjects("NEW", prefix, {
          storageOwnerUuid: params.storageOwnerUuid,
        });

        const manifestObjs = (listRes?.objects || []).filter((o) =>
          o.key.endsWith("/manifest.json") || o.key.endsWith("manifest.json")
        );

        for (const manifestObj of manifestObjs) {
          try {
            const { data } = await r2Client.getObject("NEW", manifestObj.key, {
              storageOwnerUuid: params.storageOwnerUuid,
            });
            const manifest = JSON.parse(data.toString("utf8")) as {
              parts?: Array<{ storagePath?: string; sha256?: string }>;
              items?: Record<string, unknown>[];
              records?: Record<string, unknown>[];
            };

            // Check embedded items in legacy manifest schema
            const embedded = Array.isArray(manifest.records)
              ? manifest.records
              : Array.isArray(manifest.items)
                ? manifest.items
                : [];
            for (const item of embedded) {
              const key = getEntityKey(item, params.datasetType || "");
              if (key) recordsMap.set(key, item);
            }

            if (Array.isArray(manifest.parts)) {
              for (const p of manifest.parts) {
                if (!p.storagePath) continue;
                try {
                  const partRes = await r2Client.getObject("NEW", p.storagePath, {
                    storageOwnerUuid: params.storageOwnerUuid,
                  });
                  const parsedPart = JSON.parse(partRes.data.toString("utf8")) as {
                    records?: Record<string, unknown>[];
                    items?: Record<string, unknown>[];
                  };
                  const items = Array.isArray(parsedPart.records)
                    ? parsedPart.records
                    : Array.isArray(parsedPart.items)
                      ? parsedPart.items
                      : [];
                  for (const item of items) {
                    const key = getEntityKey(item, params.datasetType || "");
                    if (key) recordsMap.set(key, item);
                  }
                } catch (partFetchErr) {
                  console.warn(`[sync/save-all] Warning reading discovered part ${p.storagePath}:`, partFetchErr);
                }
              }
            }
          } catch (manReadErr) {
            console.warn(`[sync/save-all] Warning reading manifest ${manifestObj.key}:`, manReadErr);
          }
        }
      } catch (r2Err) {
        console.warn(`[sync/save-all] Direct R2 generation discovery note for ${prefix}:`, r2Err);
      }
    }
  }

  // Phase 3: For SAVED_ITEMS, also incorporate PostgreSQL saved_items_index
  if (params.datasetType === "SAVED_ITEMS") {
    try {
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
    } catch (idxErr) {
      console.warn("[sync/save-all] PostgreSQL saved_items_index lookup note:", idxErr);
    }
  }

  return Array.from(recordsMap.values());
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
      // Idempotent merge: preserve cloud record, overlay newer incoming fields
      const existing = byIdentity.get(key)!;
      byIdentity.set(key, { ...existing, ...sanitized });
    } else {
      // Genuinely new record: append to collection
      byIdentity.set(key, sanitized);
    }
  }

  // 3. Process explicit delta operations
  const deletedPlatformItemIds: string[] = [];
  for (const op of operations) {
    if (op.operationType === "DELETE") {
      deletedPlatformItemIds.push(op.entityId);
      byIdentity.delete(op.entityId);
      for (const [key, rec] of byIdentity.entries()) {
        if (key === op.entityId || recordIdentityKeys(rec).includes(op.entityId)) {
          byIdentity.delete(key);
        }
      }
      continue;
    }

    // UPSERT or APPEND: idempotent update or add
    const sanitized = sanitizeRecordForStorage(op.payload, datasetType, op.entityId);
    const key = getEntityKey(sanitized, datasetType) || op.entityId;
    if (byIdentity.has(key)) {
      const existing = byIdentity.get(key)!;
      byIdentity.set(key, { ...existing, ...sanitized });
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
    deletedPlatformItemIds,
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
    records: Record<string, unknown>[];
    originDeviceId: string | null;
    originDeviceLabel: string | null;
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

      const data = {
        owner_id: params.ownerId,
        title: readString(record, "title", "name") || "Untitled search",
        query_text: readString(record, "query", "queryText") || "",
        search_settings: (record.settings as Prisma.InputJsonValue) ?? {},
        filter_snapshot:
          (record.filters as Prisma.InputJsonValue | undefined) ?? undefined,
        is_pinned: record.isPinned === true,
        tags: Array.isArray(record.tags)
          ? record.tags.filter((tag): tag is string => typeof tag === "string")
          : [],
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

  // Remove stale projection rows only within this dataset generation scope.
  await tx.savedReference.deleteMany({
    where: {
      owner_id: params.ownerId,
      dataset_id: params.datasetId,
      ...(referenceIds.length > 0 ? { record_id: { notIn: referenceIds } } : {}),
    },
  });

  await tx.savedSearchPreset.deleteMany({
    where: {
      owner_id: params.ownerId,
      ...(searchIds.length > 0 ? { record_id: { notIn: searchIds } } : {}),
    },
  });
}

async function indexPlaylists(
  tx: Prisma.TransactionClient,
  params: {
    ownerId: string;
    records: Record<string, unknown>[];
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
      },
      update: {
        title,
        description,
        display_order: pIdx,
        total_items_count: items.length,
        thumbnail_urls: thumbnails,
        updated_at: updatedAt,
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
        },
        update: {
          title: gTitle,
          notes: gNotes,
          position: gPos,
          is_collapsed: Boolean(g.isCollapsed),
          updated_at: parseDate(g.updatedAt) || updatedAt,
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
        },
        update: {
          group_id: validGroupUuid,
          entity_type: entityType,
          platform_item_id: platformItemId?.slice(0, 64) ?? null,
          custom_title: customTitle,
          custom_url: customUrl,
          notes,
          position: pos,
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

  await tx.userPlaylist.deleteMany({
    where: {
      owner_id: params.ownerId,
      ...(activePlaylistUuids.length > 0 ? { id: { notIn: activePlaylistUuids } } : {}),
    },
  });
}

async function indexResearchQueue(
  tx: Prisma.TransactionClient,
  params: {
    ownerId: string;
    datasetId: string;
    generationId: string;
    records: Record<string, unknown>[];
  }
): Promise<void> {
  const activeIds: string[] = [];
  let pos = 0;

  for (const record of params.records) {
    const rawId = readString(record, "id", "recordId");
    const queryText = (readString(record, "query", "queryText", "title") || "").slice(0, 512);
    if (!rawId || !queryText) continue;

    const id = toDatabaseUuid(`research-queue:${params.ownerId}:${rawId}`);
    activeIds.push(id);

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

  await tx.researchQueueItem.deleteMany({
    where: {
      owner_id: params.ownerId,
      ...(activeIds.length > 0 ? { id: { notIn: activeIds } } : {}),
    },
  });
}

async function indexSearchHistory(
  tx: Prisma.TransactionClient,
  params: {
    ownerId: string;
    generationId: string;
    records: Record<string, unknown>[];
  }
): Promise<void> {
  const activeIds: string[] = [];

  for (const record of params.records) {
    const rawId = readString(record, "id", "recordId");
    const queryText = (readString(record, "query", "queryText") || "").slice(0, 512);
    if (!rawId || !queryText) continue;

    const id = toDatabaseUuid(`search-history:${params.ownerId}:${rawId}`);
    activeIds.push(id);

    const data = {
      owner_id: params.ownerId,
      query_text: queryText,
      search_settings: (record.settings as Prisma.InputJsonValue) ?? {},
      result_count: Math.max(0, Math.floor(readNumber(record, "resultCount") ?? 0)),
      quota_units_consumed: Math.max(0, Math.floor(readNumber(record, "quotaUnits", "quotaCostEstimate") ?? 100)),
      manifest_id: (readString(record, "manifestId") || rawId).slice(0, 64),
      generation_id: params.generationId,
      executed_at:
        parseDate(record.timestamp) ||
        parseDate(record.executedAt) ||
        parseDate(record.createdAt) ||
        new Date(),
    };

    await tx.searchHistoryRecord.upsert({
      where: { id },
      create: { id, ...data },
      update: data,
    });
  }

  await tx.searchHistoryRecord.deleteMany({
    where: {
      owner_id: params.ownerId,
      ...(activeIds.length > 0 ? { id: { notIn: activeIds } } : {}),
    },
  });
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
              records: snapshotRecords,
              originDeviceId: batchOriginDeviceId,
              originDeviceLabel: batchOriginDeviceLabel,
            });
          } else if (datasetType === "PLAYLIST") {
            await indexPlaylists(tx, {
              ownerId: profile.id,
              records: snapshotRecords,
            });
          } else if (datasetType === "RESEARCH_QUEUE") {
            await indexResearchQueue(tx, {
              ownerId: profile.id,
              datasetId: dataset.id,
              generationId,
              records: snapshotRecords,
            });
          } else if (datasetType === "SEARCH_HISTORY") {
            await indexSearchHistory(tx, {
              ownerId: profile.id,
              generationId,
              records: snapshotRecords,
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
