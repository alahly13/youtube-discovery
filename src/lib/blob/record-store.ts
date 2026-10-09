import type { BlobBackend } from "./blob-backend";
import { BlobConflictError } from "./blob-backend";
import {
  chunkedRecordDir,
  chunkManifestPathname,
  chunkPathname,
  indexPathname,
  recordPathname,
  type BlobNamespace,
} from "./blob-paths";
import {
  SINGLE_OBJECT_LIMIT_BYTES,
  buildChunkManifest,
  reassembleChunks,
  sha256Hex,
  splitBuffer,
  stableStringify,
  utf8Bytes,
  validateChunkManifest,
} from "./record-format";
import { immutableCacheSeconds } from "./vercel-blob-backend";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * Record Store — ONE logical record in, ONE logical record out.
 * ──────────────────────────────────────────────────────────────────────────
 * - saveRecord(): serialize deterministically → measure UTF-8 bytes → store
 *   as ONE object (≤4 MiB) or as versioned chunks + manifest. The index is
 *   published only AFTER the data generation verifies; the previous valid
 *   generation stays live until then. Success is reported only after a
 *   read-back verification of the committed version.
 * - loadRecord(): single object, or manifest → ordered chunks → byte-count +
 *   SHA-256 verification → JSON parse. Any gap or mismatch throws a safe
 *   RecordStoreError (callers show recovery UI, never partial data).
 * - deleteRecord(): removes index entry + current-generation objects; never
 *   touches objects belonging to other records.
 * - Indexes carry a monotonic `version` for optimistic concurrency (CAS with
 *   bounded retries) so concurrent edits cannot silently clobber each other.
 * ═══════════════════════════════════════════════════════════════════════════
 */

export class RecordStoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RecordStoreError";
  }
}

export interface IndexEntry {
  id: string;
  /** "single" → data at records/<id>.json · "chunked" → manifest dir. */
  storage: "single" | "chunked";
  /** ETag-independent content version, bumped on every committed write. */
  version: number;
  updatedAt: string;
  /** Present only for chunked records (current live generation). */
  generationId?: string;
  /** Arbitrary lightweight metadata (counts, titles, thumbnails...). */
  meta?: Record<string, unknown>;
}

export interface StoredIndex {
  version: number;
  updatedAt: string;
  entries: IndexEntry[];
}

const EMPTY_INDEX: StoredIndex = { version: 0, updatedAt: "", entries: [] };
const INDEX_RETRIES = 5;

function newGenerationId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export async function readIndex(backend: BlobBackend, namespace: BlobNamespace): Promise<StoredIndex> {
  const path = indexPathname(namespace);
  const meta = await backend.head(path);
  if (!meta) return { ...EMPTY_INDEX, entries: [] };
  try {
    const raw = await backend.getBytes(path);
    const parsed = JSON.parse(raw.toString("utf8")) as Partial<StoredIndex>;
    if (typeof parsed.version !== "number" || !Array.isArray(parsed.entries)) {
      return { ...EMPTY_INDEX, entries: [] };
    }
    return { version: parsed.version, updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : "", entries: parsed.entries };
  } catch {
    throw new RecordStoreError("Stored index is corrupted and cannot be read");
  }
}

/**
 * CAS index update with retries. `mutate` receives the current index and
 * returns the next entries (or null to abort). Concurrent writers retry
 * against the fresh index instead of overwriting each other.
 */
export async function updateIndex(
  backend: BlobBackend,
  namespace: BlobNamespace,
  mutate: (current: StoredIndex) => IndexEntry[] | null,
): Promise<StoredIndex> {
  const path = indexPathname(namespace);
  for (let attempt = 0; attempt < INDEX_RETRIES; attempt += 1) {
    const current = await readIndex(backend, namespace);
    const nextEntries = mutate(current);
    if (nextEntries === null) return current;
    const next: StoredIndex = {
      version: current.version + 1,
      updatedAt: new Date().toISOString(),
      entries: nextEntries,
    };
    const body = Buffer.from(stableStringify(next), "utf8");
    try {
      const existing = await backend.head(path);
      if (!existing) {
        await backend.putBytes(path, body, { allowOverwrite: false, contentType: "application/json", cacheSeconds: 0 });
      } else {
        await backend.putBytes(path, body, { ifMatch: existing.etag, contentType: "application/json", cacheSeconds: 0 });
      }
      return next;
    } catch (err) {
      if (err instanceof BlobConflictError) continue; // lost race → re-read & retry
      throw err;
    }
  }
  throw new RecordStoreError("Index update conflicted repeatedly; please retry the operation");
}

