import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/require-auth";
import {
  resolveProfileId,
  resolveStorageOwnerId,
} from "@/lib/auth/storage-owner";
import { prisma } from "@/lib/db/prisma";
import {
  getOldStorageBackend,
  getNewStorageBackend,
  OLD_R2_BUCKET,
  NEW_R2_BUCKET,
} from "@/lib/storage/r2-blob-backend";
import { getR2WorkerStorageClient } from "@/lib/storage/r2-worker-storage-client";
import {
  buildDatasetPrefix,
  buildManifestKey,
  buildPartKey,
  buildVersionPointerKey,
  slugToDatasetType,
  type CanonicalDatasetType,
} from "@/lib/storage/canonical-paths";
import {
  parseRawBufferToEnvelope,
  getArchivedManifestStoragePath,
  normalizeOldCategory,
  type OldArchiveCategory,
} from "@/lib/old/archive-envelope";
import { checkArchiveExistsBySha256 } from "@/lib/old/archive-store";
import type { Prisma } from "@prisma/client";

const LEGACY_DATASET_ALIASES: Record<string, CanonicalDatasetType> = {
  SAVED_VIDEOS: "SAVED_ITEMS",
  SAVED_PLAYLISTS: "PLAYLIST",
  SAVED_SEARCHES: "REFERENCES",
  SAVED_TITLES_LINKS: "REFERENCES",
};

function normalizeCanonicalDatasetType(rawType?: string | null): CanonicalDatasetType {
  const clean = (rawType || "").trim();
  if (!clean) return "SAVED_ITEMS";
  const upper = clean.toUpperCase();
  if (LEGACY_DATASET_ALIASES[upper]) return LEGACY_DATASET_ALIASES[upper];
  return slugToDatasetType(clean) ?? slugToDatasetType(upper) ?? "SAVED_ITEMS";
}

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * POST /api/manifests/upload — Dedicated Manifest Upload Endpoint
 * ──────────────────────────────────────────────────────────────────────────
 * Scope: Phase E — Explicit OLD and NEW Bucket Routing
 *
 * 1. OLD Bucket Route:
 *    - Destination: 'old-youtube-discovery-private'
 *    - Strict logical prefixes:
 *        asdy/old/saved-items/<manifest-id>/manifest.json
 *        asdy/old/saved-playlists/<manifest-id>/manifest.json
 *        asdy/old/saved-titles-links/<manifest-id>/manifest.json
 *        asdy/old/saved-search-history/<manifest-id>/manifest.json
 *    - Verifies Storage bytes, registers in `archived_manifests`.
 *    - Never silently overwrites existing manifests.
 *
 * 2. NEW Bucket Route:
 *    - Destination: 'new-youtube-discovery-private'
 *    - Canonical generational path:
 *        <storage_owner_uuid>/persistence/datasets/<dataset-id>/generations/<generation-id>/parts/part-000001.json
 *    - Verifies SHA-256 over uploaded bytes, commits via PostgreSQL transaction.
 * ═══════════════════════════════════════════════════════════════════════════
 */

