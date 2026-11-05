/**
 * ═══════════════════════════════════════════════════════════════════════════
 * YouTube Discovery — Cloudflare R2 Worker API (NEW Application Storage)
 * ──────────────────────────────────────────────────────────────────────────
 * Worker Name: new-youtube-discovery-api
 * Binding:     env.NEW_BUCKET -> R2 Bucket: new-youtube-discovery-private
 * Scope:       Active application manifests, datasets, generation parts, temp
 *
 * Security:
 *   - 100% Native Cloudflare R2 binding (Zero S3 SDK / No AWS credentials)
 *   - Strict capability tokens verified via Web Crypto HMAC-SHA256
 *   - Bounded path traversal and size checks
 *   - Scoped CORS for authorized web origins
 * ═══════════════════════════════════════════════════════════════════════════
 */

export interface Env {
  NEW_BUCKET: R2Bucket;
  WORKER_AUTH_SECRET?: string;
  ALLOWED_ORIGINS?: string;
}

export interface CapabilityClaims {
  iss: string;
  aud: string;
  sub: string;
  profile_id?: string;
  storage_owner_uuid: string;
  bucket_kind: "NEW" | "OLD";
  operation:
    | "upload"
    | "download"
    | "head"
    | "list"
    | "delete"
    | "batch_upload"
    | "batch_verify";
  key: string;
  batch_id?: string;
  allowed_keys?: string[];
  max_bytes?: number;
  content_type?: string;
  iat: number;
  exp: number;
  jti: string;
}

const WORKER_IDENTITY = "new-youtube-discovery-api";
const BUCKET_KIND = "NEW";
const DEFAULT_ALLOWED_ORIGINS = [
  "https://youtube-discovery.vercel.app",
  "http://localhost:3000",
  "http://127.0.0.1:3000",
];

/**
 * Hard storage limits for the NEW bucket.
 * - A single manifest part may never exceed 45 MiB.
 * - A whole generation batch may never exceed 200 MiB.
 * These mirror STORAGE_LIMITS in the Next.js serializer; keep both in sync.
 */
const MAX_SINGLE_OBJECT_BYTES = 45 * 1024 * 1024;
const MAX_BATCH_BYTES = 200 * 1024 * 1024;
const MAX_BATCH_ITEMS = 50;

/**
 * Only structured JSON objects belong in the NEW persistence namespace.
 * Rejecting arbitrary content types prevents the private bucket from being
 * repurposed as a general file host.
 */
const ALLOWED_JSON_CONTENT_TYPES = new Set([
  "application/json",
  "application/json; charset=utf-8",
]);

// Helper: Base64URL decode to Uint8Array
function base64UrlDecode(str: string): Uint8Array {
  let base64 = str.replace(/-/g, "+").replace(/_/g, "/");
  while (base64.length % 4) {
    base64 += "=";
  }
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

// Helper: ArrayBuffer to lowercase hex string
function bufToHex(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let hex = "";
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i].toString(16).padStart(2, "0");
  }
  return hex;
}

