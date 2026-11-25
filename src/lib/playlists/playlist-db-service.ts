import "server-only";

import crypto from "node:crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import {
  USER_PLAYLIST_MANIFEST_TYPE,
  USER_PLAYLIST_MANIFEST_VERSION,
  type LibraryCustomItem,
  type LibraryPlaylistGroup,
  type LibraryPlaylistItem,
  type LibraryYouTubeItem,
  type LibraryYouTubeKind,
  type LibraryYouTubeSnapshot,
  type UserPlaylistIndexEntry,
  type UserPlaylistManifest,
} from "@/types/library";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * User Playlists Database Service (Canonical Supabase PostgreSQL)
 * ──────────────────────────────────────────────────────────────────────────
 * Architecture Guarantees:
 *   1. Multi-user isolation: Every record is strictly scoped to owner_id.
 *   2. Bidirectional upl_* <-> UUID Identity Mapping:
 *      - `id` in PostgreSQL is a deterministic UUID (`toPlaylistUuid(rawId)`).
 *      - `record_id` preserves the client's original local/outbox ID
 *        (e.g. `upl_...`, `grp_...`, `yt-video:...`, `custom_...`) so Chrome
 *        IndexedDB, `/api/playlists`, `/api/sync/save-all`, and R2 manifests
 *        share the exact same external playlist ID with zero duplicates.
 *   3. Lossless Metadata (`snapshot_json`): Preserves full YouTube snapshot
 *      fields (`viewsCount`, `channelTitle`, `durationSeconds`, etc.) inside DB.
 * ═══════════════════════════════════════════════════════════════════════════
 */

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function toPlaylistUuid(id: string): string {
  const clean = id.trim();
  if (!clean) return crypto.randomUUID();
  if (UUID_REGEX.test(clean)) {
    return clean.toLowerCase();
  }
  const hash = crypto
    .createHash("sha256")
    .update(`yt-discovery-playlist:${clean}`)
    .digest("hex");
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}

export function toGroupUuid(id: string): string {
  if (!id || typeof id !== "string") return crypto.randomUUID();
  const clean = id.trim();
  if (UUID_REGEX.test(clean)) {
    return clean.toLowerCase();
  }
  const hash = crypto
    .createHash("sha256")
    .update(`yt-discovery-group:${clean}`)
    .digest("hex");
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}

export function toEntryUuid(id: string): string {
  if (!id || typeof id !== "string") return crypto.randomUUID();
  const clean = id.trim();
  if (UUID_REGEX.test(clean)) {
    return clean.toLowerCase();
  }
  const hash = crypto
    .createHash("sha256")
    .update(`yt-discovery-entry:${clean}`)
    .digest("hex");
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}

/**
 * Resolves the authenticated user's profile ID from storage owner UUID, auth user ID, or profile ID.
 */
async function resolveUserProfileId(storageOwnerUuid: string): Promise<string | null> {
  try {
    const clean = storageOwnerUuid.trim();
    const profile = await prisma.userProfile.findFirst({
      where: {
        OR: [
          { storage_owner_uuid: clean },
          { id: clean },
          { auth_user_id: clean },
        ],
        is_deleted: false,
      },
      select: { id: true },
    });
    return profile?.id ?? null;
  } catch {
    return null;
  }
}

function buildPlaylistWhereCandidates(ownerId: string, rawPlaylistId: string) {
  const clean = rawPlaylistId.trim();
  const uuidCandidate = toPlaylistUuid(clean);
  const candidates: Array<{ id?: string; record_id?: string }> = [
    { id: uuidCandidate },
    { record_id: clean },
  ];
  if (UUID_REGEX.test(clean) && clean.toLowerCase() !== uuidCandidate) {
    candidates.push({ id: clean.toLowerCase() });
  }
  return {
    owner_id: ownerId,
    OR: candidates,
  };
}

/**
 * Persists a complete UserPlaylistManifest into Supabase PostgreSQL,
 * mapping groups and entries deterministically while preserving original record_ids.
 */
