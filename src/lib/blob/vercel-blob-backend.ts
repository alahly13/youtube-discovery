import "server-only";

import type { BlobBackend, BlobObjectMeta } from "./blob-backend";
import { SupabaseStorageBackend } from "../storage/supabase-storage-backend";
import { DiskStorageBackend } from "../storage/disk-storage-backend";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * Unified Storage Adapter (Supabase Storage + Local Disk Fallback)
 * ──────────────────────────────────────────────────────────────────────────
 * - Replaces @vercel/blob completely at runtime.
 * - Routes storage operations to private Supabase Storage buckets when
 *   NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY are set.
 * - Gracefully falls back to DiskStorageBackend (`data/storage/`) when running
 *   offline or in local dev without cloud storage credentials.
 * - Preserves exact BlobBackend contract for all existing callers.
 * ═══════════════════════════════════════════════════════════════════════════
 */

export const immutableCacheSeconds = 60 * 60 * 24 * 365;

export class VercelBlobBackend implements BlobBackend {
  private delegate: BlobBackend;

  constructor() {
    const hasSupabase =
      Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL) &&
      Boolean(process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY);

    if (hasSupabase) {
      this.delegate = new SupabaseStorageBackend();
    } else {
      this.delegate = new DiskStorageBackend();
    }
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
