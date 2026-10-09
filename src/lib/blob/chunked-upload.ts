import type { BlobBackend } from "./blob-backend";
import { stagingChunkPathname, stagingSessionPathname } from "./blob-paths";
import { MAX_REQUEST_BYTES, sha256Hex } from "./record-format";
import { loadRecord, saveRecord } from "./record-store";
import type { BlobNamespace } from "./blob-paths";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * Staged Chunked Upload — large records without oversized requests.
 * ──────────────────────────────────────────────────────────────────────────
 * The browser NEVER submits an oversized record in one request:
 *   init   → server reserves {uploadId, namespace, recordId, chunkCount,
 *             totalBytes, sha256} in a staging session object.
 *   chunk* → each request carries ONE base64 chunk (≤ MAX_REQUEST_BYTES);
 *             the server stores it as an immutable staging blob and records
 *             its byte length + checksum in the session.
 *   commit → server verifies every chunk (presence, order, bytes, checksum),
 *             assembles the record through the standard saveRecord() path
 *             (which itself chunks in Blob when needed), verifies read-back,
 *             deletes staging artifacts, and only then reports success.
 *
 * Idempotency: init carries a client-generated uploadId; re-init with the
 * same uploadId resumes (already-stored chunks are skipped by checksum).
 * A missing chunk or checksum mismatch NEVER publishes a partial record.
 * ═══════════════════════════════════════════════════════════════════════════
 */

export const STAGING_SESSION_TTL_MS = 24 * 60 * 60 * 1000;

export interface UploadSession {
  uploadId: string;
  namespace: BlobNamespace;
  recordId: string;
  chunkCount: number;
  totalBytes: number;
  sha256: string;
  received: Array<{ index: number; bytes: number; sha256: string }>;
  createdAt: number;
  meta?: Record<string, unknown>;
}

export class UploadError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = "UploadError";
    this.status = status;
  }
}

function sessionPath(uploadId: string): string {
  return stagingSessionPathname(uploadId);
}

async function readSession(backend: BlobBackend, uploadId: string): Promise<UploadSession> {
  let raw: Buffer;
  try {
    raw = await backend.getBytes(sessionPath(uploadId));
  } catch {
    throw new UploadError("Upload session not found or expired", 404);
  }
  try {
    const parsed = JSON.parse(raw.toString("utf8")) as UploadSession;
    if (!parsed || parsed.uploadId !== uploadId || !Array.isArray(parsed.received)) {
      throw new Error("bad session");
    }
    if (Date.now() - parsed.createdAt > STAGING_SESSION_TTL_MS) {
      throw new UploadError("Upload session expired; please start a new upload", 410);
    }
    return parsed;
  } catch (err) {
    if (err instanceof UploadError) throw err;
    throw new UploadError("Upload session is corrupted", 422);
  }
}

async function writeSession(backend: BlobBackend, session: UploadSession): Promise<void> {
  await backend.putBytes(sessionPath(session.uploadId), Buffer.from(JSON.stringify(session), "utf8"), {
    contentType: "application/json",
    cacheSeconds: 0,
  });
}

const VALID_NAMESPACES: BlobNamespace[] = ["playlists", "savedHistory"];

export async function initUpload(
  backend: BlobBackend,
  input: {
    uploadId: string;
    namespace: BlobNamespace;
    recordId: string;
    chunkCount: number;
    totalBytes: number;
    sha256: string;
    meta?: Record<string, unknown>;
  },
): Promise<{ resumed: boolean; missing: number[] }> {
  if (!/^[A-Za-z0-9_-]{8,128}$/.test(input.uploadId)) throw new UploadError("Invalid upload id");
  if (!VALID_NAMESPACES.includes(input.namespace)) throw new UploadError("Invalid namespace");
  if (!input.recordId || input.recordId.length > 160) throw new UploadError("Invalid record id");
  if (!Number.isInteger(input.chunkCount) || input.chunkCount < 1 || input.chunkCount > 512) {
    throw new UploadError("Invalid chunk count");
  }
  if (!Number.isInteger(input.totalBytes) || input.totalBytes <= 0) {
    throw new UploadError("Invalid total byte size");
  }
  if (!/^[0-9a-f]{64}$/.test(input.sha256)) throw new UploadError("Invalid checksum");
  // Resume path: same uploadId re-inits; report which chunks are still missing.
  const existing = await backend.head(sessionPath(input.uploadId));
  if (existing) {
    const session = await readSession(backend, input.uploadId);
    if (
      session.namespace !== input.namespace ||
      session.recordId !== input.recordId ||
      session.chunkCount !== input.chunkCount ||
      session.totalBytes !== input.totalBytes ||
      session.sha256 !== input.sha256
    ) {
      throw new UploadError("Upload id already in use for a different record", 409);
    }
    const have = new Set(session.received.map((r) => r.index));
    const missing = Array.from({ length: session.chunkCount }, (_, i) => i).filter((i) => !have.has(i));
    return { resumed: true, missing };
  }
  const session: UploadSession = {
    uploadId: input.uploadId,
    namespace: input.namespace,
    recordId: input.recordId,
    chunkCount: input.chunkCount,
    totalBytes: input.totalBytes,
    sha256: input.sha256,
    received: [],
    createdAt: Date.now(),
    meta: input.meta,
  };
  await writeSession(backend, session);
  return { resumed: false, missing: Array.from({ length: input.chunkCount }, (_, i) => i) };
}

