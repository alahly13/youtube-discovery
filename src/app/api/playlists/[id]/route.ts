import { NextResponse } from "next/server";
import { assertSameOrigin, requireAdmin } from "@/lib/auth/require-auth";
import { resolveStorageOwnerId } from "@/lib/auth/storage-owner";
import { readUserPlaylist } from "@/lib/playlists/playlist-archive";
import {
  deletePlaylistFromDb,
  getPlaylistManifestFromDb,
  syncPlaylistToDb,
} from "@/lib/playlists/playlist-db-service";
import {
  updatePlaylistMetaSchema,
  userPlaylistManifestSchema,
} from "@/lib/validation/library-schemas";
import type { UserPlaylistManifest } from "@/types/library";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

function sanitizeId(raw: string): string | null {
  const clean = raw.trim();
  if (!clean || !/^[a-zA-Z0-9_-]{3,80}$/.test(clean)) return null;
  return clean;
}

export async function GET(request: Request, context: RouteContext) {
  const guard = await requireAdmin(request);
  if (!guard.ok) return guard.response;

  const storageOwnerUuid = resolveStorageOwnerId(guard.admin);
  if (!storageOwnerUuid) {
    return NextResponse.json(
      { error: "Unable to resolve a canonical storage owner for this session." },
      { status: 500 }
    );
  }

  const { id: rawId } = await context.params;
  const id = sanitizeId(rawId);
  if (!id) {
    return NextResponse.json({ error: "Invalid playlist id" }, { status: 400 });
  }

  try {
    const dbManifest = await getPlaylistManifestFromDb(storageOwnerUuid, id);
    if (dbManifest) {
      return NextResponse.json({ manifest: dbManifest });
    }

    // Read-only fallback to legacy disk/v1 archive if not yet migrated into Postgres.
    const legacyRecord = await readUserPlaylist(id);
    if (!legacyRecord?.manifest) {
      return NextResponse.json({ error: "Playlist not found" }, { status: 404 });
    }
    return NextResponse.json({ manifest: legacyRecord.manifest });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to read playlist";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function PUT(request: Request, context: RouteContext) {
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

  const { id: rawId } = await context.params;
  const id = sanitizeId(rawId);
  if (!id) {
    return NextResponse.json({ error: "Invalid playlist id" }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = userPlaylistManifestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid playlist manifest" },
      { status: 400 }
    );
  }

  if (parsed.data.playlist.id !== id) {
    return NextResponse.json({ error: "Playlist id mismatch" }, { status: 400 });
  }

  try {
    const manifest: UserPlaylistManifest = {
      ...parsed.data,
      playlist: {
        ...parsed.data.playlist,
        updatedAt: new Date().toISOString(),
      },
    };
    const synced = await syncPlaylistToDb(storageOwnerUuid, manifest);
    if (!synced) {
      return NextResponse.json(
        { error: "Failed to save playlist to PostgreSQL database" },
        { status: 500 }
      );
    }
    return NextResponse.json({ manifest });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to write playlist";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function PATCH(request: Request, context: RouteContext) {
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

  const { id: rawId } = await context.params;
  const id = sanitizeId(rawId);
  if (!id) {
    return NextResponse.json({ error: "Invalid playlist id" }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = updatePlaylistMetaSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid update" },
      { status: 400 }
    );
  }

  try {
    const existing =
      (await getPlaylistManifestFromDb(storageOwnerUuid, id)) ??
      (await readUserPlaylist(id))?.manifest ??
      null;
    if (!existing) {
      return NextResponse.json({ error: "Playlist not found" }, { status: 404 });
    }
    const next: UserPlaylistManifest = {
      ...existing,
      playlist: {
        ...existing.playlist,
        name: parsed.data.name ?? existing.playlist.name,
        description:
          parsed.data.description === undefined
            ? existing.playlist.description
            : parsed.data.description,
        updatedAt: new Date().toISOString(),
      },
    };
    const synced = await syncPlaylistToDb(storageOwnerUuid, next);
    if (!synced) {
      return NextResponse.json(
        { error: "Failed to update playlist in PostgreSQL database" },
        { status: 500 }
      );
    }
    return NextResponse.json({ manifest: next });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to update playlist";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function DELETE(request: Request, context: RouteContext) {
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

  const { id: rawId } = await context.params;
  const id = sanitizeId(rawId);
  if (!id) {
    return NextResponse.json({ error: "Invalid playlist id" }, { status: 400 });
  }

  try {
    const deletedFromDb = await deletePlaylistFromDb(storageOwnerUuid, id);
    if (!deletedFromDb) {
      const legacy = await readUserPlaylist(id).catch(() => null);
      if (!legacy) {
        return NextResponse.json({ error: "Playlist not found" }, { status: 404 });
      }
    }
    return NextResponse.json({ deleted: true, id });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to delete playlist";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
