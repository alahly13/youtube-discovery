# new-youtube-discovery-api

Dedicated Cloudflare Worker managing active application data, manifests, dataset generations, and temporary objects in the private R2 bucket `new-youtube-discovery-private`.

The Worker is the only write path to the NEW bucket. The Next.js server authenticates users, resolves the canonical storage owner, signs short-lived capability tokens, and calls this Worker. The Worker never trusts client-supplied ownership.

## Configuration

- **Worker Name:** `new-youtube-discovery-api`
- **R2 Binding:** `env.NEW_BUCKET` -> `new-youtube-discovery-private`
- **Live URL:** `https://new-youtube-discovery-api.elmahdyabdulla208.workers.dev`
- **Authentication:** Web Crypto HMAC-SHA256 capability grants (JWT-shaped, short TTL)
- **CORS:** restricted to configured `ALLOWED_ORIGINS`; unknown origins are rejected

## Security Model

Every request must carry a capability token with:

- `iss` = expected issuer
- `aud` = expected audience
- `storage_owner_uuid` = the canonical `user_profiles.storage_owner_uuid`
- `key` = the authorized object key or prefix
- `operation` = one of `read`, `write`, `list`, `delete`, `verify`, `batch_verify`
- `exp` = short expiration

Additional enforcement:

- **Owner namespace:** writes and deletes must stay under `asdy/persistence/<storage_owner_uuid>/` or `asdy/temp/<storage_owner_uuid>/`.
- **Legacy paths:** historical `<owner-id>/persistence/...` paths are read-only compatibility. They are never valid write targets.
- **Path traversal:** keys containing `..` or backslashes are rejected.
- **Immutability:** committed generation objects are never overwritten. Identical re-uploads are idempotent; conflicting content returns `409`.
- **DELETE:** restricted to disposable temp objects under `asdy/temp/<owner>/...`; committed generations are not deletable.
- **Integrity:** uploads are verified for exact byte count and SHA-256 before success is reported.
- **No secrets in responses or logs.** Error messages are sanitized.

## Endpoints

| Method | Path | Operation | Purpose |
|---|---|---|---|
| `GET` | `/health` | public | Health probe |
| `POST` | `/v1/objects/list` | `list` | List objects under an authorized prefix |
| `POST` | `/v1/batches/upload` | `write` | Upload a batch of manifest/part objects |
| `POST` | `/v1/batches/verify` | `batch_verify` | Verify size + SHA-256 for uploaded objects |
| `PUT` | `/v1/objects/<key>` | `write` | Upload one object |
| `GET` | `/v1/objects/<key>` | `read` | Download one object |
| `HEAD` | `/v1/objects/<key>` | `read` | Object metadata |
| `DELETE` | `/v1/objects/<key>` | `delete` | Delete an uncommitted temp object |

### Batch upload limits

- Maximum **50 items** per batch.
- Maximum **45 MiB** per item.
- Maximum **200 MiB** per batch.
- JSON content only.
- Duplicate keys inside a batch are rejected.
- Each item must declare its expected `byteCount` and `sha256`; the Worker verifies both.

### Batch verification

`POST /v1/batches/verify` accepts a list of `{ key, byteCount, sha256 }` items and returns per-item results plus failures. The server calls this after upload and before the PostgreSQL commit. A failed or missing verification prevents the commit.

## Secret Setup (One-Time)

```bash
npx wrangler secret put WORKER_AUTH_SECRET --config cloudflare/workers/new-youtube-discovery-api/wrangler.jsonc
```

Paste the `R2_NEW_WORKER_AUTH_SECRET` (or shared `WORKER_AUTH_SECRET`) from the root `.env`. Never commit the secret.

## Deployment

```bash
# 1. Login to Cloudflare CLI if not already authenticated:
npx wrangler login

# 2. Deploy the Worker:
npm run worker:new:deploy
```

### Current deployment status (2026-11-05)

The hardened Worker source in this directory is **local only and has not been deployed** in this change set. The remote Worker must be deployed before end-to-end save/hydrate can be claimed, because `POST /api/sync/save-all` now requires `batch_verify` and owner-namespace enforcement.

After deployment, run the remote Worker suite and a real save/hydrate round-trip. Do not treat local mocked tests as proof of remote behavior.

## Logs & Monitoring

```bash
npm run worker:new:tail
```

## Related Code

- `src/lib/storage/r2-capability-token.ts` — token signing/verification and claim shape.
- `src/lib/storage/r2-worker-storage-client.ts` — typed client (`uploadBatch`, `verifyBatch`, `deleteTempObject`, `listNewObjects`).
- `src/lib/storage/r2-blob-backend.ts` — backend adapter that resolves the owner and signs tokens.
- `src/lib/storage/canonical-paths.ts` — the single authoritative path builder.
