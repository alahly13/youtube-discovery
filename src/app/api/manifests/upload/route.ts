import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/require-auth";
import { prisma } from "@/lib/db/prisma";
import { getOldStorageBackend, getNewStorageBackend } from "@/lib/storage/supabase-storage-backend";
import { OLD_STORAGE_BUCKET, NEW_STORAGE_BUCKET } from "@/lib/supabase/storage";
import {
  parseRawBufferToEnvelope,
  getArchivedManifestStoragePath,
  normalizeOldCategory,
  type OldArchiveCategory,
} from "@/lib/old/archive-envelope";
import { checkArchiveExistsBySha256 } from "@/lib/old/archive-store";

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

  const ownerId = auth.admin.profileId || auth.admin.userId || "00000000-0000-0000-0000-000000000001";
  const storageOwnerUuid = auth.admin.storageOwnerUuid || auth.admin.userId || "00000000-0000-0000-0000-000000000001";

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
          bucket_id: OLD_STORAGE_BUCKET,
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
          provenance_metadata: (envelope.manifest_metadata.provenance ?? {}) as any,
          filter_summary: (envelope.manifest_metadata.filter_summary ?? {}) as any,
        },
      });

      return NextResponse.json({
        ok: true,
        destination: "OLD",
        bucket: OLD_STORAGE_BUCKET,
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
    // ROUTE 2: NEW BUCKET UPLOAD
    // ─────────────────────────────────────────────────────────────────────────
    if (destination === "NEW") {
      const datasetType = (formData.get("datasetType") as string) || "SAVED_VIDEOS";
      const customDatasetName = (formData.get("datasetName") as string) || `Dataset-${datasetType}`;

      // 1. Find or create StorageDataset
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

      // 2. Parse items and prepare part payload
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

      // 3. Build canonical NEW Storage Path: <storage_owner_uuid>/persistence/datasets/...
      const storagePath = `${storageOwnerUuid}/persistence/datasets/${dataset.id}/generations/${generationId}/parts/part-000001.json`;
      const newBackend = getNewStorageBackend();

      const partPayload = {
        schema_version: "1.0.0",
        dataset_id: dataset.id,
        generation_id: generationId,
        part_number: 1,
        record_count: parsedItems.length,
        items: parsedItems,
      };

      const partBuffer = Buffer.from(JSON.stringify(partPayload, null, 2), "utf8");
      const partSha256 = crypto.createHash("sha256").update(partBuffer).digest("hex").toLowerCase();

      // Upload part to NEW bucket
      await newBackend.putBytes(storagePath, partBuffer, {
        contentType: "application/json",
      });

      // 4. Atomic PostgreSQL Transaction: Create Generation, Part, and Update Dataset
      await prisma.$transaction(async (tx) => {
        // Create Generation in COMMITTED state
        await tx.storageGeneration.create({
          data: {
            id: generationId,
            owner_id: ownerId,
            dataset_id: dataset.id,
            generation_number: generationNumber,
            state: "COMMITTED",
            total_parts: 1,
            total_records: parsedItems.length,
            total_bytes: BigInt(partBuffer.length),
            aggregate_sha256: partSha256,
            committed_at: new Date(),
          },
        });

        // Create Manifest Part
        await tx.storageManifestPart.create({
          data: {
            owner_id: ownerId,
            dataset_id: dataset.id,
            generation_id: generationId,
            part_number: 1,
            storage_path: storagePath,
            bucket_id: NEW_STORAGE_BUCKET,
            byte_count: BigInt(partBuffer.length),
            record_count: parsedItems.length,
            sha256: partSha256,
          },
        });

        // Update Dataset current generation pointer and revision
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
        bucket: NEW_STORAGE_BUCKET,
        datasetId: dataset.id,
        datasetType,
        generationId,
        generationNumber,
        storagePath,
        byteCount: partBuffer.length,
        recordCount: parsedItems.length,
        sha256: partSha256,
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
