import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/require-auth";
import { prisma } from "@/lib/db/prisma";
import { getStorageBackendForBucket } from "@/lib/storage/supabase-storage-backend";
import { OLD_STORAGE_BUCKET, NEW_STORAGE_BUCKET } from "@/lib/supabase/storage";
import { createZipArchive, type ZipFileEntry } from "@/lib/storage/zip-builder";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * POST /api/manifests/export-selected — Verified Manifest Exporter
 * ──────────────────────────────────────────────────────────────────────────
 * Scope: Phase F — Dedicated Manifest Export Engine
 *
 * Downloads authentic bytes from dedicated OLD or NEW buckets:
 *   - For OLD: Queries `archived_manifests`, fetches from 'old-youtube-discovery-private'
 *   - For NEW: Queries `storage_manifest_parts`, fetches from 'new-youtube-discovery-private'
 *   - Packaging: Single original file OR bundled ZIP with checksums
 * ═══════════════════════════════════════════════════════════════════════════
 */

export async function POST(request: Request) {
  const auth = await requireAdmin(request);
  if (!auth.ok) return auth.response;

  const ownerId = auth.admin.profileId || auth.admin.userId || "00000000-0000-0000-0000-000000000001";
  const storageOwnerUuid = auth.admin.storageOwnerUuid || auth.admin.userId || "00000000-0000-0000-0000-000000000001";

  try {
    const body = await request.json();
    const source = (body.source || "OLD").toUpperCase();
    const format = body.format || "ZIP"; // "ZIP" | "ORIGINAL" | "NORMALIZED_JSON"

    // ─────────────────────────────────────────────────────────────────────────
    // EXPORT FROM OLD BUCKET
    // ─────────────────────────────────────────────────────────────────────────
    if (source === "OLD") {
      const manifestIds: string[] = body.manifestIds || [];

      if (manifestIds.length === 0) {
        return NextResponse.json(
          { ok: false, error: "Please select at least one manifest to export." },
          { status: 400 }
        );
      }

      const records = await prisma.archivedManifest.findMany({
        where: {
          owner_id: ownerId,
          manifest_id: { in: manifestIds },
        },
      });

      if (records.length === 0) {
        return NextResponse.json(
          { ok: false, error: "No matching archived manifests found." },
          { status: 404 }
        );
      }

      // If single file requested in ORIGINAL format
      if (records.length === 1 && (format === "ORIGINAL" || format === "NORMALIZED_JSON")) {
        const rec = records[0];
        const backend = getStorageBackendForBucket(rec.bucket_id || OLD_STORAGE_BUCKET);
        const bytes = await backend.getBytes(rec.storage_path);

        const outFilename = (rec.original_filename || `manifest-${rec.manifest_id}.json`).replace(
          /[^a-zA-Z0-9._-]/g,
          "_"
        );

        return new Response(new Uint8Array(bytes), {
          status: 200,
          headers: {
            "Content-Type": "application/json; charset=utf-8",
            "Content-Disposition": `attachment; filename="${outFilename}"`,
            "Content-Length": String(bytes.byteLength),
            "X-Content-Sha256": rec.content_sha256,
          },
        });
      }

      // Multiple files or ZIP format requested: Bundle into standard ZIP archive
      const zipEntries: ZipFileEntry[] = [];
      const checksumLines: string[] = [];

      for (const rec of records) {
        const backend = getStorageBackendForBucket(rec.bucket_id || OLD_STORAGE_BUCKET);
        const bytes = await backend.getBytes(rec.storage_path);
        const fileSha = crypto.createHash("sha256").update(bytes).digest("hex").toLowerCase();

        const safeCat = rec.category.replace(/[^a-zA-Z0-9_-]/g, "_");
        const safeName = (rec.original_filename || `manifest-${rec.manifest_id}.json`).replace(
          /[^a-zA-Z0-9._-]/g,
          "_"
        );
        const zipPath = `${safeCat}/${rec.manifest_id}/${safeName}`;

        zipEntries.push({ filename: zipPath, data: bytes });
        checksumLines.push(`${fileSha}  ${zipPath}`);
      }

      // Add SHA-256 Checksums file
      checksumLines.push("");
      zipEntries.push({
        filename: "checksums/SHA256SUMS.txt",
        data: checksumLines.join("\n"),
      });

      // Add export manifest
      const exportSummary = {
        exported_at: new Date().toISOString(),
        source: "OLD_ARCHIVE",
        bucket: OLD_STORAGE_BUCKET,
        total_manifests: records.length,
        manifests: records.map((r) => ({
          manifest_id: r.manifest_id,
          category: r.category,
          sha256: r.content_sha256,
          byte_count: Number(r.byte_count),
          record_count: r.record_count,
        })),
      };
      zipEntries.push({
        filename: "export-manifest.json",
        data: JSON.stringify(exportSummary, null, 2),
      });

      const zipBuffer = createZipArchive(zipEntries);
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      const zipFilename = `YouTube-Discovery-OLD-Export-${timestamp}.zip`;

      return new Response(new Uint8Array(zipBuffer), {
        status: 200,
        headers: {
          "Content-Type": "application/zip",
          "Content-Disposition": `attachment; filename="${zipFilename}"`,
          "Content-Length": String(zipBuffer.byteLength),
        },
      });
    }

    // ─────────────────────────────────────────────────────────────────────────
    // EXPORT FROM NEW BUCKET (GENERATION PARTS)
    // ─────────────────────────────────────────────────────────────────────────
    if (source === "NEW") {
      const datasetId = body.datasetId as string;
      const generationId = body.generationId as string;

      if (!datasetId || !generationId) {
        return NextResponse.json(
          { ok: false, error: "Missing datasetId or generationId for NEW export." },
          { status: 400 }
        );
      }

      const parts = await prisma.storageManifestPart.findMany({
        where: {
          owner_id: ownerId,
          dataset_id: datasetId,
          generation_id: generationId,
        },
        orderBy: { part_number: "asc" },
      });

      if (parts.length === 0) {
        return NextResponse.json(
          { ok: false, error: "No manifest parts found for this generation." },
          { status: 404 }
        );
      }

      const zipEntries: ZipFileEntry[] = [];
      const checksumLines: string[] = [];

      for (const part of parts) {
        const backend = getStorageBackendForBucket(part.bucket_id || NEW_STORAGE_BUCKET);
        const bytes = await backend.getBytes(part.storage_path);
        const fileSha = crypto.createHash("sha256").update(bytes).digest("hex").toLowerCase();

        const zipPath = `parts/part-${String(part.part_number).padStart(6, "0")}.json`;
        zipEntries.push({ filename: zipPath, data: bytes });
        checksumLines.push(`${fileSha}  ${zipPath}`);
      }

      checksumLines.push("");
      zipEntries.push({
        filename: "checksums/SHA256SUMS.txt",
        data: checksumLines.join("\n"),
      });

      const zipBuffer = createZipArchive(zipEntries);
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      const zipFilename = `YouTube-Discovery-NEW-Gen-${generationId.slice(0, 8)}-${timestamp}.zip`;

      return new Response(new Uint8Array(zipBuffer), {
        status: 200,
        headers: {
          "Content-Type": "application/zip",
          "Content-Disposition": `attachment; filename="${zipFilename}"`,
          "Content-Length": String(zipBuffer.byteLength),
        },
      });
    }

    return NextResponse.json({ ok: false, error: "Invalid source parameter." }, { status: 400 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to export manifests.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
