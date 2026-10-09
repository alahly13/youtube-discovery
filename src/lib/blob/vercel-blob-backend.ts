import "server-only";

import { del, get, head, list, put } from "@vercel/blob";
import type { BlobBackend, BlobObjectMeta } from "./blob-backend";
import { BlobConflictError, BlobNotFoundError, BlobUnavailableError } from "./blob-backend";
import { getBlobRuntimeConfig } from "./blob-config";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * Vercel Blob Backend — production adapter (private objects only).
 * ──────────────────────────────────────────────────────────────────────────
 * - Writes: `access: "private"`, `allowOverwrite` semantics mapped 1:1,
 *   `ifMatch` ETag compare-and-swap, mutable pointers/indexes use
 *   `cacheControlMaxAge: 0`, immutable chunks use long cache.
 * - Reads: authenticated server-side `get(..., { access: "private",
 *   useCache: false })` so callers always see the latest committed bytes;
 *   private URLs are never handed to the browser.
 * - SDK errors are translated to backend errors WITHOUT secret values.
 * ═══════════════════════════════════════════════════════════════════════════
 */

const IMMUTABLE_CACHE_SECONDS = 60 * 60 * 24 * 365;

function sdkOptions(extra?: { cacheSeconds?: number; token?: string }) {
  const cfg = getBlobRuntimeConfig();
  return {
    ...(cfg.token ? { token: cfg.token } : {}),
    ...(extra?.token ? { token: extra.token } : {}),
    ...(cfg.storeId ? { storeId: cfg.storeId } : {}),
  };
}

function toMeta(pathname: string, size: number, etag: string, uploadedAt: Date): BlobObjectMeta {
  return { pathname, size, etag, uploadedAt: uploadedAt.toISOString() };
}

function isNotFound(err: unknown): boolean {
  // NOTE (verified against @vercel/blob 2.8.1): a missing object surfaces as
  // a plain Error with message "Vercel Blob: The requested blob does not
  // exist" — not always as BlobNotFoundError. Match that precise message.
  if (typeof err !== "object" || err === null) return false;
  const e = err as { name?: string; message?: string };
  if (e.name === "BlobNotFoundError") return true;
  return typeof e.message === "string" && /requested blob does not exist/i.test(e.message);
}

function isPrecondition(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    (err as { name?: string }).name === "BlobPreconditionFailedError"
  );
}

export class VercelBlobBackend implements BlobBackend {
  async getBytes(pathname: string): Promise<Buffer> {
    try {
      const result = await get(pathname, {
        access: "private",
        useCache: false,
        ...sdkOptions(),
      });
      if (!result || result.statusCode !== 200 || !result.stream) {
        throw new BlobNotFoundError(pathname);
      }
      const reader = result.stream.getReader();
      const parts: Uint8Array[] = [];
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) parts.push(value);
      }
      return Buffer.concat(parts.map((p) => Buffer.from(p)));
    } catch (err) {
      if (err instanceof BlobNotFoundError) throw err;
      if (isNotFound(err)) throw new BlobNotFoundError(pathname);
      throw new BlobUnavailableError("Blob read failed");
    }
  }

  async head(pathname: string): Promise<BlobObjectMeta | null> {
    try {
      const meta = await head(pathname, sdkOptions());
      return toMeta(meta.pathname, meta.size, meta.etag, meta.uploadedAt);
    } catch (err) {
      if (isNotFound(err)) return null;
      throw new BlobUnavailableError("Blob metadata read failed");
    }
  }

  async putBytes(
    pathname: string,
    data: Buffer,
    options?: { allowOverwrite?: boolean; ifMatch?: string; contentType?: string; cacheSeconds?: number },
  ): Promise<BlobObjectMeta> {
    const cacheSeconds = options?.cacheSeconds ?? 0;
    try {
      const result = await put(pathname, data, {
        access: "private",
        contentType: options?.contentType ?? "application/octet-stream",
        cacheControlMaxAge: cacheSeconds,
        addRandomSuffix: false,
        ...(options?.ifMatch !== undefined
          ? { ifMatch: options.ifMatch }
          : { allowOverwrite: options?.allowOverwrite ?? true }),
        ...sdkOptions(),
      });
      const meta = await head(result.pathname, sdkOptions());
      return toMeta(meta.pathname, meta.size, meta.etag, meta.uploadedAt);
    } catch (err) {
      if (isPrecondition(err)) throw new BlobConflictError();
      if (
        typeof err === "object" &&
        err !== null &&
        (err as { name?: string }).name === "BlobAccessError"
      ) {
        throw new BlobUnavailableError("Blob authentication failed");
      }
      throw new BlobUnavailableError("Blob write failed");
    }
  }

  async delete(pathname: string): Promise<void> {
    try {
      await del(pathname, sdkOptions());
    } catch (err) {
      if (isNotFound(err)) return;
      throw new BlobUnavailableError("Blob delete failed");
    }
  }

  async list(prefix: string): Promise<BlobObjectMeta[]> {
    try {
      const out: BlobObjectMeta[] = [];
      let cursor: string | undefined;
      for (;;) {
        const page = await list({ prefix, cursor, limit: 1000, ...sdkOptions() });
        for (const b of page.blobs) {
          out.push(toMeta(b.pathname, b.size, b.etag, b.uploadedAt));
        }
        if (!page.hasMore) break;
        cursor = page.cursor;
      }
      return out;
    } catch (err) {
      if (isNotFound(err)) return [];
      throw new BlobUnavailableError("Blob list failed");
    }
  }

  /**
   * Diagnostics capability: Blob URL hostname for store-identity checks.
   * Hostnames are identifiers, never secrets.
   */
  async probeUrlHost(pathname: string): Promise<string | null> {
    try {
      const meta = await head(pathname, sdkOptions());
      return new URL(meta.url).hostname;
    } catch {
      return null;
    }
  }
}

export function immutableCacheSeconds(): number {
  return IMMUTABLE_CACHE_SECONDS;
}
