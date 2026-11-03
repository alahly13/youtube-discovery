/**
 * ═══════════════════════════════════════════════════════════════════════════
 * Storage Configuration — Cloud / Supabase / Cloudflare / Disk resolution.
 * ──────────────────────────────────────────────────────────────────────────
 * - Vercel Blob has been fully decommissioned.
 * - Resolves Supabase Storage when configured, or local DiskStorageBackend.
 * - Ready for Cloudflare R2 adapter.
 * ═══════════════════════════════════════════════════════════════════════════
 */

export class BlobConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BlobConfigError";
  }
}

export interface BlobRuntimeConfig {
  token?: string;
  storeId?: string;
  authMode: "supabase" | "cloudflare" | "disk-fallback";
}

export function getBlobRuntimeConfig(): BlobRuntimeConfig {
  // Check Supabase Storage credentials first
  const hasSupabase =
    Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL) &&
    Boolean(process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY);
  if (hasSupabase) {
    return { authMode: "supabase" };
  }

  // Cloudflare R2 support (future/configured)
  const hasCloudflare =
    Boolean(process.env.CLOUDFLARE_R2_BUCKET) &&
    Boolean(process.env.CLOUDFLARE_R2_ACCESS_KEY_ID);
  if (hasCloudflare) {
    return { authMode: "cloudflare" };
  }

  // Local development / disk fallback
  return { authMode: "disk-fallback" };
}

/** Non-throwing probe for status UIs (returns labels only). */
export function describeBlobConfig(): {
  configured: boolean;
  authMode: string | null;
  storeIdSet: boolean;
} {
  try {
    const cfg = getBlobRuntimeConfig();
    return { configured: true, authMode: cfg.authMode, storeIdSet: false };
  } catch {
    return { configured: false, authMode: null, storeIdSet: false };
  }
}
