import "server-only";

import { YouTubeProviderError } from "./youtube-errors";
import {
  countPoolQuotaErrors,
  disableKeyForInvalidity,
  markKeyQuotaExhausted,
  promoteProjectToVerified,
  recordKeyLifetimeUsage,
  resolveApiKeyForRequest,
} from "./youtube-api-keys";
import {
  bucketForOperation,
  markPoolBucketExhausted,
  recordRequestOutcome,
  unitsForOperation,
} from "../../keys/quota-pools";

type QueryValue = string | number | boolean | null | undefined;

/**
 * Error classification (never rotate blindly on 403):
 * - QUOTA_EXHAUSTED_REASONS → the POOL's bucket for this operation is spent:
 *   mark pool-level exhaustion, skip same-pool keys for this bucket, try the
 *   next pool. Correlated exhaustion across ≥2 pool keys promotes a declared
 *   project association to verified (behavioral evidence).
 * - INVALID_KEY_REASONS → this KEY is bad/restricted: disable the key only,
 *   never the pool. Other keys (even same pool) stay eligible.
 * - Anything else (400 malformed, 5xx transient, unknown) → fail fast with
 *   the real error. Rotating cannot help a malformed query.
 */
const QUOTA_EXHAUSTED_REASONS = new Set([
  "quotaExceeded",
  "dailyLimitExceeded",
  "rateLimitExceeded",
  "userRateLimitExceeded",
  "quotaExceeded402",
]);

const INVALID_KEY_REASONS = new Set([
  "API_KEY_INVALID",
  "keyInvalid",
  "ipRefererBlocked",
  "refererBlocked",
  "accessNotConfigured",
  "forbidden",
  "accountDeleted",
  "accountDisabled",
]);

const MAX_ROTATION_ATTEMPTS = 8;

export class YouTubeApiClient {
  private readonly apiBaseUrl = process.env.YOUTUBE_API_BASE_URL ?? "https://www.googleapis.com/youtube/v3";

  async request<T>(path: string, params: Record<string, QueryValue>): Promise<T> {
    // Project-aware rotation across legitimately configured quota pools.
    // Every attempt is attributed (key + project + bucket + outcome) to the
    // persistent usage log; the dashboard shows the REAL outcome, not the
    // pre-selected key.
    const bucket = bucketForOperation(path);
    const units = unitsForOperation(path);
    const triedKeyIds: string[] = [];
    let lastError: unknown = null;

    for (let attempt = 0; attempt < MAX_ROTATION_ATTEMPTS; attempt += 1) {
      let selection;
      try {
        selection = await resolveApiKeyForRequest(triedKeyIds, bucket);
      } catch (err) {
        if (lastError instanceof YouTubeProviderError) throw lastError;
        throw err;
      }
      const { key: activeApiKey, keyId, projectId, poolKey } = selection;
      triedKeyIds.push(keyId);

      const url = new URL(`${this.apiBaseUrl.replace(/\/$/, "")}/${path}`);

      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined && value !== null && value !== "" && value !== "any") {
          url.searchParams.set(key, String(value));
        }
      }

      url.searchParams.set("key", activeApiKey);

      const response = await fetch(url, {
        headers: {
          Accept: "application/json",
        },
        cache: "no-store",
      });

      const payload = (await response.json().catch(() => null)) as unknown;

      if (response.ok) {
        await recordOutcome({
          keyId,
          poolKey,
          projectId,
          operation: path,
          bucket,
          units,
          ok: true,
          errorReason: null,
        });
        await recordKeyLifetimeUsage(keyId, units);
        return payload as T;
      }

      const reason = extractProviderReason(payload) ?? "youtube_provider_error";
      const message = extractProviderMessage(payload) ?? "YouTube Data API request failed.";
      const providerError = new YouTubeProviderError(
        message,
        response.status,
        reason,
        sanitizeProviderDetails(payload),
      );

