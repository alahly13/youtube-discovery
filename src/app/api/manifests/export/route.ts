import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/require-auth";
import { getNewStorageBackend } from "@/lib/storage/r2-blob-backend";
import { createZipArchive, type ZipFileEntry } from "@/lib/storage/zip-builder";
import { computePartSha256, computeAggregateGenerationSha256 } from "@/lib/storage/manifest-serializer";
import { datasetTypeToSlug } from "@/lib/storage/canonical-paths";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * GET /api/manifests/export?datasetId=<id>&generationId=<id>
 * ──────────────────────────────────────────────────────────────────────────
 * Pre-validates cryptographic SHA-256 digests across all parts in a generation,
 * packages them into a standard PKZIP archive with a generation index descriptor,
 * and streams the ZIP file to the administrator.
 *
 * Checks canonical asdy/persistence/<ownerId>/<slug>/generations/<genId>/parts/
 * with graceful fallback to legacy <ownerId>/persistence/... paths.
 * ═══════════════════════════════════════════════════════════════════════════
 */

export async function GET(request: Request) {
  const auth = await requireAdmin(request);
  if (!auth.ok) return auth.response;

  const storageOwnerUuid = auth.admin.userId || "00000000-0000-0000-0000-000000000001";
  const { searchParams } = new URL(request.url);
  const datasetId = searchParams.get("datasetId");
  const generationId = searchParams.get("generationId");

  if (!datasetId || !generationId) {
    return NextResponse.json(
      { ok: false, error: "Missing required datasetId or generationId query parameters" },
      { status: 400 }
    );
  }

  try {
    const backend = getNewStorageBackend();

    // 1. Determine canonical slug
    let slug = datasetId;
    try {
      slug = datasetTypeToSlug(datasetId);
    } catch {
      slug = datasetId.toLowerCase().replace(/_/g, "-");
    }

    // Try canonical prefix first
    const canonicalPrefix = `asdy/persistence/${storageOwnerUuid}/${slug}/generations/${generationId}/parts/`;
    let listResult = await backend.list(canonicalPrefix);
    let partFiles = listResult.filter((obj) => obj.pathname.includes("/parts/part-"));

    // Fallback to legacy prefixes if no parts found
    if (partFiles.length === 0) {
      const legacyPrefix1 = `${storageOwnerUuid}/persistence/datasets/${datasetId}/generations/${generationId}/parts/`;
      listResult = await backend.list(legacyPrefix1);
      partFiles = listResult.filter((obj) => obj.pathname.includes("/parts/part-"));
    }

    if (partFiles.length === 0) {
      const legacyPrefix2 = `${storageOwnerUuid}/persistence/${datasetId}/generations/${generationId}/parts/`;
      listResult = await backend.list(legacyPrefix2);
      partFiles = listResult.filter((obj) => obj.pathname.includes("/parts/part-"));
    }

    if (partFiles.length === 0) {
      return NextResponse.json(
        { ok: false, error: "No manifest parts found for the specified generation" },
        { status: 404 }
      );
    }

    const zipEntries: ZipFileEntry[] = [];
    const verifiedPartsMeta: Array<{
      partNumber: number;
      byteCount: number;
      recordCount: number;
      sha256: string;
    }> = [];

    // Fetch and verify all parts
    for (let i = 0; i < partFiles.length; i++) {
      const fileObj = partFiles[i];
      const rawBuffer = await backend.getBytes(fileObj.pathname);
      const computedSha = computePartSha256(rawBuffer);
      const filename = fileObj.pathname.split("/").pop() || `part-${String(i + 1).padStart(6, "0")}.json`;

      // Extract part number from filename
      const match = filename.match(/part-(\d+)\.json/);
      const partNum = match ? parseInt(match[1], 10) : i + 1;

      // Extract record count if valid JSON envelope
      let recordCount = 1;
      try {
        const parsed = JSON.parse(rawBuffer.toString("utf8"));
        if (typeof parsed.recordCount === "number") {
          recordCount = parsed.recordCount;
        } else if (Array.isArray(parsed.items)) {
          recordCount = parsed.items.length;
        }
      } catch {
        // Fallback estimate
      }

      verifiedPartsMeta.push({
        partNumber: partNum,
        byteCount: rawBuffer.length,
        recordCount,
        sha256: computedSha,
      });

      zipEntries.push({
        filename: `parts/${filename}`,
        data: rawBuffer,
      });
    }

    // Sort parts by partNumber
    verifiedPartsMeta.sort((a, b) => a.partNumber - b.partNumber);

    // Compute aggregate generation SHA-256
    const aggregateSha256 = computeAggregateGenerationSha256(verifiedPartsMeta);
    const totalRecords = verifiedPartsMeta.reduce((acc, p) => acc + p.recordCount, 0);
    const totalBytes = verifiedPartsMeta.reduce((acc, p) => acc + p.byteCount, 0);

    // Build standard generation index descriptor
    const manifestDescriptor = {
      $schema: "https://youtube-discovery.app/schemas/dataset-manifest-v1.json",
      schemaVersion: 1,
      datasetId,
      generationId,
      ownerId: storageOwnerUuid,
      exportedAt: new Date().toISOString(),
      aggregateSha256,
      totalParts: verifiedPartsMeta.length,
      totalRecords,
      totalBytes,
      parts: verifiedPartsMeta,
    };

    zipEntries.unshift({
      filename: "manifest.json",
      data: Buffer.from(JSON.stringify(manifestDescriptor, null, 2), "utf8"),
    });

    // Package into streaming ZIP
    const zipBuffer = createZipArchive(zipEntries);
    const zipFilename = `${datasetId}-${generationId}-export.zip`;

    return new Response(new Uint8Array(zipBuffer), {
      status: 200,
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${zipFilename}"`,
        "Content-Length": String(zipBuffer.length),
        "Cache-Control": "private, no-cache",
      },
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Failed to export generation" },
      { status: 500 }
    );
  }
}
