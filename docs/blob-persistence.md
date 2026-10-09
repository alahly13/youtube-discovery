# Vercel Blob Persistence, Auth & Quota Pools — youtube-discovery

## 1. What lives in Blob (authoritative)

Private Blob store, root `youtube-discovery/v1/`:

| Namespace | Contents | Retention |
|---|---|---|
| `playlists/` | One logical record per user playlist + lightweight `index.json` | Permanent — user delete only |
| `saved-history/` | Complete saved-search records (full manifest + rawJson) + `index.json` | Permanent — user delete only |
| `api-keys/state.json` | Managed keys, AES-256-GCM encrypted | Permanent — user delete only |
| `api-keys/usage-<PT-day>.json` | Per-request accounting (key + project + bucket) | Rolling daily docs |
| `api-keys/pools.json` | Pool bucket-exhaustion state + evidence | Until reset / cleared |
| `admin/account.json` | **Auth exception:** username, scrypt hash, authVersion, timestamps | Permanent |
| `admin/sessions/<sid>.json` | Opaque server-side sessions | TTL expiry |
| `admin/ratelimit/<ipHash>.json` | Login sliding-window counters | 15-min windows |
| `staging/<uploadId>/…` | Uncommitted chunked uploads | 24h sessions, 48h GC |

Browser `localStorage`/IndexedDB remain **optional caches only**. `data/` on
disk is legacy (import once via Settings → Migrate, then inert).

## 2. Environment variables

| Variable | Purpose | Required for |
|---|---|---|
| `BLOB_STORE_ID` | Expected store identifier; validated + compared against observed Blob URL host | Reads/writes (identity check) |
| `BLOB_READ_WRITE_TOKEN` | Private token, passed explicitly to the SDK (`token` param) or Vercel OIDC when connected | All Blob I/O |
| `BLOB_WEBHOOK_PUBLIC_KEY` | **Webhook signature verification ONLY.** No webhook endpoint exists, so this is NOT required for reads, writes, or auth. Never use it as a token/password/secret. | Future webhooks only |
| `ADMIN_DEFAULT_USERNAME` | Bootstrap username (default `admin`). Bootstrap-only; persisted account wins afterwards | First init |
| `ADMIN_INITIAL_PASSWORD` | Strong initial password (≥12 chars). No default exists; init is refused without it | First init |
| `ADMIN_SESSION_SECRET` | Session cookie salt + rate-limit salt. Independent secret | Runtime |
| `ADMIN_SESSION_TTL_SECONDS` | Fixed session lifetime, default `604800` (7d) | Runtime |
| `API_KEYS_ENCRYPTION_KEY` | 32-byte AES-256-GCM key (base64/hex/raw-32). Independent secret. **Back up securely** — loss = unrecoverable keys | Saving managed keys |

Never prefix secrets with `NEXT_PUBLIC_`. Never commit `.env.local`.

## 3. Authentication (exactly one admin)

- First protected request bootstraps the account **atomically**
  (create-if-absent; racers read back the winner) from the bootstrap env.
  Afterwards env changes never overwrite the record.
- Passwords: scrypt N=16384/r=8/p=1/64B (Node built-in; chosen over
  Argon2id to avoid native bindings on serverless — documented in
  `src/lib/auth/password.ts`). Constant-time verify; generic login errors.
- Sessions: opaque 256-bit ids in Blob, `HttpOnly; Secure (prod);
  SameSite=Lax; Path=/` cookies, fixed duration from login, server-side
  expiry + `authVersion` checks. Password/username changes bump
  `authVersion` and delete all sessions → re-login required.
- Rate limiting: Blob sliding window (10/15min per IP hash) + in-memory
  mirror; password verification always runs.
- CSRF: same-origin check on mutations + SameSite cookies.
- Every data route calls `requireAdmin()` itself; middleware redirects are
  UX only. `/login` + `/api/auth/login` + `/api/auth/username` are public.
- Recovery (lost/corrupt account): with Blob store access (Vercel dashboard
  or CLI), delete `youtube-discovery/v1/admin/account.json`, ensure
  `ADMIN_INITIAL_PASSWORD` is set to a new strong value, restart/redeploy —
  the next protected request bootstraps a fresh account. There is no public
  reset endpoint by design.

## 4. Large records (>4.5 MB)

- Records serialize deterministically (sorted keys) and are measured in
  **UTF-8 bytes**. ≤4 MiB → one object; larger → 2 MiB chunks +
  `manifest.json` (`schemaVersion`, `generationId`, order, count, total
  bytes, SHA-256).
- Browsers never POST oversized bodies: `saveSearchRecord()` switches to
  staged init/chunk/commit (each request ≤ ~2.7 MB). Commits verify every
  chunk, then publish via the standard path with read-back verification.
- Versioned writes: new generation first, index published after
  verification, old generation removed last. Index updates are CAS
  (ETag `ifMatch` + bounded retries). Reads verify byte count + checksum;
  any gap throws — partial data is never published or returned.
- Staging GC touches only `staging/` objects older than 48h.

## 5. Quota pools & monitoring confidence

- Pool = Google Cloud project (`project:<id>`). Keys without a project form
  solo `key:<id>` pools — unknowns are never merged, and different
  values/names/Gmail labels never imply (non-)shared quota.
- Association: `verified` (only via observed correlated exhaustion across
  ≥2 pool keys, or explicit verification), `declared` (admin-entered),
  `unknown`. Manual entries are never auto-claimed verified.
- Buckets `search` (search.list ≈ 100 u) vs `other` (≈1 u) exhaust
  independently. Rotation skips pool-exhausted buckets, tries other pools,
  disables invalid keys individually, fails fast on malformed/transient
  errors (strict retry cap).
- **Confidence:** no official Google Cloud monitoring is connected (Service
  Usage API would need separate OAuth/service-account credentials — optional
  future work). The dashboard shows `local-estimate` figures from persistent
  per-request accounting; per-key and project views derive from the same
  events and are never summed together. Quota resets at midnight Pacific.
- Rotation across your own projects uses each project's own allocation; it
  does not bypass Google quotas.

## 6. Troubleshooting

- `401 Unauthorized` on data routes → sign in at `/login` (cookie expired,
  password changed elsewhere, or TTL lowered).
- `503 Storage is not configured` → set `BLOB_READ_WRITE_TOKEN` (+
  `BLOB_STORE_ID`) locally and in Vercel; run Settings → Run Connection
  Check (reports config/list/write/identity separately, no secrets).
- `storeIdentity: unverified` with working reads/writes → token reaches A
  store, but the URL host doesn't contain `BLOB_STORE_ID`; confirm the
  store ID matches the intended store.
- Managed-key save refused → set a valid 32-byte `API_KEYS_ENCRYPTION_KEY`.
- Login `429` → wait out the 15-minute window (per-IP, shared across instances).
- `410 Upload session expired` → restart the large save (resumable via init).
