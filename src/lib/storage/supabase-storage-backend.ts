import "server-only";

import {
  R2StorageBackend,
  getOldStorageBackend,
  getNewStorageBackend,
  getStorageBackendForBucket,
  OLD_R2_BUCKET,
  NEW_R2_BUCKET,
} from "./r2-blob-backend";
import type { BlobBackend } from "./storage-backend";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * Legacy Supabase Storage Backend Compatibility Bridge -> Cloudflare R2
 * ──────────────────────────────────────────────────────────────────────────
 * Scope: Migration bridge routing legacy calls directly to R2StorageBackend.
 *
 * Supabase Storage has been retired for object storage in favor of
 * Cloudflare R2 accessed exclusively through dedicated Cloudflare Workers.
 * ═══════════════════════════════════════════════════════════════════════════
 */

export class SupabaseStorageBackend extends R2StorageBackend {
  constructor(bucket = NEW_R2_BUCKET) {
    super(bucket);
  }
}

export {
  getOldStorageBackend,
  getNewStorageBackend,
  getStorageBackendForBucket,
  OLD_R2_BUCKET as OLD_STORAGE_BUCKET,
  NEW_R2_BUCKET as NEW_STORAGE_BUCKET,
};