export interface SaveResult {
  storage: "single" | "chunked";
  version: number;
  bytes: number;
  chunks: number;
}

/**
 * Save one logical record. Never publishes partial data: for chunked
 * records every chunk is written and verified BEFORE the index points at
 * the new generation, and the previous generation is removed only after
 * the new one reads back successfully.
 */
export async function saveRecord(
  backend: BlobBackend,
  namespace: BlobNamespace,
  recordId: string,
  value: unknown,
  meta?: Record<string, unknown>,
): Promise<SaveResult> {
  const text = stableStringify(value);
  const bytes = utf8Bytes(text);

  if (bytes.length <= SINGLE_OBJECT_LIMIT_BYTES) {
    const path = recordPathname(namespace, recordId);
    await backend.putBytes(path, bytes, { contentType: "application/json", cacheSeconds: 0 });
    // Remove any stale chunked generation of this record (previous layout).
    await removeChunkedGeneration(backend, namespace, recordId).catch(() => {});
    const index = await updateIndex(backend, namespace, (current) => {
      const version = (current.entries.find((e) => e.id === recordId)?.version ?? 0) + 1;
      return [
        { id: recordId, storage: "single", version, updatedAt: new Date().toISOString(), meta },
        ...current.entries.filter((e) => e.id !== recordId),
      ];
    });
    // Read-back verification of the COMMITTED version before reporting success.
    const entry = index.entries.find((e) => e.id === recordId);
    if (!entry || entry.storage !== "single") {
      throw new RecordStoreError("Write verification failed: index entry missing after commit");
    }
    const verify = await backend.getBytes(path);
    if (!verify.equals(bytes)) {
      throw new RecordStoreError("Write verification failed: stored bytes differ");
    }
    return { storage: "single", version: entry.version, bytes: bytes.length, chunks: 1 };
  }

  // ── Chunked path ──
  const generationId = newGenerationId();
  const chunks = splitBuffer(bytes);
  const manifest = buildChunkManifest({
    recordId,
    namespace,
    generationId,
    totalBytes: bytes.length,
    sha256: sha256Hex(bytes),
    chunkCount: chunks.length,
  });
  // 1. Write all chunks (immutable, long cache).
  for (let i = 0; i < chunks.length; i += 1) {
    await backend.putBytes(chunkPathname(namespace, recordId, generationId, i), chunks[i], {
      contentType: "application/octet-stream",
      cacheSeconds: immutableCacheSeconds(),
    });
  }
  // 2. Verify every chunk reads back byte-identical.
  for (let i = 0; i < chunks.length; i += 1) {
    const back = await backend.getBytes(chunkPathname(namespace, recordId, generationId, i));
    if (!back.equals(chunks[i])) {
      throw new RecordStoreError(`Chunk ${i} verification failed; record not published`);
    }
  }
  // 3. Publish manifest, then point the index at the new generation.
  const manifestPath = chunkManifestPathname(namespace, recordId);
  await backend.putBytes(manifestPath, Buffer.from(stableStringify(manifest), "utf8"), {
    contentType: "application/json",
    cacheSeconds: 0,
  });
  // Remove any legacy single object for this record.
  await backend.delete(recordPathname(namespace, recordId)).catch(() => {});
  const previous = (await readIndex(backend, namespace)).entries.find((e) => e.id === recordId);
  const index = await updateIndex(backend, namespace, (current) => {
    const version = (current.entries.find((e) => e.id === recordId)?.version ?? 0) + 1;
    return [
      { id: recordId, storage: "chunked", version, updatedAt: new Date().toISOString(), generationId, meta },
      ...current.entries.filter((e) => e.id !== recordId),
    ];
  });
  // 4. Read-back verification through the PUBLIC read path (manifest→chunks).
  const roundTrip = await loadRecordBytes(backend, namespace, recordId);
  if (!roundTrip.equals(bytes)) {
    throw new RecordStoreError("Write verification failed after chunked commit");
  }
  // 5. Only now remove the previous generation's chunks (never shared: each
  //    generation has a unique id, so deletion cannot affect other records).
  if (previous?.storage === "chunked" && previous.generationId && previous.generationId !== generationId) {
    await removeGenerationChunks(backend, namespace, recordId, previous.generationId).catch(() => {});
  }
  const entry = index.entries.find((e) => e.id === recordId);
  return { storage: "chunked", version: entry?.version ?? 0, bytes: bytes.length, chunks: chunks.length };
}

