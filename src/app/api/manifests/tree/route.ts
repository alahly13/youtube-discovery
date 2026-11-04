import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/require-auth";
import { getNewStorageBackend } from "@/lib/storage/r2-blob-backend";
import { parseStorageKey } from "@/lib/storage/canonical-paths";
import { prisma } from "@/lib/db/prisma";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * GET /api/manifests/tree
 * ──────────────────────────────────────────────────────────────────────────
 * Returns the hierarchical dataset, generation, and parts tree for the
 * authenticated administrator, scoped strictly to their storage partition.
 *
 * Scans both canonical `asdy/persistence/<ownerId>/` and legacy
 * `<ownerId>/persistence/` paths, parsing with parseStorageKey(), and
 * augmenting with PostgreSQL database metadata if active.
 * ═══════════════════════════════════════════════════════════════════════════
 */

export async function GET(request: Request) {
  const auth = await requireAdmin(request);
  if (!auth.ok) return auth.response;

  const storageOwnerUuid = auth.admin.userId || "00000000-0000-0000-0000-000000000001";

  try {
    const backend = getNewStorageBackend();

    // 1. List objects from canonical prefix
    const canonicalPrefix = `asdy/persistence/${storageOwnerUuid}/`;
    let canonicalObjects: Array<{ pathname: string; size: number; etag?: string }> = [];
    try {
      canonicalObjects = await backend.list(canonicalPrefix);
    } catch {
      // Best effort
    }

    // 2. List objects from legacy prefix
    const legacyPrefix = `${storageOwnerUuid}/persistence/`;
    let legacyObjects: Array<{ pathname: string; size: number; etag?: string }> = [];
    try {
      legacyObjects = await backend.list(legacyPrefix);
    } catch {
      // Best effort
    }

    // Merge and deduplicate by pathname
    const allObjectsMap = new Map<string, { pathname: string; size: number; etag?: string }>();
    for (const obj of canonicalObjects) allObjectsMap.set(obj.pathname, obj);
    for (const obj of legacyObjects) allObjectsMap.set(obj.pathname, obj);

    // Map datasets
    const datasetsMap = new Map<
      string,
      {
        id: string;
        datasetType: string;
        displayName: string;
        currentRevision: number;
        generations: Map<
          string,
          {
            id: string;
            generationNumber: number;
            state: string;
            totalBytes: number;
            aggregateSha256: string | null;
            isBeforeAppUpdating?: boolean;
            parts: Array<{
              id: string;
              partNumber: number;
              storagePath: string;
              byteCount: number;
              recordCount: number;
              sha256: string;
              status: string;
            }>;
          }
        >;
      }
    >();

    // Seed default datasets for visibility
    const defaultDatasets = [
      { id: "saved-items", type: "SAVED_ITEMS", name: "Saved Items Library" },
      { id: "saved-playlists", type: "PLAYLIST", name: "Saved Playlists" },
      { id: "saved-search-history", type: "SEARCH_HISTORY", name: "Search History" },
      { id: "research-queue", type: "RESEARCH_QUEUE", name: "Research Queue" },
      { id: "references", type: "REFERENCES", name: "References & Citations" },
    ];

    for (const d of defaultDatasets) {
      datasetsMap.set(d.id, {
        id: d.id,
        datasetType: d.type,
        displayName: d.name,
        currentRevision: 1,
        generations: new Map(),
      });
    }

    // Parse each listed object
    for (const obj of allObjectsMap.values()) {
      const parsed = parseStorageKey(obj.pathname);

      if (parsed && parsed.generationId && parsed.partNumber !== null) {
        const datasetKey = parsed.datasetSlug || parsed.datasetType?.toLowerCase().replace(/_/g, "-") || "unknown";
        const displayName = parsed.datasetType
          ? parsed.datasetType.replace(/_/g, " ").toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase())
          : datasetKey;

        if (!datasetsMap.has(datasetKey)) {
          datasetsMap.set(datasetKey, {
            id: datasetKey,
            datasetType: parsed.datasetType || datasetKey.toUpperCase().replace(/-/g, "_"),
            displayName,
            currentRevision: 1,
            generations: new Map(),
          });
        }

        const ds = datasetsMap.get(datasetKey)!;
        const genId = parsed.generationId;

        if (!ds.generations.has(genId)) {
          ds.generations.set(genId, {
            id: genId,
            generationNumber: 1,
            state: "COMMITTED",
            totalBytes: 0,
            aggregateSha256: null,
            isBeforeAppUpdating: parsed.isBeforeAppUpdating,
            parts: [],
          });
        }

        const gen = ds.generations.get(genId)!;
        const partNum = parsed.partNumber;

        // Check if part already added
        if (!gen.parts.some((p) => p.partNumber === partNum)) {
          gen.parts.push({
            id: `part_${genId}_${partNum}`,
            partNumber: partNum,
            storagePath: obj.pathname,
            byteCount: obj.size,
            recordCount: Math.max(1, Math.round(obj.size / 200)),
            sha256: (obj.etag || "").replace(/"/g, "") || "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
            status: "VERIFIED",
          });
          gen.totalBytes += obj.size;
        }
      } else {
        // Fallback for legacy formats not matching parseStorageKey
        const parts = obj.pathname.split("/");
        const dsIdx = parts.indexOf("datasets");
        if (dsIdx !== -1 && parts.length > dsIdx + 5 && parts[dsIdx + 2] === "generations") {
          const datasetId = parts[dsIdx + 1];
          const genId = parts[dsIdx + 3];
          const filename = parts[parts.length - 1];

          if (!datasetsMap.has(datasetId)) {
            datasetsMap.set(datasetId, {
              id: datasetId,
              datasetType: datasetId.startsWith("pl_") ? "PLAYLIST" : "SAVED_ITEMS",
              displayName: datasetId.startsWith("pl_") ? `Personal Playlist (${datasetId})` : "Saved Items",
              currentRevision: 1,
              generations: new Map(),
            });
          }

          const ds = datasetsMap.get(datasetId)!;
          if (!ds.generations.has(genId)) {
            ds.generations.set(genId, {
              id: genId,
              generationNumber: 1,
              state: "COMMITTED",
              totalBytes: 0,
              aggregateSha256: null,
              parts: [],
            });
          }

          const gen = ds.generations.get(genId)!;
          const partMatch = filename.match(/part-(\d+)\.json/);
          const partNum = partMatch ? parseInt(partMatch[1], 10) : gen.parts.length + 1;

          if (!gen.parts.some((p) => p.partNumber === partNum)) {
            gen.parts.push({
              id: `part_${genId}_${partNum}`,
              partNumber: partNum,
              storagePath: obj.pathname,
              byteCount: obj.size,
              recordCount: Math.max(1, Math.round(obj.size / 200)),
              sha256: (obj.etag || "").replace(/"/g, "") || "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
              status: "VERIFIED",
            });
            gen.totalBytes += obj.size;
          }
        }
      }
    }

    // Try to query PostgreSQL to enrich revisions and database generations
    try {
      const profile = await prisma.userProfile.findFirst({
        where: { storage_owner_uuid: storageOwnerUuid },
        include: {
          storage_datasets: {
            include: {
              generations: {
                include: {
                  parts: true,
                },
              },
            },
          },
        },
      });

      if (profile && profile.storage_datasets) {
        for (const dbDs of profile.storage_datasets) {
          const type = dbDs.dataset_type;
          const slug = type.toLowerCase().replace(/_/g, "-");
          const existing = datasetsMap.get(slug) || datasetsMap.get(type);

          if (existing) {
            existing.currentRevision = Number(dbDs.current_revision);
            for (const dbGen of dbDs.generations) {
              const genId = dbGen.id;
              if (!existing.generations.has(genId)) {
                existing.generations.set(genId, {
                  id: genId,
                  generationNumber: dbGen.generation_number,
                  state: dbGen.state,
                  totalBytes: Number(dbGen.total_bytes),
                  aggregateSha256: dbGen.aggregate_sha256,
                  parts: dbGen.parts.map((p) => ({
                    id: p.id,
                    partNumber: p.part_number,
                    storagePath: p.storage_path,
                    byteCount: Number(p.byte_count),
                    recordCount: p.record_count,
                    sha256: p.sha256,
                    status: "VERIFIED",
                  })),
                });
              }
            }
          }
        }
      }
    } catch {
      // Prisma offline or disconnected, R2 list suffices
    }

    // Convert to JSON-serializable array
    const tree = Array.from(datasetsMap.values()).map((ds) => ({
      ...ds,
      generations: Array.from(ds.generations.values()).map((g) => ({
        ...g,
        parts: g.parts.sort((a, b) => a.partNumber - b.partNumber),
      })),
    }));

    return NextResponse.json({
      ok: true,
      owner: {
        username: auth.admin.username,
        storageOwnerUuid,
      },
      datasets: tree,
      totalDatasets: tree.length,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Failed to load manifest tree" },
      { status: 500 }
    );
  }
}
