import "server-only";

import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/require-auth";
import {
  resolveLegacyOwnerIds,
  resolveProfileId,
  resolveStorageOwnerId,
} from "@/lib/auth/storage-owner";
import { prisma } from "@/lib/db/prisma";
import { getR2WorkerStorageClient } from "@/lib/storage/r2-worker-storage-client";
import {
  buildDatasetPrefix,
  buildHistoricalDatasetPrefix,
  buildVersionPointerKey,
} from "@/lib/storage/canonical-paths";
import type { SearchHistoryItem } from "@/types/youtube";

export const dynamic = "force-dynamic";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * Authoritative Cloud Search History Endpoint (`GET /api/history`)
 * ───────────────────────────────────────────────────────────────────────────
 * Scope:
 *   Reads the user's committed `SEARCH_HISTORY` dataset across BOTH:
 *     1. Cloudflare R2 (`asdy/persistence/<storageOwnerUuid>/saved-search-history/...`
 *        via NEW Worker `version.json` -> `manifest.json` -> immutable parts +
 *        read-only `before-app-updating/` historical generations).
 *     2. Supabase PostgreSQL (`search_history_records`).
 *
 * Purpose:
 *   When local browser storage is cleaned up after a verified R2 upload (or
 *   on a fresh device), `/history` calls `GET /api/history` so uploaded
 *   searches remain cleanly visible with their `R2 Cloud` badge (`CLOUD_ONLY`),
 *   full result counts, thumbnails, settings, and R2 generation provenance.
 *
 * Security & Immutability:
 *   - Fail-closed admin authentication (`requireAdmin`).
 *   - Read-only across R2 and PostgreSQL; never deletes or overwrites history.
 * ═══════════════════════════════════════════════════════════════════════════
 */

export interface CloudSearchHistoryItem extends SearchHistoryItem {
  recordId: string;
  isPinned?: boolean;
  generationId?: string;
  partKey?: string;
  r2ManifestKey?: string;
  _storageState: "CLOUD_ONLY";
  _sourceLocation: "CLOUD";
  _localStatus: "COMMITTED";
  _syncStatus: "COMMITTED";
}

function sanitizeThumbnails(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    .slice(0, 6);
}

function normalizeStatus(rawStatus: unknown, resultsCount: number): SearchHistoryItem["status"] {
  if (
    rawStatus === "complete" ||
    rawStatus === "failed" ||
    rawStatus === "partial" ||
    rawStatus === "empty"
  ) {
    return rawStatus;
  }
  return resultsCount === 0 ? "empty" : "complete";
}

function mapRawHistoryRecord(
  raw: Record<string, unknown>,
  provenance: { generationId?: string; partKey?: string; r2ManifestKey?: string }
): CloudSearchHistoryItem | null {
  const id = String(raw.id || raw.recordId || raw.manifestId || "").trim();
  const query = String(raw.query || raw.query_text || "").trim();
  if (!id || !query) return null;

  const resultsCount = Number(raw.resultsCount ?? raw.resultCount ?? raw.itemCount ?? 0) || 0;
  const videoCount = typeof raw.videoCount === "number" ? raw.videoCount : undefined;
  const channelCount = typeof raw.channelCount === "number" ? raw.channelCount : undefined;
  const playlistCount = typeof raw.playlistCount === "number" ? raw.playlistCount : undefined;
  const quotaCostEstimate =
    typeof raw.quotaCostEstimate === "number"
      ? raw.quotaCostEstimate
      : typeof raw.quotaUnits === "number"
        ? raw.quotaUnits
        : undefined;

  return {
    id,
    recordId: id,
    title: String(raw.title || query),
    query,
    resourceSelection:
      (raw.resourceSelection as SearchHistoryItem["resourceSelection"]) || "ALL",
    settings:
      raw.settings && typeof raw.settings === "object"
        ? (raw.settings as SearchHistoryItem["settings"])
        : {},
    timestamp: String(raw.timestamp || raw.executedAt || raw.createdAt || new Date().toISOString()),
    resultsCount,
    videoCount,
    channelCount,
    playlistCount,
    quotaCostEstimate,
    status: normalizeStatus(raw.status, resultsCount),
    manifestId: typeof raw.manifestId === "string" ? raw.manifestId : id,
    topThumbnails: sanitizeThumbnails(raw.topThumbnails),
    isPinned: raw.isPinned === true ? true : undefined,
    generationId: provenance.generationId,
    partKey: provenance.partKey,
    r2ManifestKey: provenance.r2ManifestKey,
    _storageState: "CLOUD_ONLY",
    _sourceLocation: "CLOUD",
    _localStatus: "COMMITTED",
    _syncStatus: "COMMITTED",
  };
}

