import "server-only";

import type { BlobBackend, BlobObjectMeta } from "./blob-backend";
import { R2StorageBackend, NEW_R2_BUCKET } from "../storage/r2-blob-backend";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * Unified Storage Adapter (Cloudflare R2 via Workers + Local Disk Fallback)
 * ──────────────────────────────────────────────────────────────────────────
 * - Replaces @vercel/blob and Supabase Storage completely at runtime.
 * - Routes storage operations exclusively to Cloudflare R2 via dedicated
 *   Cloudflare Workers with short-lived capability tokens.
 * - Gracefully falls back to DiskStorageBackend (`data/storage/`) when running
 *   offline or in local dev without worker credentials.
 * - Preserves exact BlobBackend contract for all existing callers.
 * ═══════════════════════════════════════════════════════════════════════════
 */

export const immutableCacheSeconds = 60 * 60 * 24 * 365;

export class VercelBlobBackend implements BlobBackend {
  private delegate: BlobBackend;

  constructor() {
    this.delegate = new R2StorageBackend(NEW_R2_BUCKET);
  }

  async getBytes(pathname: string): Promise<Buffer> {
    return this.delegate.getBytes(pathname);
  }

  async head(pathname: string): Promise<BlobObjectMeta | null> {
    return this.delegate.head(pathname);
  }

  async putBytes(
    pathname: string,
    data: Buffer,
    options?: {
      allowOverwrite?: boolean;
      ifMatch?: string;
      contentType?: string;
      cacheSeconds?: number;
    }
  ): Promise<BlobObjectMeta> {
    return this.delegate.putBytes(pathname, data, options);
  }

  async delete(pathname: string): Promise<void> {
    return this.delegate.delete(pathname);
  }

  async list(prefix: string): Promise<BlobObjectMeta[]> {
    return this.delegate.list(prefix);
  }
}
