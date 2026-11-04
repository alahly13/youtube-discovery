import "server-only";

import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/require-auth";
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

  const storageOwnerUuid = auth.admin.userId || "asdy-admin";
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
          { id: storageOwnerUuid },
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

  // 2. If PostgreSQL had no active generations or was disconnected, inspect Cloudflare R2
  const hasCommittedGenerations = Array.from(datasetsMap.values()).some((d) => d.generationId !== null);
  if (!dbSuccess || !hasCommittedGenerations) {
    try {
      const r2Client = getR2WorkerStorageClient();

      // Check both canonical prefix and legacy prefix
      const canonicalPrefix = `asdy/persistence/${storageOwnerUuid}/`;
      const legacyPrefix = `${storageOwnerUuid}/persistence/`;

      const [canonicalList, legacyList] = await Promise.all([
        r2Client.listObjects("NEW", canonicalPrefix, { limit: 500 }).catch(() => ({ objects: [] })),
        r2Client.listObjects("NEW", legacyPrefix, { limit: 500 }).catch(() => ({ objects: [] })),
      ]);

      const allObjects = [...(canonicalList.objects || []), ...(legacyList.objects || [])];

      for (const obj of allObjects) {
        const parsed = parseStorageKey(obj.key);
        if (!parsed || !parsed.datasetType || !parsed.generationId) continue;

        const current = datasetsMap.get(parsed.datasetType)!;

        if (parsed.partNumber !== null) {
          const exists = current.parts.some((p) => p.storagePath === obj.key);
          if (!exists) {
            current.parts.push({
              partNumber: parsed.partNumber,
              storagePath: obj.key,
              sha256: (obj.etag || "").replace(/"/g, ""),
              byteCount: obj.size,
              recordCount: Math.max(1, Math.round(obj.size / 200)),
            });
            current.totalParts = current.parts.length;
            current.totalBytes += obj.size;
            current.totalRecords += Math.max(1, Math.round(obj.size / 200));
            current.generationId = parsed.generationId;
            current.currentRevision = Math.max(current.currentRevision, 1);
          }
        } else if (parsed.isManifest) {
          current.manifestKey = obj.key;
          current.generationId = parsed.generationId;
        }
      }

      // Sort parts
      for (const d of datasetsMap.values()) {
        d.parts.sort((a, b) => a.partNumber - b.partNumber);
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
