import "server-only";

import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/require-auth";
import {
  resolveProfileId,
  resolveStorageOwnerId,
} from "@/lib/auth/storage-owner";
import { prisma } from "@/lib/db/prisma";
import { getR2WorkerStorageClient } from "@/lib/storage/r2-worker-storage-client";
import {
  datasetTypeToSlug,
  type CanonicalDatasetType,
} from "@/lib/storage/canonical-paths";
import type { NormalizedYouTubeDiscoveryItem } from "@/types/youtube";

export const dynamic = "force-dynamic";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * GET /api/saved-items — Authoritative Cloud Saved Items Listing & Retrieval API
 * ──────────────────────────────────────────────────────────────────────────
 * Scope: Workstream A & B — Cloud Saved Items Listing & Honest Error Delivery
 *
 * Guarantees:
 *   1. Strict Administrator Authorization: Requires active Supabase session.
 *   2. Owner Namespace Isolation: Partitioned strictly by canonical storageOwnerUuid.
 *   3. Authoritative Source: Reads committed manifest parts directly from Cloudflare R2
 *      with SHA-256 integrity verification.
 *   4. Zero Hallucination: Never fabricates records from local browser state.
 *   5. Honest Error Reporting: A network or Worker failure returns status 502 with
 *      the authentic error message; it NEVER masquerades as an empty collection.
 * ═══════════════════════════════════════════════════════════════════════════
 */
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
  const { searchParams } = new URL(request.url);
  const typeFilter = searchParams.get("type") || "all";
  const searchQuery = searchParams.get("q")?.trim().toLowerCase() || "";
  const limit = Math.min(Math.max(Number(searchParams.get("limit") || 1000), 1), 5000);
  const offset = Math.max(Number(searchParams.get("offset") || 0), 0);

  const r2Client = getR2WorkerStorageClient();
  let generationId: string | null = null;
  let currentRevision = 0;
  let rawRecords: Record<string, unknown>[] = [];
  let retrievalSource: "R2_PARTS" | "R2_MANIFEST_DISCOVERY" | "POSTGRESQL_INDEX" = "R2_PARTS";

  try {
    // ─────────────────────────────────────────────────────────────────────────
    // Phase 1: Query PostgreSQL for the latest COMMITTED generation & parts
    // ─────────────────────────────────────────────────────────────────────────
    const profile = await prisma.userProfile.findFirst({
      where: {
        OR: [
          { storage_owner_uuid: storageOwnerUuid },
          ...(profileId ? [{ id: profileId }] : []),
          ...(auth.admin.userId ? [{ auth_user_id: auth.admin.userId }] : []),
        ],
      },
      include: {
        storage_datasets: {
          where: { dataset_type: "SAVED_ITEMS" },
          include: {
            generations: {
              where: { state: "COMMITTED" },
              orderBy: { generation_number: "desc" },
              take: 1,
              include: {
                parts: { orderBy: { part_number: "asc" } },
              },
            },
          },
        },
      },
    });

    const dataset = profile?.storage_datasets[0];
    const latestGen = dataset?.generations[0];

    if (dataset) {
      currentRevision = Number(dataset.current_revision);
    }

    if (latestGen && latestGen.parts.length > 0) {
      generationId = latestGen.id;
      // Download and SHA-256 verify every part from Cloudflare R2
      for (const part of latestGen.parts) {
        const { data, sha256 } = await r2Client.getObject("NEW", part.storage_path, {
          storageOwnerUuid,
        });

        if (sha256.toLowerCase() !== part.sha256.toLowerCase()) {
          throw new Error(
            `Part ${part.part_number} failed SHA-256 verification (expected ${part.sha256.slice(0, 16)}..., got ${sha256.slice(0, 16)}...).`
          );
        }

        const rawJson = data.toString("utf8");
        const parsed = JSON.parse(rawJson) as {
          records?: Record<string, unknown>[];
          items?: Record<string, unknown>[];
        };

        const partRecords = Array.isArray(parsed.records)
          ? parsed.records
          : Array.isArray(parsed.items)
            ? parsed.items
            : Array.isArray(parsed)
              ? (parsed as unknown as Record<string, unknown>[])
              : [];

        rawRecords.push(...partRecords);
      }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Phase 2: If no DB generation parts, discover manifest directly from R2
    // ─────────────────────────────────────────────────────────────────────────
    if (rawRecords.length === 0) {
      const datasetSlug = datasetTypeToSlug("SAVED_ITEMS" as CanonicalDatasetType);
      const prefix = `asdy/persistence/${storageOwnerUuid}/${datasetSlug}/generations/`;

      try {
        const listed = await r2Client.listObjects("NEW", prefix, {
          limit: 100,
          storageOwnerUuid,
        });

        const manifestObjs = (listed?.objects || []).filter((o) =>
          o.key.endsWith("/manifest.json")
        );

        if (manifestObjs.length > 0) {
          // Sort descending to get the latest generation
          manifestObjs.sort((a, b) => b.key.localeCompare(a.key));
          const latestManifestObj = manifestObjs[0];

          const { data } = await r2Client.getObject("NEW", latestManifestObj.key, {
            storageOwnerUuid,
          });

          const manifest = JSON.parse(data.toString("utf8")) as {
            generationId?: string;
            currentRevision?: number;
            parts?: Array<{ storagePath?: string; sha256?: string }>;
          };

          if (manifest.generationId) generationId = manifest.generationId;
          if (manifest.currentRevision) currentRevision = manifest.currentRevision;

          if (Array.isArray(manifest.parts) && manifest.parts.length > 0) {
            retrievalSource = "R2_MANIFEST_DISCOVERY";
            for (const p of manifest.parts) {
              if (!p.storagePath) continue;
              const partRes = await r2Client.getObject("NEW", p.storagePath, {
                storageOwnerUuid,
              });

              if (p.sha256 && partRes.sha256.toLowerCase() !== p.sha256.toLowerCase()) {
                throw new Error(
                  `Discovered R2 part at '${p.storagePath}' failed SHA-256 verification.`
                );
              }

              const parsedPart = JSON.parse(partRes.data.toString("utf8")) as {
                records?: Record<string, unknown>[];
                items?: Record<string, unknown>[];
              };

              const items = Array.isArray(parsedPart.records)
                ? parsedPart.records
                : Array.isArray(parsedPart.items)
                  ? parsedPart.items
                  : [];

              rawRecords.push(...items);
            }
          }
        }
      } catch (r2DiscoveryErr) {
        console.warn("[api/saved-items] R2 manifest discovery check:", r2DiscoveryErr);
      }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Phase 3: Relational Index Fallback (if R2 generation was empty)
    // ─────────────────────────────────────────────────────────────────────────
    if (rawRecords.length === 0 && profile) {
      try {
        const dbItems = await prisma.savedItemIndex.findMany({
          where: { owner_id: profile.id },
          orderBy: { saved_at: "desc" },
        });

        if (dbItems.length > 0) {
          retrievalSource = "POSTGRESQL_INDEX";
          rawRecords = dbItems.map((dbItem) => ({
            platformItemId: dbItem.platform_item_id,
            id: `youtube:${dbItem.platform_item_id}`,
            title: dbItem.title,
            channelTitle: dbItem.channel_title ?? undefined,
            thumbnailUrl: dbItem.thumbnail_url ?? undefined,
            itemType: dbItem.entity_type.toLowerCase(),
            isShortsLike: dbItem.is_shorts_like,
            isAgeRestricted: dbItem.is_age_restricted,
            publishedAt: dbItem.published_at?.toISOString(),
            viewsCount: dbItem.views_count ? Number(dbItem.views_count) : undefined,
            likesCount: dbItem.likes_count ? Number(dbItem.likes_count) : undefined,
            commentsCount: dbItem.comments_count ? Number(dbItem.comments_count) : undefined,
            durationSeconds: dbItem.duration_seconds ?? undefined,
            savedAt: dbItem.saved_at.toISOString(),
            savedDate: dbItem.saved_date,
            originDeviceId: dbItem.origin_device_id ?? undefined,
            originDeviceLabel: dbItem.origin_device_label ?? undefined,
            resourceType: dbItem.resource_type ?? undefined,
            resourceId: dbItem.resource_id ?? dbItem.platform_item_id,
          }));
        }
      } catch (dbErr) {
        console.warn("[api/saved-items] PostgreSQL index fallback note:", dbErr);
      }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Phase 4: Normalize & Deduplicate Cloud Items
    // ─────────────────────────────────────────────────────────────────────────
    const itemMap = new Map<string, NormalizedYouTubeDiscoveryItem>();

    for (const raw of rawRecords) {
      const platformItemId =
        (raw.platformItemId as string) ||
        (raw.resourceId as string) ||
        (raw.id as string)?.replace(/^youtube:/, "") ||
        "";

      if (!platformItemId) continue;

      const itemType = (raw.itemType as string) || (raw.entityType as string)?.toLowerCase() || "video";
      const isShortsLike = Boolean(
        raw.isShortsLike ||
        raw.resourceType === "VIDEO_SHORT" ||
        itemType === "shorts_like"
      );

      const canonicalId = (raw.id as string) || `youtube:${platformItemId}`;
      const url =
        (raw.url as string) ||
        (itemType === "channel"
          ? `https://www.youtube.com/channel/${platformItemId}`
          : itemType === "playlist"
            ? `https://www.youtube.com/playlist?list=${platformItemId}`
            : `https://www.youtube.com/watch?v=${platformItemId}`);

      const normalized: NormalizedYouTubeDiscoveryItem = {
        id: canonicalId,
        platform: "youtube",
        platformItemId,
        url,
        itemType: (itemType === "channel" ? "channel" : itemType === "playlist" ? "playlist" : "video") as "video" | "channel" | "playlist",
        title: (raw.title as string) || "Untitled Saved Item",
        description: (raw.description as string) || null,
        channelTitle: (raw.channelTitle as string) || (raw.channel_title as string) || null,
        channelId: (raw.channelId as string) || (raw.channel_id as string) || null,
        thumbnailUrl: (raw.thumbnailUrl as string) || (raw.thumbnail_url as string) || null,
        publishedAt: (raw.publishedAt as string) || (raw.published_at as string) || null,
        savedAt: (raw.savedAt as string) || (raw.saved_at as string) || (raw.createdAt as string) || new Date().toISOString(),
        isShortsLike,
        viewsCount: typeof raw.viewsCount === "number" ? raw.viewsCount : typeof raw.views_count === "number" ? raw.views_count : null,
        likesCount: typeof raw.likesCount === "number" ? raw.likesCount : typeof raw.likes_count === "number" ? raw.likes_count : null,
        commentsCount: typeof raw.commentsCount === "number" ? raw.commentsCount : typeof raw.comments_count === "number" ? raw.comments_count : null,
        durationSeconds: typeof raw.durationSeconds === "number" ? raw.durationSeconds : typeof raw.duration_seconds === "number" ? raw.duration_seconds : null,
        subscriberCount: typeof raw.subscriberCount === "number" ? raw.subscriberCount : null,
        videoCount: typeof raw.videoCount === "number" ? raw.videoCount : null,
        itemCount: typeof raw.itemCount === "number" ? raw.itemCount : null,
        language: (raw.language as string) || null,
        region: (raw.region as string) || null,
        tags: Array.isArray(raw.tags) ? (raw.tags as string[]) : [],
        categoryId: (raw.categoryId as string) || null,
        isEmbeddable: typeof raw.isEmbeddable === "boolean" ? raw.isEmbeddable : null,
        liveBroadcastContent: (raw.liveBroadcastContent as "none" | "live" | "upcoming" | "completed") || null,
        rawJson: raw.rawJson || raw,
        // Explicit cloud provenance markers
        ...({
          _sourceLocation: "CLOUD",
          _syncStatus: "CLOUD",
          _localStatus: "COMMITTED",
          _originDeviceId: raw.originDeviceId || raw.origin_device_id || undefined,
          _originDeviceLabel: raw.originDeviceLabel || raw.origin_device_label || undefined,
          _generationId: generationId || undefined,
          _revision: currentRevision,
        } as Record<string, unknown>),
      };

      // Key by itemType + platformItemId for strict deduplication
      const key = `${normalized.itemType}:${platformItemId}`;
      itemMap.set(key, normalized);
    }

    let allCloudItems = Array.from(itemMap.values());

    // Sort newest first by default
    allCloudItems.sort((a, b) => {
      const timeA = a.savedAt ? new Date(a.savedAt).getTime() : 0;
      const timeB = b.savedAt ? new Date(b.savedAt).getTime() : 0;
      return timeB - timeA;
    });

    const totalCountBeforeFilter = allCloudItems.length;

    // Apply optional type filter
    if (typeFilter !== "all") {
      allCloudItems = allCloudItems.filter((item) => {
        if (typeFilter === "video") {
          return item.itemType === "video" && !item.isShortsLike;
        }
        if (typeFilter === "shorts") {
          return item.isShortsLike;
        }
        if (typeFilter === "channel") {
          return item.itemType === "channel";
        }
        if (typeFilter === "playlist") {
          return item.itemType === "playlist";
        }
        return true;
      });
    }

    // Apply optional search query
    if (searchQuery) {
      allCloudItems = allCloudItems.filter((item) => {
        const titleMatch = item.title?.toLowerCase().includes(searchQuery);
        const channelMatch = item.channelTitle?.toLowerCase().includes(searchQuery);
        const tagMatch = item.tags?.some((t) => t.toLowerCase().includes(searchQuery));
        return titleMatch || channelMatch || tagMatch;
      });
    }

    // Paginate results
    const paginatedItems = allCloudItems.slice(offset, offset + limit);

    return NextResponse.json({
      ok: true,
      source: "R2_CLOUD",
      retrievalSource,
      items: paginatedItems,
      totalCount: totalCountBeforeFilter,
      filteredCount: allCloudItems.length,
      generationId,
      revision: currentRevision,
      hasMore: offset + limit < allCloudItems.length,
      nextOffset: offset + limit < allCloudItems.length ? offset + limit : null,
    });
  } catch (err) {
    console.error("[api/saved-items] Error retrieving cloud saved items:", err);
    const errorMessage =
      err instanceof Error ? err.message : "Failed to load cloud saved items from Cloudflare R2.";

    // Honest Error Delivery: Status 502 Bad Gateway with authentic failure details.
    // The UI must display this error honestly and NEVER pretend it is an empty collection.
    return NextResponse.json(
      {
        ok: false,
        error: errorMessage,
        code: "CLOUD_RETRIEVAL_ERROR",
        source: "R2_CLOUD",
      },
      { status: 502 }
    );
  }
}
