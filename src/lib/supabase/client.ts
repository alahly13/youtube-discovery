import { createBrowserClient } from "@supabase/ssr";

/**
 * Supabase client for Client Components.
 * Uses public environment variables only. Safe to run in the browser.
 */
export function createClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !key) {
    // Returns a dummy or disabled client when credentials are not yet supplied
    // Prevents crashes in local development prior to setting up Supabase
    return createBrowserClient(
      url || "https://placeholder-project.supabase.co",
      key || "placeholder-anon-key"
    );
  }

  return createBrowserClient(url, key);
}
