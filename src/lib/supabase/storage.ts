import "server-only";

import { OLD_R2_BUCKET, NEW_R2_BUCKET } from "../storage/r2-blob-backend";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * YouTube Discovery — Storage Bucket Constants (Cloudflare R2 Migration)
 * ──────────────────────────────────────────────────────────────────────────
 * Scope: Retained for backward-compatibility aliases.
 *
 * All object storage is now routed to Cloudflare R2 via dedicated Workers:
 *   1. OLD: 'old-youtube-discovery-private'
 *   2. NEW: 'new-youtube-discovery-private'
 * ═══════════════════════════════════════════════════════════════════════════
 */

export const OLD_STORAGE_BUCKET = OLD_R2_BUCKET;
export const NEW_STORAGE_BUCKET = NEW_R2_BUCKET;
export const LEGACY_STORAGE_BUCKET = "youtube-discovery-private";

export const CANONICAL_STORAGE_BUCKET = NEW_STORAGE_BUCKET;
export const DEFAULT_SUPABASE_BUCKET = NEW_STORAGE_BUCKET;

/**
 * @deprecated Supabase Storage is retired in favor of Cloudflare R2 via Workers.
 */
export async function ensurePrivateBucket(_bucketName = NEW_STORAGE_BUCKET): Promise<boolean> {
  return true;
}

/**
 * @deprecated Supabase Storage is retired in favor of Cloudflare R2 via Workers.
 */
export async function ensureAllApplicationBuckets(): Promise<{
  oldBucketOk: boolean;
  newBucketOk: boolean;
}> {
  return { oldBucketOk: true, newBucketOk: true };
}
