import "server-only";

import { createAdminClient } from "./admin";

export const DEFAULT_SUPABASE_BUCKET = "youtube-discovery";

/**
 * Ensures a private Supabase Storage bucket exists.
 * Does not overwrite or delete existing bucket items.
 */
export async function ensurePrivateBucket(bucketName = DEFAULT_SUPABASE_BUCKET): Promise<boolean> {
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
        fileSizeLimit: 104857600, // 100MB
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