export async function syncPlaylistToDb(
  storageOwnerUuid: string,
  manifest: UserPlaylistManifest
): Promise<boolean> {
  try {
    const ownerId = await resolveUserProfileId(storageOwnerUuid);
    if (!ownerId) return false;

    const rawPlaylistId = manifest.playlist.id.trim();
    const playlistUuid = toPlaylistUuid(rawPlaylistId);
    const isUuidInput = UUID_REGEX.test(rawPlaylistId);

    const existingRow = await prisma.userPlaylist.findFirst({
      where: buildPlaylistWhereCandidates(ownerId, rawPlaylistId),
      select: { id: true, record_id: true },
    });

    const targetPlaylistUuid = existingRow?.id ?? playlistUuid;
    const preservedRecordId = isUuidInput
      ? existingRow?.record_id ?? rawPlaylistId
      : rawPlaylistId;

    const thumbnails: string[] = [];
    for (const item of manifest.items) {
      if (item.kind === "youtube" && item.snapshot.thumbnailUrl) {
        if (!thumbnails.includes(item.snapshot.thumbnailUrl)) {
          thumbnails.push(item.snapshot.thumbnailUrl);
        }
        if (thumbnails.length >= 4) break;
      }
    }

    await prisma.$transaction(async (tx) => {
      await tx.userPlaylist.upsert({
        where: {
          owner_id_id: {
            owner_id: ownerId,
            id: targetPlaylistUuid,
          },
        },
        create: {
          id: targetPlaylistUuid,
          owner_id: ownerId,
          title: manifest.playlist.name.slice(0, 255),
          description: manifest.playlist.description,
          display_order: 0,
          total_items_count: manifest.items.length,
          thumbnail_urls: thumbnails,
          created_at: new Date(manifest.playlist.createdAt || Date.now()),
          updated_at: new Date(manifest.playlist.updatedAt || Date.now()),
          record_id: preservedRecordId.slice(0, 128),
        },
        update: {
          title: manifest.playlist.name.slice(0, 255),
          description: manifest.playlist.description,
          total_items_count: manifest.items.length,
          thumbnail_urls: thumbnails,
          updated_at: new Date(manifest.playlist.updatedAt || Date.now()),
          record_id: preservedRecordId.slice(0, 128),
        },
      });

      const activeGroupIds: string[] = [];
      for (const g of manifest.groups) {
        const gUuid = toGroupUuid(g.id);
        activeGroupIds.push(gUuid);

        await tx.userPlaylistGroup.upsert({
          where: {
            playlist_id_id: {
              playlist_id: targetPlaylistUuid,
              id: gUuid,
            },
          },
          create: {
            id: gUuid,
            owner_id: ownerId,
            playlist_id: targetPlaylistUuid,
            title: g.title.slice(0, 255),
            notes: g.description,
            position: g.position,
            created_at: new Date(g.createdAt || Date.now()),
            updated_at: new Date(g.updatedAt || Date.now()),
            record_id: g.id.slice(0, 128),
          },
          update: {
            title: g.title.slice(0, 255),
            notes: g.description,
            position: g.position,
            updated_at: new Date(g.updatedAt || Date.now()),
            record_id: g.id.slice(0, 128),
          },
        });
      }

      await tx.userPlaylistGroup.deleteMany({
        where: {
          owner_id: ownerId,
          playlist_id: targetPlaylistUuid,
          ...(activeGroupIds.length > 0 ? { id: { notIn: activeGroupIds } } : {}),
        },
      });

      const activeEntryIds: string[] = [];
      for (const item of manifest.items) {
        const eUuid = toEntryUuid(item.entryId);
        activeEntryIds.push(eUuid);

        const mappedGroupId = item.groupId ? toGroupUuid(item.groupId) : null;
        const validGroupId =
          mappedGroupId && activeGroupIds.includes(mappedGroupId) ? mappedGroupId : null;

        let entityType: "VIDEO" | "CHANNEL" | "PLAYLIST" | "CUSTOM" = "CUSTOM";
        if (item.kind === "youtube") {
          if (item.youtubeKind === "channel") entityType = "CHANNEL";
          else if (item.youtubeKind === "youtube_playlist") entityType = "PLAYLIST";
          else entityType = "VIDEO";
        }

        const platformItemId =
          item.kind === "youtube" ? item.snapshot.platformItemId : null;
        const customTitle = item.kind === "custom" ? item.title.slice(0, 512) : null;
        const customUrl =
          item.kind === "custom"
            ? item.url?.slice(0, 1024) ?? null
            : item.snapshot.url.slice(0, 1024);
        const notes = item.kind === "custom" ? item.customNote ?? item.note : item.note;
        const snapshotJson = (
          item.kind === "youtube"
            ? {
                kind: "youtube",
                youtubeKind: item.youtubeKind,
                snapshot: item.snapshot,
                note: item.note,
              }
            : {
                kind: "custom",
                customNote: item.customNote,
                note: item.note,
              }
        ) as Prisma.InputJsonValue;

        await tx.userPlaylistEntry.upsert({
          where: { id: eUuid },
          create: {
            id: eUuid,
            owner_id: ownerId,
            playlist_id: targetPlaylistUuid,
            group_id: validGroupId,
            entity_type: entityType,
            platform_item_id: platformItemId?.slice(0, 64) ?? null,
            custom_title: customTitle,
            custom_url: customUrl,
            notes,
            position: item.position,
            added_at: new Date(item.addedAt || Date.now()),
            record_id: item.entryId.slice(0, 128),
            snapshot_json: snapshotJson,
          },
          update: {
            group_id: validGroupId,
            entity_type: entityType,
            platform_item_id: platformItemId?.slice(0, 64) ?? null,
            custom_title: customTitle,
            custom_url: customUrl,
            notes,
            position: item.position,
            record_id: item.entryId.slice(0, 128),
            snapshot_json: snapshotJson,
          },
        });
      }

      await tx.userPlaylistEntry.deleteMany({
        where: {
          owner_id: ownerId,
          playlist_id: targetPlaylistUuid,
          ...(activeEntryIds.length > 0 ? { id: { notIn: activeEntryIds } } : {}),
        },
      });
    });

    return true;
  } catch (err) {
    console.warn("[playlist-db-service] Failed syncing playlist to DB:", err);
    return false;
  }
}

