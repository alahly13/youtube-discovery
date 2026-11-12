# YouTube Discovery (2026) — Environment Variables Reference

This document is generated from direct codebase inspection across `src/`, `scripts/`, `prisma.config.ts`, and `cloudflare/workers/*`. No real secrets appear here; all examples use safe placeholders.

Run the secret-safe audit anytime:

```powershell
npm run env:check
```

---

## 1. Security Classification & Public vs Server Rules

- **Public (`NEXT_PUBLIC_*`)**: Bundled into browser JavaScript. Only non-secret public endpoints, public Supabase publishable keys, and safe display settings belong here.
- **Server-Only (Next.js App Router & Node Scripts)**: Read exclusively on the server (`src/app/api/*`, `src/lib/*`, `scripts/*`). Never returned to clients.
- **Cloudflare Worker Secrets / Bindings**: Stored inside Cloudflare Workers (`new-youtube-discovery-api`, `old-youtube-discovery-api`), separate from Vercel `.env`.

---

## 2. Complete Variable Reference Matrix

### A. Application & Deployment Metadata

| Variable | Scope | Required | Used In | Default | Format / Example | Effect if Missing |
|---|---|---|---|---|---|---|
| `NEXT_PUBLIC_APP_URL` | Browser Public + Server | Recommended | `src/app/layout.tsx`, `scripts/app-validate-env.mjs` | Auto-derived or `http://localhost:3000` | `https://youtube-discovery.vercel.app` | Metadata/origin falls back to Vercel URL or localhost. |
| `VERCEL_PROJECT_PRODUCTION_URL` | Vercel Auto Server | Auto (Vercel) | `scripts/app-validate-env.mjs` | None | `my-app.vercel.app` (no scheme) | Ignored outside Vercel production. |
| `VERCEL_URL` | Vercel Auto Server | Auto (Vercel) | `scripts/app-validate-env.mjs` | None | `my-app-abc.vercel.app` | Ignored locally when `NEXT_PUBLIC_APP_URL` is set. |
| `NODE_ENV` | Runtime Standard | Auto | `src/lib/db/prisma.ts`, `src/lib/supabase/server.ts`, auth routes, `scripts/load-project-env.mjs` | Runtime dependent | `development` / `production` | Controls TLS cookie flags and Prisma dev logging. |

### B. Supabase Authentication & Identity

