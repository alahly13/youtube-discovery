import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/require-auth";
import {
  resolveProfileId,
  resolveStorageOwnerId,
} from "@/lib/auth/storage-owner";
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

  // Database ownership uses the profile UUID; R2 ownership uses the canonical
  // storage owner UUID. They are different identifiers and must not be mixed.
  const ownerId = resolveProfileId(auth.admin);
  const storageOwnerUuid = resolveStorageOwnerId(auth.admin);
  if (!ownerId || !storageOwnerUuid) {
    return NextResponse.json(
      { ok: false, error: "Unable to resolve the canonical profile/storage owner for this session." },
      { status: 500 }
    );
  }

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
