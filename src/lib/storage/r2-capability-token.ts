import "server-only";

import crypto from "node:crypto";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * YouTube Discovery — Cloudflare R2 Worker Capability Token Generator
 * ──────────────────────────────────────────────────────────────────────────
 * Scope: Server-side cryptographic token signer for Cloudflare R2 Workers.
 *
 * Security:
 *   - Issues short-lived (60–120s) HMAC-SHA256 JWT tokens.
 *   - Strictly scoped to a single operation (upload, download, head, list, delete).
 *   - Strictly scoped to a specific object key or list prefix.
 *   - Audience validation ('new-youtube-discovery-api' vs 'old-youtube-discovery-api').
 *   - Never exposes secret keys to clients or browser.
 * ═══════════════════════════════════════════════════════════════════════════
 */

export type R2BucketKind = "NEW" | "OLD";
export type R2Operation =
  | "upload"
  | "download"
  | "head"
  | "list"
  | "delete"
  | "batch_upload";

export interface CapabilityClaims {
  iss: "youtube-discovery-web";
  aud: "new-youtube-discovery-api" | "old-youtube-discovery-api";
  sub: string;
  profile_id?: string;
  storage_owner_uuid: string;
  bucket_kind: R2BucketKind;
  operation: R2Operation;
  key: string;
  batch_id?: string;
  allowed_keys?: string[];
  max_bytes?: number;
  content_type?: string;
  iat: number;
  exp: number;
  jti: string;
}

export interface CapabilitySignOptions {
  bucketKind: R2BucketKind;
  operation: R2Operation;
  key: string;
  batchId?: string;
  allowedKeys?: string[];
  storageOwnerUuid?: string;
  profileId?: string;
  subject?: string;
  maxBytes?: number;
  contentType?: string;
  ttlSeconds?: number;
}

const DEFAULT_TTL_SECONDS = 120; // 2 minutes

function base64UrlEncode(data: Buffer | string): string {
  const buf = typeof data === "string" ? Buffer.from(data, "utf8") : data;
  return buf
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function base64UrlDecode(str: string): Buffer {
  let base64 = str.replace(/-/g, "+").replace(/_/g, "/");
  while (base64.length % 4) {
    base64 += "=";
  }
  return Buffer.from(base64, "base64");
}

/**
 * Resolves the authentication secret for the target worker.
 */
export function getWorkerAuthSecret(bucketKind: R2BucketKind): string {
  if (bucketKind === "NEW") {
    const secret =
      process.env.R2_NEW_WORKER_AUTH_SECRET ||
      process.env.WORKER_AUTH_SECRET ||
      process.env.R2_WORKER_AUTH_SECRET;
    if (!secret) {
      throw new Error(
        "Missing R2_NEW_WORKER_AUTH_SECRET or WORKER_AUTH_SECRET in environment."
      );
    }
    return secret;
  } else {
    const secret =
      process.env.R2_OLD_WORKER_AUTH_SECRET ||
      process.env.WORKER_AUTH_SECRET ||
      process.env.R2_WORKER_AUTH_SECRET;
    if (!secret) {
      throw new Error(
        "Missing R2_OLD_WORKER_AUTH_SECRET or WORKER_AUTH_SECRET in environment."
      );
    }
    return secret;
  }
}

/**
 * Signs a short-lived capability grant token for Worker authorization.
 */
export function signCapabilityToken(
  options: CapabilitySignOptions,
  customSecret?: string
): string {
  const secret = customSecret || getWorkerAuthSecret(options.bucketKind);
  const now = Math.floor(Date.now() / 1000);
  const ttl = options.ttlSeconds || DEFAULT_TTL_SECONDS;

  const audience =
    options.bucketKind === "NEW"
      ? ("new-youtube-discovery-api" as const)
      : ("old-youtube-discovery-api" as const);

  // Normalize key: strip leading slashes
  const cleanKey = options.key.replace(/^\/+/, "");

  const header = {
    alg: "HS256",
    typ: "JWT",
  };

  const claims: CapabilityClaims = {
    iss: "youtube-discovery-web",
    aud: audience,
    sub: options.subject || "admin-session",
    storage_owner_uuid: options.storageOwnerUuid || "asdy-admin",
    bucket_kind: options.bucketKind,
    operation: options.operation,
    key: cleanKey,
    iat: now,
    exp: now + ttl,
    jti: crypto.randomUUID(),
  };

  if (options.profileId) claims.profile_id = options.profileId;
  if (options.batchId) claims.batch_id = options.batchId;
  if (options.allowedKeys) claims.allowed_keys = options.allowedKeys;
  if (options.maxBytes !== undefined) claims.max_bytes = options.maxBytes;
  if (options.contentType) claims.content_type = options.contentType;

  const headerB64 = base64UrlEncode(JSON.stringify(header));
  const payloadB64 = base64UrlEncode(JSON.stringify(claims));
  const dataToSign = `${headerB64}.${payloadB64}`;

  const signature = crypto
    .createHmac("sha256", secret)
    .update(dataToSign)
    .digest();

  const signatureB64 = base64UrlEncode(signature);

  return `${dataToSign}.${signatureB64}`;
}

/**
 * Validates a capability grant token (local / test utility).
 */
export function verifyCapabilityTokenLocally(
  token: string,
  secret: string,
  expectedOperation?: R2Operation,
  expectedKey?: string
): { valid: true; claims: CapabilityClaims } | { valid: false; error: string } {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) {
      return { valid: false, error: "Invalid token structure." };
    }

    const [headerB64, payloadB64, sigB64] = parts;
    const dataToSign = `${headerB64}.${payloadB64}`;

    const expectedSig = crypto
      .createHmac("sha256", secret)
      .update(dataToSign)
      .digest();

    const actualSig = base64UrlDecode(sigB64);
    if (
      expectedSig.length !== actualSig.length ||
      !crypto.timingSafeEqual(expectedSig, actualSig)
    ) {
      return { valid: false, error: "Cryptographic signature mismatch." };
    }

    const claims = JSON.parse(
      base64UrlDecode(payloadB64).toString("utf8")
    ) as CapabilityClaims;

    const now = Math.floor(Date.now() / 1000);
    if (claims.exp <= now) {
      return { valid: false, error: "Token has expired." };
    }

    if (expectedOperation && claims.operation !== expectedOperation) {
      return {
        valid: false,
        error: `Operation mismatch. Expected ${expectedOperation}, got ${claims.operation}.`,
      };
    }

    if (expectedKey) {
      const cleanExpected = expectedKey.replace(/^\/+/, "");
      if (expectedOperation === "list" || expectedOperation === "batch_upload") {
        if (!cleanExpected.startsWith(claims.key)) {
          return {
            valid: false,
            error: `Prefix ${cleanExpected} outside authorized scope ${claims.key}.`,
          };
        }
      } else {
        if (claims.key !== cleanExpected) {
          return {
            valid: false,
            error: `Key mismatch. Expected ${cleanExpected}, got ${claims.key}.`,
          };
        }
      }
    }

    return { valid: true, claims };
  } catch (err) {
    return {
      valid: false,
      error: err instanceof Error ? err.message : "Verification failed.",
    };
  }
}
