/**
 * ═══════════════════════════════════════════════════════════════════════════
 * YouTube Discovery 2026 — Canonical Storage Owner Resolution
 * ──────────────────────────────────────────────────────────────────────────
 * Scope: One authoritative mapping from a verified Supabase Auth session to
 *        the owner identity used by IndexedDB, PostgreSQL, R2 object keys,
 *        manifests, and the Cloudflare Worker capability token.
 *
 * Why this file exists:
 *   The application has THREE related identifiers:
 *     - auth userId          (Supabase Auth identity)
 *     - profile id           (user_profiles primary key)
 *     - storage_owner_uuid   (canonical R2 / dataset owner namespace)
 *
 *   The R2 namespace and dataset ownership MUST use `storage_owner_uuid`.
 *   Using the auth userId silently splits ownership: the profile lookup by
 *   `storage_owner_uuid` fails, no generation is committed, and the client
 *   may still report success. This module prevents that class of bug.
 *
 * Safety:
 *   - No hardcoded "asdy-admin" fallback for cloud writes.
 *   - Legacy owner identifiers are exposed only for read compatibility.
 *   - The browser never chooses the owner; routes derive it from requireAdmin.
 * ═══════════════════════════════════════════════════════════════════════════
 */

export interface StorageOwnerContext {
  userId?: string | null;
  profileId?: string | null;
  storageOwnerUuid?: string | null;
  username?: string | null;
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value.trim());
}

/**
 * Returns the canonical storage owner for cloud reads/writes.
 *
 * Precedence is deliberate:
 *   1. `storage_owner_uuid` from the authoritative user_profiles row.
 *   2. Verified Supabase Auth `userId` only when the profile row has no
 *      storage owner value (legacy profile shape).
 *
 * Returns null when neither exists. Callers MUST fail closed rather than
 * inventing an owner or falling back to a shared demo namespace.
 */
export function resolveStorageOwnerId(context: StorageOwnerContext): string | null {
  const storageOwner = context.storageOwnerUuid?.trim();
  if (storageOwner) return storageOwner;

  const authUserId = context.userId?.trim();
  if (authUserId) return authUserId;

  return null;
}

/**
 * Resolves the canonical owner or throws. Server routes should convert this
 * into an explicit 401/403/500 response, never into a silent success.
 */
export function requireStorageOwnerId(context: StorageOwnerContext): string {
  const owner = resolveStorageOwnerId(context);
  if (!owner) {
    throw new Error(
      "Unable to resolve a canonical storage owner from the authenticated session."
    );
  }
  return owner;
}

export function resolveProfileId(context: StorageOwnerContext): string | null {
  return context.profileId?.trim() || null;
}

/**
 * Returns every owner identifier that may legitimately appear in historical
 * storage paths for this account. Used ONLY for read compatibility and
 * reconciliation. New writes must use `resolveStorageOwnerId`.
 */
export function resolveLegacyOwnerIds(context: StorageOwnerContext): string[] {
  const candidates = [
    context.storageOwnerUuid,
    context.userId,
    context.username,
    context.username ? `${context.username}-admin` : null,
  ];

  const result: string[] = [];
  for (const candidate of candidates) {
    const clean = candidate?.trim();
    if (clean && !result.includes(clean)) result.push(clean);
  }
  return result;
}

/**
 * Checks whether a storage key belongs to one of the supplied owner
 * namespaces. Supports the canonical `asdy/persistence|temp/<owner>/...`
 * layout and the historical `<owner>/persistence|temp/...` layout.
 *
 * This is a defense-in-depth check used by Next.js routes in addition to the
 * Worker's own capability-token and prefix enforcement.
 */
export function isOwnerScopedStorageKey(key: string, ownerIds: string[]): boolean {
  if (typeof key !== "string" || !key.trim()) return false;
  const clean = key.replace(/^\/+/, "");
  if (clean.includes("..") || clean.includes("\\")) return false;

  return ownerIds.some((owner) => {
    const safeOwner = owner.trim();
    if (!safeOwner) return false;
    return (
      clean.startsWith(`asdy/persistence/${safeOwner}/`) ||
      clean.startsWith(`asdy/temp/${safeOwner}/`) ||
      clean.startsWith(`${safeOwner}/persistence/`) ||
      clean.startsWith(`${safeOwner}/temp/`)
    );
  });
}

/**
 * Client-side helper for `/api/auth/status` responses. Kept separate from the
 * server context so client code never imports server-only auth modules.
 */
export function resolveClientStorageOwnerId(payload: {
  storageOwnerUuid?: string | null;
  userId?: string | null;
}): string | null {
  return resolveStorageOwnerId(payload);
}
