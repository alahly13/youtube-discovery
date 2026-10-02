/**
 * ═══════════════════════════════════════════════════════════════════════════
 * Search Storage TTL Configuration & Expiration Source of Truth
 * ──────────────────────────────────────────────────────────────────────────
 * Provides a single centralized authority for search storage retention.
 * Defaults to 168 hours (7 full days / 1 week) and can be configured via
 * the SEARCH_STORAGE_TTL_HOURS environment variable.
 *
 * Safe parsing guarantees that invalid, missing, zero, or negative values
 * safely fall back to 168 hours without breaking the application.
 * ═══════════════════════════════════════════════════════════════════════════
 */

export const DEFAULT_SEARCH_STORAGE_TTL_HOURS = 168; // 7 days (168 hours)

/**
 * Safely parses the configured search storage TTL in hours.
 * Falls back to 168 hours if missing, empty, non-numeric, or non-positive.
 */
export function getSearchStorageTtlHours(): number {
  const envVal =
    typeof process !== "undefined"
      ? (process.env.SEARCH_STORAGE_TTL_HOURS ?? process.env.NEXT_PUBLIC_SEARCH_STORAGE_TTL_HOURS)
      : undefined;

  if (!envVal || typeof envVal !== "string") {
    return DEFAULT_SEARCH_STORAGE_TTL_HOURS;
  }

  const parsed = Number(envVal.trim());
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_SEARCH_STORAGE_TTL_HOURS;
  }

  return Math.round(parsed);
}

/**
 * Returns the configured search storage TTL in milliseconds.
 */
export function getSearchStorageTtlMs(): number {
  return getSearchStorageTtlHours() * 60 * 60 * 1000;
}

/**
 * Calculates the exact expiration timestamp for a search created at the given time.
 * expiresAt = createdAt + configured TTL
 */
export function calculateExpirationTimestamp(searchedAtMs: number): number {
  return searchedAtMs + getSearchStorageTtlMs();
}

/**
 * Determines whether a search has expired based on its searchedAt or expiresAt timestamp.
 */
export function isSearchExpired(searchedAtMs: number, customExpiresAt?: number): boolean {
  if (!searchedAtMs || typeof searchedAtMs !== "number") {
    return true;
  }
  const expiresAt = customExpiresAt ?? calculateExpirationTimestamp(searchedAtMs);
  return Date.now() >= expiresAt;
}

/**
 * Formats user-friendly elapsed time and remaining TTL strings for UI display.
 */
export function formatSearchTtlRemaining(
  searchedAtMs: number,
  customExpiresAt?: number,
): { elapsedText: string; remainingText: string; isExpired: boolean } {
  const now = Date.now();
  const expiresAt = customExpiresAt ?? calculateExpirationTimestamp(searchedAtMs);
  const isExpired = now >= expiresAt;

  const ageMs = Math.max(0, now - searchedAtMs);
  const remainingMs = Math.max(0, expiresAt - now);

  const formatHoursMins = (ms: number) => {
    const totalMins = Math.floor(ms / (60 * 1000));
    if (totalMins < 60) {
      return `${totalMins}m`;
    }
    const hours = Math.floor(ms / (60 * 60 * 1000));
    const remMins = Math.floor((ms % (60 * 60 * 1000)) / (60 * 1000));
    if (hours >= 24) {
      const days = Math.floor(hours / 24);
      const remHours = hours % 24;
      return remHours > 0 ? `${days}d ${remHours}h` : `${days}d`;
    }
    return remMins > 0 ? `${hours}h ${remMins}m` : `${hours}h`;
  };

  return {
    elapsedText: `${formatHoursMins(ageMs)} ago`,
    remainingText: isExpired ? "Expired" : `${formatHoursMins(remainingMs)} left`,
    isExpired,
  };
}
