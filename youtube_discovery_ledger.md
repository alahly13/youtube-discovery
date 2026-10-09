# youtube-discovery Project Ledger

Last updated: 2026-10-09 (Private Blob persistence, single-admin auth, quota pools)

## Project Identity And Mission

`youtube-discovery` is a professional 2026 research SaaS for discovering, filtering, saving, organizing, exporting, and AI-analyzing public YouTube metadata. The platform uses official YouTube Data API v3 workflows only. It is not a downloader, scraper, rehoster, private-data tool, or AI result fabricator.

Core loop: official YouTube API fetch -> normalize metadata -> create manifest -> search/filter/sort locally -> save/export/analyze with scoped AI.

## Product Rules And Non-Goals

- Use official YouTube Data API v3 only.
- Do not download videos, scrape streams, scrape YouTube pages, rehost content, bypass restrictions, or access private data.
- Provider search settings may call YouTube only after explicit user action.
- Local filters and search-inside-results operate only on already collected or saved metadata.
- Treat `0` views, likes, and comments as valid metadata.
- Label inferred short-form videos as `Shorts-like`, not guaranteed Shorts.
- Community posts remain unsupported/future-ready unless an official endpoint exposes them.
- Use `Known public playlist appearances`, never `All playlists containing this video`.
- AI must use explicit scopes and must not invent IDs, URLs, counts, videos, playlist relationships, or private data.

## Current Tech Stack And Library Decisions

- Next.js `16.2.6` App Router with React `19.2.4`.
- TypeScript strict mode.
- Tailwind CSS 4 with centralized CSS variables in `src/app/globals.css`.
- lucide-react for iconography.
- Zod for server route validation.
- Prisma 7 with `prisma.config.ts`, generated client output under `src/generated/prisma`, and Supabase PostgreSQL-oriented schema.
- `@next/env` for standalone script env loading from root `.env.local`.
- Google GenAI SDK through server-only Gemini helpers.
- FlexSearch (used): shared local-search service in `src/lib/search/local-search.ts` (Document index, title-weighted, with a weighted fallback matcher) powers Saved Library, playlist contents, and History — strictly local, zero YouTube quota. Zustand, TanStack Query, and Framer Motion remain installed for state/UX expansion.

## Runtime And Deployment Paths

- Local Windows/PowerShell: run from `F:\discovery\youtube-discovery`; keep local secrets in root `.env.local`; use `vercel env pull .env.local --yes` when linked to Vercel.
- Vercel production/preview: configure server-only variables in Vercel Project Settings; do not run database migrations during normal build.
- Supabase PostgreSQL: `DATABASE_URL` is server-only; `db:apply` uses guarded `prisma migrate deploy` and requires explicit confirmation.
- GitHub Actions: `.github/workflows/ci.yml` runs npm install, DB schema validation, lint, typecheck, and build on Node 24.
- Codex/online environment: provider keys and DB may be missing; live provider/DB checks must be reported honestly.

## Architecture Overview

The app is manifest-first. Every provider fetch returns a `YouTubeManifest` with provenance, settings snapshot, pages fetched, quota estimate, status, duplicate count, warnings/errors, and normalized items.

Authoritative persistence is the PRIVATE Vercel Blob store (`@vercel/blob`
2.8.1, `access: "private"` everywhere) under `youtube-discovery/v1/`:
playlists, saved-history (complete records, permanent), encrypted managed
API keys (+ per-day usage accounting, pool exhaustion state), and the single
admin account/sessions. One logical record in → one logical record out:
small records are single objects, large records are chunked (2 MiB pieces +
manifest with SHA-256) with staged browser uploads, versioned CAS index
writes, and read-back verification. No TTL expiry on user data. Browser
storage is cache only; local `data/` is legacy import source only.

Access is gated by a single-admin session system (scrypt password hash in
Blob, opaque Blob-backed sessions, 7-day default TTL, Blob sliding-window
login rate limiting). Every data API route enforces `requireAdmin()`
itself; middleware redirects are UX only. `/login` and the username prefill
endpoint are the only public surfaces.

