import "server-only";

import crypto from "node:crypto";
import {
  signCapabilityToken,
  type R2BucketKind,
  type R2Operation,
} from "./r2-capability-token";
import {
  BlobConflictError,
  BlobNotFoundError,
  BlobUnavailableError,
} from "../blob/blob-backend";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * YouTube Discovery — Cloudflare R2 Worker Storage Client
 * ──────────────────────────────────────────────────────────────────────────
 * Scope: Direct HTTP client communicating exclusively with the two dedicated
 * Cloudflare Workers over HTTPS using cryptographic capability tokens.
 *
 * Workers:
 *   1. NEW: env.R2_NEW_WORKER_URL -> new-youtube-discovery-api -> new-youtube-discovery-private
 *   2. OLD: env.R2_OLD_WORKER_URL -> old-youtube-discovery-api -> old-youtube-discovery-private
 *
 * Rules:
 *   - Zero S3 SDKs, Zero AWS dependencies, Zero public buckets.
 *   - Strict capability tokens for every operation.
 *   - Automatic SHA-256 integrity computation and verification.
 * ═══════════════════════════════════════════════════════════════════════════
 */

export const DEFAULT_NEW_WORKER_URL =
  "https://new-youtube-discovery-api.elmahdyabdulla208.workers.dev";
export const DEFAULT_OLD_WORKER_URL =
  "https://old-youtube-discovery-api.elmahdyabdulla208.workers.dev";

export interface R2WorkerObjectMeta {
  key: string;
  size: number;
  etag: string;
  version?: string;
  uploaded: string;
  contentType?: string;
  customMetadata?: Record<string, string>;
}

export interface R2WorkerListResult {
  ok: boolean;
  objects: R2WorkerObjectMeta[];
  truncated: boolean;
  cursor?: string;
  delimitedPrefixes?: string[];
}

export interface WorkerHealthStatus {
  ok: boolean;
  worker: string;
  bucket_kind: "NEW" | "OLD";
  backend: string;
  binding_configured: boolean;
  timestamp: string;
}

export interface BatchUploadItemInput {
  key: string;
  data: Buffer | string;
  contentType?: string;
  sha256?: string;
}

export interface BatchUploadReceipt {
  key: string;
  size: number;
  etag: string;
  sha256: string;
  uploaded: string;
}

export interface BatchUploadResult {
  ok: boolean;
  batchId: string;
  uploadedCount: number;
  receipts: BatchUploadReceipt[];
}

export class R2WorkerStorageClient {
  private newWorkerUrl: string;
  private oldWorkerUrl: string;

  constructor(newWorkerUrl?: string, oldWorkerUrl?: string) {
    this.newWorkerUrl = (
      newWorkerUrl ||
      process.env.R2_NEW_WORKER_URL ||
      DEFAULT_NEW_WORKER_URL
    ).replace(/\/+$/, "");

    this.oldWorkerUrl = (
      oldWorkerUrl ||
      process.env.R2_OLD_WORKER_URL ||
      DEFAULT_OLD_WORKER_URL
    ).replace(/\/+$/, "");
  }

  public getWorkerUrl(bucketKind: R2BucketKind): string {
    return bucketKind === "NEW" ? this.newWorkerUrl : this.oldWorkerUrl;
  }

  public computeSha256(data: Buffer): string {
    return crypto.createHash("sha256").update(data).digest("hex").toLowerCase();
  }

  /**
   * Health check on the target worker.
   */
  async checkHealth(bucketKind: R2BucketKind): Promise<WorkerHealthStatus> {
    const url = `${this.getWorkerUrl(bucketKind)}/health`;
    try {
      const res = await fetch(url, {
        method: "GET",
        signal: AbortSignal.timeout(10000),
      });

      if (!res.ok) {
        throw new Error(`Worker health check responded with status ${res.status}`);
      }

      return (await res.json()) as WorkerHealthStatus;
    } catch (err) {
      throw new BlobUnavailableError(
        `Failed to reach Cloudflare R2 Worker (${bucketKind}): ${
          err instanceof Error ? err.message : String(err)
        }`
      );
    }
  }

