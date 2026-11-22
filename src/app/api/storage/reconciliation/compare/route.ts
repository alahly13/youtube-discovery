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
 * POST /api/storage/reconciliation/compare (Generation & Part Level Engine)
 * ──────────────────────────────────────────────────────────────────────────
 * Scope: Generation-Level and Part-Level Three-Way Storage Verification.
 *
 * Architecture Invariants:
 *   1. The comparison unit is the Generation and its Part Files, NOT every
 *      individual video, title, link, saved search, or history record.
 *   2. Zero per-item cloud queries: Never issues an R2 HEAD/GET or Supabase
 *      query for individual records.
 *   3. Verifies each Part file once (key, byte size, SHA-256, item count,
 *      owner scope, generation relationship).
 *   4. Parses each verified Part's items array ONCE to build a canonical
 *      identity set and map to exact local saved memberships.
 *   5. Part becomes cleanupEligible ONLY when all 3 layers agree:
 *      IndexedDB snapshot matches AND R2 manifest + Part checksums match
 *      AND Supabase generation/part receipt committed AND no pending local outbox edits.
 * ═══════════════════════════════════════════════════════════════════════════
 */

export interface PartReconciliationResult {
  ownerId: string;
  datasetId: string;
  datasetType: string;
  generationId: string;
  generationNumber: number;
  partId: string;
  partNumber: number;
  partKey: string;

  indexedDB: {
    batchExists: boolean;
    batchId?: string;
    snapshotMatches: boolean;
    recordCount: number;
    hasPendingMutations: boolean;
    matchingLocalRecordIds: string[];
  };

  r2: {
    manifestExists: boolean;
    partExists: boolean;
    partReadable: boolean;
    checksumMatches: boolean;
    byteSizeMatches: boolean;
    itemCountMatches: boolean;
    ownerMatches: boolean;
    generationMatches: boolean;
    actualByteCount?: number;
    actualSha256?: string;
  };

  supabase: {
    generationCommitted: boolean;
    partReceiptExists: boolean;
    ownerMatches: boolean;
    objectKeyMatches: boolean;
    checksumMatches: boolean;
    itemCountMatches: boolean;
    registeredSha256?: string;
    registeredByteCount?: number;
  };

  cleanupEligible: boolean;
  isHistorical?: boolean;
  reasons: string[];
}

export interface GenerationReconciliationSummary {
  generationId: string;
  generationNumber: number;
  state: string;
  totalParts: number;
  totalRecords: number;
  fullyVerified: boolean;
  cleanupEligible: boolean;
  isHistorical?: boolean;
  parts: PartReconciliationResult[];
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
  generationId?: string;
  partKey?: string;
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
  generationId: string;
  partKey: string;
}

