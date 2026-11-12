/**
 * ═══════════════════════════════════════════════════════════════════════════
 * Saved Link Identity & Validation
 * ──────────────────────────────────────────────────────────────────────────
 * Scope: Shared, runtime-agnostic rules for SAVED_LINK records in the
 *        canonical REFERENCES dataset.
 *
 * Why this file exists:
 *   The manual Saved Titles & Links workspace and the PWA Web Share Target
 *   both write to the same dataset. If each surface implemented its own URL
 *   validation or duplicate comparison, the same link could be saved twice
 *   with different identities. This module is the single source of truth for:
 *     - HTTP(S)-only URL acceptance
 *     - duplicate comparison normalization
 *     - the saved-link record contract used by the outbox pipeline
 *
 * Safety rules (do not weaken):
 *   - Only absolute http: and https: URLs are valid saved links.
 *   - javascript:, data:, file:, blob:, and every other scheme are rejected.
 *   - Normalization is for comparison only. Stored URLs preserve the user's
 *     canonical URL text; identity is never derived from a title.
 *   - This module performs no network requests. A shared URL is never fetched
 *     by the server or the browser before the user explicitly opens it.
 * ═══════════════════════════════════════════════════════════════════════════
 */

/**
 * Shared limits for the persisted saved-link contract.
 * The database columns are title VARCHAR(512), url VARCHAR(2048), notes TEXT.
 */
export const SAVED_REFERENCE_LIMITS = {
  title: 512,
  url: 2048,
  notes: 4000,
} as const;

/**
 * Minimal record shape needed to recognize a saved link during duplicate
 * checks across local IndexedDB projections and hydrated server records.
 */
export interface SavedLinkIdentityRecord {
  id?: string;
  recordId?: string;
  resourceType?: string;
  savedKind?: string;
  title?: string;
  url?: string;
}

/**
 * Returns true only for an absolute HTTP or HTTPS URL with a hostname.
 * Embedded credentials are rejected because they are commonly used for
 * deceptive links ("https://trusted.example@attacker.example").
 */
export function isValidHttpUrl(value: string): boolean {
  if (typeof value !== "string" || !value.trim()) return false;

  try {
    const parsed = new URL(value.trim());
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
    if (!parsed.hostname) return false;
    if (parsed.username || parsed.password) return false;
    return true;
  } catch {
    return false;
  }
}

/**
 * Produces a stable comparison key for duplicate detection only.
 *
 * Deliberately mirrors the historical Saved Titles & Links behavior:
 *   - hostname is case-insensitive
 *   - fragment identifiers are ignored
 *   - a trailing slash is ignored
 *   - query strings are preserved because they often identify different pages
 *
 * The stored `url` field keeps the original (canonicalized) URL text. This
 * helper must never be used as the record identity.
 */
export function normalizeUrlForComparison(value: string): string {
  try {
    const parsed = new URL(value.trim());
    parsed.hash = "";
    const path = parsed.pathname.replace(/\/+$/, "") || "/";
    return `${parsed.protocol}//${parsed.host.toLowerCase()}${path}${parsed.search}`;
  } catch {
    return value.trim().toLowerCase();
  }
}

/**
 * Recognizes records that participate in saved-link duplicate checks.
 *
 * Legacy references may not carry an explicit taxonomy discriminator, so a
 * record with a URL and no type is treated as a link candidate. Explicit
 * SAVED_TITLE / SAVED_SEARCH records are never treated as links even if they
 * contain a URL.
 */
export function isSavedLinkIdentityRecord(record: SavedLinkIdentityRecord): boolean {
  if (!record || typeof record !== "object") return false;
  if (typeof record.url !== "string" || !record.url.trim()) return false;

  const explicitType = String(record.resourceType || record.savedKind || "").trim();
  return !explicitType || explicitType === "SAVED_LINK";
}

/**
 * Finds a previously saved link with the same normalized URL. Returns null
 * when no duplicate exists. This function does not mutate the input.
 */
export function findSavedLinkDuplicate<T extends SavedLinkIdentityRecord>(
  records: readonly T[],
  url: string
): T | null {
  const target = normalizeUrlForComparison(url);
  if (!target) return null;

  for (const record of records) {
    if (!isSavedLinkIdentityRecord(record)) continue;
    if (normalizeUrlForComparison(String(record.url)) === target) {
      return record;
    }
  }

  return null;
}
