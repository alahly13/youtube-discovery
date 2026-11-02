import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/require-auth";
import { listArchivedManifests } from "@/lib/old/archive-store";
import type { OldArchiveCategory } from "@/lib/old/archive-envelope";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * GET /api/old/list
 * ──────────────────────────────────────────────────────────────────────────
 * Returns all archived manifests for the authenticated administrator.
 * Supports optional ?category= query param (saved-items, saved-titles, etc.).
 * ═══════════════════════════════════════════════════════════════════════════
 */

export async function GET(request: Request) {
  const auth = await requireAdmin(request);
  if (!auth.ok) return auth.response;

  const ownerId = auth.admin.userId || "00000000-0000-0000-0000-000000000001";
  const storageOwnerUuid = auth.admin.userId || "00000000-0000-0000-0000-000000000001";

  try {
    const url = new URL(request.url);
    const categoryParam = url.searchParams.get("category") as OldArchiveCategory | null;

    const manifests = await listArchivedManifests(
      ownerId,
      storageOwnerUuid,
      categoryParam || undefined
    );

    return NextResponse.json({
      ok: true,
      count: manifests.length,
      manifests,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to list archived manifests.";
    return NextResponse.json(
      {
        ok: false,
        error: message,
      },
      { status: 500 }
    );
  }
}