Provider quota model: keys are grouped into Google Cloud project pools
(`project:<id>`; unknown keys form solo pools, never merged). Rotation is
bucket-aware (`search` vs `other` exhaust independently), classifies errors
(quota → pool-bucket cooldown + correlated-verification; invalid key →
disable key only; else fail fast), and attributes every request (key +
project + bucket + outcome) to persistent usage docs. The dashboard shows
local estimates labeled as such; no official monitoring is connected.

Search pipeline: provider settings -> explicit fetch -> temporary manifest -> local search -> local filters -> local sort -> render/export/AI.

AI pipeline: route-validated prompt -> explicit scope -> capped manifest context -> Gemini if configured -> server-validated response with evidence refs, limitations, confidence, and confirmation-only suggestions.

## Route Map And Page Responsibilities

- `/login`: single-administrator sign-in with current-username prefill (only public page besides API auth helpers).
- `/`: dashboard with product posture, system boundaries, quick actions, and manifest overview.
- `/search`: general YouTube Search workspace with provider settings, manifest summary, local filters, result cards, export, scoped AI panel, Unrestricted Mode toggle, custom Saved Search Titles shelf, configurable search results retention (default 168h / 7 days via `SEARCH_STORAGE_TTL_HOURS`), complete rawJson archive preservation, instant direct load from archive via `?load=[id]`, and Back-to-Top control.
- `/ai-search`: AI Search / AI Discovery workspace and safety contract.
- `/link-explorer`: parses YouTube URLs and reports official API strategy without scraping.
- `/channels`: **FULL** saved channel library (localStorage-backed).
- `/channel-explorer`: channel uploads workflow scaffold.
- `/channels/[sourceId]`: **FULL** channel explorer with YouTube-like profile header, uploads manifest, local filters/sort/search-inside-channel, export, and scoped AI panel.
- `/playlists`: **FULL** saved playlist library (localStorage-backed).
- `/playlist-explorer`: playlist workflow scaffold.
- `/playlists/[playlistId]`: **FULL** playlist explorer with order-preserving list/grid view, play-next navigation, local filters/sort/search-inside-playlist, export, and scoped AI panel.
- `/manifests`: manifest library with interactive manifest listing, clickable navigation to detail pages.
- `/manifests/[manifestId]`: **FULL** manifest detail workspace with local search/filter/sort, export, and scoped AI analysis.
- `/collections`: **FULL** collection management workspace with create/delete/search and runtime manifest reference (localStorage-backed).
- `/saved`: **FULL** Saved Library hub with three tabs — user Playlists (create/rename/delete/search/sort, thumbnail collages, open dedicated page), Saved Items (global entities with standalone-vs-in-playlist detection, type filter, add-to-playlist), and the Saved Search Titles shelf (Zustand & localStorage-backed).
- `/saved/[playlistId]`: **FULL** personal-playlist workspace — in-playlist FlexSearch search, content-type/date/views filters, 12 transient sort modes plus canonical manual order, user sections/groups (create/rename/note/collapse/reorder/delete keep-or-delete), custom items/notes, HTML5 drag-and-drop with Move Up/Down alternatives, multi-select bulk move/copy/group/remove, Undo, and self-contained JSON export. Zero YouTube API calls.
- `/history`: **FULL** chronological history workspace with shared FlexSearch `Search history...` filter across title/query/metadata without calling YouTube API, unified client + server archive listing, "View Results" action loading full search data from the archive with zero quota consumption, and Back-to-Top control.
- `/watch/[videoId]`: embedded playback with manifest-first suggested videos sidebar, Zustand-backed watch settings, and graceful error handling.
- `/settings`: **FULL** Settings page with environment status, Default SafeSearch & Sensitivity Policy, persistent YouTube Fetch Controls, YouTube API Key Management (multi-key rotation, safe masked strings, active key switching, custom key deletion, per-key Gmail/project metadata editing), Quota Pools & Usage dashboard (per-project buckets, local-estimate confidence, per-key stats, last-request attribution), Private Blob Storage & Migration card (connection diagnostics, idempotent legacy import), Account Security card (username/password change, logout).

## API Route Map And Backend Authority Boundaries

