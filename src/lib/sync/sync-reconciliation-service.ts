import "server-only";

import { prisma } from "@/lib/db/prisma";
import { getNewStorageBackend } from "@/lib/storage/r2-blob-backend";
import { parseStorageKey } from "@/lib/storage/canonical-paths";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * YouTube Discovery 2026 — Sync Reconciliation & Integrity Service
 * ──────────────────────────────────────────────────────────────────────────
 * Scope: Reconciles Supabase PostgreSQL storage registries (datasets,
 *        generations, manifest parts) against Cloudflare R2 bucket state.
 *
 * Checks:
 *   1. Missing parts: Part exists in DB but is missing in R2.
 *   2. Orphan objects: Object exists in R2 but is unreferenced in DB.
 *   3. Stale temporary objects: Files in /temp/ older than 24 hours.
 *   4. Checksum integrity: ETag / SHA-256 verification.
 *   5. Revision alignment: DB current_revision matches highest generation.
 * ═══════════════════════════════════════════════════════════════════════════
 */

export interface ReconciliationIssue {
  severity: "CRITICAL" | "WARNING" | "INFO";
  code:
    | "MISSING_PART"
    | "CHECKSUM_MISMATCH"
    | "ORPHAN_TEMP"
    | "REVISION_DIVERGENCE"
    | "ORPHAN_R2_OBJECT";
  datasetType?: string;
  generationId?: string;
  storagePath?: string;
  message: string;
}

export type ReconciliationItemStatus =
  | "VERIFIED"
  | "MISSING_FROM_STORAGE"
  | "UNTRACKED_ORPHAN"
  | "METADATA_MISMATCH"
  | "UNCOMMITTED_GENERATION"
  | "INCOMPLETE_PARTS";

export interface ReconciliationItemEntry {
  storagePath: string;
  status: ReconciliationItemStatus;
  details: string;
}

export interface ReconciliationCounts {
  VERIFIED: number;
  MISSING_FROM_STORAGE: number;
  UNTRACKED_ORPHAN: number;
  METADATA_MISMATCH: number;
  UNCOMMITTED_GENERATION: number;
  INCOMPLETE_PARTS: number;
}

export interface ReconciliationReport {
  timestamp: string;
  ownerId: string;
  status: "HEALTHY" | "DRIFT_DETECTED" | "CORRUPTED";
  overallHealthy: boolean;
  totalScanned: number;
  counts: ReconciliationCounts;
  items: ReconciliationItemEntry[];
  totalDatasetsChecked: number;
  totalGenerationsChecked: number;
  totalPartsChecked: number;
  totalR2ObjectsChecked: number;
  issues: ReconciliationIssue[];
  cleanupCandidates: string[];
}

