import "server-only";

import crypto from "node:crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { resolveCanonicalAdminProfile } from "@/lib/auth/canonical-admin-owner";
import type { StorageBackend as BlobBackend } from "../storage/storage-backend";
import { getBlobBackend } from "../storage/r2-blob-backend";
import type { YouTubeManifest } from "@/types/manifest";
import type {
  YouTubeResultFilters,
  YouTubeSearchResourceSelection,
  YouTubeSearchSettings,
} from "@/types/youtube";
import { loadRecord, readIndex, type IndexEntry } from "../storage/record-store";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * Saved Search History Archive — Authoritative PostgreSQL Persistence
 * ──────────────────────────────────────────────────────────────────────────
 * Stores complete search records (`raw_payload_json`, settings, filters,
 * full `YouTubeManifest`) inside canonical `search_history_records` in
 * Supabase PostgreSQL, replacing ephemeral `youtube-discovery/v1/saved-history/`
 * disk fallback writes on Vercel.
 *
 * Legacy Read-Only Compatibility:
 *   - Read operations merge any remaining legacy `record-store` entries
 *     read-only without mutating or deleting them.
 *   - `clearSearchArchive` / per-record delete remain EXPLICIT user actions.
 * ═══════════════════════════════════════════════════════════════════════════
 */

export interface StoredSearchRecord {
  id: string;
  title: string;
  query: string;
  resourceSelection: YouTubeSearchResourceSelection;
  settings: YouTubeSearchSettings;
  filters?: YouTubeResultFilters;
  manifest: YouTubeManifest;
  createdAt: string;
  searchedAt: number;
  expiresAt: number | null;
}

export interface StoredSearchMetadata {
  id: string;
  title: string;
  query: string;
  resourceSelection: YouTubeSearchResourceSelection;
  settings: Partial<YouTubeSearchSettings>;
  itemCount: number;
  videoCount?: number;
  channelCount?: number;
  playlistCount?: number;
  quotaCostEstimate?: number;
  status: "complete" | "failed" | "partial" | "empty";
  createdAt: string;
  searchedAt: number;
  expiresAt: number | null;
  topThumbnails?: string[];
}

const NAMESPACE = "savedHistory" as const;

function backend(): BlobBackend {
  return getBlobBackend();
}

function toHistoryUuid(ownerId: string, recordId: string): string {
  const hash = crypto
    .createHash("sha256")
    .update(`search-history:${ownerId}:${recordId}`)
    .digest("hex");
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}

/**
 * Computes the deterministic UUID v5 variant used by `/api/sync/save-all`
 * so direct archive lookups & sync reads always resolve the same database row.
 */