/**
 * Deletes a playlist explicitly requested by the user (matches both upl_* and UUID).
 */
export async function deletePlaylistFromDb(
  storageOwnerUuid: string,
  playlistId: string
): Promise<boolean> {
  try {
    const ownerId = await resolveUserProfileId(storageOwnerUuid);
    if (!ownerId) return false;

    const deleted = await prisma.userPlaylist.deleteMany({
      where: buildPlaylistWhereCandidates(ownerId, playlistId),
    });

    return deleted.count > 0;
  } catch (err) {
    console.warn("[playlist-db-service] Failed deleting playlist from DB:", err);
    return false;
  }
}

/**
 * Reads a full UserPlaylistManifest directly from Supabase PostgreSQL,
 * reconstructing original `upl_*` ID, groups, and full entry snapshots.
 */
export async function getPlaylistManifestFromDb(
  storageOwnerUuid: string,
  playlistId: string
): Promise<UserPlaylistManifest | null> {
  try {
    const ownerId = await resolveUserProfileId(storageOwnerUuid);
    if (!ownerId) return null;

    const row = await prisma.userPlaylist.findFirst({
      where: buildPlaylistWhereCandidates(ownerId, playlistId),
      include: {
        groups: { orderBy: { position: "asc" } },
        entries: { orderBy: { position: "asc" } },
      },
    });
    if (!row) return null;

    const groupIdMap = new Map<string, string>();
    const groups: LibraryPlaylistGroup[] = row.groups.map((g) => {
      const canonicalGroupId = g.record_id || g.id;
      groupIdMap.set(g.id, canonicalGroupId);
      return {
        id: canonicalGroupId,
        title: g.title,
        description: g.notes ?? null,
        position: g.position,
        createdAt: g.created_at.toISOString(),
        updatedAt: g.updated_at.toISOString(),
      };
    });

    const items: LibraryPlaylistItem[] = row.entries.map((e) => {
      const snapObj =
        e.snapshot_json && typeof e.snapshot_json === "object"
          ? (e.snapshot_json as Record<string, unknown>)
          : null;
      const mappedGroupId = e.group_id ? groupIdMap.get(e.group_id) ?? e.group_id : null;
      const addedIso = e.added_at.toISOString();

      if (e.entity_type === "CUSTOM") {
        const customItem: LibraryCustomItem = {
          kind: "custom",
          entryId: e.record_id || e.id,
          position: e.position,
          groupId: mappedGroupId,
          addedAt: addedIso,
          updatedAt: row.updated_at.toISOString(),
          note: (typeof snapObj?.note === "string" ? snapObj.note : e.notes) ?? null,
          title: e.custom_title || "Custom item",
          customNote:
            (typeof snapObj?.customNote === "string" ? snapObj.customNote : e.notes) ?? null,
          url: e.custom_url ?? null,
        };
        return customItem;
      }

      const rawSnap =
        snapObj?.snapshot && typeof snapObj.snapshot === "object"
          ? (snapObj.snapshot as Partial<LibraryYouTubeSnapshot>)
          : {};
      const defaultYKind: LibraryYouTubeKind =
        e.entity_type === "CHANNEL"
          ? "channel"
          : e.entity_type === "PLAYLIST"
          ? "youtube_playlist"
          : "video";
      const youtubeKind =
        typeof snapObj?.youtubeKind === "string"
          ? (snapObj.youtubeKind as LibraryYouTubeKind)
          : defaultYKind;
      const platformItemId = rawSnap.platformItemId || e.platform_item_id || e.id;

      const snapshot: LibraryYouTubeSnapshot = {
        platformItemId,
        title: rawSnap.title || e.custom_title || platformItemId,
        description: rawSnap.description ?? null,
        thumbnailUrl: rawSnap.thumbnailUrl ?? null,
        channelId: rawSnap.channelId ?? null,
        channelTitle: rawSnap.channelTitle ?? null,
        publishedAt: rawSnap.publishedAt ?? null,
        viewsCount: typeof rawSnap.viewsCount === "number" ? rawSnap.viewsCount : null,
        likesCount: typeof rawSnap.likesCount === "number" ? rawSnap.likesCount : null,
        commentsCount: typeof rawSnap.commentsCount === "number" ? rawSnap.commentsCount : null,
        durationSeconds:
          typeof rawSnap.durationSeconds === "number" ? rawSnap.durationSeconds : null,
        itemCount: typeof rawSnap.itemCount === "number" ? rawSnap.itemCount : null,
        url: rawSnap.url || e.custom_url || `https://www.youtube.com/watch?v=${platformItemId}`,
        sourceItemType:
          rawSnap.sourceItemType ||
          (youtubeKind === "shorts"
            ? "shorts_like"
            : youtubeKind === "channel"
            ? "channel"
            : youtubeKind === "youtube_playlist"
            ? "playlist"
            : "video"),
        isShortsLike: Boolean(rawSnap.isShortsLike ?? youtubeKind === "shorts"),
        isAgeRestricted: rawSnap.isAgeRestricted,
      };

      const ytItem: LibraryYouTubeItem = {
        kind: "youtube",
        youtubeKind,
        entryId: e.record_id || e.id,
        position: e.position,
        groupId: mappedGroupId,
        addedAt: addedIso,
        updatedAt: row.updated_at.toISOString(),
        note: (typeof snapObj?.note === "string" ? snapObj.note : e.notes) ?? null,
        snapshot,
      };
      return ytItem;
    });

    return {
      manifestVersion: USER_PLAYLIST_MANIFEST_VERSION,
      type: USER_PLAYLIST_MANIFEST_TYPE,
      playlist: {
        id: row.record_id || row.id,
        name: row.title,
        description: row.description ?? null,
        createdAt: row.created_at.toISOString(),
        updatedAt: row.updated_at.toISOString(),
      },
      groups,
      items,
    };
  } catch (err) {
    console.warn("[playlist-db-service] Failed reading playlist from DB:", err);
    return null;
  }
}

