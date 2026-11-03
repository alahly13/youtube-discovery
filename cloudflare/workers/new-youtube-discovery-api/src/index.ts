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
  operation: "upload" | "download" | "head" | "list" | "delete";
  key: string;
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

    // Key / prefix check
    if (expectedOperation === "list") {
      // For listing, targetKey is the prefix filter; claims.key is the authorized root prefix
      if (!targetKey.startsWith(claims.key)) {
        return { valid: false, status: 403, error: `List prefix '${targetKey}' outside authorized scope '${claims.key}'.` };
      }
    } else {
      if (claims.key !== targetKey) {
        return { valid: false, status: 403, error: `Requested object key '${targetKey}' does not match authorized grant key '${claims.key}'.` };
      }
    }

    return { valid: true, claims };
  } catch (err) {
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

function jsonResponse(data: unknown, status = 200, corsHeaders: Headers): Response {
  const headers = new Headers(corsHeaders);
  headers.set("Content-Type", "application/json");
  return new Response(JSON.stringify(data), { status, headers });
}

function sanitizeKey(raw: string): string {
  // Strip leading slashes and prevent directory traversal
  let key = decodeURIComponent(raw).replace(/^\/+/, "");
  if (key.includes("..") || key.includes("\\")) {
    throw new Error("Invalid object key: path traversal not permitted.");
  }
  return key;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const cors = getCorsHeaders(request, env);

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

    // 2B. Single Object Operations on /v1/objects/<key>
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

        const contentType = request.headers.get("Content-Type") || authCheck.claims.content_type || "application/octet-stream";

        const customMetadata: Record<string, string> = {
          storage_owner_uuid: authCheck.claims.storage_owner_uuid,
          uploaded_at: new Date().toISOString(),
        };

        const uploadedObj = await env.NEW_BUCKET.put(key, request.body, {
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

        // Safety enforcement: Permanent generation parts and committed manifests can NEVER be deleted via REST
        if (!key.includes("/temp/")) {
          return jsonResponse(
            { error: "Permanent committed generation parts cannot be deleted via Worker API. Only temporary objects are eligible." },
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
