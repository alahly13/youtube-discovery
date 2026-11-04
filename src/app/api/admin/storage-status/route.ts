import { NextResponse } from "next/server";
import { getNewStorageBackend } from "@/lib/storage/r2-blob-backend";
import { getLoginUsername } from "@/lib/auth/account-store";
import { getSessionTtlSeconds } from "@/lib/auth/session";
import { isKeyEncryptionAvailable } from "@/lib/keys/key-crypto";
import { requireAdmin } from "@/lib/auth/require-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/admin/storage-status — Cloudflare R2 / auth / encryption readiness WITHOUT
 * secret values. Used by Settings to show clear errors, never silent fallback.
 */
export async function GET(request: Request) {
  const guard = await requireAdmin(request);
  if (!guard.ok) return guard.response;

  const isR2Configured = Boolean(
    process.env.NEW_WORKER_URL?.trim() || process.env.OLD_WORKER_URL?.trim()
  );

  const blob = {
    configured: isR2Configured,
    authMode: isR2Configured ? "cloudflare-r2-worker" : "local-disk-fallback",
    storeIdSet: Boolean(process.env.NEW_R2_BUCKET?.trim() || "new-youtube-discovery-private"),
  };

  let username: string | null = null;
  const counts: Record<string, number> = {
    playlists: 0,
    savedSearches: 0,
  };

  try {
    const backend = getNewStorageBackend();
    username = await getLoginUsername(backend);
  } catch {
    // Status endpoint degrades gracefully; routes themselves enforce strictly.
  }

  return NextResponse.json({
    blob,
    encryptionAvailable: isKeyEncryptionAvailable(),
    username,
    counts,
    sessionTtlSeconds: getSessionTtlSeconds(),
  });
}
