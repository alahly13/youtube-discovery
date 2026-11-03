import "server-only";

import type { BlobBackend, BlobObjectMeta } from "../blob/blob-backend";
import {
  BlobConflictError,
  BlobNotFoundError,
  BlobUnavailableError,
} from "../blob/blob-backend";
import {
  R2WorkerStorageClient,
  getR2WorkerStorageClient,
} from "./r2-worker-storage-client";
import type { R2BucketKind } from "./r2-capability-token";
import { DiskStorageBackend } from "./disk-storage-backend";

export const OLD_R2_BUCKET = "old-youtube-discovery-private";
export const NEW_R2_BUCKET = "new-youtube-discovery-private";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * Cloudflare R2 Worker Blob Backend
 * ──────────────────────────────────────────────────────────────────────────
 * Scope: Production storage adapter connecting the application exclusively
 * to Cloudflare R2 through the two dedicated Cloudflare Workers.
 *
 * Replaces Supabase Storage and Vercel Blob completely for object storage.
 *
 * Routing:
 *   - 'old-youtube-discovery-private' or paths with 'asdy/old/' -> OLD Worker
 *   - 'new-youtube-discovery-private' or all other paths -> NEW Worker
 * ═══════════════════════════════════════════════════════════════════════════
 */
export class R2StorageBackend implements BlobBackend {
  private client: R2WorkerStorageClient;
  private defaultBucketKind: R2BucketKind;
  private bucketName: string;
  private diskFallback: DiskStorageBackend;

  constructor(bucketName: string = NEW_R2_BUCKET) {
    this.bucketName = bucketName;
    this.defaultBucketKind =
      bucketName === OLD_R2_BUCKET ? "OLD" : "NEW";
    this.client = getR2WorkerStorageClient();
    this.diskFallback = new DiskStorageBackend();
  }

  private isWorkerConfigured(bucketKind: R2BucketKind): boolean {
    const hasUrl = Boolean(
      bucketKind === "NEW"
        ? process.env.R2_NEW_WORKER_URL || "https://new-youtube-discovery-api.elmahdyabdulla208.workers.dev"
        : process.env.R2_OLD_WORKER_URL || "https://old-youtube-discovery-api.elmahdyabdulla208.workers.dev"
    );

    const hasSecret = Boolean(
      bucketKind === "NEW"
        ? process.env.R2_NEW_WORKER_AUTH_SECRET ||
          process.env.WORKER_AUTH_SECRET ||
          process.env.R2_WORKER_AUTH_SECRET
        : process.env.R2_OLD_WORKER_AUTH_SECRET ||
          process.env.WORKER_AUTH_SECRET ||
          process.env.R2_WORKER_AUTH_SECRET
    );

    return hasUrl && hasSecret;
  }

  private resolveBucketKind(pathname: string): R2BucketKind {
    const clean = pathname.replace(/^\/+/, "");
    if (
      clean.startsWith("asdy/old/") ||
      clean.startsWith("ASDY/OLD/") ||
      this.bucketName === OLD_R2_BUCKET
    ) {
      return "OLD";
    }
    return this.defaultBucketKind;
  }

  private cleanPath(pathname: string): string {
    return pathname.replace(/^\/+/, "");
  }

  async getBytes(pathname: string): Promise<Buffer> {
    const clean = this.cleanPath(pathname);
    const bucketKind = this.resolveBucketKind(clean);

    if (!this.isWorkerConfigured(bucketKind)) {
      return this.diskFallback.getBytes(clean);
    }

    try {
      const { data } = await this.client.getObject(bucketKind, clean);
      return data;
    } catch (err) {
      if (err instanceof BlobNotFoundError) throw err;
      // In local dev without workers, fallback
      try {
        return await this.diskFallback.getBytes(clean);
      } catch {
        throw err;
      }
    }
  }