| Variable | Scope | Required | Used In | Default | Format / Example | Effect if Missing |
|---|---|---|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Browser Public + Server | **Required** | `src/lib/supabase/{client,server,admin}.ts`, `src/lib/auth/{require-auth,auth-diagnostics}.ts`, `scripts/{auth-*,test-remote-integration}.mjs` | None | `https://[PROJECT-REF].supabase.co` | Login and all Supabase SSR sessions fail closed (`401`/`503`). |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Browser Public + Server | **Required** | `src/lib/supabase/{client,server}.ts`, `src/app/api/auth/login/route.ts`, `src/lib/auth/{require-auth,auth-diagnostics}.ts` | Falls back to `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `sb_publishable_...` or JWT anon key | Login/SSR client cannot initialize unless `NEXT_PUBLIC_SUPABASE_ANON_KEY` is set. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Browser Public + Server | Alias Fallback | Same files above (checked second) | None | JWT anon key | Only needed if `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` is omitted. |
| `SUPABASE_SERVICE_ROLE_KEY` | Server Only | **Required** | `src/lib/supabase/admin.ts`, `src/lib/auth/{rate-limit,auth-diagnostics}.ts`, `scripts/{auth-*,backup-cli,test-*}.mjs` | Falls back to `SUPABASE_SECRET_KEY` | Supabase service role / `sb_secret_...` | Privileged user profile lookup, admin scripts, and DB backups fail. |
| `SUPABASE_SECRET_KEY` | Server Only | Alias Fallback | Same files above (checked second) | None | `sb_secret_...` | Used when `SUPABASE_SERVICE_ROLE_KEY` is omitted or as alias. |
| `ADMIN_DEFAULT_USERNAME` | Server Only | Recommended | `src/app/api/auth/{login,username}/route.ts`, `src/lib/auth/{account-store,auth-diagnostics}.ts`, `scripts/auth-*.mjs` | `"asdy"` | `asdy` (3–32 safe chars) | Defaults to `"asdy"`. |
| `ADMIN_EMAIL` | Server Only | Recommended | `src/app/api/auth/login/route.ts`, `src/lib/auth/{user-profile,auth-diagnostics}.ts`, `scripts/auth-*.mjs` | `"asdy@youtube.discov.com"` | `asdy@youtube.discov.com` | Defaults to `"asdy@youtube.discov.com"`. |
| `SESSION_TTL_SECONDS` | Server Only | Optional | `src/lib/auth/session.ts` | `604800` (7 days) | Integer seconds (`604800`) or duration (`7d`, `24h`) | Falls through `ADMIN_SESSION_TTL_SECONDS` -> `SUPABASE_SESSION_TTL_SECONDS` -> `SESSION_DURATION` -> `604800`. |
| `ADMIN_SESSION_TTL_SECONDS` | Server Only | Alias | `src/lib/auth/session.ts` | None | `604800` | Fallback if `SESSION_TTL_SECONDS` unset. |
| `SUPABASE_SESSION_TTL_SECONDS` | Server Only | Alias | `src/lib/auth/session.ts` | None | `604800` | Third fallback in chain. |
| `SESSION_DURATION` | Server Only | Alias | `src/lib/auth/session.ts` | None | `7d` | Fourth fallback in chain. |
| `ADMIN_PASSWORD` / `ADMIN_INITIAL_PASSWORD` / `SUPABASE_ADMIN_PASSWORD` | Server Fallback / CLI | Optional (Bootstrap Only) | `src/lib/auth/account-store.ts` (legacy bootstrap fallback only) | None | Strong password `>= 8 chars` | Ignored when Supabase Auth handles login (normal production). |

### C. Supabase PostgreSQL Database (Prisma 7)

| Variable | Scope | Required | Used In | Default | Format / Example | Effect if Missing |
|---|---|---|---|---|---|---|
| `DATABASE_URL` | Server Only + CLI | **Required** | `src/lib/db/prisma.ts`, `prisma.config.ts`, `scripts/db-migrations/core.mjs`, `src/app/settings/page.tsx` | Placeholder during build only | `postgresql://postgres.[REF]:[PW]@aws-0-[REGION].pooler.supabase.com:6543/postgres?pgbouncer=true` | DB reads/writes fail; sync commits fail closed and preserve browser IndexedDB outbox. |
| `DIRECT_URL` | Server CLI / Migrations | Recommended | `prisma.config.ts`, `scripts/db-migrations/{core,apply-migration}.mjs`, `scripts/{backup-cli,test-remote-integration}.mjs` | Falls back to `DATABASE_URL` | `postgresql://postgres.[REF]:[PW]@db.[REF].supabase.co:5432/postgres` | Prisma CLI checks fall back to Session Pooler derivation when IPv6 direct host is unreachable. |

### D. Cloudflare R2 Workers & Secret-Matching Architecture