  /**
   * Upload an object to Cloudflare R2 via the designated Worker.
   */
  async putObject(
    bucketKind: R2BucketKind,
    key: string,
    data: Buffer,
    options?: {
      contentType?: string;
      storageOwnerUuid?: string;
      maxBytes?: number;
      allowOverwrite?: boolean;
    }
  ): Promise<R2WorkerObjectMeta & { sha256: string }> {
    const cleanKey = key.replace(/^\/+/, "");
    const token = signCapabilityToken({
      bucketKind,
      operation: "upload",
      key: cleanKey,
      storageOwnerUuid: options?.storageOwnerUuid,
      maxBytes: options?.maxBytes || data.length + 1024,
      contentType: options?.contentType || "application/octet-stream",
    });

    const url = `${this.getWorkerUrl(bucketKind)}/v1/objects/${encodeURI(cleanKey)}`;

    try {
      const res = await fetch(url, {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": options?.contentType || "application/octet-stream",
          "Content-Length": String(data.length),
        },
        body: new Uint8Array(data),
        signal: AbortSignal.timeout(30000),
      });

      if (!res.ok) {
        const errorText = await res.text();
        if (res.status === 409) {
          throw new BlobConflictError(
            `R2 write conflict on ${cleanKey}: ${errorText}`
          );
        }
        if (res.status === 401 || res.status === 403) {
          throw new BlobUnavailableError(
            `Worker authorization rejected (${res.status}): ${errorText}`
          );
        }
        throw new BlobUnavailableError(
          `Worker PUT failed (${res.status}): ${errorText}`
        );
      }

      const result = (await res.json()) as {
        ok: boolean;
        key: string;
        size: number;
        etag: string;
        version?: string;
        uploaded: string;
      };

      const sha256 = this.computeSha256(data);

      return {
        key: result.key,
        size: result.size,
        etag: result.etag,
        version: result.version,
        uploaded: result.uploaded,
        contentType: options?.contentType,
        sha256,
      };
    } catch (err) {
      if (
        err instanceof BlobConflictError ||
        err instanceof BlobUnavailableError
      ) {
        throw err;
      }
      throw new BlobUnavailableError(
        `Failed to upload object to Cloudflare R2 Worker (${bucketKind}/${cleanKey}): ${
          err instanceof Error ? err.message : String(err)
        }`
      );
    }
  }

  /**
   * Download full bytes of an object from Cloudflare R2 via Worker.
   */
  async getObject(
    bucketKind: R2BucketKind,
    key: string,
    options?: { storageOwnerUuid?: string }
  ): Promise<{ data: Buffer; meta: R2WorkerObjectMeta; sha256: string }> {
    const cleanKey = key.replace(/^\/+/, "");
    const token = signCapabilityToken({
      bucketKind,
      operation: "download",
      key: cleanKey,
      storageOwnerUuid: options?.storageOwnerUuid,
    });

    const url = `${this.getWorkerUrl(bucketKind)}/v1/objects/${encodeURI(cleanKey)}`;

    try {
      const res = await fetch(url, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
        },
        signal: AbortSignal.timeout(30000),
      });

      if (res.status === 404) {
        throw new BlobNotFoundError(cleanKey);
      }

      if (!res.ok) {
        const errorText = await res.text();
        if (res.status === 401 || res.status === 403) {
          throw new BlobUnavailableError(
            `Worker authorization rejected (${res.status}): ${errorText}`
          );
        }
        throw new BlobUnavailableError(
          `Worker GET failed (${res.status}): ${errorText}`
        );
      }

      const arrayBuffer = await res.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      const sha256 = this.computeSha256(buffer);

      const etag = res.headers.get("ETag") || `etag-${Date.now()}`;
      const contentType =
        res.headers.get("Content-Type") || "application/octet-stream";

      return {
        data: buffer,
        meta: {
          key: cleanKey,
          size: buffer.length,
          etag,
          uploaded: res.headers.get("Last-Modified") || new Date().toISOString(),
          contentType,
        },
        sha256,
      };
    } catch (err) {
      if (
        err instanceof BlobNotFoundError ||
        err instanceof BlobUnavailableError
      ) {
        throw err;
      }
      throw new BlobUnavailableError(
        `Failed to download object from Cloudflare R2 Worker (${bucketKind}/${cleanKey}): ${
          err instanceof Error ? err.message : String(err)
        }`
      );
    }
  }

  /**
   * Probe metadata for an object without downloading bytes.
   */
  async headObject(
    bucketKind: R2BucketKind,
    key: string,
    options?: { storageOwnerUuid?: string }
  ): Promise<R2WorkerObjectMeta | null> {
    const cleanKey = key.replace(/^\/+/, "");
    const token = signCapabilityToken({
      bucketKind,
      operation: "head",
      key: cleanKey,
      storageOwnerUuid: options?.storageOwnerUuid,
    });

    const url = `${this.getWorkerUrl(bucketKind)}/v1/objects/${encodeURI(cleanKey)}`;

    try {
      const res = await fetch(url, {
        method: "HEAD",
        headers: {
          Authorization: `Bearer ${token}`,
        },
        signal: AbortSignal.timeout(10000),
      });

      if (res.status === 404) {
        return null;
      }

      if (!res.ok) {
        return null;
      }

      const size = Number(res.headers.get("Content-Length") || 0);
      const etag = res.headers.get("ETag") || `etag-${Date.now()}`;
      const contentType = res.headers.get("Content-Type") || undefined;
      const uploaded =
        res.headers.get("Last-Modified") || new Date().toISOString();

      return {
        key: cleanKey,
        size,
        etag,
        uploaded,
        contentType,
      };
    } catch {
      return null;
    }
  }

  /**
   * List objects under a prefix with cursor pagination.
   */
  async listObjects(
    bucketKind: R2BucketKind,
    prefix = "",
    options?: {
      cursor?: string;
      limit?: number;
      delimiter?: string;
      storageOwnerUuid?: string;
    }
  ): Promise<R2WorkerListResult> {
    const cleanPrefix = prefix.replace(/^\/+/, "");
    const token = signCapabilityToken({
      bucketKind,
      operation: "list",
      key: cleanPrefix,
      storageOwnerUuid: options?.storageOwnerUuid,
    });

    const url = `${this.getWorkerUrl(bucketKind)}/v1/objects/list`;

    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          prefix: cleanPrefix,
          cursor: options?.cursor,
          limit: options?.limit || 100,
          delimiter: options?.delimiter,
        }),
        signal: AbortSignal.timeout(15000),
      });

      if (!res.ok) {
        const errorText = await res.text();
        throw new BlobUnavailableError(
          `Worker list failed (${res.status}): ${errorText}`
        );
      }

      return (await res.json()) as R2WorkerListResult;
    } catch (err) {
      if (err instanceof BlobUnavailableError) throw err;
      throw new BlobUnavailableError(
        `Failed to list objects from Cloudflare R2 Worker (${bucketKind}): ${
          err instanceof Error ? err.message : String(err)
        }`
      );
    }
  }

  /**
   * Delete an object.
   * Safety: NEW Worker allows deleting ONLY temporary objects (`/temp/`).
   * OLD Worker rejects any deletion of historical manifests.
   */
  async deleteObject(
    bucketKind: R2BucketKind,
    key: string,
    options?: { storageOwnerUuid?: string }
  ): Promise<{ ok: boolean; deleted: boolean }> {
    const cleanKey = key.replace(/^\/+/, "");
    const token = signCapabilityToken({
      bucketKind,
      operation: "delete",
      key: cleanKey,
      storageOwnerUuid: options?.storageOwnerUuid,
    });

    const url = `${this.getWorkerUrl(bucketKind)}/v1/objects/${encodeURI(cleanKey)}`;

    try {
      const res = await fetch(url, {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${token}`,
        },
        signal: AbortSignal.timeout(15000),
      });

      if (res.status === 404) {
        return { ok: true, deleted: false };
      }

      if (!res.ok) {
        const errorText = await res.text();
        throw new BlobUnavailableError(
          `Worker delete failed (${res.status}): ${errorText}`
        );
      }

      return { ok: true, deleted: true };
    } catch (err) {
      if (err instanceof BlobUnavailableError) throw err;
      throw new BlobUnavailableError(
        `Failed to delete object from Cloudflare R2 Worker (${bucketKind}/${cleanKey}): ${
          err instanceof Error ? err.message : String(err)
        }`
      );
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // High-Level Domain Helpers
  // ───────────────────────────────────────────────────────────────────────────

  async uploadNewObject(
    key: string,
    data: Buffer,
    contentType = "application/json",
    storageOwnerUuid?: string
  ) {
    return this.putObject("NEW", key, data, { contentType, storageOwnerUuid });
  }

  async downloadNewObject(key: string, storageOwnerUuid?: string) {
    return this.getObject("NEW", key, { storageOwnerUuid });
  }

  async headNewObject(key: string, storageOwnerUuid?: string) {
    return this.headObject("NEW", key, { storageOwnerUuid });
  }

  async listNewObjects(prefix?: string, cursor?: string, limit?: number) {
    return this.listObjects("NEW", prefix, { cursor, limit });
  }

  async deleteTempObject(key: string, storageOwnerUuid?: string) {
    if (!key.includes("/temp/")) {
      throw new Error(
        "Only temporary uncommitted objects under /temp/ are eligible for deletion."
      );
    }
    return this.deleteObject("NEW", key, { storageOwnerUuid });
  }

  async uploadOldManifest(
    category: string,
    manifestId: string,
    filename: string,
    data: Buffer,
    storageOwnerUuid?: string
  ) {
    const key = `asdy/old/${category}/${manifestId}/${filename}`;
    return this.putObject("OLD", key, data, {
      contentType: "application/json",
      storageOwnerUuid,
    });
  }

  async downloadOldManifest(
    category: string,
    manifestId: string,
    filename = "manifest.json",
    storageOwnerUuid?: string
  ) {
    const key = `asdy/old/${category}/${manifestId}/${filename}`;
    return this.getObject("OLD", key, { storageOwnerUuid });
  }

  async headOldManifest(
    category: string,
    manifestId: string,
    filename = "manifest.json",
    storageOwnerUuid?: string
  ) {
    const key = `asdy/old/${category}/${manifestId}/${filename}`;
    return this.headObject("OLD", key, { storageOwnerUuid });
  }

  async listOldManifests(categoryPrefix?: string, cursor?: string, limit?: number) {
    const prefix = categoryPrefix ? `asdy/old/${categoryPrefix}` : `asdy/old/`;
    return this.listObjects("OLD", prefix, { cursor, limit });
  }

  /**
   * Upload a grouped batch of objects (e.g. Manifest + Parts + Version pointer)
   * in a single coordinated HTTP request to the NEW Cloudflare Worker.
   * Eliminates per-item Worker calls.
   */
  async uploadBatch(
    batchId: string,
    datasetType: string,
    items: BatchUploadItemInput[],
    options?: {
      targetPrefix?: string;
      storageOwnerUuid?: string;
    }
  ): Promise<BatchUploadResult> {
    if (items.length === 0) {
      return { ok: true, batchId, uploadedCount: 0, receipts: [] };
    }

    const cleanItems = items.map((item) => {
      const cleanKey = item.key.replace(/^\/+/, "");
      const buf = typeof item.data === "string" ? Buffer.from(item.data, "utf8") : item.data;
      const sha256 = item.sha256 || this.computeSha256(buf);
      return {
        key: cleanKey,
        content: buf.toString("utf8"),
        contentType: item.contentType || "application/json",
        sha256,
      };
    });

    const prefix = options?.targetPrefix || cleanItems[0].key.split("/").slice(0, 3).join("/");
    const allowedKeys = cleanItems.map((i) => i.key);

    const token = signCapabilityToken({
      bucketKind: "NEW",
      operation: "batch_upload",
      key: prefix,
      batchId,
      allowedKeys,
      storageOwnerUuid: options?.storageOwnerUuid,
      ttlSeconds: 180,
    });

    const url = `${this.getWorkerUrl("NEW")}/v1/batches/upload`;

    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          batchId,
          datasetType,
          targetPrefix: prefix,
          items: cleanItems,
        }),
        signal: AbortSignal.timeout(60000),
      });

      if (!res.ok) {
        const errorText = await res.text();
        throw new BlobUnavailableError(
          `Worker batch upload failed (${res.status}): ${errorText}`
        );
      }

      const result = (await res.json()) as BatchUploadResult;
      return result;
    } catch (err) {
      if (err instanceof BlobUnavailableError) throw err;
      throw new BlobUnavailableError(
        `Failed to execute batch upload to Cloudflare R2 Worker: ${
          err instanceof Error ? err.message : String(err)
        }`
      );
    }
  }
}

// Global Singleton
let clientInstance: R2WorkerStorageClient | null = null;

export function getR2WorkerStorageClient(): R2WorkerStorageClient {
  if (!clientInstance) {
    clientInstance = new R2WorkerStorageClient();
  }
  return clientInstance;
}