export async function putUploadChunk(
  backend: BlobBackend,
  uploadId: string,
  index: number,
  base64Data: string,
): Promise<{ received: number; of: number }> {
  const session = await readSession(backend, uploadId);
  if (!Number.isInteger(index) || index < 0 || index >= session.chunkCount) {
    throw new UploadError("Chunk index out of range");
  }
  if (typeof base64Data !== "string" || base64Data.length === 0) {
    throw new UploadError("Empty chunk payload");
  }
  // Bound each request: base64 inflates ~33%, so cap the encoded length.
  if (base64Data.length > Math.ceil(MAX_REQUEST_BYTES * 1.4)) {
    throw new UploadError("Chunk payload exceeds the per-request limit");
  }
  let bytes: Buffer;
  try {
    bytes = Buffer.from(base64Data, "base64");
  } catch {
    throw new UploadError("Chunk payload is not valid base64");
  }
  if (bytes.length === 0 || bytes.length > MAX_REQUEST_BYTES) {
    throw new UploadError("Chunk payload exceeds the per-request limit");
  }
  const digest = sha256Hex(bytes);
  const already = session.received.find((r) => r.index === index);
  if (already) {
    if (already.bytes === bytes.length && already.sha256 === digest) {
      return { received: session.received.length, of: session.chunkCount }; // idempotent retry
    }
    throw new UploadError(`Chunk ${index} conflicts with a previously stored chunk`, 409);
  }
  await backend.putBytes(stagingChunkPathname(uploadId, index), bytes, {
    contentType: "application/octet-stream",
    cacheSeconds: 0,
  });
  session.received.push({ index, bytes: bytes.length, sha256: digest });
  await writeSession(backend, session);
  return { received: session.received.length, of: session.chunkCount };
}

export async function commitUpload(
  backend: BlobBackend,
  uploadId: string,
): Promise<{ recordId: string; bytes: number; chunks: number }> {
  const session = await readSession(backend, uploadId);
  if (session.received.length !== session.chunkCount) {
    const have = new Set(session.received.map((r) => r.index));
    const missing = Array.from({ length: session.chunkCount }, (_, i) => i).filter((i) => !have.has(i));
    throw new UploadError(`Cannot commit: ${missing.length} chunk(s) missing (${missing.slice(0, 8).join(",")})`, 422);
  }
  // Retrieve in order; any missing blob fails the commit (no partial data).
  const ordered = [...session.received].sort((a, b) => a.index - b.index);
  const parts: Buffer[] = [];
  for (const r of ordered) {
    try {
      parts.push(await backend.getBytes(stagingChunkPathname(uploadId, r.index)));
    } catch {
      throw new UploadError(`Cannot commit: staged chunk ${r.index} is unavailable`, 422);
    }
  }
  const combined = Buffer.concat(parts);
  if (combined.length !== session.totalBytes) {
    throw new UploadError("Cannot commit: staged byte count does not match the declared size", 422);
  }
  if (sha256Hex(combined) !== session.sha256) {
    throw new UploadError("Cannot commit: staged checksum mismatch", 422);
  }
  let value: unknown;
  try {
    value = JSON.parse(combined.toString("utf8"));
  } catch {
    throw new UploadError("Cannot commit: staged payload is not valid JSON", 422);
  }
  // Standard durable path (auto-chunks in Blob when needed + verifies).
  const saved = await saveRecord(backend, session.namespace, session.recordId, value, session.meta);
  // Cleanup staging ONLY after the committed version verified.
  for (let i = 0; i < session.chunkCount; i += 1) {
    await backend.delete(stagingChunkPathname(uploadId, i)).catch(() => {});
  }
  await backend.delete(sessionPath(uploadId)).catch(() => {});
  // Final proof: the committed logical record reads back.
  await loadRecord(backend, session.namespace, session.recordId);
  return { recordId: session.recordId, bytes: saved.bytes, chunks: saved.chunks };
}

export async function abortUpload(backend: BlobBackend, uploadId: string): Promise<void> {
  let session: UploadSession | null = null;
  try {
    session = await readSession(backend, uploadId);
  } catch {
    return;
  }
  for (let i = 0; i < session.chunkCount; i += 1) {
    await backend.delete(stagingChunkPathname(uploadId, i)).catch(() => {});
  }
  await backend.delete(sessionPath(uploadId)).catch(() => {});
}
