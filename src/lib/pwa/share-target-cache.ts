/**
 * ═══════════════════════════════════════════════════════════════════════════
 * Web Share Target — Cache Storage Handoff
 * ──────────────────────────────────────────────────────────────────────────
 * Scope: Reads, validates, deletes, and prunes the temporary share payload
 *        written by `public/sw.js`.
 *
 * Why this file exists:
 *   The service worker cannot render the review UI and the page cannot read
 *   the original multipart POST. Cache Storage is the handoff boundary. This
 *   module ensures the page only trusts a payload with the expected version,
 *   token, shape, and age.
 *
 * Security notes:
 *   - The cache key contains a 128-bit random token.
 *   - Payloads are deleted after save, discard, duplicate, or one hour.
 *   - The owner hint recorded at share time is compared with the current
 *     authenticated canonical owner before any content is displayed.
 * ═══════════════════════════════════════════════════════════════════════════
 */

import {
  SHARE_RAW_FIELD_LIMITS,
  SHARE_TARGET_CACHE_NAME,
  SHARE_TARGET_CACHE_PREFIX,
  SHARE_TARGET_MAX_AGE_MS,
  SHARE_TARGET_PAYLOAD_VERSION,
  buildSharePayloadKey,
  isValidShareToken,
  type SharePayload,
} from "./share-target";

export type SharePayloadReadResult =
  | { ok: true; payload: SharePayload }
  | { ok: false; reason: "missing" | "expired" | "invalid" | "unavailable" };

const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeOwnerHint(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const clean = value.trim();
  return clean || null;
}

/**
 * Validates the stored JSON before the review page trusts any field. A payload
 * with the wrong token is treated as corrupt, not as a different share.
 */
function parseSharePayload(value: unknown, token: string): SharePayload | null {
  if (!isRecord(value)) return null;
  if (value.version !== SHARE_TARGET_PAYLOAD_VERSION) return null;
  if (value.token !== token) return null;
  if (typeof value.createdAt !== "string" || !value.createdAt.trim()) return null;

  const fields = value.fields;
  if (!isRecord(fields)) return null;

  const title = typeof fields.title === "string" ? fields.title : "";
  const text = typeof fields.text === "string" ? fields.text : "";
  const url = typeof fields.url === "string" ? fields.url : "";

  if (title.length > SHARE_RAW_FIELD_LIMITS.title) return null;
  if (text.length > SHARE_RAW_FIELD_LIMITS.text) return null;
  if (url.length > SHARE_RAW_FIELD_LIMITS.url) return null;

  return {
    version: SHARE_TARGET_PAYLOAD_VERSION,
    token,
    createdAt: value.createdAt,
    ownerHint: normalizeOwnerHint(value.ownerHint),
    fields: { title, text, url },
  };
}

function cacheStorageAvailable(): boolean {
  return typeof caches !== "undefined" && typeof location !== "undefined";
}

/**
 * Reads the cached payload for a token. Expired/corrupt entries are deleted so
 * a stale share can never be replayed later.
 */
export async function readSharePayload(
  token: string
): Promise<SharePayloadReadResult> {
  if (!isValidShareToken(token)) return { ok: false, reason: "invalid" };
  if (!cacheStorageAvailable()) return { ok: false, reason: "unavailable" };

  try {
    const cache = await caches.open(SHARE_TARGET_CACHE_NAME);
    const key = buildSharePayloadKey(token, location.origin);
    const response = await cache.match(key);

    if (!response) return { ok: false, reason: "missing" };

    const payload = parseSharePayload(await response.json(), token);
    if (!payload) {
      await cache.delete(key);
      return { ok: false, reason: "invalid" };
    }

    const createdAt = Date.parse(payload.createdAt);
    if (!Number.isFinite(createdAt)) {
      await cache.delete(key);
      return { ok: false, reason: "invalid" };
    }

    const age = Date.now() - createdAt;
    if (age > SHARE_TARGET_MAX_AGE_MS) {
      await cache.delete(key);
      return { ok: false, reason: "expired" };
    }

    // A timestamp far in the future cannot be trusted; treat it as corrupt.
    if (age < -MAX_CLOCK_SKEW_MS) {
      await cache.delete(key);
      return { ok: false, reason: "invalid" };
    }

    return { ok: true, payload };
  } catch {
    return { ok: false, reason: "invalid" };
  }
}

/** Deletes a share payload. Best-effort: cleanup must never block the UI. */
export async function deleteSharePayload(token: string): Promise<void> {
  if (!isValidShareToken(token)) return;
  if (!cacheStorageAvailable()) return;

  try {
    const cache = await caches.open(SHARE_TARGET_CACHE_NAME);
    await cache.delete(buildSharePayloadKey(token, location.origin));
  } catch {
    // The payload will be pruned on the next share or after the one-hour TTL.
  }
}

/**
 * Removes expired or corrupt entries from the share cache. Called when the
 * review page opens and by the service worker after every new share.
 */
export async function pruneExpiredSharePayloads(): Promise<void> {
  if (!cacheStorageAvailable()) return;

  try {
    const cache = await caches.open(SHARE_TARGET_CACHE_NAME);
    const requests = await cache.keys();

    await Promise.all(
      requests.map(async (request) => {
        const url = new URL(request.url);
        if (!url.pathname.startsWith(SHARE_TARGET_CACHE_PREFIX)) return;

        try {
          const response = await cache.match(request);
          const payload = response ? await response.json() : null;
          const createdAt =
            isRecord(payload) && typeof payload.createdAt === "string"
              ? Date.parse(payload.createdAt)
              : NaN;

          if (
            !Number.isFinite(createdAt) ||
            Date.now() - createdAt > SHARE_TARGET_MAX_AGE_MS
          ) {
            await cache.delete(request);
          }
        } catch {
          await cache.delete(request);
        }
      })
    );
  } catch {
    // Cache Storage may be unavailable in private/incognito edge cases.
  }
}
