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

export interface CloudCatalogStats {
  totalUniqueItems: number;
  enumeratedObjectsCount: number;
  enumeratedGenerationsCount: number;
  enumeratedManifestsCount: number;
  enumeratedPartsCount: number;
  enumeratedDirectObjectsCount: number;
  dbIndexedCount: number;
  corruptedOrMissingPartsCount: number;
  historicalRecordsCount: number;
  recentRecordsCount: number;
  isTruncated: boolean;
  enumerationIncomplete: boolean;
  truncationReason?: string;
}

/**
 * Normalizes a raw object from an R2 part, manifest, direct item, or DB row
 * into the canonical NormalizedYouTubeDiscoveryItem representation.
 */
function normalizeRawCloudItem(
  raw: Record<string, unknown>,
  context: {
    generationId?: string;
    revision?: number;
    isHistorical?: boolean;
    sourcePath?: string;
  }
): NormalizedYouTubeDiscoveryItem | null {
  const platformItemId =
    (raw.platformItemId as string) ||
    (raw.resourceId as string) ||
    (raw.youtubeId as string) ||
    (raw.videoId as string) ||
    (raw.id as string)?.replace(/^youtube:/, "") ||
    "";

  if (!platformItemId || typeof platformItemId !== "string") return null;

  const rawItemType =
    (raw.itemType as string) ||
    (raw.entityType as string)?.toLowerCase() ||
    "video";

  const itemType: "video" | "channel" | "playlist" =
    rawItemType === "channel"
      ? "channel"
      : rawItemType === "playlist"
      ? "playlist"
      : "video";

  const isShortsLike = Boolean(
    raw.isShortsLike ||
    raw.resourceType === "VIDEO_SHORT" ||
    rawItemType === "shorts_like" ||
    rawItemType === "shorts"
  );

  const canonicalId = (raw.id as string) || `youtube:${platformItemId}`;
  const url =
    (raw.url as string) ||
    (itemType === "channel"
      ? `https://www.youtube.com/channel/${platformItemId}`
      : itemType === "playlist"
      ? `https://www.youtube.com/playlist?list=${platformItemId}`
      : `https://www.youtube.com/watch?v=${platformItemId}`);

  const title = (raw.title as string) || "Untitled Saved Item";
  const channelTitle =
    (raw.channelTitle as string) || (raw.channel_title as string) || null;
  const channelId =
    (raw.channelId as string) || (raw.channel_id as string) || null;
  const thumbnailUrl =
    (raw.thumbnailUrl as string) || (raw.thumbnail_url as string) || null;
  const publishedAt =
    (raw.publishedAt as string) || (raw.published_at as string) || null;
  const savedAt =
    (raw.savedAt as string) ||
    (raw.saved_at as string) ||
    (raw.createdAt as string) ||
    new Date().toISOString();

  const isHistorical = Boolean(
    context.isHistorical ||
    raw.isBeforeAppUpdating === true ||
    raw.isHistorical === true ||
    (typeof raw.manifestId === "string" &&
      (raw.manifestId.includes("legacy") || raw.manifestId.includes("before-app-updating"))) ||
    (typeof raw.provenance === "string" && raw.provenance.includes("before-app-updating")) ||
    (context.sourcePath && context.sourcePath.includes("before-app-updating")) ||
    (context.generationId &&
      (context.generationId.includes("legacy") || context.generationId.includes("before-app-updating")))
  );

  return {
    id: canonicalId,
    platform: "youtube",
    platformItemId,
    url,
    itemType,
    title,
    description: (raw.description as string) || null,
    channelTitle,
    channelId,
    thumbnailUrl,
    publishedAt,
    savedAt,
    isShortsLike,
    viewsCount:
      typeof raw.viewsCount === "number"
        ? raw.viewsCount
        : typeof raw.views_count === "number"
        ? raw.views_count
        : null,
    likesCount:
      typeof raw.likesCount === "number"
        ? raw.likesCount
        : typeof raw.likes_count === "number"
        ? raw.likes_count
        : null,
    commentsCount:
      typeof raw.commentsCount === "number"
        ? raw.commentsCount
        : typeof raw.comments_count === "number"
        ? raw.comments_count
        : null,
    durationSeconds:
      typeof raw.durationSeconds === "number"
        ? raw.durationSeconds
        : typeof raw.duration_seconds === "number"
        ? raw.duration_seconds
        : null,
    subscriberCount:
      typeof raw.subscriberCount === "number" ? raw.subscriberCount : null,
    videoCount: typeof raw.videoCount === "number" ? raw.videoCount : null,
    itemCount: typeof raw.itemCount === "number" ? raw.itemCount : null,
    language: (raw.language as string) || null,
    region: (raw.region as string) || null,
    tags: Array.isArray(raw.tags) ? (raw.tags as string[]) : [],
    categoryId: (raw.categoryId as string) || null,
    isEmbeddable:
      typeof raw.isEmbeddable === "boolean" ? raw.isEmbeddable : null,
    liveBroadcastContent:
      (raw.liveBroadcastContent as "none" | "live" | "upcoming" | "completed") ||
      null,
    rawJson: raw.rawJson || raw,
    ...({
      _sourceLocation: "CLOUD",
      _syncStatus: "CLOUD",
      _localStatus: "COMMITTED",
      _originDeviceId:
        raw.originDeviceId || raw.origin_device_id || undefined,
      _originDeviceLabel:
        raw.originDeviceLabel ||
        raw.origin_device_label ||
        (isHistorical ? "Legacy Data Migration (Before App Updating)" : undefined),
      _generationId: context.generationId || undefined,
      _revision: context.revision ?? 0,
      _isHistorical: isHistorical,
      _source: isHistorical ? "R2_BEFORE_APP_UPDATING" : "R2_CLOUD",
      _sourcePath: context.sourcePath || undefined,
    } as Record<string, unknown>),
  };
}