| Variable | Scope | Required | Used In | Default | Format / Example | Effect if Missing |
|---|---|---|---|---|---|---|
| `R2_NEW_WORKER_URL` | Server Only | **Required (Cloud R2)** | `src/lib/storage/{r2-worker-storage-client,r2-blob-backend}.ts`, `src/app/api/admin/{storage-status,storage-verify}/route.ts` | Production workers.dev default in `r2-blob-backend.ts`; empty throws in `r2-worker-storage-client.ts` | `https://new-youtube-discovery-api.elmahdyabdulla208.workers.dev` | `save-all` & hydration cannot reach NEW R2 bucket; client outbox stays safely local. |
| `R2_OLD_WORKER_URL` | Server Only | Recommended | `src/lib/storage/{r2-worker-storage-client,r2-blob-backend}.ts`, `src/app/api/admin/storage-status/route.ts` | Production workers.dev default in `r2-blob-backend.ts` | `https://old-youtube-discovery-api.elmahdyabdulla208.workers.dev` | OLD archive uploads/downloads fall back or fail. |
| `R2_NEW_WORKER_AUTH_SECRET` | Server Only | **Required (Cloud R2)** | `src/lib/storage/{r2-capability-token,r2-blob-backend}.ts`, `src/app/api/admin/*` | Falls back to `WORKER_AUTH_SECRET` -> `R2_WORKER_AUTH_SECRET` | High-entropy random hex/base64 secret | Signing fails (`401`/`500` on save/hydrate) unless fallback `WORKER_AUTH_SECRET` matches NEW Worker. |
| `R2_OLD_WORKER_AUTH_SECRET` | Server Only | Recommended | `src/lib/storage/{r2-capability-token,r2-blob-backend}.ts` | Falls back to `WORKER_AUTH_SECRET` -> `R2_WORKER_AUTH_SECRET` | High-entropy random hex/base64 secret | OLD Worker token signing fails unless matching secret is set. |
| `WORKER_AUTH_SECRET` (Root `.env`) | Server Only | Optional Shared Alias | `src/lib/storage/{r2-capability-token,r2-blob-backend}.ts` | None | Same strong secret | Used as fallback if per-worker secret (`R2_NEW_...` / `R2_OLD_...`) is unset. |
| `R2_WORKER_AUTH_SECRET` | Server Only | Legacy Fallback Alias | `src/lib/storage/{r2-capability-token,r2-blob-backend}.ts` | None | Same strong secret | Lowest-priority HMAC secret fallback. |
| `WORKER_AUTH_SECRET` (Inside CF Workers) | Cloudflare Worker Secret | **Required in CF** | `cloudflare/workers/{new,old}-youtube-discovery-api/src/index.ts` | None | Set via `wrangler secret put WORKER_AUTH_SECRET` | Worker rejects every request (`500 Worker authentication secret not configured`). |
| `ALLOWED_ORIGINS` (Inside CF Workers) | Cloudflare Worker Env/Secret | Recommended in CF | `cloudflare/workers/{new,old}-youtube-discovery-api/src/index.ts` | Built-in localhost + production Vercel URLs | Comma-separated origins (`https://...,http://localhost:3000`) | Browser-originated requests from unlisted origins get `403`. |
| `NEW_BUCKET` / `OLD_BUCKET` | Cloudflare Worker R2 Binding | **Required in CF** | `cloudflare/workers/*/wrangler.jsonc` | Bound in `wrangler.jsonc` | `new-youtube-discovery-private` / `old-youtube-discovery-private` | Worker R2 binding fails if missing in `wrangler.jsonc`. |

> **Secret Matching Rule:**
> - `R2_NEW_WORKER_AUTH_SECRET` (in Vercel/`.env`) **must match** `WORKER_AUTH_SECRET` stored on Cloudflare Worker **`new-youtube-discovery-api`**.
> - `R2_OLD_WORKER_AUTH_SECRET` (in Vercel/`.env`) **must match** `WORKER_AUTH_SECRET` stored on Cloudflare Worker **`old-youtube-discovery-api`**.

### E. YouTube Data API v3, Managed Keys & Gemini AI

| Variable | Scope | Required | Used In | Default | Format / Example | Effect if Missing |
|---|---|---|---|---|---|---|
| `API_KEYS_ENCRYPTION_KEY` | Server Only | **Required** | `src/lib/keys/key-crypto.ts`, `src/lib/auth/rate-limit.ts` | None | 64 hex chars, 44-char base64, or 32-char UTF-8 (32 bytes) | Managed YouTube API keys cannot be encrypted or decrypted; adding custom keys is refused. |
| `YOUTUBE_API_BASE_URL` | Server Only | Optional | `src/lib/platforms/youtube/youtube-client.ts` | `https://www.googleapis.com/youtube/v3` | URL | Uses official v3 URL. |
| `YOUTUBE_API_KEY` | Server Only | Optional | `src/lib/platforms/youtube/youtube-api-keys.ts`, `src/app/settings/page.tsx` | None | `AIza...` | Uses DB-managed keys instead; live YouTube search disabled if neither exists. |
| `YOUTUBE_DAILY_QUOTA_BUDGET` | Server Only | Optional | `src/lib/platforms/youtube/youtube-quota.ts`, `src/app/api/youtube/keys/usage/route.ts`, `src/app/settings/page.tsx` | `10000` | Integer (`10000`) | Defaults to `10000`. |
| `YOUTUBE_SEARCH_PAGE_SIZE` | Server Only | Optional | `src/app/settings/page.tsx` | `25` | `25` | Defaults to `25`. |
| `YOUTUBE_SEARCH_MAX_PAGES` | Server Only | Optional | `src/app/settings/page.tsx` | `3` | `3` | Defaults to `3`. |
| `YOUTUBE_SEARCH_MAX_ITEMS` | Server Only | Optional | `src/app/settings/page.tsx` | `150` | `150` | Defaults to `150`. |
| `YOUTUBE_SEARCH_DELAY_MS` | Server Only | Optional | `src/lib/platforms/youtube/youtube-search-service.ts` | `250` | Integer ms (`250`) | Defaults to `250`. |
| `ENABLE_YOUTUBE_MANIFEST_PERSISTENCE` | Server Only | Optional | `src/app/api/youtube/manifests/**/route.ts`, `scripts/app-validate-env.mjs` | `"false"` | `"true"` / `"false"` | Disables legacy DB search-manifest auto-store unless `"true"`. |
| `GEMINI_API_KEY` | Server Only | Optional | `src/lib/ai/gemini-client.ts`, `src/app/settings/page.tsx` | None | `AIza...` | Scoped AI manifest assistant returns disabled status. |
| `GEMINI_MODEL` | Server Only | Optional | `src/lib/ai/gemini-client.ts` | `gemini-2.5-flash` | `gemini-2.5-flash` | Defaults to `gemini-2.5-flash`. |
| `AI_MANIFEST_MAX_ITEMS` | Server Only | Optional | `src/lib/ai/youtube-manifest-context.ts` | `200` | Integer (`60`–`200`) | Uses `200`. |
| `AI_MANIFEST_MAX_CHARS` | Server Only | Optional | `src/lib/ai/youtube-manifest-context.ts` | `120000` | Integer (`30000`–`120000`) | Uses `120000`. |

