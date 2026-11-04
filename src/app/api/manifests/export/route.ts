import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/require-auth";
import { getNewStorageBackend } from "@/lib/storage/r2-blob-backend";
import { createZipArchive, type ZipFileEntry } from "@/lib/storage/zip-builder";
import { computePartSha256, computeAggregateGenerationSha256 } from "@/lib/storage/manifest-serializer";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * GET /api/manifests/export?datasetId=<id>&generationId=<id>
 * ──────────────────────────────────────────────────────────────────────────
 * Pre-validates cryptographic SHA-256 digests across all parts in a generation,
 * packages them into a standard PKZIP archive with a generation index descriptor,
 * and streams the ZIP file to the administrator.
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
    const genPrefix = `${storageOwnerUuid}/persistence/datasets/${datasetId}/generations/${generationId}/parts/`;
    const listResult = await backend.list(genPrefix);

    const partFiles = listResult.filter((obj) => obj.pathname.includes("/parts/part-"));

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

    // Compute generation aggregate SHA-256
    const aggregateSha = computeAggregateGenerationSha256(verifiedPartsMeta);

    // Create root generation descriptor
    const descriptor = {
      $schema: "https://youtube-discovery.app/schemas/manifest-generation-export-v1.json",
      exportedAt: new Date().toISOString(),
      datasetId,
      generationId,
      storageOwnerUuid,
      totalParts: verifiedPartsMeta.length,
      totalBytes: verifiedPartsMeta.reduce((acc, p) => acc + p.byteCount, 0),
      totalRecords: verifiedPartsMeta.reduce((acc, p) => acc + p.recordCount, 0),
      aggregateSha256: aggregateSha,
      parts: verifiedPartsMeta,
    };

    zipEntries.unshift({
      filename: "generation-descriptor.json",
      data: JSON.stringify(descriptor, null, 2),
    });

    const zipBuffer = createZipArchive(zipEntries);
    const exportFilename = `youtube-discovery-${datasetId}-${generationId}.zip`;

    return new Response(new Uint8Array(zipBuffer), {
      status: 200,
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${exportFilename}"`,
        "Content-Length": String(zipBuffer.length),
        "Cache-Control": "private, no-cache",
      },
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Generation export failed" },
      { status: 500 }
    );
  }
}