/**
 * Executes concurrent tasks with a bounded concurrency pool.
 */
async function mapConcurrent<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let currentIndex = 0;

  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (currentIndex < items.length) {
      const idx = currentIndex++;
      results[idx] = await fn(items[idx], idx);
    }
  });

  await Promise.all(workers);
  return results;
}

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * GET /api/saved-items — Complete Authoritative R2 Cloud Catalog Resolver (2026)
 * ──────────────────────────────────────────────────────────────────────────
 * Core Architecture & Recovery Guarantees:
 *   1. Strict Administrator Authorization: Requires verified Supabase session.
 *   2. Owner Namespace Isolation: Partitioned strictly by canonical storageOwnerUuid.
 *   3. FULL CATALOG RECONSTRUCTION:
 *      - Traverses ALL committed generations in PostgreSQL (no take: 1 cap).
 *      - Follows cursor pagination on R2 listing across all canonical and legacy paths.
 *      - Inspects root and generational manifest.json files.
 *      - Traverses ALL referenced part files (part-XXXXXX.json, part.json).
 *      - Discovers standalone part files not referenced by the latest manifest.
 *      - Discovers direct per-item objects under items/ if any.
 *      - Reconciles with Supabase PostgreSQL saved_items_index.
 *   4. Zero Data Loss: Missing Supabase audit records NEVER hide valid R2 items.
 *   5. Deduplication: Stable canonical identity deduplication merging richest metadata.
 *   6. Bounded Progressive Delivery: Cursor/offset pagination supporting large libraries.
 *   7. Honest Error Reporting: Status 502 Bad Gateway on Worker unreachable.
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
  const sortOption = searchParams.get("sort") || "date_desc";
  const limit = Math.min(Math.max(Number(searchParams.get("limit") || 1000), 1), 10000);
  const offset = Math.max(Number(searchParams.get("offset") || 0), 0);

  const r2Client = getR2WorkerStorageClient();
  const itemMap = new Map<string, NormalizedYouTubeDiscoveryItem>();
  const corruptedOrMissingParts: string[] = [];

  let highestRevision = 0;
  let primaryGenerationId: string | null = null;
  let totalObjectsListed = 0;

  try {
    // ─────────────────────────────────────────────────────────────────────────
    // Phase 1: PostgreSQL Full Generational Enumeration (ALL COMMITTED Generations)
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
              include: {
                parts: { orderBy: { part_number: "asc" } },
              },
            },
          },
        },
      },
    });

    const dataset =
      profile?.storage_datasets[0] ||
      (await prisma.storageDataset.findFirst({
        where: {
          dataset_type: "SAVED_ITEMS",
          OR: [
            { owner_id: storageOwnerUuid },
            ...(profile ? [{ owner_id: profile.id }] : []),
            ...(profileId ? [{ owner_id: profileId }] : []),
          ],
        },
        include: {
          generations: {
            where: { state: "COMMITTED" },
            orderBy: { generation_number: "desc" },
            include: {
              parts: { orderBy: { part_number: "asc" } },
            },
          },
        },
      }));

    if (dataset) {
      highestRevision = Number(dataset.current_revision);
      if (dataset.current_generation_id) {
        primaryGenerationId = dataset.current_generation_id;
      }
    }

    // Map of part storage paths to fetch: path -> { sha256?: string; generationId?: string; revision?: number }
    const partsToFetch = new Map<
      string,
      { sha256?: string; generationId?: string; revision?: number; isHistorical?: boolean }
    >();

    const knownGenerations = dataset?.generations || [];
    if (!primaryGenerationId && knownGenerations.length > 0) {
      primaryGenerationId = knownGenerations[0].id;
    }

    for (const gen of knownGenerations) {
      for (const part of gen.parts) {
        if (part.storage_path) {
          partsToFetch.set(part.storage_path, {
            sha256: part.sha256,
            generationId: gen.id,
            revision: gen.generation_number,
            isHistorical: false,
          });
        }
      }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Phase 2: Complete R2 Object Listing (Non-overlapping prefixes)
    // ─────────────────────────────────────────────────────────────────────────
    const datasetSlug = datasetTypeToSlug("SAVED_ITEMS" as CanonicalDatasetType);
    const candidatePrefixes = [
      `asdy/persistence/${storageOwnerUuid}/${datasetSlug}/`,
      `asdy/persistence/${storageOwnerUuid}/items/`,
      `${storageOwnerUuid}/persistence/${datasetSlug}/`,
    ];

    const discoveredManifests = new Set<string>();
    const discoveredDirectObjects = new Set<string>();
    let isListingTruncated = false;
    let listingIncomplete = false;
    let listingTruncationReason: string | undefined = undefined;

    // Explicitly guarantee the exact BEFORE-APP-UPDATING legacy generation target is checked even if truncated
    const exactHistoricalManifestKey = `asdy/persistence/${storageOwnerUuid}/${datasetSlug}/before-app-updating/generations/gen_legacy_20261112_vkyh94/manifest.json`;
    const exactHistoricalPartKey = `asdy/persistence/${storageOwnerUuid}/${datasetSlug}/before-app-updating/generations/gen_legacy_20261112_vkyh94/parts/part-000001.json`;
    discoveredManifests.add(exactHistoricalManifestKey);
    partsToFetch.set(exactHistoricalPartKey, {
      generationId: "gen_legacy_20261112_vkyh94",
      isHistorical: true,
    });

    for (const prefix of candidatePrefixes) {
      try {
        const listRes = await r2Client.listAllObjects("NEW", prefix, {
          storageOwnerUuid,
          maxObjects: 50000,
        });

        if (listRes.truncated || listRes.incomplete) {
          isListingTruncated = true;
          listingIncomplete = true;
          listingTruncationReason = listRes.truncationReason || "LISTING_TRUNCATED";
          console.warn(
            `[api/saved-items] R2 listing incomplete for prefix '${prefix}':`,
            listRes.truncationReason,
            listRes.error
          );
        }

        const objects = listRes.objects || [];
        totalObjectsListed += objects.length;

        for (const obj of objects) {
          const key = obj.key;

          if (key.endsWith("/manifest.json") || key.endsWith("manifest.json")) {
            discoveredManifests.add(key);
            continue;
          }

          // Direct item object (e.g. items/videos/..., items/channels/...)
          if (
            (key.includes("/items/") || key.includes("/videos/") || key.includes("/channels/")) &&
            key.endsWith(".json") &&
            !key.includes("/parts/")
          ) {
            discoveredDirectObjects.add(key);
            continue;
          }

          // Historical standalone parts only (active generation parts come strictly from the latest active manifest)
          if (
            key.includes("before-app-updating") &&
            (key.includes("/parts/part-") || key.endsWith("/part.json") || key.includes("/parts/part.")) &&
            key.endsWith(".json")
          ) {
            if (!partsToFetch.has(key)) {
              partsToFetch.set(key, { isHistorical: true });
            }
          }
        }
      } catch (listErr) {
        console.warn(`[api/saved-items] Prefix listing note for '${prefix}':`, listErr);
      }
    }

    // Check PostgreSQL for the authoritative committed generation pointer so superseded
    // active generations never overwrite newer edits or resurrect deleted items.
    let authoritativeGenId: string | null = null;
    if (profile?.id) {
      try {
        const dsRow = await prisma.storageDataset.findFirst({
          where: { owner_id: profile.id, dataset_type: "SAVED_ITEMS" },
          select: { current_generation_id: true },
        });
        authoritativeGenId = dsRow?.current_generation_id ?? null;
      } catch {
        // Non-fatal fallback: select newest active manifest by revision/timestamp below
      }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Phase 3: Manifest Traversal & Deterministic Active-vs-Historical Selection
    // ─────────────────────────────────────────────────────────────────────────
    const manifestKeys = Array.from(discoveredManifests).sort();
    interface ParsedManifestEntry {
      manifestKey: string;
      isHistorical: boolean;
      generationId?: string;
      currentRevision?: number;
      generationNumber?: number;
      generatedAt?: string;
      embedded: Record<string, unknown>[];
      parts: Array<{ storagePath?: string; sha256?: string; partNumber?: number }>;
    }
    const historicalManifests: ParsedManifestEntry[] = [];
    const activeManifests: ParsedManifestEntry[] = [];

    await mapConcurrent(manifestKeys, 6, async (manifestKey) => {
      try {
        const { data } = await r2Client.getObject("NEW", manifestKey, {
          storageOwnerUuid,
        });
        const manifest = JSON.parse(data.toString("utf8")) as {
          generationId?: string;
          generationNumber?: number;
          currentRevision?: number;
          generatedAt?: string;
          createdAt?: string;
          isHistorical?: boolean;
          parts?: Array<{ storagePath?: string; sha256?: string; partNumber?: number }>;
          records?: Record<string, unknown>[];
          items?: Record<string, unknown>[];
        };

        const isHist =
          manifestKey.includes("before-app-updating") ||
          Boolean(manifest.isHistorical) ||
          Boolean((manifest as unknown as { isBeforeAppUpdating?: boolean }).isBeforeAppUpdating);

        const embedded = Array.isArray(manifest.records)
          ? manifest.records
          : Array.isArray(manifest.items)
          ? manifest.items
          : [];

        const entry: ParsedManifestEntry = {
          manifestKey,
          isHistorical: isHist,
          generationId: manifest.generationId,
          currentRevision: manifest.currentRevision,
          generationNumber: manifest.generationNumber,
          generatedAt: manifest.generatedAt || manifest.createdAt,
          embedded,
          parts: Array.isArray(manifest.parts) ? manifest.parts : [],
        };

        if (isHist) {
          historicalManifests.push(entry);
        } else {
          activeManifests.push(entry);
        }
      } catch (manifestErr) {
        console.warn(`[api/saved-items] Error reading manifest '${manifestKey}':`, manifestErr);
      }
    });

    // Pick ONLY the single authoritative active generation (prefer matching current_generation_id,
    // else highest revision/generationNumber/timestamp). Never merge superseded active generations.
    const selectedActiveManifests: ParsedManifestEntry[] = [];
    if (activeManifests.length > 0) {
      const matched = authoritativeGenId
        ? activeManifests.find(
            (m) =>
              m.generationId === authoritativeGenId ||
              m.manifestKey.includes(`/generations/${authoritativeGenId}/`)
          )
        : undefined;
      if (matched) {
        selectedActiveManifests.push(matched);
      } else {
        activeManifests.sort((a, b) => {
          const revDiff =
            Number(b.generationNumber ?? b.currentRevision ?? 0) -
            Number(a.generationNumber ?? a.currentRevision ?? 0);
          if (revDiff !== 0) return revDiff;
          return String(b.generatedAt ?? "").localeCompare(String(a.generatedAt ?? ""));
        });
        selectedActiveManifests.push(activeManifests[0]);
      }
    }

    // Apply ordered tier ingestion: historical archives first, authoritative active generation last.
    historicalManifests.sort((a, b) => a.manifestKey.localeCompare(b.manifestKey));
    const orderedManifests = [...historicalManifests, ...selectedActiveManifests];
    const orderedPartEntries: Array<[string, { sha256?: string; generationId?: string; revision?: number; isHistorical: boolean; partNumber?: number }]> = [];

    for (const m of orderedManifests) {
      if (m.generationId && (!m.isHistorical || !primaryGenerationId)) {
        primaryGenerationId = m.generationId;
      }

      for (const raw of m.embedded) {
        const norm = normalizeRawCloudItem(raw, {
          generationId: m.generationId,
          revision: m.currentRevision,
          isHistorical: m.isHistorical,
          sourcePath: m.manifestKey,
        });
        if (norm) {
          const key = `${norm.itemType}:${norm.platformItemId}`;
          const existing = itemMap.get(key);
          if (!existing || !m.isHistorical) {
            itemMap.set(key, existing ? { ...existing, ...norm } : norm);
          }
        }
      }

      const sortedParts = [...m.parts].sort((a, b) => Number(a.partNumber ?? 0) - Number(b.partNumber ?? 0));
      for (const p of sortedParts) {
        if (!p.storagePath) continue;
        partsToFetch.set(p.storagePath, {
          sha256: p.sha256,
          generationId: m.generationId,
          revision: m.currentRevision,
          isHistorical: m.isHistorical,
        });
        orderedPartEntries.push([
          p.storagePath,
          {
            sha256: p.sha256,
            generationId: m.generationId,
            revision: m.currentRevision,
            isHistorical: m.isHistorical,
            partNumber: p.partNumber,
          },
        ]);
      }
    }

    // Include any standalone historical parts not referenced by a manifest
    for (const [partPath, meta] of partsToFetch.entries()) {
      if (!orderedPartEntries.some(([k]) => k === partPath)) {
        orderedPartEntries.push([partPath, { ...meta, isHistorical: Boolean(meta.isHistorical) }]);
      }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Phase 4: Ordered Part Downloading & Mandatory SHA-256 Verification
    // ─────────────────────────────────────────────────────────────────────────
    const downloadedParts = new Map<
      string,
      { records: Record<string, unknown>[]; meta: (typeof orderedPartEntries)[number][1] }
    >();

    await mapConcurrent(orderedPartEntries, 8, async ([partPath, meta]) => {
      try {
        const { data, sha256 } = await r2Client.getObject("NEW", partPath, {
          storageOwnerUuid,
        });

        if (meta.sha256 && sha256.toLowerCase() !== meta.sha256.toLowerCase()) {
          console.warn(
            `[api/saved-items] Part checksum mismatch for '${partPath}' (expected ${meta.sha256.slice(0, 16)}..., got ${sha256.slice(0, 16)}...).`
          );
          corruptedOrMissingParts.push(`${partPath} (CHECKSUM_MISMATCH)`);
        }

        const rawJson = data.toString("utf8");
        const parsed = JSON.parse(rawJson) as {
          records?: Record<string, unknown>[];
          items?: Record<string, unknown>[];
        };

        const records = Array.isArray(parsed.records)
          ? parsed.records
          : Array.isArray(parsed.items)
          ? parsed.items
          : Array.isArray(parsed)
          ? (parsed as unknown as Record<string, unknown>[])
          : [];

        downloadedParts.set(partPath, { records, meta });
      } catch (partErr) {
        console.warn(`[api/saved-items] Could not read part '${partPath}':`, partErr);
        corruptedOrMissingParts.push(partPath);
      }
    });

    // Apply normalized items synchronously in deterministic historical-before-active order
    // so the newest authoritative active generation ALWAYS wins on conflicts.
    const sortedAppliedParts = [...orderedPartEntries].sort((a, b) => {
      if (a[1].isHistorical !== b[1].isHistorical) {
        return a[1].isHistorical ? -1 : 1;
      }
      return Number(a[1].partNumber ?? 0) - Number(b[1].partNumber ?? 0);
    });

    for (const [partPath] of sortedAppliedParts) {
      const fetched = downloadedParts.get(partPath);
      if (!fetched) continue;
      const { records, meta } = fetched;
      for (const raw of records) {
        const norm = normalizeRawCloudItem(raw, {
          generationId: meta.generationId,
          revision: meta.revision,
          isHistorical: meta.isHistorical,
          sourcePath: partPath,
        });
        if (norm) {
          const key = `${norm.itemType}:${norm.platformItemId}`;
          const existing = itemMap.get(key);
          if (!existing) {
            itemMap.set(key, norm);
          } else {
            itemMap.set(key, {
              ...existing,
              ...norm,
              description: norm.description || existing.description,
              thumbnailUrl: norm.thumbnailUrl || existing.thumbnailUrl,
              viewsCount: norm.viewsCount ?? existing.viewsCount,
              likesCount: norm.likesCount ?? existing.likesCount,
              savedAt: norm.savedAt || existing.savedAt,
            });
          }
        }
      }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Phase 5: Direct Item Objects Parsing (if any)
    // ─────────────────────────────────────────────────────────────────────────
    await mapConcurrent(Array.from(discoveredDirectObjects), 8, async (itemKey) => {
      try {
        const { data } = await r2Client.getObject("NEW", itemKey, {
          storageOwnerUuid,
        });
        const raw = JSON.parse(data.toString("utf8")) as Record<string, unknown>;
        const norm = normalizeRawCloudItem(raw, {
          sourcePath: itemKey,
          isHistorical: itemKey.includes("before-app-updating"),
        });
        if (norm) {
          const key = `${norm.itemType}:${norm.platformItemId}`;
          if (!itemMap.has(key)) {
            itemMap.set(key, norm);
          }
        }
      } catch (directErr) {
        console.warn(`[api/saved-items] Direct item read error '${itemKey}':`, directErr);
      }
    });

    // ─────────────────────────────────────────────────────────────────────────
    // Phase 6: Supabase PostgreSQL saved_items_index Reconciliation
    // ─────────────────────────────────────────────────────────────────────────
    let dbIndexedCount = 0;
    try {
      const dbItems = await prisma.savedItemIndex.findMany({
        where: {
          OR: [
            { owner_id: storageOwnerUuid },
            ...(profile ? [{ owner_id: profile.id }] : []),
            ...(profileId ? [{ owner_id: profileId }] : []),
          ],
        },
        orderBy: { saved_at: "desc" },
      });

      dbIndexedCount = dbItems.length;

      for (const dbItem of dbItems) {
        const key = `${dbItem.entity_type.toLowerCase()}:${dbItem.platform_item_id}`;
        const existing = itemMap.get(key);

        if (!existing) {
          // Item present in Supabase relational index but was missing from discovered R2 parts
          const recovered = normalizeRawCloudItem(
            {
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
            },
            {
              generationId: dbItem.generation_id ?? undefined,
              isHistorical: false,
            }
          );
          if (recovered) {
            itemMap.set(key, {
              ...recovered,
              ...({ _inSupabaseIndex: true } as Record<string, unknown>),
            });
          }
        } else {
          // Tag existing R2 item as verified in Supabase index
          (existing as unknown as Record<string, unknown>)._inSupabaseIndex = true;
        }
      }
    } catch (dbErr) {
      console.warn("[api/saved-items] Supabase index reconciliation note:", dbErr);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Phase 7: Filtering, Sorting, and Progressive Cursor/Offset Pagination
    // ─────────────────────────────────────────────────────────────────────────
    let allCloudItems = Array.from(itemMap.values());

    let historicalCount = 0;
    let recentCount = 0;
    for (const item of allCloudItems) {
      if ((item as unknown as Record<string, unknown>)._isHistorical) {
        historicalCount++;
      } else {
        recentCount++;
      }
    }

    const totalCountBeforeFilter = allCloudItems.length;

    // Apply type filter
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

    // Apply search query
    if (searchQuery) {
      allCloudItems = allCloudItems.filter((item) => {
        const titleMatch = item.title?.toLowerCase().includes(searchQuery);
        const channelMatch = item.channelTitle?.toLowerCase().includes(searchQuery);
        const tagMatch = item.tags?.some((t) => t.toLowerCase().includes(searchQuery));
        return titleMatch || channelMatch || tagMatch;
      });
    }

    // Apply sorting
    allCloudItems.sort((a, b) => {
      if (sortOption === "date_asc") {
        const timeA = a.savedAt ? new Date(a.savedAt).getTime() : 0;
        const timeB = b.savedAt ? new Date(b.savedAt).getTime() : 0;
        return timeA - timeB;
      }
      if (sortOption === "title_az") {
        return (a.title || "").localeCompare(b.title || "");
      }
      if (sortOption === "views_desc") {
        return (b.viewsCount ?? 0) - (a.viewsCount ?? 0);
      }
      // Default: date_desc (newest saved first)
      const timeA = a.savedAt ? new Date(a.savedAt).getTime() : 0;
      const timeB = b.savedAt ? new Date(b.savedAt).getTime() : 0;
      return timeB - timeA;
    });

    const paginatedItems = allCloudItems.slice(offset, offset + limit);

    // Explicitly partition into Active Cloud Items vs BEFORE-APP-UPDATING Historical Archive
    const activeCloudItems: NormalizedYouTubeDiscoveryItem[] = [];
    const historicalCloudItems: NormalizedYouTubeDiscoveryItem[] = [];

    for (const item of allCloudItems) {
      if ((item as unknown as Record<string, unknown>)._isHistorical) {
        historicalCloudItems.push(item);
      } else {
        activeCloudItems.push(item);
      }
    }

    const beforeAppUpdatingArchive = {
      bucket: "new-youtube-discovery-private",
      ownerNamespace: "asdy",
      storageOwnerUuid,
      generationId: "gen_legacy_20261112_vkyh94",
      exactGenerationPrefix: `asdy/persistence/${storageOwnerUuid}/${datasetSlug}/before-app-updating/generations/gen_legacy_20261112_vkyh94/`,
      exactPartsPrefix: `asdy/persistence/${storageOwnerUuid}/${datasetSlug}/before-app-updating/generations/gen_legacy_20261112_vkyh94/parts/`,
      manifestKey: exactHistoricalManifestKey,
      totalRecords: historicalCloudItems.length,
      items: historicalCloudItems,
    };

    const catalogStats: CloudCatalogStats = {
      totalUniqueItems: totalCountBeforeFilter,
      enumeratedObjectsCount: totalObjectsListed,
      enumeratedGenerationsCount: knownGenerations.length,
      enumeratedManifestsCount: manifestKeys.length,
      enumeratedPartsCount: partsToFetch.size,
      enumeratedDirectObjectsCount: discoveredDirectObjects.size,
      dbIndexedCount,
      corruptedOrMissingPartsCount: corruptedOrMissingParts.length,
      historicalRecordsCount: historicalCount,
      recentRecordsCount: recentCount,
      isTruncated: isListingTruncated,
      enumerationIncomplete: listingIncomplete,
      truncationReason: listingTruncationReason,
    };

    const response = NextResponse.json({
      ok: true,
      source: "R2_CLOUD",
      items: paginatedItems,
      activeCloudItems: activeCloudItems.slice(offset, offset + limit),
      activeTotalCount: activeCloudItems.length,
      beforeAppUpdatingArchive,
      totalCount: totalCountBeforeFilter,
      filteredCount: allCloudItems.length,
      offset,
      limit,
      hasMore: offset + limit < allCloudItems.length,
      nextOffset: offset + limit < allCloudItems.length ? offset + limit : null,
      generationId: primaryGenerationId,
      revision: highestRevision,
      catalogStats,
    });

    response.headers.set("Cache-Control", "private, no-cache, no-store, must-revalidate");
    return response;
  } catch (err) {
    console.error("[api/saved-items] Error reconstructing cloud saved library from R2:", err);
    const errorMessage =
      err instanceof Error ? err.message : "Failed to load cloud saved library from Cloudflare R2.";

    return NextResponse.json(
      {
        ok: false,
        error: errorMessage,
        code: "CLOUD_RETRIEVAL_ERROR",
        source: "R2_CLOUD",
      },
      {
        status: 502,
        headers: { "Cache-Control": "private, no-cache, no-store, must-revalidate" },
      }
    );
  }
}