      if (QUOTA_EXHAUSTED_REASONS.has(reason)) {
        await recordOutcome({ keyId, poolKey, projectId, operation: path, bucket, units, ok: false, errorReason: reason });
        // Pool-level exhaustion for THIS bucket only (other buckets stay live).
        await markKeyQuotaExhausted(keyId, reason);
        const { getBlobBackend } = await import("../../blob/backend-factory");
        await markPoolBucketExhausted(
          getBlobBackend(),
          poolKey,
          bucket,
          `quotaExceeded on ${path} with key ${keyId}`,
        );
        // Behavioral verification: ≥2 distinct pool keys exhausted for the
        // same bucket ⇒ they share quota ⇒ declared association is verified.
        try {
          const correlated = await countPoolQuotaErrors(poolKey);
          if (correlated.keys >= 2 && correlated.projectId) {
            await promoteProjectToVerified(
              correlated.projectId,
              `Correlated ${bucket}-bucket exhaustion across ${correlated.keys} keys`,
            );
          }
        } catch {
          // Verification promotion is informational only.
        }
        lastError = providerError;
        continue;
      }

      if (response.status === 401 || INVALID_KEY_REASONS.has(reason)) {
        await recordOutcome({ keyId, poolKey, projectId, operation: path, bucket, units: 0, ok: false, errorReason: reason });
        // Invalid/restricted KEY — disable it alone, never its pool.
        await disableKeyForInvalidity(keyId, `${response.status}/${reason}`);
        lastError = providerError;
        continue;
      }

      // Fail fast: malformed queries, transient provider errors, and unknown
      // failures cannot be fixed by rotating keys.
      await recordOutcome({ keyId, poolKey, projectId, operation: path, bucket, units: 0, ok: false, errorReason: reason });
      throw providerError;
    }

    // Every eligible pool/key was exhausted or disabled.
    if (lastError instanceof YouTubeProviderError) throw lastError;
    throw new YouTubeProviderError("No eligible YouTube API key available.", 503, "no_eligible_key", null);
  }

  searchList<T>(params: Record<string, QueryValue>) {
    return this.request<T>("search", params);
  }

  videosList<T>(params: Record<string, QueryValue>) {
    return this.request<T>("videos", params);
  }

  channelsList<T>(params: Record<string, QueryValue>) {
    return this.request<T>("channels", params);
  }

  playlistsList<T>(params: Record<string, QueryValue>) {
    return this.request<T>("playlists", params);
  }

  playlistItemsList<T>(params: Record<string, QueryValue>) {
    return this.request<T>("playlistItems", params);
  }
}

export function getYouTubeClient() {
  return new YouTubeApiClient();
}

/** Best-effort usage attribution; accounting failures never fail requests. */
async function recordOutcome(outcome: {
  keyId: string;
  poolKey: string;
  projectId: string | null;
  operation: string;
  bucket: "search" | "other";
  units: number;
  ok: boolean;
  errorReason: string | null;
}): Promise<void> {
  try {
    const { getBlobBackend } = await import("../../blob/backend-factory");
    await recordRequestOutcome(getBlobBackend(), outcome);
  } catch {
    // Accounting is informational; the provider result stands on its own.
  }
}

function extractProviderMessage(payload: unknown) {
  if (!payload || typeof payload !== "object" || !("error" in payload)) {
    return null;
  }

  const error = (payload as { error?: { message?: unknown } }).error;
  return typeof error?.message === "string" ? error.message : null;
}

function extractProviderReason(payload: unknown) {
  if (!payload || typeof payload !== "object" || !("error" in payload)) {
    return null;
  }

  const errors = (payload as { error?: { errors?: Array<{ reason?: unknown }> } }).error?.errors;
  const reason = errors?.[0]?.reason;
  return typeof reason === "string" ? reason : null;
}

function sanitizeProviderDetails(payload: unknown) {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const error = (payload as { error?: unknown }).error;
  return error && typeof error === "object" ? error : null;
}