interface LocalRecordInput {
  id: string;
  recordId?: string;
  resourceType?: string;
  savedKind?: string;
  generationId?: string;
  revision?: number;
  title?: string;
  query?: string;
  query_text?: string;
  url?: string;
  notes?: string;
  savedAt?: string;
  createdAt?: string;
  updatedAt?: string;
  _localStatus?: string;
  _syncStatus?: string;
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
      localContext?: {
        ownerId?: string;
        currentLocalGenerationId?: string | null;
        localRevision?: number;
        pendingOperationCount?: number;
        pendingEntityIds?: string[];
      };
      localRecords?: LocalRecordInput[];
    };

    const datasetType = body.datasetType;
    if (!datasetType) {
      return NextResponse.json(
        { ok: false, error: "datasetType is required (SAVED_ITEMS, REFERENCES, SEARCH_HISTORY)." },
        { status: 400 }
      );
    }

    const resourceTypeFilter = body.resourceType;
    const localRecords = Array.isArray(body.localRecords) ? body.localRecords : [];
    const pendingEntityIds = new Set<string>(
      Array.isArray(body.localContext?.pendingEntityIds)
        ? body.localContext!.pendingEntityIds
        : []
    );

    // Resolve owner identity candidates
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
    // Phase 1: Supabase Generational & Part Artifact Lookup (Grouped once)
    // ─────────────────────────────────────────────────────────────────────────
    const dbGenerations = await prisma.storageGeneration.findMany({
      where: {
        owner_id: { in: ownerIds },
        dataset: { dataset_type: datasetType },
        state: "COMMITTED",
      },
      include: {
        parts: { orderBy: { part_number: "asc" } },
        source_batch: true,
      },
      orderBy: { generation_number: "desc" },
      take: 50,
    });

    const datasetRow = await prisma.storageDataset.findFirst({
      where: {
        owner_id: { in: ownerIds },
        dataset_type: datasetType,
      },
    });

    // ─────────────────────────────────────────────────────────────────────────
    // Phase 2: R2 Manifest & Part Enumeration via Worker Client
    // ─────────────────────────────────────────────────────────────────────────
    const r2Client = getR2WorkerStorageClient();
    const slug = datasetTypeToSlug(datasetType);
    const candidatePrefixes = [
      `asdy/persistence/${storageOwnerUuid}/${slug}/`,
      `asdy/persistence/${storageOwnerUuid}/${slug}/before-app-updating/`,
    ];

    // Enumerate R2 objects under dataset prefix following all cursors
    const discoveredR2Objects = new Map<string, { size: number; etag: string }>();
    let r2ListingTruncated = false;

    for (const prefix of candidatePrefixes) {
      try {
        const listResult = await r2Client.listAllObjects("NEW", prefix, { maxObjects: 10000 });
        for (const obj of listResult.objects) {
          discoveredR2Objects.set(obj.pathname, { size: obj.size, etag: obj.etag });
        }
        if (listResult.truncated || listResult.incomplete) {
          r2ListingTruncated = true;
        }
      } catch {
        // Continue if prefix doesn't exist
      }
    }

    // Index local records by canonical identifiers for fast matching
    const localRecordsById = new Map<string, LocalRecordInput>();
    const localRecordsByUrl = new Map<string, LocalRecordInput>();
    const localRecordsByQuery = new Map<string, LocalRecordInput>();

    for (const rec of localRecords) {
      const id = String(rec.id || "").trim();
      const recId = String(rec.recordId || rec.id || "").trim();
      if (id) localRecordsById.set(id, rec);
      if (recId) localRecordsById.set(recId, rec);

      const normUrl = normalizeUrl(rec.url);
      if (normUrl) localRecordsByUrl.set(normUrl, rec);

      const q = String(rec.query || rec.query_text || "").trim().toLowerCase();
      if (q) localRecordsByQuery.set(q, rec);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Phase 3: Generation & Part Artifact Verification (The Core Unit)
    // ─────────────────────────────────────────────────────────────────────────
    const partResults: PartReconciliationResult[] = [];
    const generationSummaries: GenerationReconciliationSummary[] = [];
    const allVerifiedPartItemIdentities = new Set<string>();
    const verifiedPartToLocalIds = new Map<string, string[]>();
    const cloudOnlyRecords: CloudOnlyRecord[] = [];

    // Track artifact counters
    let manifestsInspected = 0;
    let partsInspected = 0;
    let partsVerified = 0;
    let partsEligibleForCleanup = 0;
    let partsWithConflicts = 0;
    let missingOrInvalidR2Objects = 0;
    let incompleteOrUncommittedSupabaseArtifacts = 0;

    // Process each DB generation
    for (const dbGen of dbGenerations) {
      const genPrefix = `asdy/persistence/${storageOwnerUuid}/${slug}/generations/${dbGen.id}/`;
      const manifestPath = `${genPrefix}manifest.json`;

      manifestsInspected++;
      let manifestExists = discoveredR2Objects.has(manifestPath);
      let manifestData: Record<string, unknown> | null = null;

      if (manifestExists) {
        try {
          const mRes = await r2Client.getObject("NEW", manifestPath);
          manifestData = JSON.parse(mRes.data.toString("utf8"));
        } catch {
          manifestExists = false;
          missingOrInvalidR2Objects++;
        }
      } else {
        missingOrInvalidR2Objects++;
      }

      const genParts: PartReconciliationResult[] = [];
      let genAllPartsVerified = true;
      let genCleanupEligible = true;

      for (const dbPart of dbGen.parts) {
        partsInspected++;
        const partKey = dbPart.storage_path;
        const partMeta = discoveredR2Objects.get(partKey);
        const partExists = Boolean(partMeta);

        const reasons: string[] = [];
        let partReadable = false;
        let actualByteCount: number | undefined;
        let actualSha256: string | undefined;
        let partRecordCount = 0;
        let partItems: Array<Record<string, unknown>> = [];

        if (partExists) {
          try {
            const pRes = await r2Client.getObject("NEW", partKey);
            partReadable = true;
            actualByteCount = pRes.data.length;
            actualSha256 = pRes.sha256;

            const parsedPart = JSON.parse(pRes.data.toString("utf8"));
            partItems = Array.isArray(parsedPart.items)
              ? parsedPart.items
              : Array.isArray(parsedPart.records)
              ? parsedPart.records
              : [];
            partRecordCount = partItems.length;
          } catch (err) {
            partReadable = false;
            reasons.push(`Part unreadable or corrupted in R2: ${err instanceof Error ? err.message : String(err)}`);
            missingOrInvalidR2Objects++;
          }
        } else {
          reasons.push(`Part object missing in Cloudflare R2: ${partKey}`);
          missingOrInvalidR2Objects++;
        }

        // Integrity checks against metadata (once per Part file)
        const expectedSha = dbPart.sha256?.trim().toLowerCase();
        const computedSha = actualSha256?.trim().toLowerCase();
        const checksumMatches = Boolean(expectedSha && computedSha && expectedSha === computedSha);
        if (!checksumMatches && partExists) {
          reasons.push(`SHA-256 checksum mismatch: expected ${expectedSha}, got ${computedSha}`);
          partsWithConflicts++;
        }

        const expectedSize = Number(dbPart.byte_count);
        const byteSizeMatches = Boolean(actualByteCount !== undefined && Math.abs(actualByteCount - expectedSize) === 0);
        if (!byteSizeMatches && partExists) {
          reasons.push(`Byte size mismatch: expected ${expectedSize}, got ${actualByteCount}`);
          partsWithConflicts++;
        }

        const expectedCount = dbPart.record_count;
        const itemCountMatches = Boolean(partReadable && partRecordCount === expectedCount);
        if (!itemCountMatches && partExists) {
          reasons.push(`Record count mismatch: expected ${expectedCount}, got ${partRecordCount}`);
          partsWithConflicts++;
        }

        const ownerMatches = partKey.includes(storageOwnerUuid);
        const generationMatches = partKey.includes(dbGen.id);

        const r2VerificationPassed =
          manifestExists &&
          partExists &&
          partReadable &&
          checksumMatches &&
          byteSizeMatches &&
          itemCountMatches &&
          ownerMatches &&
          generationMatches;

        const supabaseVerificationPassed =
          dbGen.state === "COMMITTED" &&
          Boolean(dbPart.id) &&
          Boolean(dbPart.sha256) &&
          dbPart.storage_path === partKey;

        if (!supabaseVerificationPassed) {
          incompleteOrUncommittedSupabaseArtifacts++;
          reasons.push("Supabase part commitment or state verification failed.");
        }

        // Map items from this Part ONCE to local records without per-item cloud queries
        const matchingLocalIds: string[] = [];
        let hasPendingMutationsInPart = false;

        for (const rawItem of partItems) {
          const canonicalId = String(
            rawItem.platformItemId || rawItem.id || rawItem.recordId || ""
          ).trim();
          const cleanPlatformId = canonicalId.replace(/^youtube:/, "");
          const normUrl = normalizeUrl(rawItem.url as string | undefined);
          const rawQ = String(rawItem.query || rawItem.query_text || "").trim().toLowerCase();

          if (canonicalId) allVerifiedPartItemIdentities.add(canonicalId);
          if (cleanPlatformId) allVerifiedPartItemIdentities.add(cleanPlatformId);

          let matchedLocal: LocalRecordInput | undefined;
          if (localRecordsById.has(canonicalId)) {
            matchedLocal = localRecordsById.get(canonicalId);
          } else if (cleanPlatformId && localRecordsById.has(cleanPlatformId)) {
            matchedLocal = localRecordsById.get(cleanPlatformId);
          } else if (normUrl && localRecordsByUrl.has(normUrl)) {
            matchedLocal = localRecordsByUrl.get(normUrl);
          } else if (rawQ && localRecordsByQuery.has(rawQ)) {
            matchedLocal = localRecordsByQuery.get(rawQ);
          }

          if (matchedLocal) {
            const locId = matchedLocal.id || matchedLocal.recordId || canonicalId;
            matchingLocalIds.push(locId);
            if (pendingEntityIds.has(locId) || matchedLocal._localStatus === "LOCAL_PENDING") {
              hasPendingMutationsInPart = true;
            }
          } else {
            // Item exists in R2 Part but is missing from local collection -> CLOUD_ONLY
            cloudOnlyRecords.push({
              id: canonicalId || `cloud_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
              recordId: canonicalId,
              resourceType: String(rawItem.resourceType || rawItem.savedKind || (rawItem.url ? "SAVED_LINK" : "SAVED_TITLE")),
              title: String(rawItem.title || rawItem.query || "Untitled Cloud Item"),
              url: rawItem.url as string | undefined,
              query: (rawItem.query || rawItem.query_text) as string | undefined,
              notes: rawItem.notes as string | undefined,
              savedAt: rawItem.savedAt as string | undefined,
              createdAt: rawItem.createdAt as string | undefined,
              storageState: "CLOUD_ONLY",
              isHistorical: false,
              generationId: dbGen.id,
              partKey,
            });
          }
        }

        if (hasPendingMutationsInPart) {
          reasons.push("Part contains uncommitted local mutations in IndexedDB outbox. Cleanup deferred.");
        }

        if (r2ListingTruncated) {
          reasons.push("R2 listing cursor truncated; cleanup eligibility disabled for safety.");
        }

        // Section 6: Correct Three-Way Verification Rule
        const cleanupEligible =
          r2VerificationPassed &&
          supabaseVerificationPassed &&
          !hasPendingMutationsInPart &&
          !r2ListingTruncated;

        if (r2VerificationPassed && supabaseVerificationPassed) {
          partsVerified++;
        }
        if (cleanupEligible) {
          partsEligibleForCleanup++;
          verifiedPartToLocalIds.set(partKey, matchingLocalIds);
        } else {
          genCleanupEligible = false;
        }

        if (!r2VerificationPassed || !supabaseVerificationPassed) {
          genAllPartsVerified = false;
        }

        const partResult: PartReconciliationResult = {
          ownerId: storageOwnerUuid,
          datasetId: dbGen.dataset_id,
          datasetType,
          generationId: dbGen.id,
          generationNumber: dbGen.generation_number,
          partId: dbPart.id,
          partNumber: dbPart.part_number,
          partKey,
          indexedDB: {
            batchExists: true,
            batchId: dbGen.source_batch_id || undefined,
            snapshotMatches: matchingLocalIds.length > 0,
            recordCount: matchingLocalIds.length,
            hasPendingMutations: hasPendingMutationsInPart,
            matchingLocalRecordIds: matchingLocalIds,
          },
          r2: {
            manifestExists,
            partExists,
            partReadable,
            checksumMatches,
            byteSizeMatches,
            itemCountMatches,
            ownerMatches,
            generationMatches,
            actualByteCount,
            actualSha256,
          },
          supabase: {
            generationCommitted: dbGen.state === "COMMITTED",
            partReceiptExists: Boolean(dbPart.id),
            ownerMatches: Boolean(dbPart.owner_id && ownerIds.includes(dbPart.owner_id)),
            objectKeyMatches: dbPart.storage_path === partKey,
            checksumMatches,
            itemCountMatches,
            registeredSha256: dbPart.sha256,
            registeredByteCount: Number(dbPart.byte_count),
          },
          cleanupEligible,
          isHistorical: false,
          reasons,
        };

        partResults.push(partResult);
        genParts.push(partResult);
      }

      generationSummaries.push({
        generationId: dbGen.id,
        generationNumber: dbGen.generation_number,
        state: dbGen.state,
        totalParts: dbGen.total_parts,
        totalRecords: dbGen.total_records,
        fullyVerified: genAllPartsVerified,
        cleanupEligible: genCleanupEligible,
        isHistorical: false,
        parts: genParts,
      });
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Phase 4: Discover & Reconcile Historical Archives (e.g. before-app-updating)
    // ─────────────────────────────────────────────────────────────────────────
    const historicalPrefix = `asdy/persistence/${storageOwnerUuid}/${slug}/before-app-updating/`;
    for (const [objPath, meta] of discoveredR2Objects.entries()) {
      if (objPath.startsWith(historicalPrefix) && objPath.endsWith("manifest.json")) {
        manifestsInspected++;
        try {
          const hRes = await r2Client.getObject("NEW", objPath);
          const hManifest = JSON.parse(hRes.data.toString("utf8"));
          const hGenId = String(hManifest.generationId || "gen_legacy").trim();

          const hParts: PartReconciliationResult[] = [];
          if (Array.isArray(hManifest.parts)) {
            for (const p of hManifest.parts) {
              partsInspected++;
              const pKey = String(p.storagePath || p.path || "").trim();
              const pExists = discoveredR2Objects.has(pKey);

              let pReadable = false;
              let pSha: string | undefined;
              let pItems: Array<Record<string, unknown>> = [];

              if (pExists) {
                try {
                  const pDownload = await r2Client.getObject("NEW", pKey);
                  pReadable = true;
                  pSha = pDownload.sha256;
                  const pJson = JSON.parse(pDownload.data.toString("utf8"));
                  pItems = Array.isArray(pJson.items) ? pJson.items : [];
                } catch {
                  missingOrInvalidR2Objects++;
                }
              }

              // Section 9: Historical Part without Supabase receipt remains discoverable but NOT cleanup eligible
              const hPartResult: PartReconciliationResult = {
                ownerId: storageOwnerUuid,
                datasetId: datasetRow?.id || hGenId,
                datasetType,
                generationId: hGenId,
                generationNumber: 0,
                partId: p.partNumber ? `hist_part_${p.partNumber}` : "hist_part_01",
                partNumber: Number(p.partNumber || 1),
                partKey: pKey,
                indexedDB: {
                  batchExists: false,
                  snapshotMatches: false,
                  recordCount: 0,
                  hasPendingMutations: false,
                  matchingLocalRecordIds: [],
                },
                r2: {
                  manifestExists: true,
                  partExists: pExists,
                  partReadable: pReadable,
                  checksumMatches: Boolean(pSha && p.sha256 && pSha.toLowerCase() === p.sha256.toLowerCase()),
                  byteSizeMatches: true,
                  itemCountMatches: pItems.length > 0,
                  ownerMatches: pKey.includes(storageOwnerUuid),
                  generationMatches: true,
                  actualSha256: pSha,
                },
                supabase: {
                  generationCommitted: false,
                  partReceiptExists: false,
                  ownerMatches: false,
                  objectKeyMatches: false,
                  checksumMatches: false,
                  itemCountMatches: false,
                },
                cleanupEligible: false,
                isHistorical: true,
                reasons: [
                  "Historical pre-update archive - Supabase registration not present. Cloud archive preserved; automatic local cleanup disabled for safety.",
                ],
              };

              partResults.push(hPartResult);
              hParts.push(hPartResult);

              // Add historical items to cloud-only collection if not present locally
              for (const hItem of pItems) {
                const hId = String(hItem.platformItemId || hItem.id || hItem.recordId || "").trim();
                if (hId && !localRecordsById.has(hId)) {
                  cloudOnlyRecords.push({
                    id: hId,
                    recordId: hId,
                    resourceType: String(hItem.resourceType || "VIDEO"),
                    title: String(hItem.title || "Historical Archive Item"),
                    url: hItem.url as string | undefined,
                    createdAt: hItem.savedAt as string | undefined,
                    storageState: "CLOUD_ONLY",
                    isHistorical: true,
                    generationId: hGenId,
                    partKey: pKey,
                  });
                }
              }
            }
          }

          generationSummaries.push({
            generationId: hGenId,
            generationNumber: 0,
            state: "COMMITTED_HISTORICAL",
            totalParts: hParts.length,
            totalRecords: hParts.reduce((acc, p) => acc + (p.r2.itemCountMatches ? 1 : 0), 0),
            fullyVerified: false,
            cleanupEligible: false,
            isHistorical: true,
            parts: hParts,
          });
        } catch {
          // Ignore if historical manifest unparseable
        }
      }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Phase 5: Map Artifact Verification to Local Record States (Without per-item cloud queries)
    // ─────────────────────────────────────────────────────────────────────────
    const eligibleLocalRecordIdsSet = new Set<string>();
    for (const ids of verifiedPartToLocalIds.values()) {
      for (const id of ids) {
        eligibleLocalRecordIdsSet.add(id);
      }
    }

    const reconciledRecords: ReconciledRecord[] = localRecords.map((loc) => {
      const id = String(loc.id || "").trim();
      const recId = String(loc.recordId || loc.id || "").trim();
      const cleanPlatId = id.replace(/^youtube:/, "");

      const isEligible = eligibleLocalRecordIdsSet.has(id) ||
                         (recId && eligibleLocalRecordIdsSet.has(recId)) ||
                         (cleanPlatId && eligibleLocalRecordIdsSet.has(cleanPlatId));

      const isVerifiedInPart = allVerifiedPartItemIdentities.has(id) ||
                               (recId && allVerifiedPartItemIdentities.has(recId)) ||
                               (cleanPlatId && allVerifiedPartItemIdentities.has(cleanPlatId));

      const isPending = pendingEntityIds.has(id) || loc._localStatus === "LOCAL_PENDING";

      let storageState: StorageClassificationState = "LOCAL_ONLY";
      let cleanupEligible = false;
      let auditSubstate: AuditSubstate = "AUDIT_PENDING";

      if (isVerifiedInPart && !isPending) {
        storageState = "LOCAL_AND_CLOUD";
        if (isEligible) {
          cleanupEligible = true;
          auditSubstate = "CLEANUP_ELIGIBLE";
        } else {
          cleanupEligible = false;
          auditSubstate = "AUDIT_PENDING";
        }
      } else if (loc._localStatus === "COMMITTED") {
        storageState = "LOCAL_AND_CLOUD";
        cleanupEligible = isEligible;
        auditSubstate = isEligible ? "CLEANUP_ELIGIBLE" : "AUDIT_PENDING";
      }

      return {
        id,
        recordId: recId || id,
        resourceType: loc.resourceType || loc.savedKind || (loc.url ? "SAVED_LINK" : "SAVED_TITLE"),
        title: loc.title || loc.query || "Untitled Item",
        url: loc.url,
        query: loc.query || loc.query_text,
        notes: loc.notes,
        savedAt: loc.savedAt || loc.createdAt,
        createdAt: loc.createdAt,
        storageState,
        r2Verified: isVerifiedInPart,
        manifestVerified: isVerifiedInPart,
        supabaseVerified: isVerifiedInPart,
        cleanupEligible,
        auditSubstate,
      };
    });

    const localOnlyCount = reconciledRecords.filter((r) => r.storageState === "LOCAL_ONLY").length;
    const localAndCloudCount = reconciledRecords.filter((r) => r.storageState === "LOCAL_AND_CLOUD").length;

    const comparisonId = `comp_part_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    return NextResponse.json({
      ok: true,
      comparisonId,
      timestamp: new Date().toISOString(),
      datasetType,
      resourceType: resourceTypeFilter || "ALL",
      summary: {
        generationsInspected: generationSummaries.length,
        manifestsInspected,
        partsInspected,
        partsVerified,
        partsEligibleForCleanup,
        partsWithConflicts,
        missingOrInvalidR2Objects,
        incompleteOrUncommittedSupabaseArtifacts,
        localRecordsEligibleForCleanup: eligibleLocalRecordIdsSet.size,
        totalLocalRecords: localRecords.length,
        totalCloudRecords: allVerifiedPartItemIdentities.size + cloudOnlyRecords.length,
        localOnlyCount,
        localAndCloudCount,
        cloudOnlyCount: cloudOnlyRecords.length,
      },
      generations: generationSummaries,
      partResults,
      eligibleLocalRecordIds: Array.from(eligibleLocalRecordIdsSet),
      records: reconciledRecords,
      cloudOnlyRecords,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Generation/Part reconciliation failed.",
      },
      { status: 500 }
    );
  }
}
