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
  partsCount: number;
  resourceTypeCounts: Partial<Record<ResourceType, number>>;
  syncedOperationIds: string[];
  syncedEntityIds: string[];
  idempotentReplay: boolean;
  versionPointerStatus: "WRITTEN" | "FAILED" | "DEFERRED";
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

/**
 * Reads the currently committed generation back from R2 for legacy delta-only
 * clients. Every part is SHA-256 verified before it is used as a merge base.
 * Failure is fatal: merging onto an unknown base would lose records.
 */
async function loadCommittedSnapshot(params: {
  ownerId: string;
  datasetId: string;
  currentGenerationId: string | null;
  storageOwnerUuid: string;
}): Promise<Record<string, unknown>[]> {
  if (!params.currentGenerationId) return [];

  const generation = await prisma.storageGeneration.findFirst({
    where: {
      id: params.currentGenerationId,
      owner_id: params.ownerId,
      dataset_id: params.datasetId,
      state: "COMMITTED",
    },
    include: { parts: { orderBy: { part_number: "asc" } } },
  });

  if (!generation) return [];

  const r2Client = getR2WorkerStorageClient();
  const records: Record<string, unknown>[] = [];

  for (const part of generation.parts) {
    const { data, sha256 } = await r2Client.getObject("NEW", part.storage_path, {
      storageOwnerUuid: params.storageOwnerUuid,
    });

    if (sha256.toLowerCase() !== part.sha256.toLowerCase()) {
      throw new Error(
        `Committed part ${part.part_number} failed SHA-256 verification while building the merge base.`
      );
    }

    const parsed = JSON.parse(data.toString("utf8")) as {
      items?: Record<string, unknown>[];
      records?: Record<string, unknown>[];
    };
    const items = Array.isArray(parsed.items)
      ? parsed.items
      : Array.isArray(parsed.records)
        ? parsed.records
        : [];
    records.push(...items);
  }

  return records;
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
  }
): Promise<void> {
  const { txOwnerId, txDatasetId, txGenerationId } = {
    txOwnerId: params.ownerId,
    txDatasetId: params.datasetId,
    txGenerationId: params.generationId,
  };

  const platformIds: string[] = [];
  for (const record of params.records) {
    const platformItemId = readString(record, "platformItemId", "resourceId");
    if (platformItemId) platformIds.push(platformItemId);
  }

  // Snapshot semantics: remove projection rows that are no longer present.
  await tx.savedItemIndex.deleteMany({
    where: {
      owner_id: txOwnerId,
      ...(platformIds.length > 0 ? { platform_item_id: { notIn: platformIds } } : {}),
    },
  });

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

      // Optimistic revision check before any R2 write.
      const baseRevision = Number(dataset.current_revision);
      if (
        datasetInput.expectedRevision !== undefined &&
        datasetInput.expectedRevision !== baseRevision
      ) {
        return NextResponse.json(
          {
            ok: false,
            error: "Revision conflict: the dataset changed on another device.",
            code: "REVISION_CONFLICT",
            datasetType,
            expectedRevision: datasetInput.expectedRevision,
            currentRevision: baseRevision,
          },
          { status: 409 }
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
          partsCount: generation?.total_parts ?? 0,
          resourceTypeCounts: {},
          syncedOperationIds: operations.map((op) => op.operationId),
          syncedEntityIds: operations.map((op) => op.entityId),
          idempotentReplay: true,
          versionPointerStatus: "DEFERRED",
        });
        continue;
      }

      // Build the full snapshot.
      let baseRecords: Record<string, unknown>[] = [];
      if (datasetInput.snapshotRecords === undefined) {
        // Legacy delta-only client: reconstruct the committed base safely.
        baseRecords = await loadCommittedSnapshot({
          ownerId: profile.id,
          datasetId: dataset.id,
          currentGenerationId: dataset.current_generation_id,
          storageOwnerUuid,
        });
      }

      const sanitizedSnapshot = (datasetInput.snapshotRecords || []).map((record, index) =>
        sanitizeRecordForStorage(
          record,
          datasetType,
          readString(record, "id", "platformItemId") || `record_${index}`
        )
      );

      const snapshotRecords =
        datasetInput.snapshotRecords !== undefined
          ? applyOperationsToSnapshot(sanitizedSnapshot, operations, datasetType)
          : applyOperationsToSnapshot(baseRecords, operations, datasetType);

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
      const uploadResult = await r2Client.uploadBatch(batchId, datasetType, uploadItems, {
        storageOwnerUuid,
        targetPrefix: `asdy/persistence/${storageOwnerUuid}`,
      });

      if (uploadResult.uploadedCount !== uploadItems.length) {
        throw new Error(
          `R2 batch upload acknowledged ${uploadResult.uploadedCount} of ${uploadItems.length} objects.`
        );
      }

      const verification = await r2Client.verifyBatch(batchId, uploadItems, {
        storageOwnerUuid,
        targetPrefix: `asdy/persistence/${storageOwnerUuid}`,
      });

      if (!verification.ok) {
        throw new Error(
          `R2 verification failed for ${verification.failedCount} object(s): ${verification.failures
            .map((failure) => failure.key)
            .join(", ")}`
        );
      }

      // PostgreSQL commit gate. Nothing is acknowledged before this succeeds.
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
        }
      });

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
        partsCount: generationDesc.parts.length,
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
          currentRevision: error.currentRevision,
        },
        { status: 409 }
      );
    }

    console.error("[sync/save-all] Fatal error during sync:", error);
    return NextResponse.json(
      {
        ok: false,
        error:
          "Synchronization failed before the database commit completed. Local changes remain queued.",
        code: "SYNC_COMMIT_FAILED",
      },
      { status: 500 }
    );
  }
}
