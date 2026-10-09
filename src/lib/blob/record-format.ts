import { createHash } from "node:crypto";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * Record Format — deterministic serialization, chunk math, manifests.
 * ──────────────────────────────────────────────────────────────────────────
 * Pure module (no I/O, no SDK): safe to unit-test in plain Node.
 *
 * - Serialization is deterministic: object keys are sorted recursively so
 *   the same logical record always hashes identically (required for
 *   idempotent retries and integrity checks).
 * - Sizes are measured in UTF-8 BYTES, never JS string length (Arabic text,
 *   emoji, and all other multi-byte content is measured honestly).
 * - Records at or under SINGLE_OBJECT_LIMIT_BYTES are stored as one Blob
 *   object. Larger records are split into CHUNK_SIZE_BYTES pieces with a
 *   manifest carrying schema version, generation id, order, count, total
 *   bytes, and a SHA-256 checksum of the ORIGINAL byte stream.
 * ═══════════════════════════════════════════════════════════════════════════
 */

/** Single-object ceiling: 4 MiB (stays clear of the ~4.5 MB function limit). */
export const SINGLE_OBJECT_LIMIT_BYTES = 4 * 1024 * 1024;

/** Per-request/per-chunk target: 2 MiB (conservative 2–3 MiB guidance). */
export const CHUNK_SIZE_BYTES = 2 * 1024 * 1024;

/** Largest single request body the client may submit (base64 inflates ~33%). */
export const MAX_REQUEST_BYTES = 3 * 1024 * 1024;

export const CHUNK_MANIFEST_SCHEMA_VERSION = 1;

export interface ChunkManifest {
  schemaVersion: number;
  recordId: string;
  namespace: string;
  generationId: string;
  chunkCount: number;
  totalBytes: number;
  sha256: string;
  chunkOrder: number[];
  createdAt: string;
}

/** Deterministic JSON: object keys sorted recursively. */
export function stableStringify(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      out[key] = sortKeys((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}

export function utf8Bytes(text: string): Buffer {
  return Buffer.from(text, "utf8");
}

export function sha256Hex(data: Buffer | string): string {
  const hash = createHash("sha256");
  hash.update(typeof data === "string" ? Buffer.from(data, "utf8") : data);
  return hash.digest("hex");
}

export function needsChunking(byteLength: number): boolean {
  return byteLength > SINGLE_OBJECT_LIMIT_BYTES;
}

export function chunkCountFor(byteLength: number): number {
  return Math.max(1, Math.ceil(byteLength / CHUNK_SIZE_BYTES));
}

/** Split a byte buffer into ordered chunks (binary-safe, UTF-8 agnostic). */
export function splitBuffer(data: Buffer): Buffer[] {
  const parts: Buffer[] = [];
  for (let offset = 0; offset < data.length; offset += CHUNK_SIZE_BYTES) {
    parts.push(data.subarray(offset, Math.min(offset + CHUNK_SIZE_BYTES, data.length)));
  }
  return parts.length > 0 ? parts : [Buffer.alloc(0)];
}

/**
 * Reassemble ordered chunks and verify total length + SHA-256.
 * Throws on any mismatch — the caller must NEVER publish partial data.
 */
export function reassembleChunks(chunks: Buffer[], manifest: ChunkManifest): Buffer {
  if (chunks.length !== manifest.chunkCount) {
    throw new Error(
      `Incomplete record: expected ${manifest.chunkCount} chunks, received ${chunks.length}`,
    );
  }
  const combined = Buffer.concat(chunks);
  if (combined.length !== manifest.totalBytes) {
    throw new Error(
      `Byte-count mismatch: expected ${manifest.totalBytes}, received ${combined.length}`,
    );
  }
  const digest = sha256Hex(combined);
  if (digest !== manifest.sha256) {
    throw new Error("Integrity checksum mismatch: reconstructed bytes do not match manifest");
  }
  return combined;
}

export function buildChunkManifest(args: {
  recordId: string;
  namespace: string;
  generationId: string;
  totalBytes: number;
  sha256: string;
  chunkCount: number;
}): ChunkManifest {
  return {
    schemaVersion: CHUNK_MANIFEST_SCHEMA_VERSION,
    recordId: args.recordId,
    namespace: args.namespace,
    generationId: args.generationId,
    chunkCount: args.chunkCount,
    totalBytes: args.totalBytes,
    sha256: args.sha256,
    chunkOrder: Array.from({ length: args.chunkCount }, (_, i) => i),
    createdAt: new Date().toISOString(),
  };
}

export function validateChunkManifest(value: unknown): ChunkManifest {
  if (!value || typeof value !== "object") throw new Error("Invalid chunk manifest");
  const m = value as Record<string, unknown>;
  if (
    m.schemaVersion !== CHUNK_MANIFEST_SCHEMA_VERSION ||
    typeof m.recordId !== "string" ||
    typeof m.namespace !== "string" ||
    typeof m.generationId !== "string" ||
    typeof m.chunkCount !== "number" ||
    typeof m.totalBytes !== "number" ||
    typeof m.sha256 !== "string" ||
    !Array.isArray(m.chunkOrder)
  ) {
    throw new Error("Invalid chunk manifest shape");
  }
  return m as unknown as ChunkManifest;
}
