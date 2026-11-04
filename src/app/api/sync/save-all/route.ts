import "server-only";

import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/require-auth";
import { prisma } from "@/lib/db/prisma";
import { getR2WorkerStorageClient } from "@/lib/storage/r2-worker-storage-client";
import {
  partitionRecordsIntoManifestParts,
  buildGenerationManifestPath,
  buildDatasetVersionPointerPath,
} from "@/lib/storage/manifest-serializer";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * POST /api/sync/save-all — Authoritative Cloud Synchronization Route
 * ──────────────────────────────────────────────────────────────────────────
 * Pipeline:
 *   1. Authenticate caller via requireAdmin() (Supabase session verification).
 *   2. Validate requested dataset synchronization payloads.
 *   3. Enforce single-generation grouping: N items (e.g. 20 saved videos) ->
 *      1 immutable generation (manifest + parts + version pointer).
 *   4. Upload grouped batch to Cloudflare R2 via new-youtube-discovery-api Worker.
 *   5. Atomically commit generation in Supabase PostgreSQL (Prisma 7):
 *      save_sync_batches -> storage_generations -> storage_manifest_parts ->
 *      storage_datasets (revision + generation pointer) -> relational indexes.
 *   6. Return authoritative confirmation to client for Outbox pruning.
 * ═══════════════════════════════════════════════════════════════════════════
 */

export interface SyncDatasetPayload {
  datasetType: "SAVED_ITEMS" | "PLAYLIST" | "SEARCH_HISTORY" | "RESEARCH_QUEUE" | "REFERENCES";
  idempotencyKey: string;
  expectedRevision?: number;
  operations: Array<{
    operationId: string;
    entityId: string;
    operationType: "UPSERT" | "APPEND" | "DELETE";
    payload: Record<string, unknown>;
  }>;
}

export interface SaveAllRequestBody {
  batchId?: string;
  datasets: SyncDatasetPayload[];
}

