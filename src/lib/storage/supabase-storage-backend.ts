import "server-only";

import { createAdminClient } from "../supabase/admin";
import {
  ensurePrivateBucket,
  DEFAULT_SUPABASE_BUCKET,
  OLD_STORAGE_BUCKET,
  NEW_STORAGE_BUCKET,
} from "../supabase/storage";
import type { BlobBackend, BlobObjectMeta } from "../blob/blob-backend";
import { BlobConflictError, BlobNotFoundError, BlobUnavailableError } from "../blob/blob-backend";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * Supabase Storage Backend — Private Bucket Storage Adapter
 * ──────────────────────────────────────────────────────────────────────────
 * - Implements the BlobBackend interface using Supabase Storage.
 * - Stores files in a private bucket (`youtube-discovery`).
 * - Never exposes public URLs to client or browser; reads happen server-side.
 * - Safe error translations without exposing sensitive tokens.
 * ═══════════════════════════════════════════════════════════════════════════
 */
export class SupabaseStorageBackend implements BlobBackend {
  private bucket: string;
  private bucketInitialized = false;

  constructor(bucket = DEFAULT_SUPABASE_BUCKET) {
    this.bucket = bucket;
  }

  private async getClient() {
    const client = createAdminClient();
    if (!client) {
      throw new BlobUnavailableError(
        "Supabase Storage is not configured. Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY / SUPABASE_SERVICE_ROLE_KEY."
      );
    }
    if (!this.bucketInitialized) {
      await ensurePrivateBucket(this.bucket);
      this.bucketInitialized = true;
    }
    return client;
  }

  private cleanPath(pathname: string): string {
    return pathname.replace(/^\/+/, "");
  }

  async getBytes(pathname: string): Promise<Buffer> {
    const client = await this.getClient();
    const clean = this.cleanPath(pathname);

    const { data, error } = await client.storage.from(this.bucket).download(clean);

    if (error || !data) {
      throw new BlobNotFoundError(pathname);
    }

    const arrayBuffer = await data.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }

  async head(pathname: string): Promise<BlobObjectMeta | null> {
    try {
      const client = await this.getClient();
      const clean = this.cleanPath(pathname);
      const parts = clean.split("/");
      const fileName = parts.pop()!;
      const folder = parts.join("/");

      const { data, error } = await client.storage.from(this.bucket).list(folder, {
        search: fileName,
        limit: 10,
      });

      if (error || !data) return null;

      const file = data.find((item) => item.name === fileName);
      if (!file) return null;

      return {
        pathname,
        size: file.metadata?.size ?? 0,
        etag: file.metadata?.eTag ?? file.id ?? file.name,
        uploadedAt: file.created_at || new Date().toISOString(),
      };
    } catch {
      return null;
    }
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
    const client = await this.getClient();
    const clean = this.cleanPath(pathname);
    const allowOverwrite = options?.allowOverwrite ?? true;

    if (!allowOverwrite) {
      const existing = await this.head(pathname);
      if (existing) {
        throw new BlobConflictError(`Storage write conflict: object already exists at ${pathname}`);
      }
    }

    const { data: uploadResult, error } = await client.storage.from(this.bucket).upload(clean, data, {
      contentType: options?.contentType || "application/octet-stream",
      upsert: allowOverwrite,
      cacheControl: options?.cacheSeconds ? String(options.cacheSeconds) : "3600",
    });

    if (error) {
      throw new BlobUnavailableError(`Supabase Storage upload failed: ${error.message}`);
    }

    return {
      pathname,
      size: data.length,
      etag: uploadResult?.id || String(Date.now()),
      uploadedAt: new Date().toISOString(),
    };
  }

  async delete(pathname: string): Promise<void> {
    try {
      const client = await this.getClient();
      const clean = this.cleanPath(pathname);
      await client.storage.from(this.bucket).remove([clean]);
    } catch {
      // Deletes of missing objects are idempotent
    }
  }

  async list(prefix: string): Promise<BlobObjectMeta[]> {
    try {
      const client = await this.getClient();
      const cleanPrefix = this.cleanPath(prefix);
      const { data, error } = await client.storage.from(this.bucket).list(cleanPrefix, {
        limit: 500,
      });

      if (error || !data) return [];

      return data.map((item) => ({
        pathname: cleanPrefix ? `${cleanPrefix}/${item.name}` : item.name,
        size: item.metadata?.size ?? 0,
        etag: item.metadata?.eTag ?? item.id ?? item.name,
        uploadedAt: item.created_at || new Date().toISOString(),
      }));
    } catch {
      return [];
    }
  }
}

let oldBackendInstance: SupabaseStorageBackend | null = null;
let newBackendInstance: SupabaseStorageBackend | null = null;

export function getOldStorageBackend(): SupabaseStorageBackend {
  if (!oldBackendInstance) {
    oldBackendInstance = new SupabaseStorageBackend(OLD_STORAGE_BUCKET);
  }
  return oldBackendInstance;
}

export function getNewStorageBackend(): SupabaseStorageBackend {
  if (!newBackendInstance) {
    newBackendInstance = new SupabaseStorageBackend(NEW_STORAGE_BUCKET);
  }
  return newBackendInstance;
}

export function getStorageBackendForBucket(bucketId?: string): SupabaseStorageBackend {
  if (bucketId === OLD_STORAGE_BUCKET) return getOldStorageBackend();
  if (bucketId === NEW_STORAGE_BUCKET) return getNewStorageBackend();
  return new SupabaseStorageBackend(bucketId || DEFAULT_SUPABASE_BUCKET);
}
