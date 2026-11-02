import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/require-auth";
import { getArchivedManifestById } from "@/lib/old/archive-store";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * GET /api/old/[archiveId]/download
 * ──────────────────────────────────────────────────────────────────────────
 * Streams the archived manifest JSON file to the browser with standard
 * Content-Disposition attachment headers.
 * ═══════════════════════════════════════════════════════════════════════════
 */

export async function GET(
  request: Request,
  context: { params: Promise<{ archiveId: string }> }
) {
  const auth = await requireAdmin(request);
  if (!auth.ok) return auth.response;

  const ownerId = auth.admin.userId || "00000000-0000-0000-0000-000000000001";
  const storageOwnerUuid = auth.admin.userId || "00000000-0000-0000-0000-000000000001";
  const { archiveId } = await context.params;

  try {
    const { record, envelope } = await getArchivedManifestById(ownerId, storageOwnerUuid, archiveId);
    const serialized = JSON.stringify(envelope, null, 2);
    const bytes = Buffer.from(serialized, "utf8");

    const safeFilename = `archived-${record.category}-${record.manifest_id}.json`.replace(/[^a-zA-Z0-9_.-]/g, "_");

    return new Response(new Uint8Array(bytes), {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="${safeFilename}"`,
        "Content-Length": String(bytes.byteLength),
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to download archived manifest.";
    return NextResponse.json(
      {
        ok: false,
        error: message,
      },
      { status: 404 }
    );
  }
}