- Auth (public: login, username; protected: logout, status, account change):
  `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/username`,
  `GET /api/auth/status`, `POST /api/auth/account`.
- Admin (protected): `POST /api/admin/migrate` (idempotent disk + browser
  title import), `GET /api/admin/storage-status`, `POST /api/admin/storage-verify`
  (config/list/write-probe/store-identity diagnostics, no secrets).
- Chunked uploads (protected): `POST /api/blob-upload/[init|chunk|commit|abort]`.
- Quota (protected): `GET /api/youtube/keys/usage` (project pools dashboard),
  `PATCH /api/youtube/keys/[keyId]` (label/account/project/enabled/priority).
- All other `/api/*` routes require admin session via `requireAdmin()`
  (mutations additionally same-origin checked); public API surface is
  login + username-prefill only.

- `POST /api/youtube/search`: validates provider settings, calls `search.list`, hydrates details, builds a temporary manifest.
- `POST /api/youtube/search/next`: same handler with page token support.
- `POST /api/youtube/details/videos`: server-only `videos.list` details.
- `POST /api/youtube/details/channels`: server-only `channels.list` details.
- `POST /api/youtube/details/playlists`: server-only `playlists.list` details.
- `POST /api/youtube/channel/analyze`: resolves channel metadata with `channels.list`.
- `POST /api/youtube/channel/uploads/start`: channel uploads flow via uploads playlist and `playlistItems.list`.
- `POST /api/youtube/channel/uploads/next`: continuation handler.
- `POST /api/youtube/playlist/analyze`: playlist metadata lookup.
- `POST /api/youtube/playlist/items/start`: playlist items flow preserving order and unavailable placeholders.
- `POST /api/youtube/playlist/items/next`: continuation handler.
- `POST /api/youtube/link/analyze`: URL parser and official strategy selector.
- `GET /api/youtube/manifests`: runtime manifest list.
- `GET /api/youtube/manifests/[manifestId]`: runtime manifest detail.
- `POST /api/youtube/manifests/[manifestId]/search`: local manifest search/filter; no provider call.
- `POST /api/youtube/manifests/[manifestId]/filter`: local manifest filter; no provider call.
- `POST /api/youtube/manifests/[manifestId]/save`: saves to runtime store only until DB repositories are enabled.
- `GET /api/youtube/keys`: lists available YouTube API keys with safe masked representations and active indicator.
- `POST /api/youtube/keys`: registers a new custom YouTube API key server-side.
- `POST /api/youtube/keys/select`: selects the active YouTube API key for provider requests.
- `DELETE /api/youtube/keys/[keyId]`: deletes a custom key with safe fallback to environment key.
- `GET /api/playlists`: lightweight user-playlist index (never full contents).
- `POST /api/playlists`: creates a user playlist + its dedicated manifest file (Zod-validated).
- `GET /api/playlists/[id]`: full self-contained playlist manifest; 404 recovery object for missing/corrupt files.
- `PUT /api/playlists/[id]`: meta patch (`{name?, description?}`) or full-manifest replace (Zod-validated, atomic write).
- `DELETE /api/playlists/[id]`: removes only that playlist's file; global saved entities untouched.
- Playlist manifests persist permanently (no TTL, independent of `SEARCH_STORAGE_TTL_HOURS`).
- `GET /api/search-storage`: returns lightweight search archive index and TTL metadata for fast History filtering.
- `POST /api/search-storage`: archives complete search record with full rawJson to dedicated disk file.
- `DELETE /api/search-storage`: clears search archive.
- `GET /api/search-storage/[id]`: retrieves complete search record from disk without calling YouTube API.
- `DELETE /api/search-storage/[id]`: deletes individual search record from archive.
- `GET /api/search-storage/latest`: retrieves latest archived search record.
- `POST /api/ai/youtube-search-assistant`: scoped AI search helper.
- `POST /api/ai/youtube-manifest-assistant`: scoped manifest analyst.
- `POST /api/ai/youtube-video-explorer`: selected-video AI explorer.

Server-only modules import `server-only` where secrets/providers are involved. Prisma, Gemini, and YouTube clients are not imported into client components or proxy/middleware.

## Database And Schema Concepts