async function readR2Json(
  r2Client: ReturnType<typeof getR2WorkerStorageClient>,
  key: string,
  storageOwnerUuid: string
): Promise<Record<string, unknown> | null> {
  try {
    const obj = await r2Client.getObject("NEW", key, { storageOwnerUuid });
    return JSON.parse(obj.data.toString("utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export async function GET(request: Request) {
  const auth = await requireAdmin(request);
  if (!auth.ok) return auth.response;

  const storageOwnerUuid = resolveStorageOwnerId(auth.admin);
  if (!storageOwnerUuid) {
    return NextResponse.json(
      { ok: false, error: "Unable to resolve a canonical storage owner for this session." },
      { status: 500 }
    );
  }

  const profileId = resolveProfileId(auth.admin);
  const allowedOwners = resolveLegacyOwnerIds(auth.admin);
  const byId = new Map<string, CloudSearchHistoryItem>();
  let r2Error: string | null = null;
  let activeGenerationId: string | null = null;
  let activeManifestKey: string | null = null;

  try {
    const r2Client = getR2WorkerStorageClient();

    // 1. Read active canonical R2 pointer (`saved-search-history/version.json`)
    const ownerCandidates = Array.from(new Set([storageOwnerUuid, ...allowedOwners]));
    for (const ownerCandidate of ownerCandidates) {
      const pointerKey = buildVersionPointerKey(ownerCandidate, "SEARCH_HISTORY");
      const pointer = await readR2Json(r2Client, pointerKey, storageOwnerUuid);
      const manifestKey =
        (typeof pointer?.manifestKey === "string" && pointer.manifestKey) ||
        (typeof pointer?.manifestPath === "string" && pointer.manifestPath) ||
        null;

      if (!manifestKey) continue;
      activeManifestKey = manifestKey;
      activeGenerationId =
        typeof pointer?.generationId === "string" ? pointer.generationId : null;

      const manifest = await readR2Json(r2Client, manifestKey, storageOwnerUuid);
      const parts = Array.isArray(manifest?.parts)
        ? (manifest.parts as Array<{ storagePath?: string }>)
        : [];

      for (const part of parts) {
        if (!part?.storagePath) continue;
        const partPayload = await readR2Json(r2Client, part.storagePath, storageOwnerUuid);
        const records = Array.isArray(partPayload?.records)
          ? (partPayload.records as Record<string, unknown>[])
          : Array.isArray(partPayload?.items)
            ? (partPayload.items as Record<string, unknown>[])
            : [];

        for (const raw of records) {
          const mapped = mapRawHistoryRecord(raw, {
            generationId: activeGenerationId ?? undefined,
            partKey: part.storagePath,
            r2ManifestKey: manifestKey,
          });
          if (mapped && !byId.has(mapped.id)) {
            byId.set(mapped.id, mapped);
          }
        }
      }

      // If current canonical pointer succeeded, also check historical `before-app-updating/` read-only
      try {
        const histPrefix = buildHistoricalDatasetPrefix(ownerCandidate, "SEARCH_HISTORY");
        const listed = await r2Client.listObjects("NEW", histPrefix, {
          storageOwnerUuid,
          limit: 50,
        });
        for (const obj of listed.objects) {
          if (!obj.key.endsWith("manifest.json")) continue;
          const hManifest = await readR2Json(r2Client, obj.key, storageOwnerUuid);
          const hParts = Array.isArray(hManifest?.parts)
            ? (hManifest.parts as Array<{ storagePath?: string }>)
            : [];
          for (const hPart of hParts) {
            if (!hPart?.storagePath) continue;
            const partPayload = await readR2Json(r2Client, hPart.storagePath, storageOwnerUuid);
            const records = Array.isArray(partPayload?.records)
              ? (partPayload.records as Record<string, unknown>[])
              : Array.isArray(partPayload?.items)
                ? (partPayload.items as Record<string, unknown>[])
                : [];
            for (const raw of records) {
              const mapped = mapRawHistoryRecord(raw, {
                generationId:
                  typeof hManifest?.generationId === "string"
                    ? hManifest.generationId
                    : "historical",
                partKey: hPart.storagePath,
                r2ManifestKey: obj.key,
              });
              if (mapped && !byId.has(mapped.id)) {
                byId.set(mapped.id, mapped);
              }
            }
          }
        }
      } catch {
        // Historical folder may not exist yet; safe to ignore cleanly.
      }

      if (byId.size > 0) break;
    }
  } catch (err) {
    r2Error = err instanceof Error ? err.message : "Failed to query R2 history snapshot.";
  }

  // 2. Merge canonical PostgreSQL `search_history_records` rows so rich DB metadata
  //    (title, counts, thumbnails, is_pinned, r2_manifest_key) enriches or completes the catalog.
  try {
    const profile = await prisma.userProfile.findFirst({
      where: {
        OR: [
          { storage_owner_uuid: storageOwnerUuid },
          ...(profileId ? [{ id: profileId }] : []),
          ...(auth.admin.userId ? [{ auth_user_id: auth.admin.userId }] : []),
        ],
      },
      select: { id: true },
    });

    if (profile) {
      const dbRows = await prisma.searchHistoryRecord.findMany({
        where: { owner_id: profile.id },
        orderBy: [{ is_pinned: "desc" }, { executed_at: "desc" }],
        take: 500,
      });

      for (const row of dbRows) {
        const canonicalId = row.record_id || row.manifest_id || row.id;
        const existing = byId.get(canonicalId);
        const rawPayload =
          row.raw_payload_json && typeof row.raw_payload_json === "object"
            ? (row.raw_payload_json as Record<string, unknown>)
            : null;
        const rowThumbs = sanitizeThumbnails(row.top_thumbnails_json);
        const rawThumbs = sanitizeThumbnails(rawPayload?.topThumbnails);

        const merged: CloudSearchHistoryItem = {
          id: canonicalId,
          recordId: canonicalId,
          title: row.title || existing?.title || row.query_text,
          query: row.query_text || existing?.query || "",
          resourceSelection:
            (row.resource_selection as unknown as SearchHistoryItem["resourceSelection"]) ||
            existing?.resourceSelection ||
            "ALL",
          settings:
            (row.search_settings as unknown as SearchHistoryItem["settings"]) ||
            existing?.settings ||
            {},
          timestamp: row.executed_at.toISOString(),
          resultsCount: Math.max(row.result_count, existing?.resultsCount ?? 0),
          videoCount: row.video_count || existing?.videoCount,
          channelCount: row.channel_count || existing?.channelCount,
          playlistCount: row.playlist_count || existing?.playlistCount,
          quotaCostEstimate: row.quota_units_consumed || existing?.quotaCostEstimate,
          status: normalizeStatus(
            row.status || existing?.status,
            Math.max(row.result_count, existing?.resultsCount ?? 0)
          ),
          manifestId: row.manifest_id || existing?.manifestId || canonicalId,
          topThumbnails:
            rowThumbs.length > 0
              ? rowThumbs
              : existing?.topThumbnails?.length
                ? existing.topThumbnails
                : rawThumbs,
          isPinned: row.is_pinned || existing?.isPinned || undefined,
          generationId: row.generation_id || existing?.generationId,
          partKey: existing?.partKey,
          r2ManifestKey: row.r2_manifest_key || existing?.r2ManifestKey,
          _storageState: "CLOUD_ONLY",
          _sourceLocation: "CLOUD",
          _localStatus: "COMMITTED",
          _syncStatus: "COMMITTED",
        };

        if (merged.query) {
          byId.set(canonicalId, merged);
        }
      }
    }
  } catch (dbErr) {
    console.warn("[GET /api/history] PostgreSQL read fallback warning:", dbErr);
  }

  const items = Array.from(byId.values()).sort((a, b) => {
    if (a.isPinned && !b.isPinned) return -1;
    if (!a.isPinned && b.isPinned) return 1;
    return new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();
  });

  return NextResponse.json({
    ok: true,
    datasetType: "SEARCH_HISTORY",
    datasetPrefix: buildDatasetPrefix(storageOwnerUuid, "SEARCH_HISTORY"),
    activeGenerationId,
    activeManifestKey,
    totalCount: items.length,
    r2Warning: r2Error,
    items,
  });
}
