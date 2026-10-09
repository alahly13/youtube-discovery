/**
 * ═══════════════════════════════════════════════════════════════════════════
 * Blob Path Layout — versioned, predictable, ID-addressable.
 * ──────────────────────────────────────────────────────────────────────────
 * ALL application records live under `youtube-discovery/v1/`. The UI and all
 * server code address records by stable application-level IDs — never by
 * random Blob URLs. Every pathname below uses PRIVATE blob objects only.
 *
 * Layout:
 *   youtube-discovery/v1/playlists/records/<playlistId>.json      (small)
 *   youtube-discovery/v1/playlists/records/<playlistId>/manifest.json (+ chunks/<gen>/<nnnn>.bin)
 *   youtube-discovery/v1/playlists/index.json                     (lightweight)
 *   youtube-discovery/v1/saved-history/records/<searchId>[.json|/manifest.json]
 *   youtube-discovery/v1/saved-history/index.json
 *   youtube-discovery/v1/api-keys/state.json                      (AES-256-GCM encrypted)
 *   youtube-discovery/v1/admin/account.json                       (auth exception: hash only)
 *   youtube-discovery/v1/admin/sessions/<sessionId>.json
 *   youtube-discovery/v1/admin/ratelimit/<ipHash>.json
 *   youtube-discovery/v1/staging/<uploadId>/chunk-<nnnn>.bin      (uncommitted uploads)
 *   youtube-discovery/v1/staging/<uploadId>.session.json
 * ═══════════════════════════════════════════════════════════════════════════
 */

export const BLOB_ROOT = "youtube-discovery/v1";

export const BLOB_NAMESPACES = {
  playlists: `${BLOB_ROOT}/playlists`,
  savedHistory: `${BLOB_ROOT}/saved-history`,
  apiKeys: `${BLOB_ROOT}/api-keys`,
  admin: `${BLOB_ROOT}/admin`,
  staging: `${BLOB_ROOT}/staging`,
} as const;

export type BlobNamespace = keyof typeof BLOB_NAMESPACES;

export function namespaceRoot(namespace: BlobNamespace): string {
  return BLOB_NAMESPACES[namespace];
}

export function indexPathname(namespace: BlobNamespace): string {
  return `${BLOB_NAMESPACES[namespace]}/index.json`;
}

/** Direct (unchunked) single-object record pathname. */
export function recordPathname(namespace: BlobNamespace, recordId: string): string {
  return `${BLOB_NAMESPACES[namespace]}/records/${sanitizeId(recordId)}.json`;
}

/** Chunked record directory for one logical record. */
export function chunkedRecordDir(namespace: BlobNamespace, recordId: string): string {
  return `${BLOB_NAMESPACES[namespace]}/records/${sanitizeId(recordId)}`;
}

export function chunkManifestPathname(namespace: BlobNamespace, recordId: string): string {
  return `${chunkedRecordDir(namespace, recordId)}/manifest.json`;
}

export function chunkPathname(
  namespace: BlobNamespace,
  recordId: string,
  generationId: string,
  chunkIndex: number,
): string {
  return `${chunkedRecordDir(namespace, recordId)}/chunks/${sanitizeId(generationId)}/${String(chunkIndex).padStart(4, "0")}.bin`;
}

export const ADMIN_ACCOUNT_PATHNAME = `${BLOB_ROOT}/admin/account.json`;

export function adminSessionPathname(sessionId: string): string {
  return `${BLOB_ROOT}/admin/sessions/${sanitizeId(sessionId)}.json`;
}

export function rateLimitPathname(ipHash: string): string {
  return `${BLOB_ROOT}/admin/ratelimit/${sanitizeId(ipHash)}.json`;
}

export const API_KEYS_STATE_PATHNAME = `${BLOB_ROOT}/api-keys/state.json`;

export function stagingSessionPathname(uploadId: string): string {
  return `${BLOB_ROOT}/staging/${sanitizeId(uploadId)}.session.json`;
}

export function stagingChunkPathname(uploadId: string, chunkIndex: number): string {
  return `${BLOB_ROOT}/staging/${sanitizeId(uploadId)}/chunk-${String(chunkIndex).padStart(4, "0")}.bin`;
}

/** IDs become single path segments: no slashes, no traversal, bounded length. */
export function sanitizeId(id: string): string {
  const clean = id.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 128);
  if (!clean || clean === "." || clean === "..") {
    throw new Error("Invalid record identifier");
  }
  return clean;
}