// Verify JWT Capability Token using native Web Crypto
async function verifyCapabilityToken(
  authHeader: string | null,
  secret: string | undefined,
  expectedOperation: CapabilityClaims["operation"],
  targetKey: string
): Promise<{ valid: true; claims: CapabilityClaims } | { valid: false; status: number; error: string }> {
  if (!secret) {
    return { valid: false, status: 500, error: "Worker authentication secret not configured on environment." };
  }
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return { valid: false, status: 401, error: "Missing or malformed Authorization header. Bearer token required." };
  }

  const token = authHeader.slice(7).trim();
  const parts = token.split(".");
  if (parts.length !== 3) {
    return { valid: false, status: 401, error: "Invalid token structure." };
  }

  const [headerB64, payloadB64, sigB64] = parts;

  try {
    // 1. Verify HMAC-SHA256 signature
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey(
      "raw",
      enc.encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["verify"]
    );

    const signedData = enc.encode(`${headerB64}.${payloadB64}`);
    const signature = base64UrlDecode(sigB64);

    const isSigValid = await crypto.subtle.verify("HMAC", key, signature, signedData);
    if (!isSigValid) {
      return { valid: false, status: 401, error: "Invalid token cryptographic signature." };
    }

    // 2. Parse and validate claims
    const payloadText = new TextDecoder().decode(base64UrlDecode(payloadB64));
    const claims = JSON.parse(payloadText) as CapabilityClaims;

    const now = Math.floor(Date.now() / 1000);

    if (claims.iss !== "youtube-discovery-web") {
      return { valid: false, status: 401, error: "Token issuer invalid." };
    }
    if (claims.aud !== WORKER_IDENTITY) {
      return { valid: false, status: 403, error: `Token audience mismatch. Expected ${WORKER_IDENTITY}, received ${claims.aud}.` };
    }
    if (claims.bucket_kind !== BUCKET_KIND) {
      return { valid: false, status: 403, error: `Token bucket_kind mismatch. Expected ${BUCKET_KIND}, received ${claims.bucket_kind}.` };
    }
    if (claims.exp <= now) {
      return { valid: false, status: 401, error: "Capability grant has expired." };
    }
    if (claims.operation !== expectedOperation) {
      return { valid: false, status: 403, error: `Unauthorized operation. Grant authorizes '${claims.operation}', request requires '${expectedOperation}'.` };
    }

    // Every NEW-bucket capability is owner-scoped. A token without an owner
    // claim must never be usable, even if it is otherwise well-signed.
    const owner = (claims.storage_owner_uuid || "").trim();
    if (!owner) {
      return { valid: false, status: 403, error: "Capability grant is missing a storage owner scope." };
    }

    // Reads may reach historical legacy owner layouts; writes may not.
    const allowLegacy =
      expectedOperation === "download" ||
      expectedOperation === "head" ||
      expectedOperation === "list";

    if (!isOwnerScopedKey(targetKey, owner, { allowLegacy })) {
      return {
        valid: false,
        status: 403,
        error: `Key '${targetKey}' is outside the authorized owner namespace for '${owner}'.`,
      };
    }

    // Key / prefix check
    if (
      expectedOperation === "list" ||
      expectedOperation === "batch_upload" ||
      expectedOperation === "batch_verify"
    ) {
      // For listing or batch upload, targetKey is the prefix filter / root; claims.key is the authorized root prefix
      if (!targetKey.startsWith(claims.key)) {
        return { valid: false, status: 403, error: `Scope '${targetKey}' outside authorized scope '${claims.key}'.` };
      }
    } else {
      if (claims.key !== targetKey) {
        return { valid: false, status: 403, error: `Requested object key '${targetKey}' does not match authorized grant key '${claims.key}'.` };
      }
    }

    return { valid: true, claims };
  } catch {
    return { valid: false, status: 401, error: "Failed to parse or verify token." };
  }
}

// Build CORS headers
function getCorsHeaders(request: Request, env: Env): Headers {
  const origin = request.headers.get("Origin") || "";
  const allowed = env.ALLOWED_ORIGINS
    ? env.ALLOWED_ORIGINS.split(",").map((s) => s.trim())
    : DEFAULT_ALLOWED_ORIGINS;

  const headers = new Headers();
  if (allowed.includes(origin)) {
    headers.set("Access-Control-Allow-Origin", origin);
  } else if (!origin) {
    headers.set("Access-Control-Allow-Origin", allowed[0]);
  }
  headers.set("Access-Control-Allow-Methods", "GET, HEAD, PUT, POST, DELETE, OPTIONS");
  headers.set("Access-Control-Allow-Headers", "Content-Type, Authorization, Range, X-Custom-Metadata");
  headers.set("Access-Control-Expose-Headers", "Content-Length, Content-Type, Content-Range, ETag");
  headers.set("Access-Control-Max-Age", "86400");
  return headers;
}

