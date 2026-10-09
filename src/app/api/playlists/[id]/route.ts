import { NextResponse } from "next/server";
import { assertSameOrigin, requireAdmin } from "@/lib/auth/require-auth";
import {
  deleteUserPlaylist,
  readUserPlaylist,
  replaceUserPlaylist,
} from "@/lib/playlists/playlist-archive";
import {
  updatePlaylistMetaSchema,
  userPlaylistManifestSchema,
} from "@/lib/validation/library-schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/playlists/[id] — full self-contained manifest.
 * PUT accepts either a full manifest (validated) or a meta patch
 * ({name?, description?}). DELETE removes only this playlist's file.
 * A missing/corrupt manifest returns 404/410 — never a whole-library crash.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireAdmin(request);
  if (!guard.ok) return guard.response;
  try {
    const { id } = await params;
    const found = await readUserPlaylist(id);
    if (!found) {
      return NextResponse.json(
        { error: "Playlist not found or unreadable", id, recoverable: true },
        { status: 404 },
      );
    }
    return NextResponse.json({ manifest: found.manifest });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to read playlist";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const csrf = assertSameOrigin(request);
  if (csrf) return csrf;
  const guard = await requireAdmin(request);
  if (!guard.ok) return guard.response;
  try {
    const { id } = await params;
    const body: unknown = await request.json();

    // Meta patch path: { name?, description? }
    const metaPatch = updatePlaylistMetaSchema.safeParse(body);
    const looksLikeMetaPatch =
      typeof body === "object" &&
      body !== null &&
      !("manifestVersion" in body) &&
      !("items" in body);
    if (looksLikeMetaPatch) {
      if (
        !metaPatch.success ||
        (metaPatch.data.name === undefined && metaPatch.data.description === undefined)
      ) {
        return NextResponse.json(
          { error: "Invalid playlist update: expected {name?, description?} or a full manifest" },
          { status: 400 },
        );
      }
      const found = await readUserPlaylist(id);
      if (!found) {
        return NextResponse.json({ error: "Playlist not found", id }, { status: 404 });
      }
      const next = {
        ...found.manifest,
        playlist: {
          ...found.manifest.playlist,
          name: metaPatch.data.name ?? found.manifest.playlist.name,
          description:
            metaPatch.data.description !== undefined
              ? (metaPatch.data.description?.trim() || null)
              : found.manifest.playlist.description,
          updatedAt: new Date().toISOString(),
        },
      };
      const saved = await replaceUserPlaylist(id, next);
      if (!saved) {
        return NextResponse.json({ error: "Playlist not found", id }, { status: 404 });
      }
      return NextResponse.json({ success: true, manifest: saved.manifest });
    }

    // Full-manifest replace path (validated, atomic).
    const parsed = userPlaylistManifestSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid playlist manifest", details: parsed.error.flatten() },
        { status: 400 },
      );
    }
    if (parsed.data.playlist.id !== id) {
      return NextResponse.json(
        { error: "Manifest id does not match route id" },
        { status: 400 },
      );
    }
    const saved = await replaceUserPlaylist(id, {
      ...parsed.data,
      playlist: {
        ...parsed.data.playlist,
        updatedAt: new Date().toISOString(),
      },
    });
    if (!saved) {
      return NextResponse.json({ error: "Playlist not found", id }, { status: 404 });
    }
    return NextResponse.json({ success: true, manifest: saved.manifest });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to update playlist";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const csrf = assertSameOrigin(request);
  if (csrf) return csrf;
  const guard = await requireAdmin(request);
  if (!guard.ok) return guard.response;
  try {
    const { id } = await params;
    const ok = await deleteUserPlaylist(id);
    if (!ok) {
      return NextResponse.json({ error: "Playlist not found", id }, { status: 404 });
    }
    // Deleting a playlist never deletes global saved entities or searches.
    return NextResponse.json({ success: true, id });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to delete playlist";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
