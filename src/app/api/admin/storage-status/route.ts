import { NextResponse } from "next/server";
import { getBlobBackend } from "@/lib/blob/backend-factory";
import { describeBlobConfig } from "@/lib/blob/blob-config";
import { readIndex } from "@/lib/blob/record-store";
import { getLoginUsername } from "@/lib/auth/account-store";
import { isKeyEncryptionAvailable } from "@/lib/keys/key-crypto";
import { requireAdmin } from "@/lib/auth/require-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/admin/storage-status — Blob/auth/encryption readiness WITHOUT
 * secret values. Used by Settings to show clear errors, never silent fallback.
 */
export async function GET(request: Request) {
  const guard = await requireAdmin(request);
  if (!guard.ok) return guard.response;
  const blob = describeBlobConfig();
  let username: string | null = null;
  const counts: Record<string, number> = {};
  try {
    const backend = getBlobBackend();
    username = await getLoginUsername(backend);
    const [pl, sh] = await Promise.all([
      readIndex(backend, "playlists").catch(() => ({ entries: [] })),
      readIndex(backend, "savedHistory").catch(() => ({ entries: [] })),
    ]);
    counts.playlists = pl.entries.length;
    counts.savedSearches = sh.entries.length;
  } catch {
    // Status endpoint degrades gracefully; routes themselves enforce strictly.
  }
  return NextResponse.json({
    blob,
    encryptionAvailable: isKeyEncryptionAvailable(),
    username,
    counts,
    sessionTtlSeconds: Number(process.env.ADMIN_SESSION_TTL_SECONDS) || 604800,
  });
}