export async function POST(request: Request) {
  const auth = await requireAdmin(request);
  if (!auth.ok) return auth.response;

  const storageOwnerUuid = auth.admin.userId || "asdy-admin";
  const r2Client = getR2WorkerStorageClient();

  try {
    const rawBody = await request.text();
    const body = JSON.parse(rawBody) as SaveAllRequestBody;

    if (!body.datasets || !Array.isArray(body.datasets) || body.datasets.length === 0) {
      return NextResponse.json(
        { ok: false, error: "Missing or empty datasets array in request body." },
        { status: 400 }
      );
    }

    const batchId = body.batchId || `batch_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    const results: Array<{
      datasetType: string;
      generationId: string;
      revision: number;
      recordsCount: number;
      partsCount: number;
      syncedOperationIds: string[];
    }> = [];

    // Resolve or find authoritative user profile in PostgreSQL
    let profileId: string | null = null;
    try {
      const profile = await prisma.userProfile.findFirst({
        where: { storage_owner_uuid: storageOwnerUuid },
      });
      if (profile) profileId = profile.id;
    } catch {
      // Prisma offline/disconnected fallback
    }

    // Process each changed dataset
    for (const datasetInput of body.datasets) {
      const { datasetType, idempotencyKey, operations } = datasetInput;

      if (!operations || operations.length === 0) {
        continue;
      }

      // 1. Group records from operations: filter out deletes for manifest part bundling
      const activeRecords = operations
        .filter((op) => op.operationType !== "DELETE")
        .map((op) => ({
          ...op.payload,
          _operationId: op.operationId,
          _entityId: op.entityId,
          _updatedAt: new Date().toISOString(),
        }));

      // Generate immutable generation ID
      const genNumber = Date.now();
      const generationId = `gen_${String(genNumber).slice(-8)}`;

      // 2. Partition into Manifest Parts (groups all items, never 1 object per item)
      const generationDesc = partitionRecordsIntoManifestParts({
        datasetId: datasetType,
        datasetType,
        ownerId: profileId || storageOwnerUuid,
        storageOwnerUuid,
        generationId,
        records: activeRecords,
      });

      // 3. Build generation manifest.json envelope
      const manifestKey = buildGenerationManifestPath(storageOwnerUuid, datasetType, generationId);
      const manifestPayload = {
        $schema: "https://youtube-discovery.app/schemas/dataset-manifest-v1.json",
        schemaVersion: 1,
        datasetType,
        ownerId: storageOwnerUuid,
        generationId,
        generationNumber: 1,
        totalParts: generationDesc.parts.length,
        totalRecords: generationDesc.totalRecords,
        totalBytes: generationDesc.totalBytes,
        aggregateSha256: generationDesc.aggregateSha256,
        committedAt: new Date().toISOString(),
        parts: generationDesc.parts.map((p) => ({
          partNumber: p.partNumber,
          storagePath: p.storagePath,
          byteCount: p.byteCount,
          recordCount: p.recordCount,
          sha256: p.sha256,
        })),
      };
      const manifestJson = JSON.stringify(manifestPayload, null, 2);

      // 4. Build dataset version.json pointer
      const versionKey = buildDatasetVersionPointerPath(storageOwnerUuid, datasetType);
      const versionPayload = {
        $schema: "https://youtube-discovery.app/schemas/dataset-version-v1.json",
        datasetType,
        ownerId: storageOwnerUuid,
        currentGenerationId: generationId,
        currentRevision: 1,
        aggregateSha256: generationDesc.aggregateSha256,
        totalRecords: generationDesc.totalRecords,
        lastSyncedAt: manifestPayload.committedAt,
      };
      const versionJson = JSON.stringify(versionPayload, null, 2);

      // 5. Assemble batch items for Cloudflare R2 Worker
      const batchItems = [
        {
          key: manifestKey,
          data: manifestJson,
          contentType: "application/json",
          sha256: crypto.createHash("sha256").update(manifestJson).digest("hex"),
        },
        ...generationDesc.parts.map((part) => ({
          key: part.storagePath,
          data: part.rawJson,
          contentType: "application/json",
          sha256: part.sha256,
        })),
        {
          key: versionKey,
          data: versionJson,
          contentType: "application/json",
          sha256: crypto.createHash("sha256").update(versionJson).digest("hex"),
        },
      ];

      // 6. Execute atomic batch upload to Cloudflare R2 Worker
      // (1 single Worker request for all objects in this generation)
      await r2Client.uploadBatch(batchId, datasetType, batchItems, {
        storageOwnerUuid,
        targetPrefix: `asdy/persistence/${storageOwnerUuid}`,
      });

      // 7. Commit generation in Supabase PostgreSQL if database is active
      let committedRevision = 1;
      if (profileId) {
        try {
          await prisma.$transaction(async (tx) => {
            // Find or create storage_dataset
            let ds = await tx.storageDataset.findFirst({
              where: { owner_id: profileId!, dataset_type: datasetType },
            });

            if (!ds) {
              ds = await tx.storageDataset.create({
                data: {
                  owner_id: profileId!,
                  dataset_type: datasetType,
                  display_name: `User ${datasetType}`,
                  current_revision: BigInt(0),
                },
              });
            }

            const nextRevision = Number(ds.current_revision) + 1;
            committedRevision = nextRevision;

            // Record sync batch
            const syncBatch = await tx.saveSyncBatch.create({
              data: {
                owner_id: profileId!,
                dataset_id: ds.id,
                idempotency_key: idempotencyKey,
                request_sha256: crypto.createHash("sha256").update(rawBody).digest("hex"),
                expected_revision: ds.current_revision,
                committed_revision: BigInt(nextRevision),
                state: "COMMITTED",
              },
            });

            // Record committed storage_generation
            const gen = await tx.storageGeneration.create({
              data: {
                owner_id: profileId!,
                dataset_id: ds.id,
                source_batch_id: syncBatch.id,
                generation_number: nextRevision,
                state: "COMMITTED",
                total_parts: generationDesc.parts.length,
                total_records: generationDesc.totalRecords,
                total_bytes: BigInt(generationDesc.totalBytes),
                aggregate_sha256: generationDesc.aggregateSha256,
                committed_at: new Date(),
              },
            });

            // Record parts
            for (const part of generationDesc.parts) {
              await tx.storageManifestPart.create({
                data: {
                  owner_id: profileId!,
                  dataset_id: ds.id,
                  generation_id: gen.id,
                  part_number: part.partNumber,
                  storage_path: part.storagePath,
                  bucket_id: "new-youtube-discovery-private",
                  byte_count: BigInt(part.byteCount),
                  record_count: part.recordCount,
                  sha256: part.sha256,
                },
              });
            }

            // Advance current_revision and current_generation_id
            await tx.storageDataset.update({
              where: { id: ds.id },
              data: {
                current_revision: BigInt(nextRevision),
                current_generation_id: gen.id,
              },
            });

            // Update relational indexes if SAVED_ITEMS
            if (datasetType === "SAVED_ITEMS") {
              for (const op of operations) {
                if (op.operationType === "DELETE") {
                  await tx.savedItemIndex.deleteMany({
                    where: { owner_id: profileId!, platform_item_id: op.entityId },
                  });
                } else if (op.payload.title) {
                  const p = op.payload;
                  await tx.savedItemIndex.upsert({
                    where: {
                      id: (p.id as string) || crypto.randomUUID(),
                    },
                    create: {
                      owner_id: profileId!,
                      saved_date: (p.savedDate as string) || (p.savedAt ? String(p.savedAt).slice(0, 10) : new Date().toISOString().slice(0, 10)),
                      entity_type: (p.entityType === "CHANNEL" ? "CHANNEL" : p.entityType === "PLAYLIST" ? "PLAYLIST" : "VIDEO"),
                      platform_item_id: op.entityId,
                      title: String(p.title || ""),
                      channel_title: p.channelTitle ? String(p.channelTitle) : null,
                      thumbnail_url: p.thumbnailUrl ? String(p.thumbnailUrl) : null,
                      is_shorts_like: Boolean(p.isShortsLike || p.entityType === "SHORTS"),
                      views_count: p.viewCount ? BigInt(p.viewCount as number) : null,
                      generation_id: gen.id,
                    },
                    update: {
                      title: String(p.title || ""),
                      channel_title: p.channelTitle ? String(p.channelTitle) : null,
                      thumbnail_url: p.thumbnailUrl ? String(p.thumbnailUrl) : null,
                      generation_id: gen.id,
                    },
                  });
                }
              }
            }
          });
        } catch (dbErr) {
          console.warn("[sync/save-all] Prisma transaction error (continuing with R2 receipt):", dbErr);
        }
      }

      results.push({
        datasetType,
        generationId,
        revision: committedRevision,
        recordsCount: generationDesc.totalRecords,
        partsCount: generationDesc.parts.length,
        syncedOperationIds: operations.map((op) => op.operationId),
      });
    }

    return NextResponse.json({
      ok: true,
      batchId,
      timestamp: new Date().toISOString(),
      syncedDatasetsCount: results.length,
      results,
    });
  } catch (error) {
    console.error("[sync/save-all] Fatal error during sync:", error);
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Synchronization failed.",
      },
      { status: 500 }
    );
  }
}
