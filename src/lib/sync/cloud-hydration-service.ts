/**
 * ═══════════════════════════════════════════════════════════════════════════
 * YouTube Discovery 2026 — Cloud Hydration Service & State Machine
 * ──────────────────────────────────────────────────────────────────────────
 * Scope: Recovers and hydrates full user datasets from Supabase PostgreSQL
 *        and Cloudflare R2 onto a fresh browser or clean device profile.
 *
 * Guarantees:
 *   1. Zero silent loss: Fresh browser never displays a fake empty state
 *      while remote hydration is active.
 *   2. Atomic Local Commit: Records commit to IndexedDB before updating
 *      the local dataset catalog revision.
 *   3. Outbox Preservation: Existing local pending operations are NEVER
 *      overwritten or lost during hydration.
 *   4. Incremental Optimization: Skips re-downloading if local revision
 *      matches remote authoritative revision.
 * ═══════════════════════════════════════════════════════════════════════════
 */

import {
  bulkHydrateDatasetEntities,
  getDatasetCatalogEntry,
  type CanonicalDatasetType,
} from "../storage/indexeddb-store";

export type HydrationState =
  | "NOT_HYDRATED"
  | "CHECKING_REGISTRY"
  | "FETCHING_MANIFEST"
  | "FETCHING_PARTS"
  | "VERIFYING"
  | "RESTORING_LOCAL_INDEX"
  | "MERGING_PENDING_CHANGES"
  | "READY"
  | "PARTIAL_FAILURE"
  | "FAILED";

export interface HydrationProgress {
  state: HydrationState;
  currentDataset?: CanonicalDatasetType;
  totalDatasets: number;
  completedDatasets: number;
  totalParts: number;
  downloadedParts: number;
  restoredRecords: number;
  errorMessage?: string;
  lastHydratedAt?: string;
}

export type HydrationListener = (progress: HydrationProgress) => void;