/**
 * Browser requests must originate from an explicitly allowed origin.
 * Server-to-server requests (no Origin header) remain allowed because they
 * authenticate with a capability token, not ambient cookies.
 */
function isRequestOriginAllowed(request: Request, env: Env): boolean {
  const origin = request.headers.get("Origin");
  if (!origin) return true;
  const allowed = env.ALLOWED_ORIGINS
    ? env.ALLOWED_ORIGINS.split(",").map((s) => s.trim())
    : DEFAULT_ALLOWED_ORIGINS;
  return allowed.includes(origin);
}

function jsonResponse(data: unknown, status = 200, corsHeaders: Headers): Response {
  const headers = new Headers(corsHeaders);
  headers.set("Content-Type", "application/json");
  return new Response(JSON.stringify(data), { status, headers });
}

function sanitizeKey(raw: string): string {
  // Strip leading slashes and prevent directory traversal
  const key = decodeURIComponent(raw).replace(/^\/+/, "");
  if (key.includes("..") || key.includes("\\")) {
    throw new Error("Invalid object key: path traversal not permitted.");
  }
  return key;
}

/**
 * Returns true when `key` is inside the caller's canonical owner namespace:
 *   asdy/persistence/<owner>/...
 *   asdy/temp/<owner>/...
 *
 * Legacy owner layouts (`<owner>/persistence/...`, `<owner>/temp/...`) are
 * accepted ONLY for read operations so historical objects remain accessible.
 * New writes are always canonical.
 */
function isOwnerScopedKey(
  key: string,
  owner: string,
  options: { allowLegacy: boolean }
): boolean {
  if (!owner) return false;

  const canonicalBases = [
    `asdy/persistence/${owner}`,
    `asdy/temp/${owner}`,
  ];
  for (const base of canonicalBases) {
    if (key === base || key.startsWith(`${base}/`)) return true;
  }

  if (options.allowLegacy) {
    const legacyBases = [`${owner}/persistence`, `${owner}/temp`];
    for (const base of legacyBases) {
      if (key === base || key.startsWith(`${base}/`)) return true;
    }
  }

  return false;
}

function isAllowedJsonContentType(contentType: string | undefined): boolean {
  if (!contentType) return false;
  return ALLOWED_JSON_CONTENT_TYPES.has(contentType.toLowerCase().trim());
}

function isCanonicalTempKey(key: string, owner: string): boolean {
  if (!owner) return false;
  return key.startsWith(`asdy/temp/${owner}/`);
}

/**
 * Version pointers and derived root manifests are mutable read indexes.
 * Generation manifests and parts are immutable and must never be rewritten.
 */