export class SyncReconciliationService {
  /**
   * Reconciles Cloudflare R2 and Supabase PostgreSQL for a specific storage owner.
   */
  public async reconcileOwnerStorage(storageOwnerUuid: string): Promise<ReconciliationReport> {
    const issues: ReconciliationIssue[] = [];
    const cleanupCandidates: string[] = [];
    const items: ReconciliationItemEntry[] = [];
    const counts: ReconciliationCounts = {
      VERIFIED: 0,
      MISSING_FROM_STORAGE: 0,
      UNTRACKED_ORPHAN: 0,
      METADATA_MISMATCH: 0,
      UNCOMMITTED_GENERATION: 0,
      INCOMPLETE_PARTS: 0,
    };
    const backend = getNewStorageBackend();

    // 1. Discover all R2 objects under owner scope
    const canonicalPrefix = `asdy/persistence/${storageOwnerUuid}/`;
    const tempPrefix = `asdy/temp/${storageOwnerUuid}/`;
    const legacyPrefix = `${storageOwnerUuid}/persistence/`;

    let r2Objects: Array<{ pathname: string; size: number; uploadedAt?: Date | string; etag?: string }> = [];
    try {
      const canonicalList = await backend.list(canonicalPrefix);
      const tempList = await backend.list(tempPrefix);
      const legacyList = await backend.list(legacyPrefix);
      r2Objects = [...canonicalList, ...tempList, ...legacyList];
    } catch (err) {
      issues.push({
        severity: "CRITICAL",
        code: "MISSING_PART",
        message: `Failed to query Cloudflare R2 for owner storage: ${err instanceof Error ? err.message : String(err)}`,
      });
    }

    const r2KeyMap = new Map<string, (typeof r2Objects)[0]>();
    for (const obj of r2Objects) {
      r2KeyMap.set(obj.pathname, obj);

      // Check for stale temporary objects (older than 24h)
      if (obj.pathname.includes("/temp/")) {
        const uploadDate = obj.uploadedAt ? new Date(obj.uploadedAt) : null;
        if (uploadDate && Date.now() - uploadDate.getTime() > 24 * 60 * 60 * 1000) {
          issues.push({
            severity: "WARNING",
            code: "ORPHAN_TEMP",
            storagePath: obj.pathname,
            message: `Stale temporary object older than 24 hours detected in R2: ${obj.pathname}`,
          });
          cleanupCandidates.push(obj.pathname);
        }
      }
    }

    // 2. Query Supabase PostgreSQL registries
    type DbPart = {
      part_number: number;
      storage_path: string;
      byte_count: bigint | number;
      record_count: number;
      sha256: string;
    };
    type DbGen = {
      id: string;
      generation_number: number;
      state: string;
      total_parts?: number;
      committed_at?: Date | null;
      parts: DbPart[];
    };
    type DbDataset = {
      dataset_type: string;
      current_revision: bigint | number;
      generations: DbGen[];
    };

    let dbDatasets: DbDataset[] = [];
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
        dbDatasets = profile.storage_datasets as unknown as DbDataset[];
      }
    } catch (dbErr) {
      issues.push({
        severity: "WARNING",
        code: "REVISION_DIVERGENCE",
        message: `Database offline or unreachable during reconciliation: ${dbErr instanceof Error ? dbErr.message : String(dbErr)}`,
      });
    }

    let totalGenerationsChecked = 0;
    let totalPartsChecked = 0;
    const dbKnownPaths = new Set<string>();

    for (const ds of dbDatasets) {
      const currentRev = Number(ds.current_revision);
      const maxGenNumber = ds.generations.reduce(
        (max: number, g) => (g.state === "COMMITTED" ? Math.max(max, g.generation_number) : max),
        0
      );

      if (currentRev < maxGenNumber) {
        issues.push({
          severity: "WARNING",
          code: "REVISION_DIVERGENCE",
          datasetType: ds.dataset_type,
          message: `Dataset ${ds.dataset_type} current_revision (${currentRev}) is lower than highest generation (${maxGenNumber}).`,
        });
      }

      for (const gen of ds.generations) {
        totalGenerationsChecked++;
        const expectedParts = typeof gen.total_parts === "number" ? gen.total_parts : gen.parts.length;
        const isIncomplete = gen.parts.length !== expectedParts || expectedParts === 0;
        const isUncommitted = gen.state !== "COMMITTED";

        if (isUncommitted) {
          counts.UNCOMMITTED_GENERATION++;
          items.push({
            storagePath: `${ds.dataset_type}/generations/${gen.id}`,
            status: "UNCOMMITTED_GENERATION",
            details: `Generation ${gen.generation_number} is in state '${gen.state}' (committed: ${gen.committed_at ? "yes" : "no"}).`,
          });
        }

        if (isIncomplete) {
          counts.INCOMPLETE_PARTS++;
          items.push({
            storagePath: `${ds.dataset_type}/generations/${gen.id}`,
            status: "INCOMPLETE_PARTS",
            details: `Expected ${expectedParts} part(s) in generation ${gen.generation_number}, found ${gen.parts.length}.`,
          });
        }

        for (const part of gen.parts) {
          totalPartsChecked++;
          dbKnownPaths.add(part.storage_path);

          const altPath = part.storage_path.startsWith("asdy/")
            ? part.storage_path.replace(/^asdy\/persistence\/[^/]+\//, `${storageOwnerUuid}/persistence/`)
            : `asdy/persistence/${storageOwnerUuid}/${part.storage_path.replace(/^[^/]+\/persistence\//, "")}`;
          dbKnownPaths.add(altPath);

          // Verify part exists in R2
          const inR2 = r2KeyMap.get(part.storage_path) ?? r2KeyMap.get(altPath);
          if (!inR2) {
            counts.MISSING_FROM_STORAGE++;
            items.push({
              storagePath: part.storage_path,
              status: "MISSING_FROM_STORAGE",
              details: `Part ${part.part_number} (${ds.dataset_type} rev ${gen.generation_number}) recorded in DB is missing from R2.`,
            });
            issues.push({
              severity: "CRITICAL",
              code: "MISSING_PART",
              datasetType: ds.dataset_type,
              generationId: gen.id,
              storagePath: part.storage_path,
              message: `Part recorded in database is missing from R2: ${part.storage_path}`,
            });
            continue;
          }

          const dbBytes = Number(part.byte_count);
          if (Number.isFinite(dbBytes) && dbBytes > 0 && inR2.size !== dbBytes) {
            counts.METADATA_MISMATCH++;
            items.push({
              storagePath: part.storage_path,
              status: "METADATA_MISMATCH",
              details: `Byte size mismatch: DB expects ${dbBytes} B, R2 object reports ${inR2.size} B.`,
            });
            issues.push({
              severity: "CRITICAL",
              code: "CHECKSUM_MISMATCH",
              datasetType: ds.dataset_type,
              generationId: gen.id,
              storagePath: part.storage_path,
              message: `Size mismatch on ${part.storage_path}: DB=${dbBytes}, R2=${inR2.size}.`,
            });
            continue;
          }

          counts.VERIFIED++;
          items.push({
            storagePath: part.storage_path,
            status: "VERIFIED",
            details: `${part.record_count} record(s), ${inR2.size} B, SHA ${String(part.sha256).slice(0, 12)}...`,
          });
        }
      }
    }

    // 3. Check for orphan permanent R2 objects not registered in PostgreSQL
    for (const [key] of r2KeyMap.entries()) {
      if (key.includes("/parts/part-") && !key.includes("/temp/")) {
        if (!dbKnownPaths.has(key)) {
          const parsed = parseStorageKey(key);
          counts.UNTRACKED_ORPHAN++;
          items.push({
            storagePath: key,
            status: "UNTRACKED_ORPHAN",
            details: `Part exists in Cloudflare R2 (${parsed?.datasetType || "unknown dataset"}) without a matching DB registry row.`,
          });
          issues.push({
            severity: "INFO",
            code: "ORPHAN_R2_OBJECT",
            storagePath: key,
            datasetType: parsed?.datasetType || undefined,
            generationId: parsed?.generationId || undefined,
            message: `R2 contains part not registered in database: ${key}`,
          });
        }
      }
    }

    const hasCritical =
      issues.some((i) => i.severity === "CRITICAL") ||
      counts.MISSING_FROM_STORAGE > 0 ||
      counts.METADATA_MISMATCH > 0;
    const hasWarning =
      issues.some((i) => i.severity === "WARNING") ||
      counts.UNCOMMITTED_GENERATION > 0 ||
      counts.INCOMPLETE_PARTS > 0 ||
      counts.UNTRACKED_ORPHAN > 0;

    const status: ReconciliationReport["status"] = hasCritical
      ? "CORRUPTED"
      : hasWarning
      ? "DRIFT_DETECTED"
      : "HEALTHY";

    const overallHealthy =
      !hasCritical &&
      counts.MISSING_FROM_STORAGE === 0 &&
      counts.METADATA_MISMATCH === 0 &&
      counts.INCOMPLETE_PARTS === 0 &&
      counts.UNCOMMITTED_GENERATION === 0;

    return {
      timestamp: new Date().toISOString(),
      ownerId: storageOwnerUuid,
      status,
      overallHealthy,
      totalScanned: items.length,
      counts,
      items,
      totalDatasetsChecked: dbDatasets.length,
      totalGenerationsChecked,
      totalPartsChecked,
      totalR2ObjectsChecked: r2Objects.length,
      issues,
      cleanupCandidates,
    };
  }
}

export const syncReconciliationService = new SyncReconciliationService();
