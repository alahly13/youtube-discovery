import crypto from "node:crypto";
import {
  buildPartKey,
  buildManifestKey,
  buildVersionPointerKey,
  buildDatasetRootManifestKey,
  buildTempExportKey,
  type CanonicalDatasetType,
} from "./canonical-paths";
import {
  RESOURCE_SCHEMA_VERSION,
  normalizeResourceRecord,
  summarizeResourceTypes,
  type ResourceType,
} from "../resources/resource-taxonomy";

export * from "./canonical-paths";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * YouTube Discovery — Manifest Serializer & Storage Path Resolver (v1.4)
 * ──────────────────────────────────────────────────────────────────────────
 * Scope: Handles exact UTF-8 byte chunking, SHA-256 hashing, binary aggregate
 *        generation checksums, and storage path generation scoped by
 *        canonical asdy/persistence/<storageOwnerUuid>/ convention.
 * ═══════════════════════════════════════════════════════════════════════════
 */

export const STORAGE_LIMITS = {
  PART_TARGET_BYTES: 40 * 1024 * 1024,      // 40 MiB (41,943,040 bytes)
  PART_HARD_CEILING_BYTES: 45 * 1024 * 1024, // 45 MiB (47,185,920 bytes)
  GENERATION_BUDGET_BYTES: 500 * 1024 * 1024, // 500 MiB (524,288,000 bytes)
  MAX_SINGLE_RECORD_BYTES: 45 * 1024 * 1024,
} as const;

export interface ManifestPartDescriptor {
  partNumber: number;
  storagePath: string;
  byteCount: number;
  recordCount: number;
  sha256: string;
  rawJson: string;
}

export interface GenerationDescriptor {
  datasetId: string;
  datasetType: string;
  ownerId: string;
  storageOwnerUuid: string;
  generationId: string;
  totalRecords: number;
  totalBytes: number;
  aggregateSha256: string;
  resourceTypeCounts: Partial<Record<ResourceType, number>>;
  parts: ManifestPartDescriptor[];
}

/**
 * Builds the canonical physical object path for an immutable manifest part.
 * Formatted as: asdy/persistence/<storageOwnerUuid>/<datasetSlug>/generations/<generationId>/parts/part-<number>.json
 *
 * IMPORTANT: `datasetType` must be a canonical dataset type (SAVED_ITEMS,
 * PLAYLIST, ...). Passing a dataset ID here silently produced wrong paths in
 * the past; canonical-paths now throws on unknown values instead of guessing.
 */
export function buildManifestPartStoragePath(
  storageOwnerUuid: string,
  datasetType: string,
  generationId: string,
  partNumber: number
): string {
  return buildPartKey(
    storageOwnerUuid,
    datasetType as CanonicalDatasetType,
    generationId,
    partNumber
  );
}

/**
 * Builds the canonical storage path for the generation manifest.json.
 */
export function buildGenerationManifestPath(
  storageOwnerUuid: string,
  datasetType: string,
  generationId: string
): string {
  return buildManifestKey(
    storageOwnerUuid,
    datasetType as CanonicalDatasetType,
    generationId
  );
}

/**
 * Builds the canonical storage path for the dataset version.json pointer.
 */
export function buildDatasetVersionPointerPath(
  storageOwnerUuid: string,
  datasetType: string
): string {
  return buildVersionPointerKey(storageOwnerUuid, datasetType as CanonicalDatasetType);
}

/**
 * Builds the canonical storage path for the derived convenience root manifest.json.
 */
export function buildDerivedRootManifestPath(
  storageOwnerUuid: string,
  datasetType: string
): string {
  return buildDatasetRootManifestKey(storageOwnerUuid, datasetType as CanonicalDatasetType);
}

/**
 * Builds the temporary export path for user downloads (e.g. ZIP bundles).
 */
export function buildTemporaryExportPath(
  storageOwnerUuid: string,
  exportId: string,
  filename: string
): string {
  return buildTempExportKey(storageOwnerUuid, exportId, filename);
}

/**
 * Computes individual part SHA-256 digest over raw UTF-8 bytes.
 */
export function computePartSha256(content: string | Buffer): string {
  return crypto.createHash("sha256").update(content).digest("hex");
}

/**
 * Computes deterministic binary aggregate SHA-256 across all parts of a generation.
 * Specification:
 *   UTF8("YOUTUBE-DISCOVERY-GENERATION-V1\0")
 *   || for each part sorted by partNumber ASC:
 *      uint32_be(partNumber) || uint64_be(byteCount) || uint64_be(recordCount) || raw_32_byte_part_sha256
 */
export function computeAggregateGenerationSha256(
  parts: Array<{
    partNumber: number;
    byteCount: number | bigint;
    recordCount: number;
    sha256: string;
  }>
): string {
  const sorted = [...parts].sort((a, b) => a.partNumber - b.partNumber);
  const hash = crypto.createHash("sha256");

  // Domain separator
  hash.update(Buffer.from("YOUTUBE-DISCOVERY-GENERATION-V1\0", "utf8"));

  for (const p of sorted) {
    const partNumBuf = Buffer.alloc(4);
    partNumBuf.writeUInt32BE(p.partNumber, 0);

    const byteCountBuf = Buffer.alloc(8);
    byteCountBuf.writeBigUInt64BE(BigInt(p.byteCount), 0);

    const recordCountBuf = Buffer.alloc(8);
    recordCountBuf.writeBigUInt64BE(BigInt(p.recordCount), 0);

    const rawSha256Buf = Buffer.from(p.sha256, "hex");

    hash.update(partNumBuf);
    hash.update(byteCountBuf);
    hash.update(recordCountBuf);
    hash.update(rawSha256Buf);
  }

  return hash.digest("hex");
}