Canonical committed schema: `prisma/schema.prisma`.

Initial migration: `prisma/migrations/20260508000100_initial_youtube_discovery/migration.sql`.

Canonical durable tables/models:

- `VideoSource`
- `YouTubeVideo`
- `YouTubeChannel`
- `YouTubePlaylist`
- `Manifest`
- `ManifestItem`
- `SavedVideo`
- `Collection`
- `AiSession`

Operational tables/models:

- `SearchJob`
- `FetchJob`
- `FetchPageAttempt`
- `FetchJobEvent`
- `ProviderRequestLog`
- `QuotaUsageEvent`

Owner scope is represented by `ownerId` defaults for saved/persistent user data (schema foundation). Application access itself is gated by the single-administrator session system backed by Blob (see Architecture Overview); there is no multi-user model.

Legacy tables: none in this repository.

Migration status: created but not applied. `db:apply` was not run.

## Environment Variable Map

Blob/auth/quota persistence (server-only, never `NEXT_PUBLIC_*`):

- `BLOB_STORE_ID` — expected store id; validated + compared with observed Blob URL host.
- `BLOB_READ_WRITE_TOKEN` — private SDK token for all Blob I/O. No local-only fallback when missing.
- `BLOB_WEBHOOK_PUBLIC_KEY` — webhook signature verification ONLY. No webhook endpoint exists, so NOT required for reads/writes/auth.
- `ADMIN_DEFAULT_USERNAME` (default `admin`), `ADMIN_INITIAL_PASSWORD` (required, ≥12 chars, no default) — bootstrap-only; persisted account wins afterwards.
- `ADMIN_SESSION_SECRET` — session/rate-limit salt (independent secret).
- `ADMIN_SESSION_TTL_SECONDS` (default `604800` = 7d; clamped 300s–30d).
- `API_KEYS_ENCRYPTION_KEY` — 32-byte AES-256-GCM key (base64/hex/raw-32). Saves refused without it. Back up securely.

Public:

- `NEXT_PUBLIC_APP_URL`
- `NEXT_PUBLIC_SUPABASE_URL` only if client Supabase auth is added
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` only if client Supabase auth is added

Server-only:

- `DATABASE_URL`
- `YOUTUBE_API_KEY`
- `YOUTUBE_API_BASE_URL`
- `YOUTUBE_DEFAULT_REGION`
- `YOUTUBE_DEFAULT_RELEVANCE_LANGUAGE`
- `YOUTUBE_SEARCH_PAGE_SIZE`
- `YOUTUBE_SEARCH_MAX_PAGES`
- `YOUTUBE_SEARCH_MAX_ITEMS`
- `YOUTUBE_SEARCH_DELAY_MS`
- `YOUTUBE_SEARCH_CONCURRENCY`
- `YOUTUBE_DAILY_QUOTA_BUDGET`
- `SEARCH_STORAGE_TTL_HOURS`: legacy disk-cache retention only (Blob saved history is permanent and ignores it).
  Default 168h; safe numeric parser fallback on invalid values.
- `ENABLE_YOUTUBE_MANIFEST_PERSISTENCE`
- `GEMINI_API_KEY`
- `GEMINI_MODEL`
- `AI_MANIFEST_MAX_ITEMS`
- `AI_MANIFEST_MAX_CHARS`

Forbidden public secrets:

- `NEXT_PUBLIC_YOUTUBE_API_KEY`
- `NEXT_PUBLIC_GEMINI_API_KEY`

## File And Folder Map

- `AGENTS.md`: repo operating rules; future agents must read it before edits.
- `Guide-Files/youtube-discovery_full_guide_2026_updated.md`: primary product and architecture guide.
- `Guide-Files/ai_youtube_discovery_ai_agent_prompt_rules_2026.md`: AI and implementation prompt/safety guide.
- `Guide-Files/git_github_arabic_commands_guide.md`: Arabic Git/GitHub command workflow guide.
- `Guide-Files/npm_commands_arabic_guide.md`: Comprehensive Arabic NPM and NPX commands reference guide.
- `DESIGN_DARK.md`, `DESIGN_LIGHT.md`, `design-inspiration/*`: visual inspiration, not product truth.
- `src/app/globals.css`: design tokens and global layout safeguards; avoid one-off color systems.
- `src/app/layout.tsx`: root metadata, fonts, and theme boot script.
- `src/components/layout/*`: app shell, navigation, theme toggle; keep provider secrets out.
- `src/components/ui/back-to-top.tsx`: reusable smooth-scrolling floating Back-to-Top button.
- `src/components/search/search-workspace.tsx`: main client search experience; local filters do not call YouTube; includes configurable TTL search persistence (default 168h / 7 days), complete rawJson archive preservation, instant direct load from archive via `?load=[id]`, and Back-to-Top control.
- `src/lib/config/search-storage-config.ts`: centralized safe TTL parser and expiration calculation module.
- `src/lib/blob/blob-paths.ts`: versioned private-Blob pathname layout (`youtube-discovery/v1/...`).
- `src/lib/blob/blob-config.ts`: token/OIDC resolution + validation (no secrets in errors).
- `src/lib/blob/blob-backend.ts`: swappable byte adapter interface + in-memory mock for tests.
- `src/lib/blob/vercel-blob-backend.ts`: production SDK adapter (private objects, ETag CAS, URL-host capability).
- `src/lib/blob/record-format.ts`: deterministic serialization, UTF-8 sizing, chunk math, SHA-256 manifests.
- `src/lib/blob/record-store.ts`: one-logical-record store (single/chunked, CAS indexes, read-back verification).
- `src/lib/blob/chunked-upload.ts`: staged init/chunk/commit/abort for oversized browser payloads.
- `src/lib/blob/blob-verify.ts`: safe connection diagnostics (config/list/write-probe/store-identity, no secrets).
- `src/lib/blob/migration.ts`: idempotent disk→Blob importers (playlists, searches, encrypted keys) with verification.
- `src/lib/blob/backend-factory.ts`: singleton production backend accessor.
- `src/lib/auth/password.ts`: scrypt hashing/verification + username/password policies.
- `src/lib/auth/cookies.ts`: edge-safe session cookie name (proxy/middleware-safe).
- `src/lib/auth/session.ts`: opaque Blob sessions, 7d TTL, server-side expiry + authVersion checks.
- `src/lib/auth/account-store.ts`: single-admin bootstrap (atomic), credential changes with read-back verify.
- `src/lib/auth/rate-limit.ts`: Blob sliding-window login limiter + memory mirror.
- `src/lib/auth/require-auth.ts`: per-route `requireAdmin()` guard + same-origin CSRF check.
- `src/lib/keys/key-crypto.ts`: AES-256-GCM for managed key values (refuses plaintext saves).
- `src/lib/keys/quota-pools.ts`: project pools, buckets, CAS usage accounting, Pacific-day docs, dashboard math.
- `src/lib/client/auth-fetch.ts`: 401→login redirect fetch wrapper.
- `src/lib/client/blob-upload.ts`: small-direct vs staged-chunked save for large search records.
- `src/app/login/page.tsx`: admin sign-in with current-username prefill.
- `src/proxy.ts`: page gate (UX only; data routes self-guard). Replaces deprecated middleware convention.
- `src/app/api/auth/*`: login/logout/username/status/account endpoints.
- `src/app/api/admin/migrate|storage-status|storage-verify`: migration, readiness, diagnostics.
- `src/app/api/blob-upload/[action]`: staged upload endpoints.
- `src/app/api/youtube/keys/usage`: project-grouped quota dashboard API.
- `src/components/settings/account-security.tsx`: username/password change + logout (Settings).
- `src/components/settings/storage-migration.tsx`: Blob status, migration, connection check (Settings).
- `src/components/settings/quota-dashboard.tsx`: per-project buckets + per-key stats UI (local-estimate labeled).
- `src/components/settings/key-metadata-editor.tsx`: per-key Gmail/project/enabled/priority editor.
- `scripts/blob-tests/suites.ts` + `scripts/run-blob-tests.mjs` (`test:blob`, `test:blob:integration`): 116 mocked assertions + scoped real-Blob integration.
- `docs/blob-persistence.md`: Blob/auth/chunking/quota/recovery/troubleshooting guide.
- `src/lib/search-storage/search-storage-archive.ts`: now Blob-backed permanent saved history (same exports; `expiresAt` always null).
- `src/lib/playlists/playlist-archive.ts`: now Blob-backed (same exports; `manifestFile` carries Blob pathname).
- `src/lib/platforms/youtube/youtube-api-keys.ts`: encrypted Blob key store, project/account metadata, pool-aware rotation, invalid-key isolation.
- `src/lib/platforms/youtube/youtube-client.ts`: single choke point — bucket classification, cross-pool rotation, outcome attribution.
- `src/lib/config/search-storage-config.ts`: null expiry = permanent.
- `src/components/layout/navigation.tsx`: app nav incl. external `Dailymotion Discovery` entry (exact `https://dailymotion-video-discovery.vercel.app/`, new tab, `noopener noreferrer`) with local brand SVG.
- `src/components/layout/dailymotion-icon.tsx`: local inline Dailymotion brand-mark SVG (no external image, no generic icon).
- `src/components/saved/saved-library-workspace.tsx`: Saved hub (playlists/items/searches tabs, shared search, standalone detection, add-to-playlist hooks).
- `src/components/library/add-to-playlist-dialog.tsx`: add-to-playlist picker with inline creation and per-playlist duplicate prevention.
- `src/components/library/playlist-detail-workspace.tsx`: individual playlist workspace (search/filter/sort/groups/drag-drop/notes/export/undo).
- `src/app/saved/[playlistId]/page.tsx`: dedicated user-playlist page (distinct from YouTube explorer `/playlists/[playlistId]`).
- `src/app/api/playlists/route.ts` + `src/app/api/playlists/[id]/route.ts`: playlist index/manifest CRUD API.
- `src/types/library.ts`: discriminated user-playlist data model (youtube video/shorts/yt-playlist/channel + custom), groups, manifest v1, canonical video≡shorts identity.
- `src/lib/validation/library-schemas.ts`: Zod contracts for playlist API (no secrets accepted/echoed).
- `src/lib/playlists/playlist-archive.ts`: server-only file archive (`data/playlists/`, atomic writes, lightweight index, no TTL).
- `src/lib/playlists/playlist-query.ts`: YouTube→snapshot adapter, date/views filters, 12 sorts, position resequencing.
- `src/lib/search/local-search.ts`: shared FlexSearch local-search service + adapters (Saved, playlists, History).
- `src/lib/state/user-playlists-store.ts`: client playlist cache + server sync, membership/group/order ops, undo, export download.
- `src/lib/state/youtube-workspace-store.ts`: centralized Zustand store managing persisted workspace state including configurable TTL last search cache with full data preservation, watch preferences, and saved items.
- `src/components/manifests/manifest-summary.tsx`: temporary manifest status and quota summary.
- `src/components/collections/collections-workspace.tsx`: collection management with localStorage persistence, create/delete/search.
- `src/components/saved/saved-library-workspace.tsx`: saved items management with localStorage, search, stats, and deduplication.
- `src/components/history/history-workspace.tsx`: chronological history with `Search history...` keyword filter, unified client + server archive listing, "View Results" action loading full search data from the archive with zero quota consumption, and Back-to-Top control.
- `src/components/watch/watch-sidebar.tsx`: manifest-first suggested videos sidebar with watch settings-based ranking.
- `src/lib/platforms/youtube/*`: server-only official YouTube adapter, normalizer, quota, errors, URL analyzer, search/channel/playlist services.
- `src/lib/filters/youtube-result-filters.ts`: zero-safe local filter and sort pipeline.
- `src/lib/manifests/*`: manifest builder and current runtime store.
- `src/lib/ai/*`: server-only Gemini client, context builder, and response schemas.
- `src/lib/validation/youtube-schemas.ts`: Zod route contracts.
- `src/types/*`: normalized YouTube and manifest contracts.
- `src/app/api/search-storage/*`: dedicated archive API routes (index, full record by ID, latest).
- `src/app/api/youtube/keys/*`: dedicated API key management routes (list/mask, register, select, delete).
- `prisma/schema.prisma`: canonical DB schema.
- `prisma/migrations/*`: append-only migration history.
- `scripts/*`: env and DB guardrails using root `.env.local`.
- `.env.example`: tracked safe environment template.
- `.github/workflows/ci.yml`: validation workflow.

## Current Limitations And Known Risks

- Blob authoritative storage requires `BLOB_READ_WRITE_TOKEN` (+ `BLOB_STORE_ID`) locally and in Vercel; without them protected routes return clear 503/401 errors (never silent local fallback). Store identity is verified by comparing the observed Blob URL host with `BLOB_STORE_ID`; if the host cannot confirm it, diagnostics report UNVERIFIED explicitly.
- Quota figures are LOCAL ESTIMATES from persistent request accounting (search.list ≈ 100 u, other calls ≈ 1 u; Pacific-day reset; `YOUTUBE_DAILY_QUOTA_BUDGET` as assumed allocation). No official Google Cloud monitoring is connected; exact remaining quota and programmatic project-ID verification are unavailable — manual project IDs stay `declared` until correlated exhaustion evidence promotes them to `verified`.
- Password hashing uses scrypt (Node built-in) rather than Argon2id to avoid native bindings on serverless runtimes (documented rationale in code).
- Prisma migration exists but was not applied; the Prisma schema is currently unused by the Blob-backed runtime.
- Shared FlexSearch search favors recall on multi-token queries (best hit ranks first); the weighted fallback guarantees case-insensitive/partial/fuzzy coverage.
- Drag-and-drop is intentionally disabled while search/filters are active or a non-manual sort is selected, so hidden items can never be silently reordered.

- Live YouTube verification requires `YOUTUBE_API_KEY`; missing key returns a controlled unavailable error.
- Live Gemini verification requires `GEMINI_API_KEY`; missing key returns a scoped unavailable response.
- Prisma migration exists but was not applied; the Prisma schema is currently unused (Blob is the authoritative runtime store).
- Access is gated by the single-admin Blob session system (no multi-user model).
- Collections remain localStorage-backed (outside the Blob scope categories).
- Channel and Playlist explorers are the primary entry points but `/channels` and `/playlists` list pages remain scaffolds.
- The root `DESIGN.md` requested by the prompt is absent; `Guide-Files/DESIGN.md`, `DESIGN_DARK.md`, `DESIGN_LIGHT.md`, and HTML inspiration files were used.

## Verification Commands And Expected Checks

- `npm run db:validate`: validates env shape and Prisma schema.
- `npm run lint`: ESLint validation.
- `npm run typecheck`: Prisma generate plus strict TypeScript.
- `npm run build`: env preflight, Prisma generate, Next build.
- `npm run db:status`: checks migration status only when `DATABASE_URL` is present.
- `npm run db:apply`: guarded migration deploy; requires `CONFIRM_DB_APPLY=true`.

Latest verification results on 2026-10-09:

- `npm run lint`: passed (0 errors, 0 warnings) on the final tree.
- `npm run typecheck`: passed (0 errors, incl. final tree).
- `npm run build`: passed cleanly with Next.js 16.2.6 Turbopack (all routes incl. `/login`, `/api/admin/*`, `/api/blob-upload/*`, `/api/youtube/keys/usage`; proxy convention, no Edge warnings).
- `npm run test:blob`: 118 assertions pass (mocked Blob).
- `npm run test:blob:integration` (real private store, `__test__` records only): small round-trip, 12.1 MiB / 7-chunk exact reassemble, index listing, full cleanup — PASSED.
- Live E2E (dev server, 28 assertions): auth gating, bootstrap, CRUD, CSRF 403, usage without plaintext, diagnostics, idempotent migration, key lifecycle, logout revocation — ALL PASSED.
- Earlier Saved-Library verification (disk era): lifecycle, manifest, export, and search checks passed; superseded by the Blob-backed equivalents above.
- Earlier search-module checks: exact/partial/case-insensitive/multi-token/fuzzy-typo ranking verified.
- Pages `/saved`, `/saved/[id]`, `/` return 200 with the Dailymotion sidebar link present.
- Zod for server route validation.

