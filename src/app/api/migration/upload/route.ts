import "server-only";

import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/require-auth";
import { resolveStorageOwnerId } from "@/lib/auth/storage-owner";
import { getNewStorageBackend, NEW_R2_BUCKET } from "@/lib/storage/r2-blob-backend";
import { getR2WorkerStorageClient } from "@/lib/storage/r2-worker-storage-client";
import { prisma } from "@/lib/db/prisma";
import type { PreparedMigrationPlan } from "@/lib/migration/legacy-migration-service";

export const dynamic = "force-dynamic";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * POST /api/migration/upload
 * ──────────────────────────────────────────────────────────────────────────
 * Explicitly uploads prepared legacy data generations and parts to Cloudflare R2
 * under canonical historical namespace:
 * asdy/persistence/<ownerId>/<datasetSlug>/before-app-updating/...
 *
 * Guarantees:
 *   1. Protected by requireAdmin().
 *   2. Non-destructive: Uploads to cloud without wiping local storage.
 *   3. SHA-256 verification receipts returned for each uploaded object.
 *   4. Upserts dataset and generation in PostgreSQL when available.
 * ═══════════════════════════════════════════════════════════════════════════
 */
export async function POST(request: Request) {
  const auth = await requireAdmin(request);
  if (!auth.ok) return auth.response;

  const storageOwnerUuid = resolveStorageOwnerId(auth.admin);
  if (!storageOwnerUuid) {
    return NextResponse.json(
      { ok: false, error: "Unable to resolve a canonical storage owner for this session." },
      { status: 500 }
    );
  }

  try {
    const body = (await request.json()) as PreparedMigrationPlan;

    if (!body || !Array.isArray(body.generations) || body.generations.length === 0) {
      return NextResponse.json(
        { ok: false, error: "Invalid migration payload: 'generations' array is required." },
        { status: 400 }
      );
    }

    const r2Client = getR2WorkerStorageClient();
    const storageBackend = getNewStorageBackend();

    const uploadReceipts: Array<{
      datasetType: string;
      generationId: string;
      dbGenerationId: string;
      manifestPath: string;
      partsCount: number;
      totalBytes: number;
      aggregateSha256: string;
      verified: boolean;
      dbRegistered: boolean;
    }> = [];

    let totalUploadedRecords = 0;
    let totalUploadedBytes = 0;
    const ownerPrefix = `asdy/persistence/${storageOwnerUuid}/`;

    for (const gen of body.generations) {
      const verifyItems: Array<{ key: string; sha256: string; byteCount: number }> = [];

      // Validate canonical historical prefix boundary for all items
      if (!gen.manifestPath.startsWith(ownerPrefix)) {
        return NextResponse.json(
          { ok: false, error: `Invalid manifestPath outside canonical owner scope: ${gen.manifestPath}` },
          { status: 403 }
        );
      }

      const workerConfigured = Boolean(
        process.env.R2_NEW_WORKER_URL?.trim() &&
          (process.env.R2_NEW_WORKER_AUTH_SECRET?.trim() ||
            process.env.R2_WORKER_AUTH_SECRET?.trim())
      );

      // 1. Upload each part
      for (const part of gen.parts) {
        if (!part.storagePath.startsWith(ownerPrefix)) {
          return NextResponse.json(
            { ok: false, error: `Invalid part path outside canonical owner scope: ${part.storagePath}` },
            { status: 403 }
          );
        }
        const partBuffer = Buffer.from(part.jsonContent, "utf-8");
        const partSha = crypto.createHash("sha256").update(partBuffer).digest("hex").toLowerCase();

        try {
          await r2Client.putObject("NEW", part.storagePath, partBuffer, {
            contentType: "application/json",
            storageOwnerUuid,
            allowOverwrite: false,
          });
        } catch (workerErr) {
          // If R2 Worker is configured, fail closed instead of masking onto ephemeral disk.
          if (workerConfigured) {
            throw workerErr;
          }
          await storageBackend.putBytes(part.storagePath, partBuffer, {
            contentType: "application/json",
            allowOverwrite: false,
          });
        }
        verifyItems.push({ key: part.storagePath, sha256: partSha, byteCount: partBuffer.byteLength });
      }

      // 2. Upload generation manifest.json (strictly write-once; fail closed if Worker configured)
      const manifestBuffer = Buffer.from(gen.manifestJson, "utf-8");
      const manifestSha = crypto.createHash("sha256").update(manifestBuffer).digest("hex").toLowerCase();
      try {
        await r2Client.putObject("NEW", gen.manifestPath, manifestBuffer, {
          contentType: "application/json",
          storageOwnerUuid,
          allowOverwrite: false,
        });
      } catch (workerErr) {
        if (workerConfigured) {
          throw workerErr;
        }
        await storageBackend.putBytes(gen.manifestPath, manifestBuffer, {
          contentType: "application/json",
          allowOverwrite: false,
        });
      }
      verifyItems.push({ key: gen.manifestPath, sha256: manifestSha, byteCount: manifestBuffer.byteLength });

      // 3. Upload version.json pointer for the historical branch
      const versionPayload = JSON.stringify(
        {
          currentGenerationId: gen.generationId,
          isBeforeAppUpdating: true,
          datasetType: gen.datasetType,
          updatedAt: new Date().toISOString(),
        },
        null,
        2
      );
      const versionBuffer = Buffer.from(versionPayload, "utf-8");
      const versionSha = crypto.createHash("sha256").update(versionBuffer).digest("hex").toLowerCase();

      if (gen.versionPointerPath.startsWith(ownerPrefix)) {
        try {
          await r2Client.putObject("NEW", gen.versionPointerPath, versionBuffer, {
            contentType: "application/json",
            storageOwnerUuid,
            allowOverwrite: true,
          });
        } catch (workerErr) {
          if (workerConfigured) {
            throw workerErr;
          }
          await storageBackend.putBytes(gen.versionPointerPath, versionBuffer, {
            contentType: "application/json",
            allowOverwrite: true,
          });
        }
        verifyItems.push({ key: gen.versionPointerPath, sha256: versionSha, byteCount: versionBuffer.byteLength });
      }

      // 3B. Verify uploaded objects via Worker SHA-256 read-back (fail closed when Worker configured)
      let verifiedInR2 = false;
      if (workerConfigured) {
        const verification = await r2Client.verifyBatch(`mig_${crypto.randomUUID()}`, verifyItems, {
          targetPrefix: ownerPrefix,
          storageOwnerUuid,
        });
        if (!verification.ok) {
          return NextResponse.json(
            {
              ok: false,
              errorCategory: "R2_VERIFICATION_ERROR",
              error: `R2 verification failed on legacy migration objects: ${verification.failures.map((f) => `${f.key}:${f.reason}`).join(", ")}`,
            },
            { status: 502 }
          );
        }
        verifiedInR2 = true;
      } else {
        try {
          const verification = await r2Client.verifyBatch(`mig_${crypto.randomUUID()}`, verifyItems, {
            targetPrefix: ownerPrefix,
            storageOwnerUuid,
          });
          verifiedInR2 = verification.ok;
        } catch {
          // Local disk fallback mode skips Worker verifyBatch when Worker is unconfigured
        }
      }

      // 4. Register historical generation in PostgreSQL using valid UUID primary keys
      const dbGenerationId = crypto.randomUUID();
      let dbRegistered = false;
      try {
        const profile = await prisma.userProfile.findFirst({
          where: {
            OR: [
              { storage_owner_uuid: storageOwnerUuid },
              ...(auth.admin.profileId ? [{ id: auth.admin.profileId }] : []),
              ...(auth.admin.userId ? [{ auth_user_id: auth.admin.userId }] : []),
            ],
          },
        });

        if (profile) {
          let dataset = await prisma.storageDataset.findFirst({
            where: {
              owner_id: profile.id,
              dataset_type: gen.datasetType,
            },
          });

          if (!dataset) {
            dataset = await prisma.storageDataset.create({
              data: {
                owner_id: profile.id,
                dataset_type: gen.datasetType,
                display_name: `${gen.datasetType.replace(/_/g, " ")}`,
                current_revision: BigInt(0),
              },
            });
          }

          const latestGen = await prisma.storageGeneration.findFirst({
            where: { owner_id: profile.id, dataset_id: dataset.id },
            orderBy: { generation_number: "desc" },
            select: { id: true, generation_number: true },
          });

          const nextGenNumber = (latestGen?.generation_number ?? 0) + 1;

          await prisma.$transaction(async (tx) => {
            await tx.storageGeneration.create({
              data: {
                id: dbGenerationId,
                owner_id: profile.id,
                dataset_id: dataset.id,
                generation_number: nextGenNumber,
                parent_generation_id: latestGen?.id || null,
                state: "COMMITTED",
                total_parts: gen.parts.length,
                total_records: gen.totalRecords,
                total_bytes: BigInt(gen.totalBytes),
                aggregate_sha256: gen.aggregateSha256,
                origin_device_label: `Legacy Data Migration (${gen.generationId})`,
                committed_at: new Date(),
                parts: {
                  create: gen.parts.map((p) => ({
                    id: crypto.randomUUID(),
                    owner_id: profile.id,
                    dataset_id: dataset.id,
                    part_number: p.partNumber,
                    storage_path: p.storagePath,
                    bucket_id: NEW_R2_BUCKET,
                    byte_count: BigInt(p.byteCount),
                    record_count: p.recordCount,
                    sha256: p.sha256,
                  })),
                },
              },
            });

            // Only advance dataset pointer if dataset previously had no live generation;
            // otherwise preserve live head while keeping historical archive browseable.
            if (!dataset.current_generation_id) {
              await tx.storageDataset.update({
                where: { id: dataset.id },
                data: {
                  current_revision: BigInt(nextGenNumber),
                  current_generation_id: dbGenerationId,
                },
              });
            }
          });
          dbRegistered = true;
        }
      } catch (dbErr) {
        console.warn("[api/migration/upload] Historical DB registration skipped:", dbErr);
      }

      uploadReceipts.push({
        datasetType: gen.datasetType,
        generationId: gen.generationId,
        dbGenerationId,
        manifestPath: gen.manifestPath,
        partsCount: gen.parts.length,
        totalBytes: gen.totalBytes,
        aggregateSha256: gen.aggregateSha256,
        verified: verifiedInR2,
        dbRegistered,
      });

      totalUploadedRecords += gen.totalRecords;
      totalUploadedBytes += gen.totalBytes;
    }

    return NextResponse.json({
      ok: true,
      planId: body.planId,
      uploadedGenerations: uploadReceipts,
      totalUploadedGenerations: uploadReceipts.length,
      totalUploadedRecords,
      totalUploadedBytes,
      message:
        "Legacy data migration successfully uploaded to Cloudflare R2 under canonical 'before-app-updating' historical namespace.",
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("[api/migration/upload] Error uploading migration:", error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Failed to execute migration upload" },
      { status: 500 }
    );
  }
}
