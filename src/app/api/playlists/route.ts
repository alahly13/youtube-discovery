import { NextResponse } from "next/server";
import {
  createUserPlaylist,
  listUserPlaylists,
} from "@/lib/playlists/playlist-archive";
import {
  listPlaylistsFromDb,
  syncPlaylistToDb,
} from "@/lib/playlists/playlist-db-service";
import { createPlaylistSchema } from "@/lib/validation/library-schemas";
import { emptyPlaylistManifest } from "@/types/library";
import { assertSameOrigin, requireAdmin } from "@/lib/auth/require-auth";
import { resolveStorageOwnerId } from "@/lib/auth/storage-owner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * GET /api/playlists — lightweight index only (never full contents).
 * POST /api/playlists — creates a new playlist with validated name and description.
 * Synchronizes with both PostgreSQL and Cloudflare R2 / storage backend.
 * ═══════════════════════════════════════════════════════════════════════════
 */
export async function GET(request: Request) {
  const guard = await requireAdmin(request);
  if (!guard.ok) return guard.response;

  try {
    const storageOwnerUuid = resolveStorageOwnerId(guard.admin);
    if (!storageOwnerUuid) {
      return NextResponse.json(
        { error: "Unable to resolve a canonical storage owner for this session." },
        { status: 500 }
      );
    }

    // 1. Try PostgreSQL first
    const dbPlaylists = await listPlaylistsFromDb(storageOwnerUuid);

    // 2. Read from Cloudflare R2 / storage archive
    const r2Playlists = await listUserPlaylists();

    // Prefer DB if available; otherwise use R2 / storage backend
    const playlists = dbPlaylists && dbPlaylists.length > 0 ? dbPlaylists : r2Playlists;

    return NextResponse.json({ playlists, totalCount: playlists.length });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to list playlists";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const csrf = assertSameOrigin(request);
  if (csrf) return csrf;
  const guard = await requireAdmin(request);
  if (!guard.ok) return guard.response;

  try {
    const storageOwnerUuid = resolveStorageOwnerId(guard.admin);
    if (!storageOwnerUuid) {
      return NextResponse.json(
        { error: "Unable to resolve a canonical storage owner for this session." },
        { status: 500 }
      );
    }
    const body: unknown = await request.json();
    const parsed = createPlaylistSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid playlist payload", details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    const description = parsed.data.description?.trim() ? parsed.data.description.trim() : null;
    const manifest = emptyPlaylistManifest(parsed.data.name, description);

    // 1. Authoritative storage persistence (Cloudflare R2 / Disk)
    const saved = await createUserPlaylist(manifest);

    // 2. Relational database persistence (PostgreSQL / Prisma 7)
    await syncPlaylistToDb(storageOwnerUuid, saved.manifest);

    return NextResponse.json(
      { success: true, manifest: saved.manifest },
      { status: 201 },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to create playlist";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