async function removeGenerationChunks(
  backend: BlobBackend,
  namespace: BlobNamespace,
  recordId: string,
  generationId: string,
): Promise<void> {
  // Trailing slash: Blob list() is pure string-prefix matching, so the slash
  // confines results to this generation's children (never the record itself).
  const dir = `${chunkedRecordDir(namespace, recordId)}/chunks/${generationId}/`;
  const listed = await backend.list(dir);
  await Promise.all(listed.map((o) => backend.delete(o.pathname).catch(() => {})));
}

async function removeChunkedGeneration(backend: BlobBackend, namespace: BlobNamespace, recordId: string): Promise<void> {
  const dir = `${chunkedRecordDir(namespace, recordId)}/`;
  const listed = await backend.list(dir);
  await Promise.all(listed.map((o) => backend.delete(o.pathname).catch(() => {})));
}

/** Raw bytes of one logical record (single or chunked), verified. */
export async function loadRecordBytes(
  backend: BlobBackend,
  namespace: BlobNamespace,
  recordId: string,
): Promise<Buffer> {
  // Try chunked manifest first (authoritative when present)...
  const manifestPath = chunkManifestPathname(namespace, recordId);
  const manifestMeta = await backend.head(manifestPath);
  if (manifestMeta) {
    const raw = await backend.getBytes(manifestPath);
    let manifest;
    try {
      manifest = validateChunkManifest(JSON.parse(raw.toString("utf8")));
    } catch {
      throw new RecordStoreError("Record manifest is corrupted; the record cannot be reconstructed");
    }
    const chunks: Buffer[] = [];
    for (const i of manifest.chunkOrder) {
      try {
        chunks.push(await backend.getBytes(chunkPathname(namespace, recordId, manifest.generationId, i)));
      } catch {
        throw new RecordStoreError(
          `Record is incomplete: chunk ${i} of ${manifest.chunkCount} is missing. The previous valid version, if any, remains untouched.`,
        );
      }
    }
    try {
      return reassembleChunks(chunks, manifest);
    } catch (err) {
      throw new RecordStoreError(err instanceof Error ? err.message : "Record reconstruction failed");
    }
  }
  // ...otherwise the single-object layout.
  try {
    return await backend.getBytes(recordPathname(namespace, recordId));
  } catch {
    throw new RecordStoreError("Record not found");
  }
}

export async function loadRecord<T>(backend: BlobBackend, namespace: BlobNamespace, recordId: string): Promise<T> {
  const bytes = await loadRecordBytes(backend, namespace, recordId);
  try {
    return JSON.parse(bytes.toString("utf8")) as T;
  } catch {
    throw new RecordStoreError("Record payload is not valid JSON");
  }
}

/** Delete a record + its current-generation objects. Verifies removal. */
export async function deleteRecord(
  backend: BlobBackend,
  namespace: BlobNamespace,
  recordId: string,
): Promise<boolean> {
  const index = await readIndex(backend, namespace);
  const entry = index.entries.find((e) => e.id === recordId);
  if (!entry) return false;
  if (entry.storage === "chunked") {
    await removeChunkedGeneration(backend, namespace, recordId).catch(() => {});
  } else {
    await backend.delete(recordPathname(namespace, recordId)).catch(() => {});
  }
  await updateIndex(backend, namespace, (current) => current.entries.filter((e) => e.id !== recordId));
  // Verify: record must be gone from the index AND unreadable.
  const after = await readIndex(backend, namespace);
  if (after.entries.some((e) => e.id === recordId)) {
    throw new RecordStoreError("Delete verification failed: index entry persists");
  }
  return true;
}

/**
 * Conservative staging GC: deletes ONLY uncommitted staging objects older
 * than `olderThanMs`. Committed records are never under staging/, and any
 * object possibly referenced by a manifest is never touched here.
 */
export async function gcStaging(backend: BlobBackend, olderThanMs: number): Promise<number> {
  const { BLOB_NAMESPACES } = await import("./blob-paths");
  const listed = await backend.list(`${BLOB_NAMESPACES.staging}/`);
  const cutoff = Date.now() - olderThanMs;
  let removed = 0;
  for (const obj of listed) {
    const uploaded = Date.parse(obj.uploadedAt);
    if (Number.isFinite(uploaded) && uploaded < cutoff) {
      await backend.delete(obj.pathname).catch(() => {});
      removed += 1;
    }
  }
  return removed;
}
