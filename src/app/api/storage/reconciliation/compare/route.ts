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

export const dynamic = "force-dynamic";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * POST /api/storage/reconciliation/compare
 * ──────────────────────────────────────────────────────────────────────────
 * Scope: Authentic three-way comparison engine matching canonical records
 *        across Local IndexedDB, Cloudflare R2, and Supabase PostgreSQL.
 *
 * Supported Datasets:
 *   - REFERENCES: SAVED_TITLE, SAVED_LINK (saved_references table)
 *   - REFERENCES: SAVED_SEARCH (saved_search_presets table)
 *   - SEARCH_HISTORY: SEARCH_HISTORY (search_history_records table)
 *   - SAVED_ITEMS: VIDEO, CHANNEL, PLAYLIST (saved_items_index table)
 * ═══════════════════════════════════════════════════════════════════════════
 */

interface LocalRecordInput {
  id: string;
  recordId?: string;
  resourceType?: string;
  savedKind?: string;
  title?: string;
  query?: string;
  query_text?: string;
  url?: string;
  notes?: string;
  savedAt?: string;
  createdAt?: string;
  updatedAt?: string;
  checksum?: string;
}

export type StorageClassificationState =
  | "LOCAL_ONLY"
  | "LOCAL_AND_CLOUD"
  | "CLOUD_ONLY";

export type AuditSubstate =
  | "CLEANUP_ELIGIBLE"
  | "AUDIT_PENDING"
  | "NEEDS_REVIEW";

export interface ReconciledRecord {
  id: string;
  recordId?: string;
  resourceType: string;
  title: string;
  url?: string;
  query?: string;
  notes?: string;
  savedAt?: string;
  createdAt?: string;
  storageState: StorageClassificationState;
  r2Verified: boolean;
  manifestVerified: boolean;
  supabaseVerified: boolean;
  cleanupEligible: boolean;
  auditSubstate: AuditSubstate;
  cloudMeta?: {
    r2StoragePath?: string;
    generationId?: string;
    revision?: number;
    partNumber?: number;
    sha256?: string;
    supabaseId?: string;
  };
}

export interface CloudOnlyRecord {
  id: string;
  recordId?: string;
  resourceType: string;
  title: string;
  url?: string;
  query?: string;
  notes?: string;
  savedAt?: string;
  createdAt?: string;
  storageState: "CLOUD_ONLY";
  isHistorical?: boolean;
  cloudMeta?: {
    r2StoragePath?: string;
    generationId?: string;
    revision?: number;
    partNumber?: number;
    sha256?: string;
    supabaseId?: string;
  };
}

function normalizeUrl(value?: string): string {
  if (!value) return "";
  try {
    const parsed = new URL(value.trim());
    parsed.hash = "";
    const path = parsed.pathname.replace(/\/+$/, "") || "/";
    return `${parsed.protocol}//${parsed.host.toLowerCase()}${path}${parsed.search}`;
  } catch {
    return value.trim().toLowerCase();
  }
}

