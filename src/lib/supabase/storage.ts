import "server-only";

import { createAdminClient } from "./admin";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * YouTube Discovery — Supabase Storage Bucket Configuration
 * ──────────────────────────────────────────────────────────────────────────
 * Scope: Separation of OLD and NEW Dedicated Private Buckets
 *
 * 1. Dedicated OLD Bucket: 'old-youtube-discovery-private'
 *    Used for historical imported manifests and browser archives.
 *    Logical prefixes:
 *      - asdy/old/saved-items/
 *      - asdy/old/saved-playlists/
 *      - asdy/old/saved-titles-links/
 *      - asdy/old/saved-search-history/
 *
 * 2. Dedicated NEW Bucket: 'new-youtube-discovery-private'
 *    Used for active application manifests, datasets, and generation parts:
 *      - <storage_owner_uuid>/persistence/datasets/...
 *      - <storage_owner_uuid>/temp/...
 * ═══════════════════════════════════════════════════════════════════════════
 */

export const OLD_STORAGE_BUCKET =
  process.env.SUPABASE_OLD_STORAGE_BUCKET || "old-youtube-discovery-private";

export const NEW_STORAGE_BUCKET =
  process.env.SUPABASE_NEW_STORAGE_BUCKET || "new-youtube-discovery-private";

export const LEGACY_STORAGE_BUCKET =
  process.env.SUPABASE_STORAGE_BUCKET || "youtube-discovery-private";

// Canonical default for new persistence operations
export const CANONICAL_STORAGE_BUCKET = NEW_STORAGE_BUCKET;
export const DEFAULT_SUPABASE_BUCKET = NEW_STORAGE_BUCKET;

/**
 * Ensures a private Supabase Storage bucket exists.
 * Does not overwrite or delete existing bucket items.
 */
export async function ensurePrivateBucket(bucketName = NEW_STORAGE_BUCKET): Promise<boolean> {
  const supabase = createAdminClient();
  if (!supabase) return false;

  try {
    const { data: buckets, error: listError } = await supabase.storage.listBuckets();
    if (listError) {
      console.warn("[supabase-storage] Failed to list buckets:", listError.message);
      return false;
    }

    const exists = buckets?.some((b) => b.name === bucketName);
    if (!exists) {
      const { error: createError } = await supabase.storage.createBucket(bucketName, {
        public: false, // Private bucket strictly
        fileSizeLimit: 52428800, // 50MB / 52,428,800 bytes
      });
      if (createError) {
        console.warn(`[supabase-storage] Failed to create bucket ${bucketName}:`, createError.message);
        return false;
      }
    }
    return true;
  } catch (err) {
    console.warn("[supabase-storage] Error ensuring private bucket:", err);
    return false;
  }
}

/**
 * Ensures both dedicated OLD and NEW application buckets are initialized.
 */
export async function ensureAllApplicationBuckets(): Promise<{
  oldBucketOk: boolean;
  newBucketOk: boolean;
}> {
  const [oldBucketOk, newBucketOk] = await Promise.all([
    ensurePrivateBucket(OLD_STORAGE_BUCKET),
    ensurePrivateBucket(NEW_STORAGE_BUCKET),
  ]);
  return { oldBucketOk, newBucketOk };
}
