import { NextResponse } from "next/server";
import { listUserPlaylists } from "@/lib/playlists/playlist-archive";
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
 * /api/playlists — Canonical PostgreSQL Primary (Legacy Read-Only Fallback)
 * ──────────────────────────────────────────────────────────────────────────
 * Writes ONLY to canonical Supabase PostgreSQL (`user_playlists`).
 * Reads from PostgreSQL first and merges any legacy `youtube-discovery/v1/`
 * playlists on read-only fallback so older backups remain visible without
 * writing new legacy disk/v1 objects on Vercel.
 * ═══════════════════════════════════════════════════════════════════════════
 */

export async function GET(request: Request) {
  const guard = await requireAdmin(request);
  if (!guard.ok) return guard.response;

  const storageOwnerUuid = resolveStorageOwnerId(guard.admin);
  if (!storageOwnerUuid) {
    return NextResponse.json(
      { error: "Unable to resolve a canonical storage owner for this session." },
      { status: 500 }
    );
  }

  try {
    const dbPlaylists = await listPlaylistsFromDb(storageOwnerUuid);
    if (dbPlaylists !== null) {
      if (dbPlaylists.length > 0) {
        return NextResponse.json({ playlists: dbPlaylists });
      }
      // If DB has 0 rows, safely check read-only legacy archive without mutating it.
      const legacyPlaylists = await listUserPlaylists().catch(() => []);
      return NextResponse.json({
        playlists: legacyPlaylists.length > 0 ? legacyPlaylists : dbPlaylists,
      });
    }

    const fallbackPlaylists = await listUserPlaylists();
    return NextResponse.json({ playlists: fallbackPlaylists });
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

  const storageOwnerUuid = resolveStorageOwnerId(guard.admin);
  if (!storageOwnerUuid) {
    return NextResponse.json(
      { error: "Unable to resolve a canonical storage owner for this session." },
      { status: 500 }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = createPlaylistSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid playlist input" },
      { status: 400 }
    );
  }

  const description =
    typeof parsed.data.description === "string" && parsed.data.description.trim()
      ? parsed.data.description.trim()
      : null;

  const manifest = emptyPlaylistManifest(parsed.data.name, description);

  try {
    const synced = await syncPlaylistToDb(storageOwnerUuid, manifest);
    if (!synced) {
      return NextResponse.json(
        { error: "Failed to persist playlist to PostgreSQL database" },
        { status: 500 }
      );
    }
    return NextResponse.json({ manifest }, { status: 201 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to create playlist";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