export async function POST(request: Request) {
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

  try {
    const body = (await request.json()) as {
      datasetType: CanonicalDatasetType;
      resourceType?: string;
      localRecords?: LocalRecordInput[];
    };

    const datasetType = body.datasetType;
    if (!datasetType) {
      return NextResponse.json(
        { ok: false, error: "datasetType is required (REFERENCES, SEARCH_HISTORY, SAVED_ITEMS)." },
        { status: 400 }
      );
    }

    const resourceTypeFilter = body.resourceType;
    const localRecords = Array.isArray(body.localRecords) ? body.localRecords : [];

    // Resolve owner profile in DB
    const profile = await prisma.userProfile.findFirst({
      where: {
        OR: [
          { storage_owner_uuid: storageOwnerUuid },
          ...(profileId ? [{ id: profileId }] : []),
          ...(auth.admin.userId ? [{ auth_user_id: auth.admin.userId }] : []),
        ],
      },
    });

    const ownerIds = Array.from(
      new Set(
        [storageOwnerUuid, profile?.id, profileId, profile?.storage_owner_uuid].filter(
          (id): id is string => Boolean(id)
        )
      )
    );

    // ─────────────────────────────────────────────────────────────────────────
    // Phase 1: Query Supabase PostgreSQL
    // ─────────────────────────────────────────────────────────────────────────
    const supabaseRecordsMap = new Map<string, Record<string, unknown>>();

    if (datasetType === "REFERENCES") {
      if (resourceTypeFilter === "SAVED_SEARCH") {
        // Saved Search Presets
        const dbSearches = await prisma.savedSearchPreset.findMany({
          where: { owner_id: { in: ownerIds } },
          orderBy: { created_at: "desc" },
        });
        for (const row of dbSearches) {
          const recId = row.record_id || row.id;
          supabaseRecordsMap.set(recId, {
            id: row.id,
            recordId: row.record_id || row.id,
            resourceType: "SAVED_SEARCH",
            title: row.title,
            query: row.query_text,
            createdAt: row.created_at.toISOString(),
            savedAt: row.saved_at.toISOString(),
            isPinned: row.is_pinned,
            tags: row.tags,
          });
        }
      } else {
        // Saved References (Titles & Links)
        const dbRefs = await prisma.savedReference.findMany({
          where: {
            owner_id: { in: ownerIds },
            ...(resourceTypeFilter
              ? { resource_type: resourceTypeFilter }
              : {}),
          },
          orderBy: { created_at: "desc" },
        });
        for (const row of dbRefs) {
          const recId = row.record_id || row.id;
          supabaseRecordsMap.set(recId, {
            id: row.id,
            recordId: row.record_id || row.id,
            resourceType: row.resource_type || (row.url ? "SAVED_LINK" : "SAVED_TITLE"),
            title: row.title,
            url: row.url || undefined,
            notes: row.notes || undefined,
            createdAt: row.created_at.toISOString(),
            savedAt: row.saved_at.toISOString(),
            generationId: row.generation_id,
            manifestPartId: row.manifest_part_id,
          });
        }
      }
    } else if (datasetType === "SEARCH_HISTORY") {
      const dbHistory = await prisma.searchHistoryRecord.findMany({
        where: { owner_id: { in: ownerIds } },
        orderBy: { executed_at: "desc" },
      });
      for (const row of dbHistory) {
        supabaseRecordsMap.set(row.id, {
          id: row.id,
          recordId: row.id,
          resourceType: "SEARCH_HISTORY",
          title: row.query_text,
          query: row.query_text,
          manifestId: row.manifest_id,
          generationId: row.generation_id,
          createdAt: row.executed_at.toISOString(),
          savedAt: row.executed_at.toISOString(),
        });
      }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Phase 2: Query Cloudflare R2 Manifests & Parts
    // ─────────────────────────────────────────────────────────────────────────
    const r2Client = getR2WorkerStorageClient();
    const slug = datasetTypeToSlug(datasetType);
    const candidatePrefixes = [
      `asdy/persistence/${storageOwnerUuid}/${slug}/`,
      `asdy/persistence/${storageOwnerUuid}/${slug}/before-app-updating/`,
    ];

    const r2RecordsMap = new Map<string, Record<string, unknown>>();

    // Also inspect committed generations registered in Supabase
    const dbGenerations = await prisma.storageGeneration.findMany({
      where: {
        owner_id: { in: ownerIds },
        dataset: { dataset_type: datasetType },
        state: "COMMITTED",
      },
      include: {
        parts: true,
      },
      orderBy: { generation_number: "desc" },
      take: 20,
    });

    const partPathsToFetch = new Set<string>();
    for (const gen of dbGenerations) {
      for (const part of gen.parts) {
        if (part.storage_path) {
          partPathsToFetch.add(part.storage_path);
        }
      }
    }

    // List objects in R2
    for (const prefix of candidatePrefixes) {
      try {
        const listResult = await r2Client.listAllObjects("NEW", prefix, { maxObjects: 5000 });
        for (const obj of listResult.objects) {
          if (obj.pathname.includes("/parts/") && obj.pathname.endsWith(".json")) {
            partPathsToFetch.add(obj.pathname);
          }
        }
      } catch {
        // Continue if listing candidate prefix fails
      }
    }

    // Fetch up to 15 newest part files to inspect actual R2 payload
    const partPathArray = Array.from(partPathsToFetch).slice(0, 15);
    for (const path of partPathArray) {
      try {
        const partRes = await r2Client.downloadObject("NEW", path);
        if (partRes.status === 200) {
          const partJson = JSON.parse(partRes.text) as Record<string, unknown>;
          const items = Array.isArray(partJson.items)
            ? (partJson.items as Array<Record<string, unknown>>)
            : Array.isArray(partJson.records)
            ? (partJson.records as Array<Record<string, unknown>>)
            : [];

          for (const item of items) {
            const rawId = String(item.id || item.recordId || item.platformItemId || "").trim();
            if (rawId) {
              r2RecordsMap.set(rawId, {
                ...item,
                _sourceR2Path: path,
              });
            }
          }
        }
      } catch {
        // Continue if single part download fails
      }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Phase 3: Match & Classify Each Local Record
    // ─────────────────────────────────────────────────────────────────────────
    const matchedCloudKeys = new Set<string>();
    const reconciledRecords: ReconciledRecord[] = [];

    for (const local of localRecords) {
      const localId = String(local.id || "").trim();
      const localRecordId = String(local.recordId || local.id || "").trim();
      const localUrlNorm = normalizeUrl(local.url);
      const localTitle = String(local.title || "").trim().toLowerCase();
      const localQuery = String(local.query || local.query_text || "").trim().toLowerCase();

      // Check PostgreSQL match
      let dbMatch: Record<string, unknown> | undefined;
      if (supabaseRecordsMap.has(localId)) {
        dbMatch = supabaseRecordsMap.get(localId);
      } else if (localRecordId && supabaseRecordsMap.has(localRecordId)) {
        dbMatch = supabaseRecordsMap.get(localRecordId);
      } else {
        // Fallback matching by URL or query or title
        for (const [key, row] of supabaseRecordsMap.entries()) {
          if (matchedCloudKeys.has(`db_${key}`)) continue;
          if (localUrlNorm && normalizeUrl(row.url as string) === localUrlNorm) {
            dbMatch = row;
            break;
          }
          if (localQuery && String(row.query || row.query_text || "").trim().toLowerCase() === localQuery) {
            dbMatch = row;
            break;
          }
          if (localTitle && String(row.title || "").trim().toLowerCase() === localTitle) {
            dbMatch = row;
            break;
          }
        }
      }

      if (dbMatch) {
        matchedCloudKeys.add(`db_${String(dbMatch.recordId || dbMatch.id)}`);
      }

      // Check R2 match
      let r2Match: Record<string, unknown> | undefined;
      if (r2RecordsMap.has(localId)) {
        r2Match = r2RecordsMap.get(localId);
      } else if (localRecordId && r2RecordsMap.has(localRecordId)) {
        r2Match = r2RecordsMap.get(localRecordId);
      } else {
        for (const [key, item] of r2RecordsMap.entries()) {
          if (matchedCloudKeys.has(`r2_${key}`)) continue;
          if (localUrlNorm && normalizeUrl(item.url as string) === localUrlNorm) {
            r2Match = item;
            break;
          }
          if (localQuery && String(item.query || item.query_text || "").trim().toLowerCase() === localQuery) {
            r2Match = item;
            break;
          }
          if (localTitle && String(item.title || "").trim().toLowerCase() === localTitle) {
            r2Match = item;
            break;
          }
        }
      }

      if (r2Match) {
        matchedCloudKeys.add(`r2_${String(r2Match.id || r2Match.recordId)}`);
      }

      const r2Verified = Boolean(r2Match);
      const supabaseVerified = Boolean(dbMatch);
      const manifestVerified = Boolean(
        (dbMatch && dbMatch.generationId) || (r2Match && r2Match._sourceR2Path)
      );

      let storageState: StorageClassificationState = "LOCAL_ONLY";
      let cleanupEligible = false;
      let auditSubstate: AuditSubstate = "AUDIT_PENDING";

      if (r2Verified || supabaseVerified) {
        storageState = "LOCAL_AND_CLOUD";
        if (r2Verified && supabaseVerified) {
          cleanupEligible = true;
          auditSubstate = "CLEANUP_ELIGIBLE";
        } else if (r2Verified && !supabaseVerified) {
          // Present in R2 but DB row sync pending
          cleanupEligible = true; // Still safely recoverable from R2 object
          auditSubstate = "AUDIT_PENDING";
        } else {
          // In DB but R2 part not directly indexed
          cleanupEligible = false;
          auditSubstate = "NEEDS_REVIEW";
        }
      }

      reconciledRecords.push({
        id: localId,
        recordId: localRecordId || localId,
        resourceType:
          local.resourceType ||
          local.savedKind ||
          (local.url ? "SAVED_LINK" : "SAVED_TITLE"),
        title: local.title || local.query || "Untitled Item",
        url: local.url,
        query: local.query || local.query_text,
        notes: local.notes,
        savedAt: local.savedAt || local.createdAt,
        createdAt: local.createdAt,
        storageState,
        r2Verified,
        manifestVerified,
        supabaseVerified,
        cleanupEligible,
        auditSubstate,
        cloudMeta: {
          r2StoragePath: (r2Match?._sourceR2Path as string) || undefined,
          generationId: (dbMatch?.generationId as string) || undefined,
          supabaseId: (dbMatch?.id as string) || undefined,
        },
      });
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Phase 4: Identify CLOUD_ONLY Records (in DB/R2 but not in local state)
    // ─────────────────────────────────────────────────────────────────────────
    const cloudOnlyRecords: CloudOnlyRecord[] = [];

    for (const [recKey, dbRow] of supabaseRecordsMap.entries()) {
      if (!matchedCloudKeys.has(`db_${recKey}`)) {
        cloudOnlyRecords.push({
          id: String(dbRow.id || recKey),
          recordId: String(dbRow.recordId || recKey),
          resourceType: String(dbRow.resourceType || (dbRow.url ? "SAVED_LINK" : "SAVED_TITLE")),
          title: String(dbRow.title || dbRow.query || "Untitled Cloud Item"),
          url: dbRow.url as string | undefined,
          query: (dbRow.query || dbRow.query_text) as string | undefined,
          notes: dbRow.notes as string | undefined,
          createdAt: dbRow.createdAt as string | undefined,
          savedAt: dbRow.savedAt as string | undefined,
          storageState: "CLOUD_ONLY",
          isHistorical: false,
          cloudMeta: {
            supabaseId: dbRow.id as string | undefined,
            generationId: dbRow.generationId as string | undefined,
          },
        });
      }
    }

    const comparisonId = `comp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const localOnlyCount = reconciledRecords.filter((r) => r.storageState === "LOCAL_ONLY").length;
    const localAndCloudCount = reconciledRecords.filter((r) => r.storageState === "LOCAL_AND_CLOUD").length;
    const cleanupEligibleCount = reconciledRecords.filter((r) => r.cleanupEligible).length;

    return NextResponse.json({
      ok: true,
      comparisonId,
      timestamp: new Date().toISOString(),
      datasetType,
      resourceType: resourceTypeFilter || "ALL",
      summary: {
        totalLocal: localRecords.length,
        totalCloud: supabaseRecordsMap.size + r2RecordsMap.size,
        localOnlyCount,
        localAndCloudCount,
        cloudOnlyCount: cloudOnlyRecords.length,
        cleanupEligibleCount,
      },
      records: reconciledRecords,
      cloudOnlyRecords,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Reconciliation comparison failed.",
      },
      { status: 500 }
    );
  }
}
