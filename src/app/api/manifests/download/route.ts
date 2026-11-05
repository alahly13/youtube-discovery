import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/require-auth";
import {
  isOwnerScopedStorageKey,
  resolveLegacyOwnerIds,
  resolveStorageOwnerId,
} from "@/lib/auth/storage-owner";
import { getNewStorageBackend } from "@/lib/storage/r2-blob-backend";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * GET /api/manifests/download?path=<storagePath>
 * ──────────────────────────────────────────────────────────────────────────
 * Streams an individual immutable manifest part directly to the caller,
 * verifying that the path is strictly within the caller's storage partition
 * (supports both canonical asdy/persistence/<ownerId>/ and legacy <ownerId>/).
 * ═══════════════════════════════════════════════════════════════════════════
 */

export async function GET(request: Request) {
  const auth = await requireAdmin(request);
  if (!auth.ok) return auth.response;

  const storageOwnerUuid = resolveStorageOwnerId(auth.admin);
  if (!storageOwnerUuid) {
    return NextResponse.json(
      { ok: false, error: "Unable to resolve a canonical storage owner for this session." },
      { status: 500 }
    );
  }
  const { searchParams } = new URL(request.url);
  const targetPath = searchParams.get("path");

  if (!targetPath) {
    return NextResponse.json({ ok: false, error: "Missing required path parameter" }, { status: 400 });
  }

  // Directory traversal prevention
  if (targetPath.includes("../") || targetPath.includes("..\\")) {
    return NextResponse.json({ ok: false, error: "Invalid storage path" }, { status: 400 });
  }

  // Enforce owner partition isolation across canonical and historical layouts.
  const allowedOwners = resolveLegacyOwnerIds(auth.admin);
  if (!isOwnerScopedStorageKey(targetPath, allowedOwners)) {
    return NextResponse.json(
      { ok: false, error: "Access denied: requested storage path outside owner partition" },
      { status: 403 }
    );
  }

  try {
    const backend = getNewStorageBackend();
    const bytes = await backend.getBytes(targetPath);
    const filename = targetPath.split("/").pop() || "manifest-part.json";

    return new Response(new Uint8Array(bytes), {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Content-Length": String(bytes.length),
        "Cache-Control": "private, no-cache",
      },
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Failed to download part" },
      { status: 404 }
    );
  }
}
