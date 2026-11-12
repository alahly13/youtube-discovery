import { NextResponse } from "next/server";
import { NEW_R2_BUCKET, getNewStorageBackend } from "@/lib/storage/r2-blob-backend";
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

  const hasNewWorkerUrl = Boolean(process.env.R2_NEW_WORKER_URL?.trim());
  const hasOldWorkerUrl = Boolean(process.env.R2_OLD_WORKER_URL?.trim());
  const hasNewSecret = Boolean(
    process.env.R2_NEW_WORKER_AUTH_SECRET?.trim() ||
      process.env.WORKER_AUTH_SECRET?.trim() ||
      process.env.R2_WORKER_AUTH_SECRET?.trim()
  );
  const hasOldSecret = Boolean(
    process.env.R2_OLD_WORKER_AUTH_SECRET?.trim() ||
      process.env.WORKER_AUTH_SECRET?.trim() ||
      process.env.R2_WORKER_AUTH_SECRET?.trim()
  );
  const isR2Configured = (hasNewWorkerUrl && hasNewSecret) || (hasOldWorkerUrl && hasOldSecret);

  const blob = {
    configured: isR2Configured,
    authMode: isR2Configured ? "cloudflare-r2-worker" : "local-disk-fallback",
    storeIdSet: Boolean(NEW_R2_BUCKET),
    newWorkerConfigured: hasNewWorkerUrl && hasNewSecret,
    oldWorkerConfigured: hasOldWorkerUrl && hasOldSecret,
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
