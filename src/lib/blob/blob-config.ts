/**
 * ═══════════════════════════════════════════════════════════════════════════
 * Blob Configuration — token resolution + validation (no secrets in errors).
 * ──────────────────────────────────────────────────────────────────────────
 * Auth resolution (supported by @vercel/blob):
 *  1. Explicit BLOB_READ_WRITE_TOKEN (local dev AND Vercel when set).
 *  2. Vercel OIDC (automatic when the project/store are connected and no
 *     token is set — the SDK resolves VERCEL_OIDC_TOKEN itself).
 * Validation failures throw BlobConfigError with SAFE messages (never the
 * token value). Nothing here is imported by client components.
 * ═══════════════════════════════════════════════════════════════════════════
 */

export class BlobConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BlobConfigError";
  }
}

export interface BlobRuntimeConfig {
  /** Explicit read/write token when configured (otherwise SDK uses OIDC). */
  token?: string;
  /** Store id hint for OIDC resolution. */
  storeId?: string;
  /** How auth was resolved (label only — never a secret). */
  authMode: "read-write-token" | "oidc";
}

export function getBlobRuntimeConfig(): BlobRuntimeConfig {
  const token = process.env.BLOB_READ_WRITE_TOKEN?.trim() || undefined;
  const storeId = process.env.BLOB_STORE_ID?.trim() || undefined;
  if (token) {
    return { token, storeId, authMode: "read-write-token" };
  }
  // OIDC path: valid on Vercel when project + store are connected. The SDK
  // picks up VERCEL_OIDC_TOKEN automatically; BLOB_STORE_ID selects the store.
  if (process.env.VERCEL === "1" || process.env.VERCEL_OIDC_TOKEN) {
    return { token: undefined, storeId, authMode: "oidc" };
  }
  throw new BlobConfigError(
    "Blob storage is not configured. Set BLOB_READ_WRITE_TOKEN (and BLOB_STORE_ID) " +
      "in .env.local and Vercel Project Settings. Local-only storage is not used as a substitute.",
  );
}

/** Non-throwing probe for status UIs (returns labels only). */
export function describeBlobConfig(): {
  configured: boolean;
  authMode: string | null;
  storeIdSet: boolean;
} {
  try {
    const cfg = getBlobRuntimeConfig();
    return { configured: true, authMode: cfg.authMode, storeIdSet: Boolean(cfg.storeId) };
  } catch {
    return { configured: false, authMode: null, storeIdSet: Boolean(process.env.BLOB_STORE_ID?.trim()) };
  }
}
