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
  datasetTypeToSlug,
  slugToDatasetType,
  parseStorageKey,
  type CanonicalDatasetType,
} from "@/lib/storage/canonical-paths";

export const dynamic = "force-dynamic";

export interface HydrateDatasetInfo {
  datasetType: CanonicalDatasetType;
  datasetSlug: string;
  currentRevision: number;
  generationId: string | null;
  manifestKey: string | null;
  aggregateSha256: string | null;
  totalParts: number;
  totalRecords: number;
  totalBytes: number;
  parts: Array<{
    partNumber: number;
    storagePath: string;
    sha256: string;
    byteCount: number;
    recordCount: number;
  }>;
}

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * GET /api/sync/hydrate — Authoritative Cloud Dataset Hydration Registry
 * ──────────────────────────────────────────────────────────────────────────
 * Returns the latest committed generations and manifest parts across all 5
 * canonical datasets for the authenticated owner.
 *
 * Source Priority:
 *   1. Supabase PostgreSQL registry (StorageDataset + StorageGeneration + StorageManifestPart)
 *   2. Cloudflare R2 discovery fallback (version pointers and manifests)
 * ═══════════════════════════════════════════════════════════════════════════
 */
export async function GET(request: Request) {
  const auth = await requireAdmin(request);
  if (!auth.ok) return auth.response;

  // Hydration must use the same owner namespace as save-all. Using the auth
  // user id here would silently read a different (empty) partition.
  const storageOwnerUuid = resolveStorageOwnerId(auth.admin);
  if (!storageOwnerUuid) {
    return NextResponse.json(
      { ok: false, error: "Unable to resolve a canonical storage owner for this session." },
      { status: 500 }
    );
  }

  const profileId = resolveProfileId(auth.admin);
  const datasetsMap = new Map<CanonicalDatasetType, HydrateDatasetInfo>();

  // Initialize all 5 canonical datasets with default empty state
  const CANONICAL_TYPES: CanonicalDatasetType[] = [
    "SAVED_ITEMS",
    "PLAYLIST",
    "SEARCH_HISTORY",
    "RESEARCH_QUEUE",
    "REFERENCES",
  ];

  for (const t of CANONICAL_TYPES) {
    datasetsMap.set(t, {
      datasetType: t,
      datasetSlug: datasetTypeToSlug(t),
      currentRevision: 0,
      generationId: null,
      manifestKey: null,
      aggregateSha256: null,
      totalParts: 0,
      totalRecords: 0,
      totalBytes: 0,
      parts: [],
    });
  }

  // 1. Try querying PostgreSQL registry first
  let dbSuccess = false;
  try {
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
          include: {
            generations: {
              where: { state: "COMMITTED" },
              orderBy: { generation_number: "desc" },
              take: 1,
              include: {
                parts: {
                  orderBy: { part_number: "asc" },
                },
              },
            },
          },
        },
      },
    });

    if (profile && profile.storage_datasets.length > 0) {
      for (const ds of profile.storage_datasets) {
        const dType = slugToDatasetType(ds.dataset_type);
        if (!dType) continue;

        const latestGen = ds.generations[0];
        if (latestGen) {
          const parts = latestGen.parts.map((p) => ({
            partNumber: p.part_number,
            storagePath: p.storage_path,
            sha256: p.sha256,
            byteCount: Number(p.byte_count),
            recordCount: p.record_count,
          }));

          datasetsMap.set(dType, {
            datasetType: dType,
            datasetSlug: datasetTypeToSlug(dType),
            currentRevision: Number(ds.current_revision),
            generationId: latestGen.id,
            manifestKey: parts[0]?.storagePath.replace(/parts\/part-\d+\.json$/, "manifest.json") || null,
            aggregateSha256: latestGen.aggregate_sha256,
            totalParts: latestGen.total_parts || parts.length,
            totalRecords: latestGen.total_records,
            totalBytes: Number(latestGen.total_bytes),
            parts,
          });
        } else {
          datasetsMap.set(dType, {
            datasetType: dType,
            datasetSlug: datasetTypeToSlug(dType),
            currentRevision: Number(ds.current_revision),
            generationId: null,
            manifestKey: null,
            aggregateSha256: null,
            totalParts: 0,
            totalRecords: 0,
            totalBytes: 0,
            parts: [],
          });
        }
      }
      dbSuccess = true;
    }
  } catch (err) {
    console.warn("[sync/hydrate] PostgreSQL registry query error, trying R2 discovery:", err);
  }

  // 2. If PostgreSQL had no active generations or was disconnected, inspect
  // Cloudflare R2. The manifest is authoritative for part checksums and
  // record counts; object size/etag must never be treated as SHA-256.
  const hasCommittedGenerations = Array.from(datasetsMap.values()).some((d) => d.generationId !== null);
  if (!dbSuccess || !hasCommittedGenerations) {
    try {
      const r2Client = getR2WorkerStorageClient();

      // Canonical prefix plus every legitimate historical owner layout.
      const ownerIds = resolveLegacyOwnerIds(auth.admin);
      const prefixes = [
        `asdy/persistence/${storageOwnerUuid}/`,
        ...ownerIds
          .filter((owner) => owner !== storageOwnerUuid)
          .map((owner) => `${owner}/persistence/`),
      ];

      const listAll = async (prefix: string) => {
        const collected: Array<{ key: string; size: number; etag: string; uploaded: string; customMetadata?: Record<string, string> }> = [];
        let cursor: string | undefined;
        for (let page = 0; page < 5; page += 1) {
          const listed = await r2Client
            .listObjects("NEW", prefix, { limit: 500, cursor, storageOwnerUuid })
            .catch(() => null);
          if (!listed) break;
          collected.push(...(listed.objects || []));
          if (!listed.truncated || !listed.cursor) break;
          cursor = listed.cursor;
        }
        return collected;
      };

      const lists = await Promise.all(prefixes.map((prefix) => listAll(prefix)));
      const allObjects = lists.flat();

      // Prefer real generation manifests. Historical `before-app-updating`
      // branches are archives, never the current dataset head.
      const manifestObjects = allObjects.filter((obj) => {
        const parsed = parseStorageKey(obj.key);
        return Boolean(parsed?.isManifest && parsed.generationId && !parsed.isBeforeAppUpdating);
      });

      for (const obj of manifestObjects) {
        const parsed = parseStorageKey(obj.key);
        if (!parsed?.datasetType || !parsed.generationId) continue;

        const current = datasetsMap.get(parsed.datasetType);
        if (!current || current.generationId !== null) continue;

        try {
          const { data } = await r2Client.getObject("NEW", obj.key, { storageOwnerUuid });
          const manifest = JSON.parse(data.toString("utf8")) as {
            generationId?: string;
            generationNumber?: number;
            currentRevision?: number;
            aggregateSha256?: string;
            totalRecords?: number;
            totalParts?: number;
            totalBytes?: number;
            parts?: Array<{
              partNumber?: number;
              storagePath?: string;
              sha256?: string;
              byteCount?: number;
              recordCount?: number;
            }>;
          };

          const parts = (manifest.parts || [])
            .filter(
              (part): part is { partNumber: number; storagePath: string; sha256: string; byteCount: number; recordCount: number } =>
                typeof part.partNumber === "number" &&
                typeof part.storagePath === "string" &&
                typeof part.sha256 === "string" &&
                part.sha256.length === 64
            )
            .map((part) => ({
              partNumber: part.partNumber,
              storagePath: part.storagePath,
              sha256: part.sha256,
              byteCount: Number(part.byteCount || 0),
              recordCount: Number(part.recordCount || 0),
            }))
            .sort((a, b) => a.partNumber - b.partNumber);

          if (parts.length === 0) continue;

          current.generationId = manifest.generationId || parsed.generationId;
          current.manifestKey = obj.key;
          current.aggregateSha256 = manifest.aggregateSha256 || null;
          current.currentRevision = Number(
            manifest.generationNumber ?? manifest.currentRevision ?? 1
          );
          current.parts = parts;
          current.totalParts = parts.length;
          current.totalRecords = Number(
            manifest.totalRecords ?? parts.reduce((sum, part) => sum + part.recordCount, 0)
          );
          current.totalBytes = Number(
            manifest.totalBytes ?? parts.reduce((sum, part) => sum + part.byteCount, 0)
          );
        } catch (manifestErr) {
          console.warn(
            `[sync/hydrate] Unable to read R2 manifest '${obj.key}':`,
            manifestErr
          );
        }
      }

      // Legacy generations without a manifest: expose them for recovery but
      // only with a real checksum recorded by the Worker. Missing checksums
      // are surfaced as empty and hydration will treat them as unverified.
      for (const obj of allObjects) {
        const parsed = parseStorageKey(obj.key);
        if (!parsed?.datasetType || !parsed.generationId || parsed.partNumber === null) continue;
        if (parsed.isBeforeAppUpdating) continue;

        const current = datasetsMap.get(parsed.datasetType);
        if (!current || current.generationId !== null) continue;
        if (current.parts.some((part) => part.storagePath === obj.key)) continue;

        const checksum = obj.customMetadata?.sha256 || "";
        current.parts.push({
          partNumber: parsed.partNumber,
          storagePath: obj.key,
          sha256: checksum,
          byteCount: obj.size,
          recordCount: 0,
        });
        current.generationId = parsed.generationId;
        current.manifestKey = obj.key.replace(/parts\/part-\d+\.json$/, "manifest.json");
        current.currentRevision = Math.max(current.currentRevision, 1);
        current.totalParts = current.parts.length;
        current.totalBytes += obj.size;
      }

      for (const dataset of datasetsMap.values()) {
        dataset.parts.sort((a, b) => a.partNumber - b.partNumber);
      }
    } catch (r2Err) {
      console.warn("[sync/hydrate] R2 fallback discovery error:", r2Err);
    }
  }

  const datasetsList = Array.from(datasetsMap.values());

  return NextResponse.json({
    ok: true,
    storageOwnerUuid,
    timestamp: new Date().toISOString(),
    datasetsCount: datasetsList.length,
    populatedDatasetsCount: datasetsList.filter((d) => d.generationId !== null).length,
    datasets: datasetsList,
  });
}
