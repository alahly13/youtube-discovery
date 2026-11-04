import "server-only";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * Authoritative Storage Backend Interface (Cloudflare R2 + Local Disk Fallback)
 * ──────────────────────────────────────────────────────────────────────────
 * Defines the canonical interface for object storage operations across
 * NEW and OLD Cloudflare R2 private buckets.
 * ═══════════════════════════════════════════════════════════════════════════
 */

export interface StorageObjectMeta {
  pathname: string;
  size: number;
  uploadedAt: Date | string;
  contentType?: string;
  etag?: string;
}

export interface PutObjectOptions {
  allowOverwrite?: boolean;
  ifMatch?: string;
  contentType?: string;
  cacheSeconds?: number;
}

export interface ListObjectsOptions {
  prefix?: string;
  cursor?: string;
  limit?: number;
}

export interface ListObjectsResult {
  objects: StorageObjectMeta[];
  cursor?: string;
  hasMore?: boolean;
}

export interface StorageBackend {
  getBytes(pathname: string): Promise<Buffer>;
  head(pathname: string): Promise<StorageObjectMeta | null>;
  putBytes(
    pathname: string,
    data: Buffer,
    options?: PutObjectOptions
  ): Promise<StorageObjectMeta>;
  delete(pathname: string): Promise<void>;
  list(prefix?: string): Promise<StorageObjectMeta[]>;
}

export class StorageNotFoundError extends Error {
  constructor(pathname: string) {
    super(`Storage object not found: ${pathname}`);
    this.name = "StorageNotFoundError";
  }
}

export class StorageConflictError extends Error {
  constructor(pathname: string, message?: string) {
    super(message || `Storage object conflict: ${pathname}`);
    this.name = "StorageConflictError";
  }
}

export class StorageUnavailableError extends Error {
  constructor(message: string) {
    super(`Storage backend unavailable: ${message}`);
    this.name = "StorageUnavailableError";
  }
}

// Backward-compatibility aliases for legacy code
export type BlobBackend = StorageBackend;
export type BlobObjectMeta = StorageObjectMeta;
export const BlobNotFoundError = StorageNotFoundError;
export const BlobConflictError = StorageConflictError;
export const BlobUnavailableError = StorageUnavailableError;

/**
 * Deterministic JSON stringifier with recursively sorted object keys.
 * Crucial for stable hashes and Compare-And-Swap (CAS) consistency.
 */
export function stableStringify(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (value === null || typeof value !== "object") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(sortKeys);
  }
  const sorted: Record<string, unknown> = {};
  for (const k of Object.keys(value as Record<string, unknown>).sort()) {
    sorted[k] = sortKeys((value as Record<string, unknown>)[k]);
  }
  return sorted;
}