export async function POST(request: Request) {
  const auth = await requireAdmin(request);
  if (!auth.ok) return auth.response;

  const ownerId = resolveProfileId(auth.admin);
  const storageOwnerUuid = resolveStorageOwnerId(auth.admin);
  if (!ownerId || !storageOwnerUuid) {
    return NextResponse.json(
      { ok: false, error: "Unable to resolve the canonical profile/storage owner for this session." },
      { status: 500 }
    );
  }

  try {
    const formData = await request.formData();
    const destination = (formData.get("destination") as string || "OLD").toUpperCase();
    const file = formData.get("file") as File | null;

    if (!file) {
      return NextResponse.json({ ok: false, error: "No file provided." }, { status: 400 });
    }

    const filename = file.name || "manifest.json";
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const contentSha256 = crypto.createHash("sha256").update(buffer).digest("hex").toLowerCase();

    // ─────────────────────────────────────────────────────────────────────────
    // ROUTE 1: OLD BUCKET UPLOAD
    // ─────────────────────────────────────────────────────────────────────────
    if (destination === "OLD") {
      const rawCategory = (formData.get("category") as string) || "saved-items";
      const category = normalizeOldCategory(rawCategory);

      // Parse and normalize into envelope
      const envelope = await parseRawBufferToEnvelope(buffer, filename, category as OldArchiveCategory);
      const manifestId = envelope.manifest_metadata.manifest_id;

      // 1. Conflict Check: Check if duplicate SHA-256 or manifest_id already exists
      const existingSha = await checkArchiveExistsBySha256(ownerId, envelope.manifest_metadata.content_sha256);
      if (existingSha) {
        return NextResponse.json(
          {
            ok: false,
            conflict: true,
            error: `Conflict: An identical archive already exists with Manifest ID "${existingSha.manifest_id}" in ${existingSha.category}.`,
            existingRecord: existingSha,
          },
          { status: 409 }
        );
      }

      // Check if manifest_id already exists for owner
      const existingId = await prisma.archivedManifest.findFirst({
        where: { owner_id: ownerId, manifest_id: manifestId },
      });
      if (existingId) {
        return NextResponse.json(
          {
            ok: false,
            conflict: true,
            error: `Conflict: Manifest ID "${manifestId}" is already registered. Please rename the manifest ID or upload a new version.`,
            existingRecord: existingId,
          },
          { status: 409 }
        );
      }

      // 2. Derive Exact OLD Storage Path: asdy/old/<category>/<manifest_id>/manifest.json
      const storagePath = getArchivedManifestStoragePath(category, manifestId, filename.endsWith(".json") ? "manifest.json" : filename);
      const oldBackend = getOldStorageBackend();

      const serialized = Buffer.from(JSON.stringify(envelope, null, 2), "utf8");
      await oldBackend.putBytes(storagePath, serialized, {
        contentType: "application/json",
      });

      // 3. Register in PostgreSQL archived_manifests
      const record = await prisma.archivedManifest.create({
        data: {
          owner_id: ownerId,
          manifest_id: manifestId,
          category,
          source_format: envelope.manifest_metadata.source_format,
          storage_path: storagePath,
          bucket_id: OLD_R2_BUCKET,
          original_filename: filename,
          mime_type: "application/json",
          status: "COMMITTED",
          byte_count: BigInt(serialized.length),
          record_count: envelope.manifest_metadata.record_count,
          content_sha256: envelope.manifest_metadata.content_sha256,
          source_created_at: envelope.manifest_metadata.source_created_at
            ? new Date(envelope.manifest_metadata.source_created_at)
            : null,
          source_exported_at: envelope.manifest_metadata.source_exported_at
            ? new Date(envelope.manifest_metadata.source_exported_at)
            : null,
          imported_at: new Date(),
          provenance_metadata: (envelope.manifest_metadata.provenance ?? {}) as unknown as Prisma.InputJsonValue,
          filter_summary: (envelope.manifest_metadata.filter_summary ?? {}) as unknown as Prisma.InputJsonValue,
        },
      });

      return NextResponse.json({
        ok: true,
        destination: "OLD",
        bucket: OLD_R2_BUCKET,
        storagePath,
        recordId: record.id,
        manifestId,
        category,
        byteCount: serialized.length,
        recordCount: envelope.manifest_metadata.record_count,
        sha256: envelope.manifest_metadata.content_sha256,
      });
    }

    // ─────────────────────────────────────────────────────────────────────────
    // ROUTE 2: NEW BUCKET UPLOAD (Canonical asdy/persistence/<owner>/<slug>/...)
    // ─────────────────────────────────────────────────────────────────────────
    if (destination === "NEW") {
      const rawDatasetType = (formData.get("datasetType") as string) || "SAVED_ITEMS";
      const datasetType = normalizeCanonicalDatasetType(rawDatasetType);
      const customDatasetName = (formData.get("datasetName") as string)?.trim() || `Dataset-${datasetType}`;

      // 1. Find or create canonical StorageDataset for (owner_id, dataset_type)
      let dataset = await prisma.storageDataset.findFirst({
        where: { owner_id: ownerId, dataset_type: datasetType },
      });

      if (!dataset) {
        dataset = await prisma.storageDataset.create({
          data: {
            owner_id: ownerId,
            dataset_type: datasetType,
            display_name: customDatasetName,
            current_revision: BigInt(0),
          },
        });
      }

      const nextRevision = Number(dataset.current_revision) + 1;
      const generationNumber = nextRevision;
      const generationId = crypto.randomUUID();
      const batchId = `upload_${crypto.randomUUID()}`;
      const nowIso = new Date().toISOString();

      // 2. Parse items and prepare canonical part + generation manifest + version pointer
      let parsedItems: Record<string, unknown>[] = [];
      try {
        const parsed = JSON.parse(buffer.toString("utf8"));
        if (Array.isArray(parsed)) {
          parsedItems = parsed;
        } else if (parsed && Array.isArray(parsed.items)) {
          parsedItems = parsed.items;
        } else {
          parsedItems = [parsed];
        }
      } catch {
        parsedItems = [{ rawFilename: filename, byteLength: buffer.length }];
      }

      const partStoragePath = buildPartKey(storageOwnerUuid, datasetType, generationId, 1);
      const manifestPath = buildManifestKey(storageOwnerUuid, datasetType, generationId);
      const versionPath = buildVersionPointerKey(storageOwnerUuid, datasetType);
      const datasetPrefix = buildDatasetPrefix(storageOwnerUuid, datasetType);

      const partPayload = {
        schema_version: "2.0.0",
        dataset_id: dataset.id,
        dataset_type: datasetType,
        generation_id: generationId,
        generation_number: generationNumber,
        part_number: 1,
        record_count: parsedItems.length,
        created_at: nowIso,
        items: parsedItems,
      };
      const partBuffer = Buffer.from(JSON.stringify(partPayload, null, 2), "utf8");
      const partSha256 = crypto.createHash("sha256").update(partBuffer).digest("hex").toLowerCase();

      const genManifestPayload = {
        schema_version: "2.0.0",
        owner_id: storageOwnerUuid,
        dataset_id: dataset.id,
        dataset_type: datasetType,
        generation_id: generationId,
        generation_number: generationNumber,
        parent_generation_id: dataset.current_generation_id || null,
        total_parts: 1,
        total_records: parsedItems.length,
        total_bytes: partBuffer.length,
        aggregate_sha256: partSha256,
        created_at: nowIso,
        parts: [
          {
            part_number: 1,
            storage_path: partStoragePath,
            byte_count: partBuffer.length,
            record_count: parsedItems.length,
            sha256: partSha256,
          },
        ],
      };
      const genManifestBuffer = Buffer.from(JSON.stringify(genManifestPayload, null, 2), "utf8");
      const genManifestSha256 = crypto.createHash("sha256").update(genManifestBuffer).digest("hex").toLowerCase();

      const versionPayload = {
        schema_version: "2.0.0",
        owner_id: storageOwnerUuid,
        dataset_type: datasetType,
        current_revision: nextRevision,
        current_generation_id: generationId,
        manifest_path: manifestPath,
        updated_at: nowIso,
      };
      const versionBuffer = Buffer.from(JSON.stringify(versionPayload, null, 2), "utf8");
      const versionSha256 = crypto.createHash("sha256").update(versionBuffer).digest("hex").toLowerCase();

      // 3. Upload & verify in NEW bucket BEFORE DB commit (R2-before-DB authority rule)
      const r2Client = getR2WorkerStorageClient();
      const newBackend = getNewStorageBackend();
      const hasWorkerConfigured = Boolean(
        process.env.R2_NEW_WORKER_URL?.trim() &&
          (process.env.R2_NEW_WORKER_AUTH_SECRET?.trim() ||
            process.env.WORKER_AUTH_SECRET?.trim() ||
            process.env.R2_WORKER_AUTH_SECRET?.trim()),
      );

      let verifiedInR2 = false;
      if (hasWorkerConfigured) {
        const batchItems = [
          { key: partStoragePath, data: partBuffer, contentType: "application/json", sha256: partSha256 },
          { key: manifestPath, data: genManifestBuffer, contentType: "application/json", sha256: genManifestSha256 },
          { key: versionPath, data: versionBuffer, contentType: "application/json", sha256: versionSha256 },
        ];
        await r2Client.uploadBatch(batchId, datasetType, batchItems, {
          targetPrefix: datasetPrefix,
          storageOwnerUuid,
        });
        const verification = await r2Client.verifyBatch(batchId, batchItems, {
          targetPrefix: datasetPrefix,
          storageOwnerUuid,
        });
        if (!verification.ok) {
          return NextResponse.json(
            {
              ok: false,
              error: `R2 verification failed after upload: ${verification.failures.map((f) => `${f.key}:${f.reason}`).join(", ")}`,
            },
            { status: 502 },
          );
        }
        verifiedInR2 = true;
      } else {
        await newBackend.putBytes(partStoragePath, partBuffer, { contentType: "application/json", allowOverwrite: false });
        await newBackend.putBytes(manifestPath, genManifestBuffer, { contentType: "application/json", allowOverwrite: false });
        await newBackend.putBytes(versionPath, versionBuffer, { contentType: "application/json", allowOverwrite: true });
      }

      // 4. Atomic PostgreSQL Transaction: Create Generation, Part, and advance Dataset pointer
      await prisma.$transaction(async (tx) => {
        await tx.storageGeneration.create({
          data: {
            id: generationId,
            owner_id: ownerId,
            dataset_id: dataset.id,
            generation_number: generationNumber,
            parent_generation_id: dataset.current_generation_id || null,
            state: "COMMITTED",
            total_parts: 1,
            total_records: parsedItems.length,
            total_bytes: BigInt(partBuffer.length),
            aggregate_sha256: partSha256,
            committed_at: new Date(),
          },
        });

        await tx.storageManifestPart.create({
          data: {
            owner_id: ownerId,
            dataset_id: dataset.id,
            generation_id: generationId,
            part_number: 1,
            storage_path: partStoragePath,
            bucket_id: NEW_R2_BUCKET,
            byte_count: BigInt(partBuffer.length),
            record_count: parsedItems.length,
            sha256: partSha256,
          },
        });

        await tx.storageDataset.update({
          where: { id: dataset.id },
          data: {
            current_revision: BigInt(nextRevision),
            current_generation_id: generationId,
          },
        });
      });

      return NextResponse.json({
        ok: true,
        destination: "NEW",
        bucket: NEW_R2_BUCKET,
        datasetId: dataset.id,
        datasetType,
        generationId,
        generationNumber,
        storagePath: partStoragePath,
        manifestPath,
        byteCount: partBuffer.length,
        recordCount: parsedItems.length,
        sha256: partSha256,
        verified: verifiedInR2,
      });
    }

    return NextResponse.json(
      { ok: false, error: `Invalid destination: "${destination}". Must be "OLD" or "NEW".` },
      { status: 400 }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to upload manifest.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
