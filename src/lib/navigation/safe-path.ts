/**
 * ═══════════════════════════════════════════════════════════════════════════
 * Safe Internal Redirect Paths
 * ──────────────────────────────────────────────────────────────────────────
 * Scope: Shared by the auth proxy and the login form.
 *
 * Why this file exists:
 *   The PWA Web Share Target keeps its cached payload behind a random token in
 *   the query string (`/share-target?share=...`). When a session expires, the
 *   login redirect must preserve that query string, but it must never become
 *   an open redirect. This helper accepts only same-origin absolute paths and
 *   rejects protocol-relative URLs, backslash tricks, and the login page
 *   itself (which would create a redirect loop).
 *
 * Future agents:
 *   - Do not replace this with a raw `startsWith("/")` check. `//evil.example`
 *     and `/\evil.example` both start with a slash and both escape the origin.
 *   - This module is runtime-agnostic and safe to import from proxy.ts.
 * ═══════════════════════════════════════════════════════════════════════════
 */

const FALLBACK_PATH = "/search";
const INTERNAL_ORIGIN = "https://internal.invalid";
const MAX_REDIRECT_PATH_LENGTH = 2048;

/**
 * Returns a safe same-origin path (including query string and fragment) or the
 * supplied fallback. Never returns an absolute URL, protocol-relative URL, or
 * a path containing control characters or backslashes.
 */
export function sanitizeRedirectPath(
  value: string | null | undefined,
  fallback: string = FALLBACK_PATH
): string {
  if (typeof value !== "string") return fallback;

  const raw = value.trim();
  if (!raw || raw.length > MAX_REDIRECT_PATH_LENGTH) return fallback;
  if (!raw.startsWith("/")) return fallback;
  if (raw.startsWith("//")) return fallback;
  if (raw.includes("\\")) return fallback;
  if (/[\u0000-\u001F\u007F]/.test(raw)) return fallback;

  try {
    const parsed = new URL(raw, INTERNAL_ORIGIN);
    // A path that changed origin was not an internal path.
    if (parsed.origin !== INTERNAL_ORIGIN) return fallback;
    // Sending a signed-in administrator back to /login creates a loop.
    if (parsed.pathname === "/login") return fallback;
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return fallback;
  }
}
