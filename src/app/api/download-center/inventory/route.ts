import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/require-auth";
import { getDownloadCenterInventory } from "@/lib/download-center/download-center-service";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * GET /api/download-center/inventory
 * ──────────────────────────────────────────────────────────────────────────
 * Returns the unified inventory of all NEW and OLD manifests across all 8
 * categories with counts, sizes, and verification status.
 * ═══════════════════════════════════════════════════════════════════════════
 */

export async function GET(request: Request) {
  const auth = await requireAdmin(request);
  if (!auth.ok) return auth.response;

  const ownerId = auth.admin.userId || "00000000-0000-0000-0000-000000000001";
  const storageOwnerUuid = auth.admin.userId || "00000000-0000-0000-0000-000000000001";

  try {
    const inventory = await getDownloadCenterInventory(ownerId, storageOwnerUuid);
    return NextResponse.json({
      ok: true,
      inventory,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to load Download Center inventory.";
    return NextResponse.json(
      {
        ok: false,
        error: message,
      },
      { status: 500 }
    );
  }
}
