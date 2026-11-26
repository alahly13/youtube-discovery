import "server-only";

import type { StorageBackend, StorageObjectMeta, BlobBackend, BlobObjectMeta } from "./storage-backend";
import {
  StorageConflictError,
  StorageNotFoundError,
  StorageUnavailableError,
  BlobConflictError,
  BlobForbiddenError,
  BlobNotFoundError,
  BlobUnavailableError,
} from "./storage-backend";
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

  /**
   * Derives the canonical storage owner from a NEW-bucket path.
   *
   * NEW Worker capability tokens must carry an owner scope. Deriving it from
   * the path (instead of a shared default) keeps every backend call inside the
   * same namespace the Worker will independently enforce. Routes that accept
   * user-supplied paths still perform their own owner check first.
   */
  private resolveOwnerFromPath(pathname: string): string | undefined {
    const canonical = pathname.match(/^asdy\/(?:persistence|temp)\/([^/]+)/);
    if (canonical) return canonical[1];

    const legacy = pathname.match(/^([^/]+)\/(?:persistence|temp)\//);
    if (legacy) return legacy[1];

    return undefined;
  }

  private requiresRemoteWorkerAuthority(bucketKind: "OLD" | "NEW", storageOwnerUuid?: string): boolean {
    return bucketKind === "OLD" || Boolean(storageOwnerUuid);
  }

  async getBytes(pathname: string): Promise<Buffer> {
    const clean = this.cleanPath(pathname);
    const bucketKind = this.resolveBucketKind(clean);
    const storageOwnerUuid = this.resolveOwnerFromPath(clean);

    if (!this.isWorkerConfigured(bucketKind)) {
      return this.diskFallback.getBytes(clean);
    }

    try {
      const { data } = await this.client.getObject(bucketKind, clean, {
        storageOwnerUuid,
      });
      return data;
    } catch (err) {
      if (err instanceof BlobNotFoundError) throw err;
      // Canonical owner-scoped and OLD-archive paths MUST fail closed when Workers are
      // configured so R2 outages never silently fall back to ephemeral container disk.
      if (this.requiresRemoteWorkerAuthority(bucketKind, storageOwnerUuid)) {
        throw err;
      }
      // Legacy non-owner system/v1 paths (`youtube-discovery/v1/...`, `asdy/admin/...`)
      // do not carry an owner claim accepted by the NEW Worker and retain disk fallback.
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
    const storageOwnerUuid = this.resolveOwnerFromPath(clean);

    if (!this.isWorkerConfigured(bucketKind)) {
      return this.diskFallback.head(clean);
    }

    try {
      const meta = await this.client.headObject(bucketKind, clean, {
        storageOwnerUuid,
      });
      if (!meta) {
        if (this.requiresRemoteWorkerAuthority(bucketKind, storageOwnerUuid)) {
          return null;
        }
        return this.diskFallback.head(clean);
      }
      return {
        pathname: clean,
        size: meta.size,
        etag: meta.etag,
        uploadedAt: meta.uploaded,
      };
    } catch (err) {
      if (this.requiresRemoteWorkerAuthority(bucketKind, storageOwnerUuid)) {
        throw err;
      }
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
    const storageOwnerUuid = this.resolveOwnerFromPath(clean);
    // Rule Zero defense-in-depth: immutable generation, part, pre-upgrade archive,
    // and OLD bucket historical keys can NEVER be overwritten silently.
    // Exception: `before-app-updating/` root version pointers are mutable read
    // indexes rewritten by every legacy-migration run (both canonical
    // `<dataset>/before-app-updating/version.json` and legacy
    // `before-app-updating/<dataset>/version.json` layouts). Generation/manifest
    // objects inside that branch stay immutable via the guards below.
    const isHistoricalRootPointer =
      /\/before-app-updating\/version\.json$/.test(clean) ||
      /\/before-app-updating\/[^/]+\/version\.json$/.test(clean);
    const isImmutableTarget =
      !isHistoricalRootPointer &&
      !clean.includes("/temp/") &&
      (bucketKind === "OLD" ||
        clean.includes("/generations/") ||
        clean.includes("/parts/") ||
        clean.includes("/before-app-updating/") ||
        clean.includes("/legacy/"));
    const allowOverwrite = isImmutableTarget ? false : (options?.allowOverwrite ?? true);

    if (!this.isWorkerConfigured(bucketKind)) {
      return this.diskFallback.putBytes(clean, data, {
        ...options,
        allowOverwrite,
      });
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
        storageOwnerUuid,
      });

      return {
        pathname: clean,
        size: result.size,
        etag: result.etag,
        uploadedAt: result.uploaded,
      };
    } catch (err) {
      if (err instanceof BlobConflictError) throw err;
      // Canonical owner-scoped and OLD-archive writes must never silently report success
      // by falling back to ephemeral disk storage when the R2 Worker is configured.
      if (this.requiresRemoteWorkerAuthority(bucketKind, storageOwnerUuid)) {
        throw err;
      }
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
    const storageOwnerUuid = this.resolveOwnerFromPath(clean);

    if (!this.isWorkerConfigured(bucketKind)) {
      const isImmutableTarget =
        !clean.includes("/temp/") &&
        (bucketKind === "OLD" ||
          clean.startsWith("asdy/persistence/") ||
          clean.includes("/generations/") ||
          clean.includes("/parts/") ||
          clean.includes("/before-app-updating/") ||
          /^[^/]+\/persistence\//.test(clean));
      if (isImmutableTarget) {
        throw new BlobForbiddenError(
          `Rule Zero Violation: Refusing to delete immutable object at ${clean}`
        );
      }
      await this.diskFallback.delete(clean);
      return;
    }

    try {
      // Historical manifests and committed generation/archive objects are immutable
      if (bucketKind === "OLD" && !clean.includes("/temp/")) {
        throw new BlobForbiddenError(
          `Rule Zero Violation: Historical archive object at ${clean} cannot be deleted.`
        );
      }
      if (
        !clean.includes("/temp/") &&
        (clean.startsWith("asdy/persistence/") ||
          clean.includes("/generations/") ||
          clean.includes("/parts/") ||
          clean.includes("/before-app-updating/") ||
          clean.includes("/legacy/") ||
          /^[^/]+\/persistence\//.test(clean))
      ) {
        throw new BlobForbiddenError(
          `Rule Zero Violation: Canonical persistence object at ${clean} cannot be deleted.`
        );
      }

      await this.client.deleteObject(bucketKind, clean, { storageOwnerUuid });
      await this.diskFallback.delete(clean).catch(() => {});
    } catch (err) {
      if (err instanceof BlobForbiddenError) {
        throw err;
      }
      // Deletion of missing disposable temp objects is idempotent
    }
  }

  async list(prefix: string): Promise<BlobObjectMeta[]> {
    const clean = this.cleanPath(prefix);
    const bucketKind = this.resolveBucketKind(clean);
    const storageOwnerUuid = this.resolveOwnerFromPath(clean);

    if (!this.isWorkerConfigured(bucketKind)) {
      return this.diskFallback.list(clean);
    }

    try {
      const result = await this.client.listObjects(bucketKind, clean, {
        limit: 1000,
        storageOwnerUuid,
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

// Backward compatibility alias
export const getBlobBackend = getNewStorageBackend;
