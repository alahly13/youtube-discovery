import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/require-auth";
import { getArchivedManifestById } from "@/lib/old/archive-store";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * GET /api/old/[archiveId]
 * ──────────────────────────────────────────────────────────────────────────
 * Retrieves full archived manifest details and payload items for a specific
 * archive ID or manifest ID.
 * ═══════════════════════════════════════════════════════════════════════════
 */

export async function GET(
  request: Request,
  context: { params: Promise<{ archiveId: string }> }
) {
  const auth = await requireAdmin(request);
  if (!auth.ok) return auth.response;

  const ownerId = auth.admin.profileId || auth.admin.userId || "00000000-0000-0000-0000-000000000001";
  const storageOwnerUuid = auth.admin.storageOwnerUuid || auth.admin.userId || "00000000-0000-0000-0000-000000000001";
  const { archiveId } = await context.params;

  try {
    const result = await getArchivedManifestById(ownerId, storageOwnerUuid, archiveId);

    return NextResponse.json({
      ok: true,
      record: result.record,
      envelope: result.envelope,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to retrieve archived manifest.";
    return NextResponse.json(
      {
        ok: false,
        error: message,
      },
      { status: 404 }
    );
  }
}