interface RemoteDatasetRegistryItem {
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

const SHA256_HEX_PATTERN = /^[0-9a-f]{64}$/i;

/**
 * Computes SHA-256 over the exact downloaded bytes using Web Crypto.
 * Hydration refuses to import bytes it cannot verify; there is no
 * "trust the transport" mode.
 */
async function computeSha256Hex(buffer: ArrayBuffer): Promise<string> {
  if (typeof crypto === "undefined" || !crypto.subtle) {
    throw new Error("Web Crypto is unavailable; refusing to hydrate unverified data.");
  }
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

class CloudHydrationService {
  private progress: HydrationProgress = {
    state: "NOT_HYDRATED",
    totalDatasets: 5,
    completedDatasets: 0,
    totalParts: 0,
    downloadedParts: 0,
    restoredRecords: 0,
  };

  private listeners = new Set<HydrationListener>();
  private isRunning = false;

  constructor() {
    if (typeof window !== "undefined") {
      const savedAt = localStorage.getItem("yt_discovery_last_hydrated_at");
      if (savedAt) {
        this.progress.lastHydratedAt = savedAt;
      }
    }
  }

  public getProgress(): HydrationProgress {
    return { ...this.progress };
  }

  public subscribe(listener: HydrationListener): () => void {
    this.listeners.add(listener);
    listener(this.getProgress());
    return () => this.listeners.delete(listener);
  }

  private emit(updates: Partial<HydrationProgress>) {
    this.progress = { ...this.progress, ...updates };
    const current = this.getProgress();
    for (const listener of this.listeners) {
      try {
        listener(current);
      } catch {
        // Listener safety
      }
    }

    if (typeof window !== "undefined") {
      window.dispatchEvent(
        new CustomEvent("yt-discovery-hydration-changed", { detail: current })
      );
    }
  }

  /**
   * Performs full or incremental cloud hydration across all 5 datasets.
   */
  public async hydrateAllDatasets(
    ownerId: string,
    force = false
  ): Promise<{ success: boolean; restoredRecords: number; error?: string }> {
    if (this.isRunning) {
      return { success: false, restoredRecords: 0, error: "Hydration already in progress" };
    }

    this.isRunning = true;
    this.emit({
      state: "CHECKING_REGISTRY",
      completedDatasets: 0,
      totalParts: 0,
      downloadedParts: 0,
      restoredRecords: 0,
      errorMessage: undefined,
    });

    try {
      // 1. Fetch Authoritative Dataset Registry
      const regRes = await fetch("/api/sync/hydrate", {
        headers: { "Cache-Control": "no-cache" },
      });

      if (!regRes.ok) {
        throw new Error(`Failed to load remote registry (status ${regRes.status})`);
      }

      const regData = (await regRes.json()) as {
        ok: boolean;
        datasets?: RemoteDatasetRegistryItem[];
        error?: string;
      };

      if (!regData.ok || !Array.isArray(regData.datasets)) {
        throw new Error(regData.error || "Malformed registry response from server");
      }

      const remoteDatasets = regData.datasets;
      const totalPartsSum = remoteDatasets.reduce((sum, d) => sum + (d.parts?.length || 0), 0);

      this.emit({
        totalDatasets: remoteDatasets.length,
        totalParts: totalPartsSum,
      });

      let totalRestoredRecords = 0;
      let completedCount = 0;
      let hasPartialFailures = false;

      // 2. Hydrate each dataset
      for (const rDataset of remoteDatasets) {
        const { datasetType, currentRevision, generationId, parts } = rDataset;
        this.emit({ currentDataset: datasetType });

        try {
          // If remote has no committed generation, mark clean
          if (!generationId || !parts || parts.length === 0) {
            completedCount++;
            this.emit({ completedDatasets: completedCount });
            continue;
          }

          // Check local catalog revision
          const localCatalog = await getDatasetCatalogEntry(ownerId, datasetType).catch(() => null);
          const isUpToDate =
            !force &&
            localCatalog &&
            localCatalog.lastHydratedRevision >= currentRevision &&
            localCatalog.lastHydratedGenerationId === generationId;

          if (isUpToDate) {
            console.debug(`[hydration] Dataset ${datasetType} already up-to-date (rev ${currentRevision}). Skipping.`);
            completedCount++;
            this.emit({ completedDatasets: completedCount });
            continue;
          }

          // Fetch all parts for this generation
          this.emit({ state: "FETCHING_PARTS" });
          const datasetEntities: Record<string, unknown>[] = [];

          for (const part of parts) {
            const partUrl = `/api/sync/hydrate/part?path=${encodeURIComponent(part.storagePath)}`;
            const partRes = await fetch(partUrl, { cache: "no-store" });

            if (!partRes.ok) {
              throw new Error(`Failed to download part ${part.partNumber} for ${datasetType} (${partRes.status})`);
            }

            const expectedSha = String(part.sha256 || "").toLowerCase();
            if (!SHA256_HEX_PATTERN.test(expectedSha)) {
              // Historical generations may lack a checksum. Importing them
              // would create unverified local truth, so hydration fails closed
              // for that dataset instead of guessing.
              throw new Error(
                `Part ${part.partNumber} for ${datasetType} has no verifiable SHA-256 checksum.`
              );
            }

            const buffer = await partRes.arrayBuffer();
            const computedSha = await computeSha256Hex(buffer);
            const headerSha = partRes.headers.get("X-Payload-SHA256")?.toLowerCase() || null;

            if (computedSha !== expectedSha) {
              throw new Error(
                `Part ${part.partNumber} for ${datasetType} failed SHA-256 verification.`
              );
            }
            if (headerSha && headerSha !== computedSha) {
              throw new Error(
                `Part ${part.partNumber} for ${datasetType} disagrees with the server checksum header.`
              );
            }
            if (part.byteCount > 0 && buffer.byteLength !== part.byteCount) {
              throw new Error(
                `Part ${part.partNumber} for ${datasetType} byte count mismatch (${buffer.byteLength} !== ${part.byteCount}).`
              );
            }

            const rawJson = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
            let parsedPart: Record<string, unknown>;
            try {
              parsedPart = JSON.parse(rawJson) as Record<string, unknown>;
            } catch {
              throw new Error(`Part ${part.partNumber} is not valid JSON`);
            }

            // Envelope identity checks prevent mixing generations or datasets.
            if (
              typeof parsedPart.datasetType === "string" &&
              parsedPart.datasetType !== datasetType
            ) {
              throw new Error(
                `Part ${part.partNumber} declares datasetType '${parsedPart.datasetType}' but '${datasetType}' was expected.`
              );
            }
            if (
              typeof parsedPart.generationId === "string" &&
              parsedPart.generationId !== generationId
            ) {
              throw new Error(
                `Part ${part.partNumber} belongs to a different generation.`
              );
            }

            // Extract records from the v2 part envelope. Legacy parts used
            // `items` or even a bare record array.
            const records: Record<string, unknown>[] = Array.isArray(parsedPart.records)
              ? (parsedPart.records as Record<string, unknown>[])
              : Array.isArray(parsedPart.items)
              ? (parsedPart.items as Record<string, unknown>[])
              : Array.isArray(parsedPart)
              ? (parsedPart as unknown as Record<string, unknown>[])
              : [parsedPart];

            if (part.recordCount > 0 && records.length !== part.recordCount) {
              throw new Error(
                `Part ${part.partNumber} record count mismatch (${records.length} !== ${part.recordCount}).`
              );
            }

            datasetEntities.push(...records);
            this.emit({ downloadedParts: this.progress.downloadedParts + 1 });
          }

          if (rDataset.totalRecords > 0 && datasetEntities.length !== rDataset.totalRecords) {
            throw new Error(
              `Generation record count mismatch for ${datasetType} (${datasetEntities.length} !== ${rDataset.totalRecords}).`
            );
          }

          // 3. Atomically restore into IndexedDB projection. The snapshot
          //    replacement removes records that no longer exist remotely while
          //    preserving entities that still have pending outbox operations.
          this.emit({ state: "RESTORING_LOCAL_INDEX" });
          const hydrationResult = await bulkHydrateDatasetEntities(
            ownerId,
            datasetType,
            datasetEntities,
            generationId,
            currentRevision
          );

          totalRestoredRecords += hydrationResult.insertedCount;
          completedCount++;
          this.emit({
            completedDatasets: completedCount,
            restoredRecords: this.progress.restoredRecords + hydrationResult.insertedCount,
          });

          if (hydrationResult.removedCount > 0) {
            console.info(
              `[hydration] ${datasetType}: restored ${hydrationResult.insertedCount}, removed ${hydrationResult.removedCount} stale local records, preserved ${hydrationResult.preservedPendingCount} pending.`
            );
          }
        } catch (datasetErr) {
          console.error(`[hydration] Error hydrating dataset ${datasetType}:`, datasetErr);
          hasPartialFailures = true;
          // Continue to next dataset to preserve fault tolerance
        }
      }

      // 4. State transition to READY / PARTIAL_FAILURE
      this.emit({ state: "MERGING_PENDING_CHANGES" });

      const now = new Date().toISOString();
      if (typeof window !== "undefined") {
        localStorage.setItem("yt_discovery_last_hydrated_at", now);
      }

      const finalState: HydrationState = hasPartialFailures ? "PARTIAL_FAILURE" : "READY";
      this.emit({
        state: finalState,
        lastHydratedAt: now,
      });

      this.isRunning = false;
      return {
        success: !hasPartialFailures,
        restoredRecords: totalRestoredRecords,
        error: hasPartialFailures ? "Some datasets encountered errors during hydration." : undefined,
      };
    } catch (err) {
      console.error("[hydration] Fatal cloud hydration error:", err);
      const msg = err instanceof Error ? err.message : "Cloud hydration failed.";
      this.emit({
        state: "FAILED",
        errorMessage: msg,
      });
      this.isRunning = false;
      return { success: false, restoredRecords: 0, error: msg };
    }
  }
}

// Global Client Singleton
export const cloudHydrationService = new CloudHydrationService();
