/**
 * ═══════════════════════════════════════════════════════════════════════════
 * Search Query Pipeline — acceptance helpers (no modification, ever).
 * ──────────────────────────────────────────────────────────────────────────
 * - `isSubmittableQuery` is the ONLY gate before submission: it blocks
 *   empty/whitespace-only input WITHOUT altering the query string.
 * - No case folding, no punctuation stripping, no emoji removal, no Unicode
 *   normalization, no length cap, no restrictive regex — anywhere.
 * - Transport uses JSON bodies and `URLSearchParams` (single encoding);
 *   user input is never interpolated into URLs or encoded twice.
 * Pure module: unit-testable in plain Node.
 * ═══════════════════════════════════════════════════════════════════════════
 */

/** True when the query carries visible content. The input is returned untouched. */
export function isSubmittableQuery(query: unknown): query is string {
  return typeof query === "string" && query.length > 0 && query.trim().length > 0;
}

/**
 * Single-encode round-trip through standard URL parameter serialization.
 * Used by tests to prove special characters, Unicode, and emoji survive
 * client→server transport exactly once (no double-encoding, no mutation).
 */
export function roundTripSearchParam(value: string): string {
  const encoded = new URLSearchParams({ q: value }).toString();
  return new URLSearchParams(encoded).get("q") ?? "";
}
