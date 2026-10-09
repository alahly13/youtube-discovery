/**
 * ═══════════════════════════════════════════════════════════════════════════
 * Blob Backend — swappable byte-level adapter (Vercel SDK ↔ in-memory mock).
 * ──────────────────────────────────────────────────────────────────────────
 * `record-store.ts` and all persistence code depend ONLY on this interface,
 * so unit tests inject MemoryBlobBackend while production uses
 * VercelBlobBackend. No Blob URLs ever leave the server: callers address
 * stable pathnames; downloads happen server-side via authenticated `get`.
 * ═══════════════════════════════════════════════════════════════════════════
 */

export class BlobNotFoundError extends Error {
  constructor(pathname: string) {
    super(`Blob not found: ${pathname}`);
    this.name = "BlobNotFoundError";
  }
}

export class BlobConflictError extends Error {
  constructor(message = "Blob write conflict: record changed since it was read") {
    super(message);
    this.name = "BlobConflictError";
  }
}

export class BlobUnavailableError extends Error {
  constructor(message = "Blob storage is unavailable") {
    super(message);
    this.name = "BlobUnavailableError";
  }
}

export interface BlobObjectMeta {
  pathname: string;
  size: number;
  etag: string;
  uploadedAt: string;
}

export interface BlobBackend {
  /** Read full bytes of a private object. Throws BlobNotFoundError. */
  getBytes(pathname: string): Promise<Buffer>;
  /** Metadata probe. Returns null when absent (no throw). */
  head(pathname: string): Promise<BlobObjectMeta | null>;
  /**
   * Write bytes (private object).
   * - allowOverwrite=false → throws BlobConflictError when the object exists
   *   (atomic create-if-absent).
   * - ifMatch=etag → throws BlobConflictError when the current ETag differs
   *   (compare-and-swap update).
   */
  putBytes(
    pathname: string,
    data: Buffer,
    options?: { allowOverwrite?: boolean; ifMatch?: string; contentType?: string; cacheSeconds?: number },
  ): Promise<BlobObjectMeta>;
  /** Delete one object. Missing objects are NOT an error. */
  delete(pathname: string): Promise<void>;
  /** List pathnames under a prefix (paginated internally, returns all). */
  list(prefix: string): Promise<BlobObjectMeta[]>;
}

/** In-memory backend for unit tests (and ONLY for tests). */
export class MemoryBlobBackend implements BlobBackend {
  private objects = new Map<string, { data: Buffer; etag: string; uploadedAt: string; contentType: string }>();
  private etagCounter = 0;

  async getBytes(pathname: string): Promise<Buffer> {
    const obj = this.objects.get(pathname);
    if (!obj) throw new BlobNotFoundError(pathname);
    return Buffer.from(obj.data);
  }

  async head(pathname: string): Promise<BlobObjectMeta | null> {
    const obj = this.objects.get(pathname);
    if (!obj) return null;
    return { pathname, size: obj.data.length, etag: obj.etag, uploadedAt: obj.uploadedAt };
  }

  async putBytes(
    pathname: string,
    data: Buffer,
    options?: { allowOverwrite?: boolean; ifMatch?: string; contentType?: string; cacheSeconds?: number },
  ): Promise<BlobObjectMeta> {
    const existing = this.objects.get(pathname);
    if (options?.ifMatch !== undefined) {
      if (!existing || existing.etag !== options.ifMatch) {
        throw new BlobConflictError();
      }
    } else if (options?.allowOverwrite === false && existing) {
      throw new BlobConflictError("Blob already exists");
    }
    this.etagCounter += 1;
    const meta = {
      data: Buffer.from(data),
      etag: `mock-etag-${this.etagCounter}`,
      uploadedAt: new Date().toISOString(),
      contentType: options?.contentType ?? "application/octet-stream",
    };
    this.objects.set(pathname, meta);
    return { pathname, size: data.length, etag: meta.etag, uploadedAt: meta.uploadedAt };
  }

  async delete(pathname: string): Promise<void> {
    this.objects.delete(pathname);
  }

  async list(prefix: string): Promise<BlobObjectMeta[]> {
    // Mirrors Vercel list(): PURE STRING-prefix matching (no directory
    // awareness). Callers MUST pass a trailing "/" when they mean "children
    // of this directory", otherwise sibling objects match too.
    const out: BlobObjectMeta[] = [];
    for (const [pathname, obj] of this.objects) {
      if (pathname.startsWith(prefix)) {
        out.push({ pathname, size: obj.data.length, etag: obj.etag, uploadedAt: obj.uploadedAt });
      }
    }
    return out.sort((a, b) => a.pathname.localeCompare(b.pathname));
  }

  /** Test introspection only. */
  count(): number {
    return this.objects.size;
  }
}
