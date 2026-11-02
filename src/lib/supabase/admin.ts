import "server-only";

import { createClient } from "@supabase/supabase-js";

/**
 * Supabase Admin Client (Server-Only).
 * Uses the Service Role Secret Key to bypass RLS for administrative storage,
 * bucket management, and background tasks.
 * NEVER expose this client or its key to the browser.
 */
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secretKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SECRET_KEY;

  if (!url || !secretKey) {
    return null;
  }

  return createClient(url, secretKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}