function toSyncHistoryUuid(ownerId: string, recordId: string): string {
  const hash = crypto
    .createHash("sha256")
    .update(`search-history:${ownerId}:${recordId}`)
    .digest("hex");
  const variant = ((parseInt(hash[16], 16) & 0x3) | 0x8).toString(16);
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-5${hash.slice(13, 16)}-${variant}${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}

function entryToMetadata(entry: IndexEntry): StoredSearchMetadata | null {
  const m = entry.meta;
  if (!m || typeof m !== "object") return null;
  const r = m as unknown as StoredSearchMetadata;
  if (typeof r.id !== "string" || typeof r.query !== "string") return null;
  return { ...r, expiresAt: null };
}

function buildMetadata(input: {
  id: string;
  title: string;
  query: string;
  resourceSelection: YouTubeSearchResourceSelection;
  settings: YouTubeSearchSettings;
  manifest: YouTubeManifest;
  createdAt: string;
  searchedAt: number;
}): StoredSearchMetadata {
  const items = input.manifest.normalizedItems ?? [];
  const videoCount = items.filter((i) => i.itemType === "video" || i.itemType === "shorts_like").length;
  const channelCount = items.filter((i) => i.itemType === "channel").length;
  const playlistCount = items.filter((i) => i.itemType === "playlist").length;
  const topThumbnails = items
    .map((i) => i.thumbnailUrl)
    .filter((t): t is string => Boolean(t))
    .slice(0, 4);
  return {
    id: input.id,
    title: input.title,
    query: input.query.trim(),
    resourceSelection: input.resourceSelection,
    settings: { ...input.settings },
    itemCount: input.manifest.itemCount ?? items.length,
    videoCount,
    channelCount,
    playlistCount,
    quotaCostEstimate: input.manifest.quotaCostEstimate,
    status:
      (input.manifest.itemCount ?? items.length) === 0
        ? "empty"
        : (["complete", "failed", "partial", "empty"] as const).includes(
              input.manifest.status as "complete" | "failed" | "partial" | "empty",
            )
          ? (input.manifest.status as "complete" | "failed" | "partial" | "empty")
          : "complete",
    createdAt: input.createdAt,
    searchedAt: input.searchedAt,
    expiresAt: null,
    topThumbnails,
  };
}

function dbRowToRecord(row: {
  id: string;
  record_id: string | null;
  manifest_id: string;
  query_text: string;
  search_settings: unknown;
  resource_selection: unknown;
  filter_snapshot: unknown;
  raw_payload_json: unknown;
  executed_at: Date;
}): StoredSearchRecord | null {
  const raw =
    row.raw_payload_json && typeof row.raw_payload_json === "object"
      ? (row.raw_payload_json as Partial<StoredSearchRecord>)
      : null;
  if (!raw?.manifest) return null;
  const id = raw.id || row.record_id || row.manifest_id || row.id;
  return {
    id,
    title: raw.title || row.query_text,
    query: raw.query || row.query_text,
    resourceSelection:
      raw.resourceSelection ??
      ((row.resource_selection as YouTubeSearchResourceSelection | null) ?? "ALL"),
    settings: raw.settings ?? (row.search_settings as unknown as YouTubeSearchSettings),
    filters: raw.filters ?? (row.filter_snapshot as YouTubeResultFilters | undefined),
    manifest: raw.manifest,
    createdAt: raw.createdAt || row.executed_at.toISOString(),
    searchedAt:
      typeof raw.searchedAt === "number" ? raw.searchedAt : row.executed_at.getTime(),
    expiresAt: null,
  };
}

/** Lists saved searches, newest first (PostgreSQL primary + legacy read-only merge). */
export async function listSearchArchiveIndex(
  ownerProfileId?: string
): Promise<StoredSearchMetadata[]> {
  const byId = new Map<string, StoredSearchMetadata>();

  try {
    const admin = await resolveCanonicalAdminProfile(ownerProfileId);
    if (admin) {
      const rows = await prisma.searchHistoryRecord.findMany({
        where: { owner_id: admin.profileId },
        orderBy: { executed_at: "desc" },
        take: 250,
      });

      for (const row of rows) {
        const rec = dbRowToRecord(row);
        if (rec) {
          byId.set(rec.id, buildMetadata(rec));
          continue;
        }
        const canonicalId = row.record_id || row.manifest_id || row.id;
        const thumbnails = Array.isArray(row.top_thumbnails_json)
          ? row.top_thumbnails_json.filter((item): item is string => typeof item === "string")
          : [];
        const statusValue =
          row.status === "failed" ||
          row.status === "partial" ||
          row.status === "empty" ||
          row.status === "complete"
            ? row.status
            : row.result_count === 0
              ? "empty"
              : "complete";

        byId.set(canonicalId, {
          id: canonicalId,
          title: row.title || row.query_text,
          query: row.query_text,
          resourceSelection:
            (row.resource_selection as unknown as YouTubeSearchResourceSelection) ?? "ALL",
          settings: (row.search_settings as Partial<YouTubeSearchSettings>) ?? {},
          itemCount: row.result_count,
          videoCount: row.video_count,
          channelCount: row.channel_count,
          playlistCount: row.playlist_count,
          quotaCostEstimate: row.quota_units_consumed,
          status: statusValue,
          createdAt: row.executed_at.toISOString(),
          searchedAt: row.executed_at.getTime(),
          expiresAt: null,
          topThumbnails: thumbnails,
        });
      }
    }
  } catch {
    // Fall through to legacy read-only merge
  }

  try {
    const index = await readIndex(backend(), NAMESPACE);
    for (const entry of index.entries) {
      const meta = entryToMetadata(entry);
      if (meta && !byId.has(meta.id)) {
        byId.set(meta.id, meta);
      }
    }
  } catch {
    // Legacy archive absent or unconfigured
  }

  return Array.from(byId.values()).sort((a, b) => b.searchedAt - a.searchedAt);
}

/**
 * Saves a COMPLETE search record directly into Supabase PostgreSQL (`search_history_records`).
 */
export async function saveSearchToArchive(
  payload: {
    id?: string;
    query: string;
    resourceSelection: YouTubeSearchResourceSelection;
    settings: YouTubeSearchSettings;
    filters?: YouTubeResultFilters;
    manifest: YouTubeManifest;
    title?: string;
  },
  ownerProfileId?: string
): Promise<StoredSearchRecord> {
  const now = Date.now();
  const id = payload.id || `search-${now}-${Math.random().toString(36).slice(2, 8)}`;
  const record: StoredSearchRecord = {
    id,
    title: (payload.title ?? payload.query).trim(),
    query: payload.query.trim(),
    resourceSelection: payload.resourceSelection,
    settings: { ...payload.settings },
    filters: payload.filters ? { ...payload.filters } : undefined,
    manifest: payload.manifest,
    createdAt: new Date(now).toISOString(),
    searchedAt: now,
    expiresAt: null,
  };

  const admin = await resolveCanonicalAdminProfile(ownerProfileId);
  if (!admin) {
    throw new Error("Unable to resolve administrator profile for search archive.");
  }

  const v4DbId = toHistoryUuid(admin.profileId, id);
  const v5DbId = toSyncHistoryUuid(admin.profileId, id);
  const itemsCount = payload.manifest.itemCount ?? payload.manifest.normalizedItems?.length ?? 0;
  const quotaUnits = Math.max(0, Math.floor(payload.manifest.quotaCostEstimate ?? 100));
  const counts = { video: 0, channel: 0, playlist: 0 };
  const topThumbnails: string[] = [];
  for (const item of payload.manifest.normalizedItems ?? []) {
    if (item.itemType === "channel") counts.channel += 1;
    else if (item.itemType === "playlist") counts.playlist += 1;
    else counts.video += 1;
    if (topThumbnails.length < 6 && typeof item.thumbnailUrl === "string" && item.thumbnailUrl) {
      topThumbnails.push(item.thumbnailUrl);
    }
  }

  const existingRow = await prisma.searchHistoryRecord.findFirst({
    where: {
      owner_id: admin.profileId,
      OR: [{ record_id: id.slice(0, 128) }, { id: v4DbId }, { id: v5DbId }],
    },
    select: { id: true, is_pinned: true, generation_id: true, r2_manifest_key: true },
  });
  const dbId = existingRow?.id ?? v4DbId;
  const manifestStatus = payload.manifest.status || (itemsCount === 0 ? "empty" : "complete");

  await prisma.searchHistoryRecord.upsert({
    where: { id: dbId },
    create: {
      id: dbId,
      owner_id: admin.profileId,
      title: record.title.slice(0, 512),
      query_text: record.query.slice(0, 512),
      status: String(manifestStatus).slice(0, 32),
      search_settings: record.settings as unknown as Prisma.InputJsonValue,
      result_count: itemsCount,
      video_count: counts.video,
      channel_count: counts.channel,
      playlist_count: counts.playlist,
      top_thumbnails_json: topThumbnails as Prisma.InputJsonValue,
      quota_units_consumed: quotaUnits,
      manifest_id: (payload.manifest.manifestId || id).slice(0, 64),
      is_pinned: false,
      executed_at: new Date(now),
      record_id: id.slice(0, 128),
      resource_selection: record.resourceSelection as unknown as Prisma.InputJsonValue,
      filter_snapshot: (record.filters ?? null) as unknown as Prisma.InputJsonValue,
      raw_payload_json: record as unknown as Prisma.InputJsonValue,
      expires_at: null,
    },
    update: {
      title: record.title.slice(0, 512),
      query_text: record.query.slice(0, 512),
      status: String(manifestStatus).slice(0, 32),
      search_settings: record.settings as unknown as Prisma.InputJsonValue,
      result_count: itemsCount,
      video_count: counts.video,
      channel_count: counts.channel,
      playlist_count: counts.playlist,
      top_thumbnails_json: topThumbnails as Prisma.InputJsonValue,
      quota_units_consumed: quotaUnits,
      manifest_id: (payload.manifest.manifestId || id).slice(0, 64),
      executed_at: new Date(now),
      record_id: id.slice(0, 128),
      resource_selection: record.resourceSelection as unknown as Prisma.InputJsonValue,
      filter_snapshot: (record.filters ?? null) as unknown as Prisma.InputJsonValue,
      raw_payload_json: record as unknown as Prisma.InputJsonValue,
      expires_at: null,
    },
  });

  return record;
}

/** Retrieves the full record by ID (PostgreSQL primary + read-only legacy fallback). */
export async function getSearchFromArchive(
  id: string,
  ownerProfileId?: string
): Promise<StoredSearchRecord | null> {
  try {
    const admin = await resolveCanonicalAdminProfile(ownerProfileId);
    if (admin) {
      const dbUuid = toHistoryUuid(admin.profileId, id);
      const syncUuid = toSyncHistoryUuid(admin.profileId, id);
      const row = await prisma.searchHistoryRecord.findFirst({
        where: {
          owner_id: admin.profileId,
          OR: [{ id: dbUuid }, { id: syncUuid }, { record_id: id }, { manifest_id: id }],
        },
      });
      if (row) {
        const mapped = dbRowToRecord(row);
        if (mapped) return mapped;
      }
    }
  } catch {
    // Fall through to legacy read
  }

  try {
    const record = await loadRecord<StoredSearchRecord>(backend(), NAMESPACE, id);
    if (!record || record.id !== id || !record.manifest) return null;
    return { ...record, expiresAt: null };
  } catch {
    return null;
  }
}

/** Most recently saved complete record. */
export async function getLatestSearchFromArchive(
  ownerProfileId?: string
): Promise<StoredSearchRecord | null> {
  const items = await listSearchArchiveIndex(ownerProfileId);
  for (const meta of items) {
    const full = await getSearchFromArchive(meta.id, ownerProfileId);
    if (full) return full;
  }
  return null;
}

/** Explicit user deletion: removes the specified search record from PostgreSQL. */
export async function deleteSearchFromArchive(
  id: string,
  ownerProfileId?: string
): Promise<boolean> {
  try {
    const admin = await resolveCanonicalAdminProfile(ownerProfileId);
    if (!admin) return false;
    const dbUuid = toHistoryUuid(admin.profileId, id);
    const syncUuid = toSyncHistoryUuid(admin.profileId, id);
    const res = await prisma.searchHistoryRecord.deleteMany({
      where: {
        owner_id: admin.profileId,
        OR: [{ id: dbUuid }, { id: syncUuid }, { record_id: id }, { manifest_id: id }],
      },
    });
    return res.count > 0;
  } catch {
    return false;
  }
}

/** Explicit user action: clears search archive records in PostgreSQL for caller owner. */
export async function clearSearchArchive(ownerProfileId?: string): Promise<void> {
  const admin = await resolveCanonicalAdminProfile(ownerProfileId);
  if (!admin) return;
  await prisma.searchHistoryRecord.deleteMany({
    where: { owner_id: admin.profileId },
  });
}

export async function cleanupExpiredSearches(): Promise<number> {
  const items = await listSearchArchiveIndex();
  return items.length;
}

export function getArchiveTtlInfo() {
  return {
    ttlHours: null as number | null,
    ttlMs: null as number | null,
    permanent: true as const,
  };
}
