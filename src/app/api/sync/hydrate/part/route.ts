import "server-only";

import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/require-auth";
import { getR2WorkerStorageClient } from "@/lib/storage/r2-worker-storage-client";
import { parseStorageKey } from "@/lib/storage/canonical-paths";

export const dynamic = "force-dynamic";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * GET /api/sync/hydrate/part?path=<storagePath>
 * ──────────────────────────────────────────────────────────────────────────
 * Streams an individual immutable manifest part from Cloudflare R2 with:
 *   1. Strict administrator authentication via requireAdmin().
 *   2. Owner partition isolation: path must match caller's storage partition
 *      (either canonical asdy/persistence/<ownerId>/ or legacy <ownerId>/persistence/).
 *   3. Path traversal defense (no '..' or '\').
 *   4. Cryptographic SHA-256 integrity verification before returning.
 * ═══════════════════════════════════════════════════════════════════════════
 */
export async function GET(request: Request) {
  const auth = await requireAdmin(request);
  if (!auth.ok) return auth.response;

  const storageOwnerUuid = auth.admin.userId || "asdy-admin";
  const { searchParams } = new URL(request.url);
  const targetPath = searchParams.get("path");

  if (!targetPath) {
    return NextResponse.json({ ok: false, error: "Missing required path query parameter." }, { status: 400 });
  }

  // Path traversal defense
  if (targetPath.includes("..") || targetPath.includes("\\")) {
    return NextResponse.json({ ok: false, error: "Invalid path: traversal characters forbidden." }, { status: 400 });
  }

  // Owner partition isolation check
  const parsed = parseStorageKey(targetPath);
  const clean = targetPath.replace(/^\/+/, "");

  const isCanonicalOwner = clean.startsWith(`asdy/persistence/${storageOwnerUuid}/`);
  const isLegacyOwner = clean.startsWith(`${storageOwnerUuid}/persistence/`);

  if (!isCanonicalOwner && !isLegacyOwner && parsed?.ownerId !== storageOwnerUuid) {
    return NextResponse.json(
      { ok: false, error: "Access denied: requested storage path outside caller's authorized partition." },
      { status: 403 }
    );
  }

  try {
    const r2Client = getR2WorkerStorageClient();
    const { data, meta, sha256 } = await r2Client.getObject("NEW", clean, {
      storageOwnerUuid,
    });

    const filename = clean.split("/").pop() || "part.json";

    return new Response(new Uint8Array(data), {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `inline; filename="${filename}"`,
        "Content-Length": String(data.length),
        "ETag": `"${meta.etag.replace(/"/g, "")}"`,
        "X-Payload-SHA256": sha256,
        "Cache-Control": "private, max-age=86400, immutable",
      },
    });
  } catch (err) {
    console.error(`[sync/hydrate/part] Error downloading part at '${clean}':`, err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Failed to retrieve storage part." },
      { status: 502 }
    );
  }
}
