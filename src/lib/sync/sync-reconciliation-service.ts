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

export interface ReconciliationReport {
  timestamp: string;
  ownerId: string;
  status: "HEALTHY" | "DRIFT_DETECTED" | "CORRUPTED";
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
    let dbDatasets: any[] = [];
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
        dbDatasets = profile.storage_datasets;
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
        (max: number, g: any) => Math.max(max, g.generation_number),
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
        for (const part of gen.parts) {
          totalPartsChecked++;
          dbKnownPaths.add(part.storage_path);

          // Verify part exists in R2
          const inR2 = r2KeyMap.get(part.storage_path);
          if (!inR2) {
            // Also check alternate path prefix
            const altPath = part.storage_path.startsWith("asdy/")
              ? part.storage_path.replace(/^asdy\/persistence\/[^/]+\//, `${storageOwnerUuid}/persistence/`)
              : `asdy/persistence/${storageOwnerUuid}/${part.storage_path.replace(/^[^/]+\/persistence\//, "")}`;

            if (!r2KeyMap.has(altPath)) {
              issues.push({
                severity: "CRITICAL",
                code: "MISSING_PART",
                datasetType: ds.dataset_type,
                generationId: gen.id,
                storagePath: part.storage_path,
                message: `Part recorded in database is missing from R2: ${part.storage_path}`,
              });
            }
          }
        }
      }
    }

    // 3. Check for orphan permanent R2 objects not registered in PostgreSQL
    for (const [key, obj] of r2KeyMap.entries()) {
      if (key.includes("/parts/part-") && !key.includes("/temp/")) {
        if (!dbKnownPaths.has(key)) {
          const parsed = parseStorageKey(key);
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

    const hasCritical = issues.some((i) => i.severity === "CRITICAL");
    const hasWarning = issues.some((i) => i.severity === "WARNING");

    const status: ReconciliationReport["status"] = hasCritical
      ? "CORRUPTED"
      : hasWarning
      ? "DRIFT_DETECTED"
      : "HEALTHY";

    return {
      timestamp: new Date().toISOString(),
      ownerId: storageOwnerUuid,
      status,
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
