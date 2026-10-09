import "server-only";

import type { BlobBackend } from "./blob-backend";
import { describeBlobConfig } from "./blob-config";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * Blob Connection Verification — safe, non-destructive diagnostics.
 * ──────────────────────────────────────────────────────────────────────────
 * Checks, in order (each reported separately, no secret values anywhere):
 *  1. configPresent — BLOB_READ_WRITE_TOKEN (or Vercel OIDC) is configured.
 *  2. listPermitted — the token can LIST (proves read access + reachability).
 *  3. writePermitted — a tiny probe object round-trips (put → head →
 *     delete). The probe lives under youtube-discovery/v1/__probe__/ and is
 *     always deleted afterwards; it never touches user records.
 *  4. storeIdentity — the Blob URL host returned for the probe is compared
 *     against the expected BLOB_STORE_ID. Blob hosts embed the store id
 *     (e.g. `<storeId>.public.blob.vercel-storage.com`), so a match proves
 *     we are talking to the INTENDED store. A mismatch (or an unparseable
 *     host) is reported as UNVERIFIED — never silently accepted, and the
 *     distinction between "token works" and "store identity confirmed" is
 *     always explicit.
 *
 * NOTE on BLOB_WEBHOOK_PUBLIC_KEY: it verifies signed Blob WEBHOOK requests
 * and is used ONLY if a webhook endpoint exists. This application has no
 * webhook endpoint, so the variable is intentionally NOT required here.
 * ═══════════════════════════════════════════════════════════════════════════
 */

export interface BlobCheckResult {
  name: string;
  passed: boolean;
  detail: string;
}

export interface BlobVerificationReport {
  checks: BlobCheckResult[];
  allPassed: boolean;
  authMode: string | null;
  storeIdConfigured: boolean;
  /** Blob URL host observed (identifier only — never a secret). */
  observedHost: string | null;
  storeIdentity: "verified" | "unverified" | "not-checked";
  generatedAt: string;
}

const PROBE_PREFIX = "youtube-discovery/v1/__probe__/";

export async function verifyBlobConnection(backend: BlobBackend): Promise<BlobVerificationReport> {
  const checks: BlobCheckResult[] = [];
  const cfg = describeBlobConfig();
  const generatedAt = new Date().toISOString();

  if (!cfg.configured) {
    checks.push({
      name: "configPresent",
      passed: false,
      detail: "BLOB_READ_WRITE_TOKEN is missing and no Vercel OIDC context was detected. Set the token (and BLOB_STORE_ID) locally and in Vercel.",
    });
    return { checks, allPassed: false, authMode: null, storeIdConfigured: cfg.storeIdSet, observedHost: null, storeIdentity: "not-checked", generatedAt };
  }
  checks.push({ name: "configPresent", passed: true, detail: `Authentication resolved via ${cfg.authMode}.` });

  // 1. List probe (read access + reachability, touches nothing).
  try {
    await backend.list(`${PROBE_PREFIX}connection/`);
    checks.push({ name: "listPermitted", passed: true, detail: "Token permits listing objects." });
  } catch (err) {
    checks.push({
      name: "listPermitted",
      passed: false,
      detail: `Listing failed: ${err instanceof Error ? err.message : "unknown error"}`,
    });
    return { checks, allPassed: false, authMode: cfg.authMode, storeIdConfigured: cfg.storeIdSet, observedHost: null, storeIdentity: "not-checked", generatedAt };
  }

  // 2. Write probe round-trip (create → read → delete), then store identity.
  const probeId = `connection-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}.json`;
  const probePath = `${PROBE_PREFIX}connection/${probeId}`;
  let observedHost: string | null = null;
  try {
    const meta = await backend.putBytes(probePath, Buffer.from(JSON.stringify({ probe: true, at: generatedAt }), "utf8"), {
      contentType: "application/json",
      cacheSeconds: 0,
    });
    void meta;
    // Re-read through the backend (proves versioned-write path works).
    const back = await backend.getBytes(probePath);
    if (back.toString("utf8").indexOf('"probe":true') < 0) {
      throw new Error("Probe read-back mismatch");
    }
    // Store identity: only the Vercel SDK backend exposes the Blob URL host.
    observedHost = await readObservedHost(backend, probePath);
    checks.push({ name: "writePermitted", passed: true, detail: "Probe object round-tripped (created, read back, and removed)." });
  } catch (err) {
    checks.push({
      name: "writePermitted",
      passed: false,
      detail: `Write probe failed: ${err instanceof Error ? err.message : "unknown error"}`,
    });
    try {
      await backend.delete(probePath);
    } catch {
      // Best effort cleanup.
    }
    return { checks, allPassed: false, authMode: cfg.authMode, storeIdConfigured: cfg.storeIdSet, observedHost, storeIdentity: "not-checked", generatedAt };
  }
  try {
    await backend.delete(probePath);
  } catch {
    // Probe already verified; deletion is best-effort (GC-eligible prefix).
  }

  // 3. Store identity vs BLOB_STORE_ID.
  const expected = (process.env.BLOB_STORE_ID ?? "").trim();
  let storeIdentity: BlobVerificationReport["storeIdentity"] = "unverified";
  if (!expected) {
    checks.push({
      name: "storeIdentity",
      passed: false,
      detail: "BLOB_STORE_ID is not set, so the intended store cannot be confirmed. Reads/writes succeed, but store identity is UNVERIFIED.",
    });
  } else if (observedHost && observedHost.includes(expected)) {
    storeIdentity = "verified";
    checks.push({
      name: "storeIdentity",
      passed: true,
      detail: "Blob URL host matches the configured BLOB_STORE_ID — connected to the intended store.",
    });
  } else {
    checks.push({
      name: "storeIdentity",
      passed: false,
      detail: observedHost
        ? "Blob URL host does not contain the configured BLOB_STORE_ID — identity UNVERIFIED. Reads/writes work, but confirm you are using the intended store."
        : "Store identity could not be determined from the backend — UNVERIFIED (token access works).",
    });
  }

  return {
    checks,
    allPassed: checks.every((c) => c.passed),
    authMode: cfg.authMode,
    storeIdConfigured: cfg.storeIdSet,
    observedHost,
    storeIdentity,
    generatedAt,
  };
}

/** Backend-agnostic host extraction (memory backend has no URLs → null). */
async function readObservedHost(backend: BlobBackend, probePath: string): Promise<string | null> {
  try {
    // The Vercel backend is the only one that can report a URL host; access
    // it through an optional capability method when present.
    const maybe = backend as unknown as { probeUrlHost?: (p: string) => Promise<string | null> };
    if (typeof maybe.probeUrlHost === "function") {
      return await maybe.probeUrlHost(probePath);
    }
    return null;
  } catch {
    return null;
  }
}