function isMutableIndexKey(key: string): boolean {
  if (key.includes("/generations/")) return false;
  return key.endsWith("/version.json") || key.endsWith("/manifest.json");
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const cors = getCorsHeaders(request, env);

    // Reject disallowed browser origins outright. Returning a response without
    // CORS headers is not enough: a hostile page must not be able to drive the
    // Worker even with a leaked short-lived token.
    if (!isRequestOriginAllowed(request, env)) {
      return new Response(
        JSON.stringify({ error: "Origin is not allowed to access this Worker." }),
        { status: 403, headers: { "Content-Type": "application/json" } }
      );
    }

    // Handle CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }

    const url = new URL(request.url);
    const pathname = url.pathname;

    // ─────────────────────────────────────────────────────────────
    // 1. Health & Root Inspection Endpoint
    // ─────────────────────────────────────────────────────────────
    if (pathname === "/health" || pathname === "/") {
      return jsonResponse(
        {
          ok: true,
          worker: WORKER_IDENTITY,
          bucket_kind: BUCKET_KIND,
          version: "1.0.0",
          backend: "cloudflare-r2",
          binding_configured: Boolean(env.NEW_BUCKET),
          timestamp: new Date().toISOString(),
        },
        200,
        cors
      );
    }

    // ─────────────────────────────────────────────────────────────
    // 2. Object APIs: /v1/objects/*
    // ─────────────────────────────────────────────────────────────
    const OBJECTS_PREFIX = "/v1/objects/";

    // 2A. List Objects: POST /v1/objects/list
    if (pathname === "/v1/objects/list" && request.method === "POST") {
      try {
        const body = (await request.json().catch(() => ({}))) as {
          prefix?: string;
          cursor?: string;
          limit?: number;
          delimiter?: string;
        };

        const prefix = sanitizeKey(body.prefix || "");
        const authCheck = await verifyCapabilityToken(
          request.headers.get("Authorization"),
          env.WORKER_AUTH_SECRET,
          "list",
          prefix
        );

        if (!authCheck.valid) {
          return jsonResponse({ error: authCheck.error }, authCheck.status, cors);
        }

        const limit = Math.min(Math.max(body.limit || 50, 1), 1000);
        const listed = await env.NEW_BUCKET.list({
          prefix,
          cursor: body.cursor,
          limit,
          delimiter: body.delimiter,
        });

        return jsonResponse(
          {
            ok: true,
            objects: listed.objects.map((obj) => ({
              key: obj.key,
              size: obj.size,
              etag: obj.httpEtag,
              uploaded: obj.uploaded.toISOString(),
              customMetadata: obj.customMetadata,
            })),
            truncated: listed.truncated,
            cursor: listed.cursor,
            delimitedPrefixes: listed.delimitedPrefixes,
          },
          200,
          cors
        );
      } catch (err) {
        return jsonResponse({ error: err instanceof Error ? err.message : "List operation failed." }, 400, cors);
      }
    }

    // 2B. Grouped Batch Upload: POST /v1/batches/upload
    // Executes atomic upload of multiple dataset objects (manifest + parts + version pointer)
    if (pathname === "/v1/batches/upload" && request.method === "POST") {
      try {
        const body = (await request.json()) as {
          batchId: string;
          datasetType?: string;
          targetPrefix?: string;
          items: Array<{
            key: string;
            content: string;
            isBase64?: boolean;
            contentType?: string;
            sha256: string;
          }>;
        };

        if (
          !body.batchId ||
          typeof body.batchId !== "string" ||
          !/^[A-Za-z0-9._:-]{1,128}$/.test(body.batchId)
        ) {
          return jsonResponse(
            { error: "Missing or invalid batchId. Expected 1-128 safe characters." },
            400,
            cors
          );
        }

        if (!Array.isArray(body.items) || body.items.length === 0) {
          return jsonResponse(
            { error: "Missing required field: non-empty items array." },
            400,
            cors
          );
        }

        if (body.items.length > MAX_BATCH_ITEMS) {
          return jsonResponse(
            { error: `Batch item count (${body.items.length}) exceeds maximum limit of ${MAX_BATCH_ITEMS} items per batch.` },
            400,
            cors
          );
        }

        const targetPrefix = sanitizeKey(
          body.targetPrefix || body.items[0].key.split("/").slice(0, 3).join("/")
        );

        const authCheck = await verifyCapabilityToken(
          request.headers.get("Authorization"),
          env.WORKER_AUTH_SECRET,
          "batch_upload",
          targetPrefix
        );

        if (!authCheck.valid) {
          return jsonResponse({ error: authCheck.error }, authCheck.status, cors);
        }

        const owner = authCheck.claims.storage_owner_uuid;
        const receipts: Array<{
          key: string;
          size: number;
          etag: string;
          sha256: string;
          uploaded: string;
        }> = [];

        // Reject duplicate keys before writing anything. A duplicate would
        // make the batch non-deterministic and could mask a path-builder bug.
        const seenKeys = new Set<string>();
        let totalBytes = 0;

        for (const item of body.items) {
          const key = sanitizeKey(item.key);

          if (seenKeys.has(key)) {
            return jsonResponse(
              { error: `Duplicate object key '${key}' in batch.` },
              409,
              cors
            );
          }
          seenKeys.add(key);

          // Verify key is in authorized scope
          if (!key.startsWith(authCheck.claims.key)) {
            return jsonResponse(
              { error: `Item key '${key}' outside authorized prefix '${authCheck.claims.key}'.` },
              403,
              cors
            );
          }

          if (authCheck.claims.allowed_keys && !authCheck.claims.allowed_keys.includes(key)) {
            return jsonResponse(
              { error: `Item key '${key}' not in token's allowed_keys list.` },
              403,
              cors
            );
          }

          // Writes must use the canonical owner namespace. Legacy layouts are
          // read-only compatibility paths.
          if (!isOwnerScopedKey(key, owner, { allowLegacy: false })) {
            return jsonResponse(
              { error: `Item key '${key}' is outside the canonical owner namespace.` },
              403,
              cors
            );
          }

          const contentType = item.contentType || "application/json";
          if (!isAllowedJsonContentType(contentType)) {
            return jsonResponse(
              { error: `Unsupported content type '${contentType}'. Only application/json is accepted in persistence batches.` },
              415,
              cors
            );
          }

          // Decode data
          let bytes: Uint8Array;
          if (item.isBase64) {
            bytes = base64UrlDecode(item.content);
          } else {
            bytes = new TextEncoder().encode(item.content);
          }

          if (bytes.byteLength > MAX_SINGLE_OBJECT_BYTES) {
            return jsonResponse(
              { error: `Object '${key}' is ${bytes.byteLength} bytes, exceeding the ${MAX_SINGLE_OBJECT_BYTES} byte per-object limit.` },
              413,
              cors
            );
          }

          totalBytes += bytes.byteLength;
          if (totalBytes > MAX_BATCH_BYTES) {
            return jsonResponse(
              { error: `Batch exceeds the ${MAX_BATCH_BYTES} byte total limit.` },
              413,
              cors
            );
          }

          // Verify SHA-256 integrity
          const digest = await crypto.subtle.digest("SHA-256", bytes);
          const computedHex = bufToHex(digest);

          if (computedHex.toLowerCase() !== item.sha256.toLowerCase()) {
            return jsonResponse(
              {
                error: `SHA-256 integrity mismatch for key '${key}'. Computed ${computedHex}, expected ${item.sha256}.`,
              },
              400,
              cors
            );
          }

          // Idempotency: an identical existing object is accepted without a
          // rewrite. A different object at the same immutable key is a hard
          // conflict; generation objects must never be silently replaced.
          const existing = await env.NEW_BUCKET.head(key);
          if (existing) {
            const existingSha = existing.customMetadata?.sha256?.toLowerCase();
            if (existingSha === computedHex) {
              receipts.push({
                key,
                size: existing.size,
                etag: existing.httpEtag,
                sha256: computedHex,
                uploaded: existing.uploaded.toISOString(),
              });
              continue;
            }
            return jsonResponse(
              {
                error: `Immutable object '${key}' already exists with different content. Refusing to overwrite a committed generation object.`,
              },
              409,
              cors
            );
          }

          const uploadedObj = await env.NEW_BUCKET.put(key, bytes, {
            httpMetadata: { contentType },
            customMetadata: {
              storage_owner_uuid: owner,
              batch_id: body.batchId,
              dataset_type: body.datasetType || "",
              sha256: computedHex,
              uploaded_at: new Date().toISOString(),
            },
          });

          receipts.push({
            key: uploadedObj.key,
            size: uploadedObj.size,
            etag: uploadedObj.httpEtag,
            sha256: computedHex,
            uploaded: uploadedObj.uploaded.toISOString(),
          });
        }

        return jsonResponse(
          {
            ok: true,
            batchId: body.batchId,
            uploadedCount: receipts.length,
            receipts,
          },
          200,
          cors
        );
      } catch (err) {
        return jsonResponse(
          { error: err instanceof Error ? err.message : "Batch upload failed." },
          400,
          cors
        );
      }
    }

    // 2B-2. Batch Verification: POST /v1/batches/verify
    // Reads every object back, recomputes SHA-256 and compares size. This is
    // the server-side gate that lets the Next.js route commit PostgreSQL only
    // after immutable storage is proven to match what it intends to register.
    if (pathname === "/v1/batches/verify" && request.method === "POST") {
      try {
        const body = (await request.json()) as {
          batchId: string;
          targetPrefix?: string;
          items: Array<{
            key: string;
            sha256: string;
            byteCount?: number;
          }>;
        };

        if (
          !body.batchId ||
          typeof body.batchId !== "string" ||
          !/^[A-Za-z0-9._:-]{1,128}$/.test(body.batchId)
        ) {
          return jsonResponse(
            { error: "Missing or invalid batchId. Expected 1-128 safe characters." },
            400,
            cors
          );
        }

        if (!Array.isArray(body.items) || body.items.length === 0) {
          return jsonResponse(
            { error: "Missing required field: non-empty items array." },
            400,
            cors
          );
        }

        if (body.items.length > MAX_BATCH_ITEMS) {
          return jsonResponse(
            { error: `Batch item count (${body.items.length}) exceeds maximum limit of ${MAX_BATCH_ITEMS}.` },
            400,
            cors
          );
        }

        const targetPrefix = sanitizeKey(
          body.targetPrefix || body.items[0].key.split("/").slice(0, 3).join("/")
        );

        const authCheck = await verifyCapabilityToken(
          request.headers.get("Authorization"),
          env.WORKER_AUTH_SECRET,
          "batch_verify",
          targetPrefix
        );

        if (!authCheck.valid) {
          return jsonResponse({ error: authCheck.error }, authCheck.status, cors);
        }

        const owner = authCheck.claims.storage_owner_uuid;
        const verified: Array<{ key: string; size: number; sha256: string }> = [];
        const failures: Array<{
          key: string;
          reason: string;
          expectedSha256?: string;
          actualSha256?: string;
          expectedBytes?: number;
          actualBytes?: number;
        }> = [];

        const seenKeys = new Set<string>();
        let totalBytes = 0;

        for (const item of body.items) {
          const key = sanitizeKey(item.key);

          if (seenKeys.has(key)) {
            failures.push({ key, reason: "duplicate_key_in_batch" });
            continue;
          }
          seenKeys.add(key);

          if (!key.startsWith(authCheck.claims.key)) {
            failures.push({ key, reason: "outside_authorized_prefix" });
            continue;
          }
          if (authCheck.claims.allowed_keys && !authCheck.claims.allowed_keys.includes(key)) {
            failures.push({ key, reason: "not_in_allowed_keys" });
            continue;
          }
          if (!isOwnerScopedKey(key, owner, { allowLegacy: true })) {
            failures.push({ key, reason: "outside_owner_namespace" });
            continue;
          }

          const head = await env.NEW_BUCKET.head(key);
          if (!head) {
            failures.push({ key, reason: "object_not_found", expectedSha256: item.sha256 });
            continue;
          }

          if (typeof item.byteCount === "number" && head.size !== item.byteCount) {
            failures.push({
              key,
              reason: "size_mismatch",
              expectedBytes: item.byteCount,
              actualBytes: head.size,
            });
            continue;
          }

          totalBytes += head.size;
          if (totalBytes > MAX_BATCH_BYTES) {
            failures.push({ key, reason: "batch_size_limit_exceeded" });
            break;
          }

          const obj = await env.NEW_BUCKET.get(key);
          if (!obj) {
            failures.push({ key, reason: "object_not_readable" });
            continue;
          }

          const bytes = new Uint8Array(await obj.arrayBuffer());
          const digest = await crypto.subtle.digest("SHA-256", bytes);
          const actualSha256 = bufToHex(digest);

          if (actualSha256.toLowerCase() !== item.sha256.toLowerCase()) {
            failures.push({
              key,
              reason: "sha256_mismatch",
              expectedSha256: item.sha256,
              actualSha256,
              actualBytes: bytes.byteLength,
            });
            continue;
          }

          verified.push({ key, size: bytes.byteLength, sha256: actualSha256 });
        }

        return jsonResponse(
          {
            ok: failures.length === 0,
            batchId: body.batchId,
            verifiedCount: verified.length,
            failedCount: failures.length,
            failures,
            verified,
          },
          failures.length === 0 ? 200 : 409,
          cors
        );
      } catch (err) {
        return jsonResponse(
          { error: err instanceof Error ? err.message : "Batch verification failed." },
          400,
          cors
        );
      }
    }

    // 2C. Single Object Operations on /v1/objects/<key>
    if (pathname.startsWith(OBJECTS_PREFIX)) {
      const rawKey = pathname.slice(OBJECTS_PREFIX.length);
      let key: string;
      try {
        key = sanitizeKey(rawKey);
      } catch (err) {
        return jsonResponse({ error: err instanceof Error ? err.message : "Invalid key." }, 400, cors);
      }

      if (!key) {
        return jsonResponse({ error: "Missing object key." }, 400, cors);
      }

      // ─── PUT /v1/objects/<key> (Upload) ───
      if (request.method === "PUT") {
        const authCheck = await verifyCapabilityToken(
          request.headers.get("Authorization"),
          env.WORKER_AUTH_SECRET,
          "upload",
          key
        );

        if (!authCheck.valid) {
          return jsonResponse({ error: authCheck.error }, authCheck.status, cors);
        }

        // Validate content length limit from claims
        const contentLength = Number(request.headers.get("Content-Length") || 0);
        if (authCheck.claims.max_bytes && contentLength > authCheck.claims.max_bytes) {
          return jsonResponse(
            { error: `Payload length (${contentLength} bytes) exceeds authorized maximum (${authCheck.claims.max_bytes} bytes).` },
            413,
            cors
          );
        }
        if (contentLength > MAX_SINGLE_OBJECT_BYTES) {
          return jsonResponse(
            { error: `Payload length (${contentLength} bytes) exceeds the ${MAX_SINGLE_OBJECT_BYTES} byte object limit.` },
            413,
            cors
          );
        }

        const contentType = request.headers.get("Content-Type") || authCheck.claims.content_type || "application/octet-stream";
        if (!isAllowedJsonContentType(contentType)) {
          return jsonResponse(
            { error: `Unsupported content type '${contentType}'. Only application/json is accepted.` },
            415,
            cors
          );
        }

        // Buffer the body so size and SHA-256 are verified before any write.
        const requestBytes = new Uint8Array(await request.arrayBuffer());
        if (requestBytes.byteLength > MAX_SINGLE_OBJECT_BYTES) {
          return jsonResponse(
            { error: `Payload is ${requestBytes.byteLength} bytes, exceeding the ${MAX_SINGLE_OBJECT_BYTES} byte object limit.` },
            413,
            cors
          );
        }

        const digest = await crypto.subtle.digest("SHA-256", requestBytes);
        const computedHex = bufToHex(digest);

        // Immutable generation objects are write-once. Re-uploading identical
        // content is idempotent; different content is a hard conflict.
        const existing = await env.NEW_BUCKET.head(key);
        if (existing && !isMutableIndexKey(key)) {
          const existingSha = existing.customMetadata?.sha256?.toLowerCase();
          if (existingSha === computedHex) {
            return jsonResponse(
              {
                ok: true,
                key,
                size: existing.size,
                etag: existing.httpEtag,
                uploaded: existing.uploaded.toISOString(),
                idempotent: true,
              },
              200,
              cors
            );
          }
          return jsonResponse(
            { error: `Immutable object '${key}' already exists with different content.` },
            409,
            cors
          );
        }

        const customMetadata: Record<string, string> = {
          storage_owner_uuid: authCheck.claims.storage_owner_uuid,
          sha256: computedHex,
          uploaded_at: new Date().toISOString(),
        };

        const uploadedObj = await env.NEW_BUCKET.put(key, requestBytes, {
          httpMetadata: { contentType },
          customMetadata,
        });

        return jsonResponse(
          {
            ok: true,
            key: uploadedObj.key,
            size: uploadedObj.size,
            etag: uploadedObj.httpEtag,
            version: uploadedObj.version,
            uploaded: uploadedObj.uploaded.toISOString(),
            sha256: computedHex,
          },
          200,
          cors
        );
      }

      // ─── GET /v1/objects/<key> (Download) ───
      if (request.method === "GET") {
        const authCheck = await verifyCapabilityToken(
          request.headers.get("Authorization"),
          env.WORKER_AUTH_SECRET,
          "download",
          key
        );

        if (!authCheck.valid) {
          return jsonResponse({ error: authCheck.error }, authCheck.status, cors);
        }

        const obj = await env.NEW_BUCKET.get(key, {
          range: request.headers,
          onlyIf: request.headers,
        });

        if (!obj) {
          return jsonResponse({ error: `Object not found: ${key}` }, 404, cors);
        }

        const headers = new Headers(cors);
        obj.writeHttpMetadata(headers);
        headers.set("ETag", obj.httpEtag);
        headers.set("Cache-Control", "private, no-store");
        if (!headers.has("Content-Type")) {
          headers.set("Content-Type", "application/octet-stream");
        }
        if (obj.size !== undefined) {
          headers.set("Content-Length", String(obj.size));
        }

        return new Response(obj.body, { headers, status: 200 });
      }

      // ─── HEAD /v1/objects/<key> (Metadata) ───
      if (request.method === "HEAD") {
        const authCheck = await verifyCapabilityToken(
          request.headers.get("Authorization"),
          env.WORKER_AUTH_SECRET,
          "head",
          key
        );

        if (!authCheck.valid) {
          return new Response(null, { status: authCheck.status, headers: cors });
        }

        const headObj = await env.NEW_BUCKET.head(key);
        if (!headObj) {
          return new Response(null, { status: 404, headers: cors });
        }

        const headers = new Headers(cors);
        headObj.writeHttpMetadata(headers);
        headers.set("ETag", headObj.httpEtag);
        headers.set("Content-Length", String(headObj.size));
        headers.set("Cache-Control", "private, no-store");
        return new Response(null, { status: 200, headers });
      }

      // ─── DELETE /v1/objects/<key> (Delete uncommitted temp objects only) ───
      if (request.method === "DELETE") {
        const authCheck = await verifyCapabilityToken(
          request.headers.get("Authorization"),
          env.WORKER_AUTH_SECRET,
          "delete",
          key
        );

        if (!authCheck.valid) {
          return jsonResponse({ error: authCheck.error }, authCheck.status, cors);
        }

        // Safety enforcement: only disposable temp objects inside the caller's
        // own canonical namespace may be deleted. Committed generation parts,
        // manifests, and version pointers can NEVER be deleted via REST.
        const deleteOwner = authCheck.claims.storage_owner_uuid;
        if (!isCanonicalTempKey(key, deleteOwner)) {
          return jsonResponse(
            { error: "Only temporary objects under asdy/temp/<owner>/ may be deleted via Worker API." },
            403,
            cors
          );
        }

        await env.NEW_BUCKET.delete(key);
        return jsonResponse({ ok: true, deleted: true, key }, 200, cors);
      }
    }

    return jsonResponse({ error: "Method not allowed or route not found." }, 404, cors);
  },
};