### F. Storage Cache, Manifest Standard, CLI & Legacy Keys

| Variable | Scope | Required | Used In | Default | Effect if Missing |
|---|---|---|---|---|---|
| `SEARCH_STORAGE_TTL_HOURS` | Server Only | Optional | `src/lib/config/search-storage-config.ts` | `168` (7d) | Ephemeral search cache defaults to 168h (permanent archives never expire). |
| `NEXT_PUBLIC_SEARCH_STORAGE_TTL_HOURS` | Browser Public | Optional | `src/lib/config/search-storage-config.ts` | `168` (7d) | Browser falls back cleanly to 168h. |
| `STORAGE_NAMING_VERSION` | Documentation / Config | Optional | `.env.example` / `docs/data-architecture/manifest-naming-and-directory-standard.md` | `2026.1` | Informational standard pin (`2026.1`). |
| `MANIFEST_TARGET_SIZE_BYTES` / `MANIFEST_MAX_OBJECT_SIZE_BYTES` | Config Template | Optional | `.env.example` (runtime enforces `40 MiB` / `45 MiB` constants in code/Worker) | `41943040` / `47185920` | Defaults apply cleanly. |
| `SUPABASE_STORAGE_BUCKET` / `SUPABASE_NEW_STORAGE_BUCKET` / `SUPABASE_OLD_STORAGE_BUCKET` | CLI / Test Scripts | Optional | `scripts/backup-cli.mjs`, `scripts/test-phase-a-g-features.mjs` | Canonical bucket slugs | Defaults apply cleanly. |
| `NO_COLOR` / `TERM` | CLI | Optional | `scripts/db-migrations/renderer.mjs` | Empty | ANSI terminal colors enabled when unset. |
| `BLOB_READ_WRITE_TOKEN` | Legacy Scanner Only | Optional (Legacy) | `src/lib/recovery/legacy-scanner.ts` | None | Historical Vercel Blob scanner stays skipped (safe). |
| `ADMIN_SESSION_SECRET`, `YOUTUBE_DEFAULT_REGION`, `YOUTUBE_DEFAULT_RELEVANCE_LANGUAGE`, `YOUTUBE_SEARCH_CONCURRENCY` | Historical / Unused | Optional (Unused) | Previously set in early pre-Supabase/pre-2026 configs; safely ignored by current runtime | None | Safe to remove during env rotation, or leave ignored without affecting behavior. |

---

## 3. Secret-Safe Local Setup & PowerShell Verification

1. **Create your local `.env.local` (or `.env`) from `.env.example`**, never committing `.env*` files.
2. **Verify presence & format without revealing any secret values:**

```powershell
# Automated validator:
npm run env:check

# PowerShell manual presence check (prints keys & lengths ONLY, never values):
Get-Content .env | Where-Object { $_ -match "^[A-Za-z_][A-Za-z0-9_]*=" } | ForEach-Object {
  $parts = $_ -split "=", 2
  $k = $parts[0].Trim()
  $v = $parts[1].Trim().Trim('"')
  "{0,-38} set={1,-5} len={2}" -f $k, ($v.Length -gt 0), $v.Length
}
```