/**
 * Reads user playlists directly from Supabase PostgreSQL for an owner, returning
 * canonical `upl_*` IDs (via `record_id || id`) matching IndexedDB and R2.
 */
export async function listPlaylistsFromDb(
  storageOwnerUuid: string
): Promise<UserPlaylistIndexEntry[] | null> {
  try {
    const ownerId = await resolveUserProfileId(storageOwnerUuid);
    if (!ownerId) return null;

    const playlists = await prisma.userPlaylist.findMany({
      where: { owner_id: ownerId },
      include: {
        groups: { select: { id: true } },
        entries: {
          select: {
            entity_type: true,
            snapshot_json: true,
          },
        },
      },
      orderBy: [{ display_order: "asc" }, { updated_at: "desc" }],
    });

    return playlists.map((p) => {
      let videos = 0;
      let shorts = 0;
      let youtubePlaylists = 0;
      let channels = 0;
      let custom = 0;

      for (const e of p.entries) {
        const snap =
          e.snapshot_json && typeof e.snapshot_json === "object"
            ? (e.snapshot_json as { youtubeKind?: string })
            : null;
        if (snap?.youtubeKind === "shorts") {
          shorts++;
        } else if (e.entity_type === "VIDEO") {
          videos++;
        } else if (e.entity_type === "PLAYLIST") {
          youtubePlaylists++;
        } else if (e.entity_type === "CHANNEL") {
          channels++;
        } else {
          custom++;
        }
      }

      const thumbs = Array.isArray(p.thumbnail_urls)
        ? (p.thumbnail_urls as string[]).slice(0, 4)
        : [];
      const canonicalId = p.record_id || p.id;

      return {
        id: canonicalId,
        name: p.title,
        description: p.description ?? null,
        createdAt: p.created_at.toISOString(),
        updatedAt: p.updated_at.toISOString(),
        itemCount: p.entries.length || p.total_items_count,
        groupCount: p.groups.length,
        manifestFile: `user_playlists/${canonicalId}`,
        thumbnails: thumbs,
        counts: {
          videos,
          shorts,
          youtubePlaylists,
          channels,
          custom,
        },
      };
    });
  } catch (err) {
    console.warn("[playlist-db-service] Failed listing playlists from DB:", err);
    return null;
  }
}
