import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/require-auth";
import { createDownloadCenterExport } from "@/lib/download-center/download-center-service";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * POST /api/download-center/export
 * ──────────────────────────────────────────────────────────────────────────
 * Generates and streams a downloadable ZIP archive containing the selected
 * manifests organized into ASDY/NEW/ and ASDY/OLD/ subdirectories.
 * ═══════════════════════════════════════════════════════════════════════════
 */

export async function POST(request: Request) {
  const auth = await requireAdmin(request);
  if (!auth.ok) return auth.response;

  const ownerId = auth.admin.userId || "00000000-0000-0000-0000-000000000001";
  const storageOwnerUuid = auth.admin.userId || "00000000-0000-0000-0000-000000000001";

  try {
    const body = (await request.json()) as {
      manifestIds?: string[];
      formatAsStandardEnvelope?: boolean;
    };

    const manifestIds = Array.isArray(body.manifestIds) ? body.manifestIds : [];
    if (manifestIds.length === 0) {
      return NextResponse.json(
        { ok: false, error: "Please select at least one manifest to export." },
        { status: 400 }
      );
    }

    const exportPackage = await createDownloadCenterExport(
      ownerId,
      storageOwnerUuid,
      manifestIds,
      {
        formatAsStandardEnvelope: body.formatAsStandardEnvelope ?? true,
      }
    );

    return new Response(new Uint8Array(exportPackage.zipBuffer), {
      status: 200,
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${exportPackage.filename}"`,
        "Content-Length": String(exportPackage.byteLength),
        "X-Export-Manifest-Count": String(exportPackage.manifestCount),
        "Cache-Control": "no-store, must-revalidate",
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to generate export package.";
    return NextResponse.json(
      {
        ok: false,
        error: message,
      },
      { status: 500 }
    );
  }
}