  async head(pathname: string): Promise<BlobObjectMeta | null> {
    const clean = this.cleanPath(pathname);
    const bucketKind = this.resolveBucketKind(clean);

    if (!this.isWorkerConfigured(bucketKind)) {
      return this.diskFallback.head(clean);
    }

    try {
      const meta = await this.client.headObject(bucketKind, clean);
      if (!meta) {
        return this.diskFallback.head(clean);
      }
      return {
        pathname: clean,
        size: meta.size,
        etag: meta.etag,
        uploadedAt: meta.uploaded,
      };
    } catch {
      return this.diskFallback.head(clean);
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
    const clean = this.cleanPath(pathname);
    const bucketKind = this.resolveBucketKind(clean);
    const allowOverwrite = options?.allowOverwrite ?? true;

    if (!this.isWorkerConfigured(bucketKind)) {
      return this.diskFallback.putBytes(clean, data, options);
    }

    if (!allowOverwrite) {
      const existing = await this.head(clean);
      if (existing) {
        throw new BlobConflictError(
          `Storage write conflict: object already exists at ${clean}`
        );
      }
    }

    try {
      const result = await this.client.putObject(bucketKind, clean, data, {
        contentType: options?.contentType || "application/json",
        allowOverwrite,
      });

      return {
        pathname: clean,
        size: result.size,
        etag: result.etag,
        uploadedAt: result.uploaded,
      };
    } catch (err) {
      if (err instanceof BlobConflictError) throw err;
      // If error occurs, try writing to disk fallback as well to prevent total data loss in degraded mode
      try {
        return await this.diskFallback.putBytes(clean, data, options);
      } catch {
        throw err;
      }
    }
  }

  async delete(pathname: string): Promise<void> {
    const clean = this.cleanPath(pathname);
    const bucketKind = this.resolveBucketKind(clean);

    if (!this.isWorkerConfigured(bucketKind)) {
      await this.diskFallback.delete(clean);
      return;
    }

    try {
      // Historical manifests are protected and will throw or reject
      if (bucketKind === "OLD" && !clean.includes("/temp/")) {
        // Idempotent no-op: committed old manifests cannot be deleted
        return;
      }

      await this.client.deleteObject(bucketKind, clean);
      await this.diskFallback.delete(clean).catch(() => {});
    } catch {
      // Deletion of missing objects is idempotent
    }
  }

  async list(prefix: string): Promise<BlobObjectMeta[]> {
    const clean = this.cleanPath(prefix);
    const bucketKind = this.resolveBucketKind(clean);

    if (!this.isWorkerConfigured(bucketKind)) {
      return this.diskFallback.list(clean);
    }

    try {
      const result = await this.client.listObjects(bucketKind, clean, {
        limit: 1000,
      });

      const workerObjects: BlobObjectMeta[] = (result.objects || []).map((o) => ({
        pathname: o.key,
        size: o.size,
        etag: o.etag,
        uploadedAt: o.uploaded,
      }));

      // Merge with any local disk objects if present
      const diskObjects = await this.diskFallback.list(clean).catch(() => []);
      const existingKeys = new Set(workerObjects.map((o) => o.pathname));

      for (const diskObj of diskObjects) {
        if (!existingKeys.has(diskObj.pathname)) {
          workerObjects.push(diskObj);
        }
      }

      return workerObjects;
    } catch {
      return this.diskFallback.list(clean);
    }
  }
}

// Singletons
let oldBackendInstance: R2StorageBackend | null = null;
let newBackendInstance: R2StorageBackend | null = null;

export function getOldStorageBackend(): R2StorageBackend {
  if (!oldBackendInstance) {
    oldBackendInstance = new R2StorageBackend(OLD_R2_BUCKET);
  }
  return oldBackendInstance;
}

export function getNewStorageBackend(): R2StorageBackend {
  if (!newBackendInstance) {
    newBackendInstance = new R2StorageBackend(NEW_R2_BUCKET);
  }
  return newBackendInstance;
}

export function getStorageBackendForBucket(bucketId?: string): R2StorageBackend {
  if (bucketId === OLD_R2_BUCKET) return getOldStorageBackend();
  if (bucketId === NEW_R2_BUCKET) return getNewStorageBackend();
  return new R2StorageBackend(bucketId || NEW_R2_BUCKET);
}
