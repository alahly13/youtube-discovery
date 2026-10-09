import { NextResponse } from "next/server";
import {
  createUserPlaylist,
  listUserPlaylists,
} from "@/lib/playlists/playlist-archive";
import { createPlaylistSchema } from "@/lib/validation/library-schemas";
import { emptyPlaylistManifest } from "@/types/library";
import { assertSameOrigin, requireAdmin } from "@/lib/auth/require-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/playlists — lightweight index only (never full contents).
 * PUT/POST bodies are validated with Zod; no secrets are accepted here.
 */
export async function GET(request: Request) {
  const guard = await requireAdmin(request);
  if (!guard.ok) return guard.response;
  try {
    const playlists = await listUserPlaylists();
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
    const body: unknown = await request.json();
    const parsed = createPlaylistSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid playlist payload", details: parsed.error.flatten() },
        { status: 400 },
      );
    }
    const manifest = emptyPlaylistManifest(
      parsed.data.name,
      parsed.data.description ?? null,
    );
    const saved = await createUserPlaylist(manifest);
    return NextResponse.json(
      { success: true, manifest: saved.manifest },
      { status: 201 },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to create playlist";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
