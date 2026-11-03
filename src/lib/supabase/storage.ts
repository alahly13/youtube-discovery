import "server-only";

import { createAdminClient } from "./admin";

export const CANONICAL_STORAGE_BUCKET =
  process.env.SUPABASE_STORAGE_BUCKET || "youtube-discovery-private";
export const DEFAULT_SUPABASE_BUCKET = CANONICAL_STORAGE_BUCKET;

/**
 * Ensures a private Supabase Storage bucket exists.
 * Does not overwrite or delete existing bucket items.
 */
export async function ensurePrivateBucket(bucketName = CANONICAL_STORAGE_BUCKET): Promise<boolean> {
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