/**
 * Serializes an array of records into immutable manifest parts complying with
 * 40 MiB target and 45 MiB hard ceilings, measuring exact UTF-8 byte lengths.
 */
export function partitionRecordsIntoManifestParts<T extends Record<string, unknown>>(params: {
  datasetId: string;
  datasetType: string;
  ownerId: string;
  storageOwnerUuid: string;
  generationId: string;
  records: T[];
  targetBytes?: number;
  ceilingBytes?: number;
  createdAt?: string;
}): GenerationDescriptor {
  const targetBytes = params.targetBytes ?? STORAGE_LIMITS.PART_TARGET_BYTES;
  const createdAt = params.createdAt || new Date().toISOString();

  // Every serialized record carries the canonical discriminator and stable
  // identity fields. This is where the taxonomy becomes part of the immutable
  // storage contract, not just transient UI state.
  const normalizedRecords = params.records.map((record) =>
    normalizeResourceRecord(record, { datasetType: params.datasetType })
  );

  const parts: ManifestPartDescriptor[] = [];
  let currentPartNumber = 1;

  // Header template builder. `totalPartsInGeneration` is patched after all
  // parts are known so the envelope remains self-describing.
  function buildPartEnvelope(items: T[], partNum: number, totalPartsPlaceholder: number): string {
    const payload = {
      $schema: "https://youtube-discovery.app/schemas/manifest-part-v2.json",
      schemaVersion: RESOURCE_SCHEMA_VERSION,
      resourceSchemaVersion: RESOURCE_SCHEMA_VERSION,
      datasetType: params.datasetType,
      datasetId: params.datasetId,
      ownerId: params.ownerId,
      storageOwnerUuid: params.storageOwnerUuid,
      generationId: params.generationId,
      partNumber: partNum,
      totalPartsInGeneration: totalPartsPlaceholder,
      createdAt,
      recordCount: items.length,
      resourceTypeCounts: summarizeResourceTypes(items, { datasetType: params.datasetType }),
      items,
    };
    return JSON.stringify(payload);
  }

  // Group items into batches using exact UTF-8 byte lengths.
  let runningItems: T[] = [];
  for (const record of normalizedRecords) {
    const recordBytes = Buffer.byteLength(JSON.stringify(record), "utf8");
    if (recordBytes > STORAGE_LIMITS.MAX_SINGLE_RECORD_BYTES) {
      throw new Error(
        `Record exceeds 45 MiB limit (${recordBytes} bytes). Individual records cannot be partitioned.`
      );
    }

    // Speculatively test size with this record added
    const testItems = [...runningItems, record];
    const testJson = buildPartEnvelope(testItems, currentPartNumber, 1);
    const testBytes = Buffer.byteLength(testJson, "utf8");

    if (testBytes > targetBytes && runningItems.length > 0) {
      // Finalize current part
      const finalJson = buildPartEnvelope(runningItems, currentPartNumber, 0); // updated later
      const byteCount = Buffer.byteLength(finalJson, "utf8");
      const sha256 = computePartSha256(finalJson);
      const storagePath = buildManifestPartStoragePath(
        params.storageOwnerUuid,
        params.datasetType,
        params.generationId,
        currentPartNumber
      );

      parts.push({
        partNumber: currentPartNumber,
        storagePath,
        byteCount,
        recordCount: runningItems.length,
        sha256,
        rawJson: finalJson,
      });

      currentPartNumber++;
      runningItems = [record];
    } else {
      runningItems.push(record);
    }
  }

  // Final remaining items. An empty dataset still produces one empty part so
  // a delete-all generation is a real, hydratable snapshot.
  if (runningItems.length > 0 || parts.length === 0) {
    const finalJson = buildPartEnvelope(runningItems, currentPartNumber, 0);
    const byteCount = Buffer.byteLength(finalJson, "utf8");
    const sha256 = computePartSha256(finalJson);
    const storagePath = buildManifestPartStoragePath(
      params.storageOwnerUuid,
      params.datasetType,
      params.generationId,
      currentPartNumber
    );

    parts.push({
      partNumber: currentPartNumber,
      storagePath,
      byteCount,
      recordCount: runningItems.length,
      sha256,
      rawJson: finalJson,
    });
  }

  // Update totalPartsInGeneration in envelopes
  const totalParts = parts.length;
  for (let i = 0; i < parts.length; i++) {
    const parsed = JSON.parse(parts[i].rawJson);
    parsed.totalPartsInGeneration = totalParts;
    const recomputedJson = JSON.stringify(parsed);
    parts[i].rawJson = recomputedJson;
    parts[i].byteCount = Buffer.byteLength(recomputedJson, "utf8");
    parts[i].sha256 = computePartSha256(recomputedJson);
  }

  const totalRecords = parts.reduce((acc, p) => acc + p.recordCount, 0);
  const totalBytes = parts.reduce((acc, p) => acc + p.byteCount, 0);
  const aggregateSha256 = computeAggregateGenerationSha256(parts);

  return {
    datasetId: params.datasetId,
    datasetType: params.datasetType,
    ownerId: params.ownerId,
    storageOwnerUuid: params.storageOwnerUuid,
    generationId: params.generationId,
    totalRecords,
    totalBytes,
    aggregateSha256,
    resourceTypeCounts: summarizeResourceTypes(normalizedRecords, {
      datasetType: params.datasetType,
    }),
    parts,
  };
}
