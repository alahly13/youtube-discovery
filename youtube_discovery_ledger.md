# youtube-discovery Project Ledger

Last updated: 2026-11-03 (Four Canonical OLD Categories, Dedicated OLD & NEW Private Storage Buckets 'old-youtube-discovery-private' & 'new-youtube-discovery-private', Migration 20261103173000, Manifest Upload / Viewer / Export Routes, Collapsible OLD Archive Navigation, Download OLD Data Engine Packaging Browser IndexedDB + LocalStorage into Verifiable ZIP with Secret Redaction and Zero Storage Mutation)

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
- Remote Vercel Blob objects must never be deleted or purged before verified migration to Supabase Storage.

## Current Tech Stack And Library Decisions

- Next.js `16.4.2` App Router with React `19.2.4`.
- TypeScript strict mode (`tsc --noEmit --incremental false`).
- Tailwind CSS 4 with centralized CSS variables in `src/app/globals.css`.
- lucide-react for iconography.
- Zod for server route validation.
- Prisma 7 (`7.10.1`, pinned) with `@prisma/client@7.10.1`, `@prisma/adapter-pg@7.10.1`, and `pg@8.20.0`. Configured via `prisma.config.ts` supporting Supabase pooled (`DATABASE_URL`) and direct (`DIRECT_URL`) connections. All 4 canonical migrations are fully applied and synchronized on remote Supabase PostgreSQL (`_prisma_migrations` initialized, 19 canonical domain models active):
  1. `20261102000000_canonical_v1_4`
  2. `20261102220000_phase1_5_security_and_old_archive`
  3. `20261103150000_canonical_private_bucket`
  4. `20261103173000_old_and_new_buckets_separation`
- Supabase Auth exclusively for user authentication, session cookies, and administrator authorization (`@supabase/ssr@0.12.7`, `@supabase/supabase-js@2.118.0`).
- Supabase PostgreSQL with Prisma 7 (`7.10.1`, pinned) exclusively for application relational data, models, and metadata.
- Cloudflare R2 accessed exclusively through Two Dedicated Cloudflare Workers for all authoritative object storage:
  1. `new-youtube-discovery-api` (bound to `NEW_BUCKET` -> `new-youtube-discovery-private`): active application manifests, dataset generations, and temp data.
  2. `old-youtube-discovery-api` (bound to `OLD_BUCKET` -> `old-youtube-discovery-private`): historical archive manifests across the 4 canonical OLD categories (`asdy/old/...`).
  Zero S3 SDKs, zero AWS credentials. Access is mediated via HMAC-SHA256 capability tokens (`src/lib/storage/r2-capability-token.ts`, `src/lib/storage/r2-worker-storage-client.ts`, `src/lib/storage/r2-blob-backend.ts`).
- Full Portability & Backup Engine: Complete project backup exporter (`src/lib/backup/project-backup-service.ts`, `/api/download-center/full-backup`, `scripts/backup-cli.mjs`) exporting database records, migrations, and Cloudflare R2 objects with SHA-256 checksums and restore CLI script.
- `@vercel/blob` runtime dependency completely removed; Supabase Storage completely retired for object persistence; all storage routes delegate to `R2StorageBackend` (`getOldStorageBackend()`, `getNewStorageBackend()`, `getStorageBackendForBucket()`) with local `DiskStorageBackend` fallback.
- `@next/env` for standalone script env loading from root `.env.local`.
- Google GenAI SDK through server-only Gemini helpers.
- FlexSearch (used): shared local-search service in `src/lib/search/local-search.ts` (Document index, title-weighted, with a weighted fallback matcher) powers Saved Library, playlist contents, and History — strictly local, zero YouTube quota. Zustand, TanStack Query, and Framer Motion remain installed for state/UX expansion.

## Runtime And Deployment Paths

- Local Windows/PowerShell: run from `F:\discovery\youtube-discovery`; keep local secrets in root `.env.local`; use `vercel env pull .env.local --yes` when linked to Vercel.
- Vercel production/preview: configure server-only variables in Vercel Project Settings; do not run database migrations during normal build.
- Supabase PostgreSQL: `DATABASE_URL` and `DIRECT_URL` are server-only; connected to Supabase PostgreSQL 17 with 4 applied migrations and 19 canonical domain tables.
- Supabase Storage: dedicated private buckets `old-youtube-discovery-private` and `new-youtube-discovery-private` configured for archives, active manifests, and exports.
- GitHub Actions: `.github/workflows/ci.yml` runs npm install, lint, typecheck, and build on Node 24.
- Codex/online environment: provider keys and DB may be missing; live provider/DB checks must be reported honestly.

## Architecture Overview

The app is manifest-first. Every provider fetch returns a `YouTubeManifest` with provenance, settings snapshot, pages fetched, quota estimate, status, duplicate count, warnings/errors, and normalized items.

Authoritative persistence uses Cloudflare R2 via `src/lib/storage/r2-blob-backend.ts` and `src/lib/storage/r2-worker-storage-client.ts` with transparent fallback to `DiskStorageBackend` (`data/storage/`) for local offline development.
- OLD archives route strictly to `old-youtube-discovery-private` via `old-youtube-discovery-api` under `asdy/old/<category>/<manifestId>/manifest.json`.
- NEW dataset generations route strictly to `new-youtube-discovery-private` via `new-youtube-discovery-api` under `<owner_uuid>/persistence/datasets/...`.
- Structured data persistence is fully connected to Prisma 7 / Supabase PostgreSQL across all 19 canonical models.
- Object storage routes through dedicated Cloudflare Workers using short-lived cryptographic capability tokens.
- Manifests, playlists, and search histories are permanently stored without TTL data loss.
- Complete Project Backup & Restore Engine allows full offline portability (database JSON + SQL dump + migrations + storage objects + restore CLI script).
- Browser Data Recovery Engine ingests Chrome storage without mutation and produces compliant ZIP archives.

Access is gated by a single-admin session system with Supabase Auth (`@supabase/ssr`) prioritized alongside legacy scrypt password session fallback. Every data API route enforces `requireAdmin()` itself; middleware redirects are UX only. `/login` and the username prefill endpoint are the only public surfaces.

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

- `/login`: single-administrator sign-in with Supabase Auth and session store fallbacks.
- `/`: dashboard with product posture, system boundaries, quick actions, and manifest overview.
- `/saved`: **FULL DEDICATED** Saved Items page supporting all 3 YouTube entity types (Videos, Channels, Playlists) with **Daily Grouping** by calendar date (e.g., "November 2, 2026", newer first, clear visual separators), type filters (All, Videos, Channels, Playlists), search, sort, add-to-playlist actions, and **Phase 1.6 UI Readability Upgrades** (spacious 3-column responsive grid `grid gap-5 sm:grid-cols-2 lg:grid-cols-3`, crisp 16:9 thumbnail containers, centered circular channel artwork, and prominent 2-line title typography `line-clamp-2 text-base font-bold`).
- `/playlist-manager`: **FULL DEDICATED** Personal Playlist Manager workspace for creating, editing, renaming, deleting, and reviewing personal playlists, featuring prominent video thumbnail galleries, bold multi-line titles (`line-clamp-2 text-base font-bold`), item count badges, section badges, and direct links to `/saved/[playlistId]`.
- `/saved-searches`: **FULL DEDICATED** Saved Searches workspace for pinned search titles, quick rerun links (`/search?q=...`), copyable titles with enhanced readability (`line-clamp-2 text-base font-bold`), and research notes.
- `/saved/[playlistId]`: **FULL** personal-playlist workspace — enlarged media thumbnails (`h-20 w-36 sm:h-22 sm:w-40`), multi-line wrapped titles (`line-clamp-2 text-base font-bold`), in-playlist FlexSearch search, content-type/date/views filters, 12 transient sort modes plus canonical manual order, user sections/groups (create/rename/note/collapse/reorder/delete keep-or-delete), custom items/notes, HTML5 drag-and-drop with Move Up/Down alternatives, multi-select bulk move/copy/group/remove, Undo, and self-contained JSON export. Zero YouTube API calls.
- `/search`: general YouTube Search workspace with provider settings, manifest summary, local filters, result cards, export, scoped AI panel, Unrestricted Mode toggle, custom Saved Search Titles shelf, configurable search results retention (default 168h / 7 days via `SEARCH_STORAGE_TTL_HOURS`), complete rawJson archive preservation, instant direct load from archive via `?load=[id]`, and Back-to-Top control. The three query-utility buttons (Shuffle Words, Trim Spaces, Shuffle One Word) rewrite the visible input ONLY — they never submit, call the API, or record history; the user presses Search explicitly.
- `/search-guide`: static Search Guide 2026 reference (documented vs experimental vs structured-filter labels, Arabic explanations, copyable examples, official doc links).
- `/ai-search`: AI Search / AI Discovery workspace and safety contract.
- `/link-explorer`: parses YouTube URLs and reports official API strategy without scraping.
- `/channels`: **FULL** saved channel library (localStorage-backed).
- `/channel-explorer`: channel uploads workflow scaffold.
- `/channels/[sourceId]`: **FULL** channel explorer with YouTube-like profile header, uploads manifest, local filters/sort/search-inside-channel, export, and scoped AI panel.
- `/playlists`: **FULL** saved playlist library (localStorage-backed).
- `/playlist-explorer`: playlist workflow scaffold.
- `/playlists/[playlistId]`: **FULL** playlist explorer with order-preserving list/grid view, play-next navigation, local filters/sort/search-inside-playlist, export, and scoped AI panel.
- `/manifests`: **FULL** Manifest Storage Explorer workspace with real-time PostgreSQL registry reconciliation, Supabase Storage browser, 6 canonical reconciliation states, individual part download stream, and generation ZIP exports.
- `/manifests/upload`: **FULL DEDICATED** Manifest Upload workspace with dual-destination selector (OLD historical archive vs NEW active dataset generation), 4-category selector for OLD with real-time derived storage path preview, dataset generation batch upload for NEW, collision detection, and verified persistence.
- `/manifests/viewer`: **FULL DEDICATED** 100% Read-Only Manifest Viewer & Inspector, allowing side-by-side inspection of registered or local manifest files with item type filters (ALL, VIDEO, SHORTS, CHANNELS, PLAYLISTS), raw JSON modal, and zero storage mutation.
- `/manifests/export`: **FULL DEDICATED** Manifest Export workspace for downloading authentic, unaltered manifest files directly from Supabase Storage or assembling multi-manifest ZIP archives with authentic `SHA256SUMS.txt`.
- `/manifests/[manifestId]`: **FULL** manifest detail workspace with local search/filter/sort, export, and scoped AI analysis.
- `/collections`: DEPRECATED and REMOVED in Phase 1.4 in favor of dedicated Saved Items (`/saved`), Playlist Manager (`/playlist-manager`), and Saved Searches (`/saved-searches`).
- `/history`: **FULL** chronological history workspace with shared FlexSearch `Search history...` filter across title/query/metadata without calling YouTube API, unified client + server archive listing, "View Results" action loading full search data from the archive with zero quota consumption, and Back-to-Top control.
- `/old`: **FULL DEDICATED** OLD Legacy Manifest Archive Dashboard with overview statistics, dedicated bucket `old-youtube-discovery-private` monitor, 4 category cards with exact `asdy/old/...` prefixes, UNCLASSIFIED records section, embedded `Download OLD Data` modal CTA, recent imported archives table, and quick import CTA.
- `/old/saved-items`: **Category 1** Dedicated archive browser for legacy saved items (`asdy/old/saved-items/`) featuring 4 explicit classification filters (`VIDEO`, `SHORTS`, `CHANNELS`, `PLAYLISTS`), upgraded spacious 3-column thumbnail grid (`grid gap-5 sm:grid-cols-2 lg:grid-cols-3`), 2-line title wrapping (`line-clamp-2 text-base font-bold`), engagement counters, and one-click Raw JSON inspection modal.
- `/old/saved-playlists`: **Category 2** Dedicated archive browser for legacy saved playlists (`asdy/old/saved-playlists/`).
- `/old/saved-titles-links`: **Category 3** Dedicated archive browser for legacy saved titles and links (`asdy/old/saved-titles-links/`).
- `/old/saved-search-history`: **Category 4** Dedicated archive browser for legacy saved search history (`asdy/old/saved-search-history/`).
- `/old/saved-titles`, `/old/search-history`, `/old/other`: Transparent redirect fallbacks routing legacy bookmarks safely to the 4 canonical categories without 404s.
- `/old/import`: Dedicated drag & drop and local file upload workspace with client-side preview, 4-category selector, SHA-256 conflict detection, and import into `old-youtube-discovery-private`.
- `/download-center`: **FULL DEDICATED** Manifest Download Center (مركز التحميل) with multi-origin filtering (ALL, NEW active domain manifests, OLD historical archives), category filter pills, multi-manifest batch selection, bulk export engine assembling canonical ZIPs, individual manifest metadata inspector, and embedded `Download OLD Data` button.
- `/download-center/legacy-recovery`: **FULL DEDICATED** Legacy Data Recovery Center with read-only discovery matrix across Vercel Blob (cursor-paginated REST scanner), disk cache, application runtime caches, and browser storage (IndexedDB `youtube_discovery_local_v1` + localStorage), category classification across 8 canonical categories, zero-deletion safety guarantees, and offline verifiable backup ZIP generation (`YouTube-Discovery-Legacy-Backup/...`).
- `/watch/[videoId]`: embedded playback with manifest-first suggested videos sidebar, Zustand-backed watch settings, and graceful error handling.
- `/settings`: **FULL** Settings page with environment status, Default SafeSearch & Sensitivity Policy, persistent YouTube Fetch Controls, YouTube API Key Management (multi-key rotation, safe masked strings, active key switching, custom key deletion, per-key Gmail/project metadata editing), Quota Pools & Usage dashboard (per-project buckets, local-estimate confidence, per-key stats, last-request attribution), Private Storage & Migration card, Account Security card (username/password change, logout).

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
- `POST /api/old/preview`: parse and preview local legacy manifest file without persistence.
- `POST /api/old/import`: validate, upload to `ASDY/OLD/<storage_owner_uuid>/<category>/<manifest_id>/manifest.json`, insert into `archived_manifests`, reject SHA-256 duplicates.
- `GET /api/old/list`: list archived manifests for current owner with category filter.
- `GET /api/old/[archiveId]`: retrieve archived manifest record and parsed envelope with item classification breakdown.
- `GET /api/old/[archiveId]/download`: download raw archived manifest JSON as attachment.
- `GET /api/download-center/inventory`: unified manifest inventory combining live domain PostgreSQL records and historical `archived_manifests` / storage archives across all 8 canonical categories.
- `POST /api/download-center/export`: multi-manifest ZIP packager building `ASDY/NEW/<category>/...` and `ASDY/OLD/<category>/...` layouts with `ASDY/SHA256SUMS.txt` and `ASDY/export-manifest.json`.
- `POST /api/download-center/full-backup`: protected endpoint streaming complete project backup ZIP (all 19 database tables JSON, schema DDL, applied migrations, logical SQL dump, storage objects, SHA256SUMS, and self-contained restore runner) for total data portability.
- `POST /api/download-center/legacy-recovery/scan`: protected legacy data discovery scanner with read-only safety guarantees across Vercel Blob, disk cache, and browser storage.
- `POST /api/download-center/legacy-recovery/backup`: protected offline verifiable backup package generator streaming ZIP (`YouTube-Discovery-Legacy-Backup/...`) with `backup-manifest.json` and `checksums/SHA256SUMS.txt`.
- `POST /api/ai/youtube-search-assistant`: scoped AI search helper.
- `POST /api/ai/youtube-manifest-assistant`: scoped manifest analyst.
- `POST /api/ai/youtube-video-explorer`: selected-video AI explorer.

Server-only modules import `server-only` where secrets/providers are involved. Prisma, Gemini, and YouTube clients are not imported into client components or proxy/middleware.

## Database And Schema Concepts

Canonical schema: Approved Phase 1.5 schema foundation with Canonical Private Storage Bucket extension. All 19 models defined in `prisma/schema.prisma` and migrations authored and deployed via Prisma migration engine:
1. `prisma/migrations/20261102000000_canonical_v1_4_foundation`
2. `prisma/migrations/20261102220000_phase1_5_security_and_old_archive`
3. `prisma/migrations/20261103150000_canonical_private_storage_bucket`

Migrations: Applied to remote Supabase PostgreSQL 17 (`qrsjlyminkpfcqpsnrxj`). Status is `SYNCHRONIZED` (verified with `npm run db:migrations:check`). The `_prisma_migrations` table records all 3 migrations as successfully applied.

Canonical 19 models (Phase 1.5 Architecture: 18 Core + 1 Archive Extension):

- `user_profiles`: Authenticated profile 1:1 with `auth.users(id)` (via `ON DELETE SET NULL`), containing `storage_owner_uuid` for permanent physical storage paths, role: 'admin' | 'user', and security lockout flags. Admin user 'asdy' mapped to authoritative profile with role 'admin'.
- `user_preferences`: 1:1 user settings, theme, auto-save settings, and preferred timezone.
- `storage_datasets`: Authoritative registry of manifest datasets scoped to `owner_id`, with `current_revision` and `current_generation_id` pointer guarded by `trg_dataset_current_generation_guard`.
- `storage_generations`: Committed immutable generation snapshots with linear parent lineage enforced by `uq_storage_generations_linear`, deterministic binary aggregate SHA-256, and composite foreign key `(owner_id, dataset_id, source_batch_id)` to `save_sync_batches`.
- `storage_manifest_parts`: Individual chunks <= 45 MiB with exact UTF-8 byte counts and SHA-256 digests.
- `storage_temp_objects`: Managed temporary and staging files with explicit TTL expirations and status lifecycle.
- `saved_items_index`: Lightweight relational index for Saved Items (Videos, Channels, Playlists) with daily date grouping in owner timezone. Provenance foreign keys to parts use `ON DELETE SET NULL (generation_id, manifest_part_id)` with all-or-none check constraint, guarded by atomic pre-delete trigger on parts.
- `user_playlists`: Personal playlists metadata, display order, and thumbnail aggregates.
- `user_playlist_groups`: Section headers/groups inside personal playlists (composite key `(playlist_id, id)`).
- `user_playlist_entries`: Ordered memberships (composite FK to group with `ON DELETE SET NULL (group_id)`, deduplicated by `(playlist_id, platform_item_id)` for YouTube items).
- `research_queue_items`: “Items I Will Search For” saved from search/AI result cards (provenance `ON DELETE SET NULL`, guarded by atomic pre-delete trigger on parts).
- `saved_references`: Manually saved titles, articles, and external non-YouTube URLs (provenance `ON DELETE SET NULL`, guarded by atomic pre-delete trigger on parts).
- `saved_search_presets`: Reusable query presets with filters, tags, and pinned state.
- `search_history_records`: Permanent audit of executed searches with raw manifest links (`ON DELETE RESTRICT`).
- `managed_api_keys`: AES-256-GCM encrypted YouTube API v3 keys with AAD binding per owner.
- `quota_usage_events`: Idempotent YouTube API request accounting and attribution with request fingerprints (`request_sha256`) and `ON DELETE RESTRICT`.
- `save_sync_batches`: Option A (Single Dataset Per Batch) sync coordinator with `expected_revision` concurrency lock and request fingerprinting.
- `audit_logs`: Security and high-impact administrative actions (append-only/restricted, `ON DELETE RESTRICT`).
- `archived_manifests`: Dedicated historical manifest archive registry table for legacy imported files under `ASDY/OLD/`, tracking `manifest_id`, `category`, `source_format`, `storage_path`, `byte_count`, `record_count`, `content_sha256`, authentic timestamps (`source_created_at`, `source_exported_at`, `imported_at`), and filter summaries. Completely isolated from active data.

Security Hardening (Phase 1.5):
- **A1 — Atomic Reference Cascade Trigger:** `trg_nullify_manifest_part_references` on `storage_manifest_parts` automatically nullifies `generation_id`, `manifest_part_id`, and `item_position` across `saved_items_index`, `research_queue_items`, and `saved_references` before part deletion, ensuring the `chk_*_manifest_provenance_all_or_none` constraint is never violated.
- **A2 — Linear Succession & Single Root Constraints:** Two partial unique indexes (`uq_storage_generations_single_root` and `uq_storage_generations_linear_successor`) ensure exactly one committed root generation per dataset and strictly linear non-forking chains, plus `chk_storage_generations_no_self_parent`.
- **A3 — Database Immutability Triggers:** `trg_prevent_committed_generation_mutation` and `trg_prevent_committed_manifest_part_mutation` prevent any `UPDATE` or `DELETE` on committed generations or their parts, with a secure session escape hatch `app.privileged_maintenance = 'on'`.
- **A4 — Direct Batch-Generation Relationship:** Composite FK `(owner_id, dataset_id, source_batch_id)` referencing `save_sync_batches(owner_id, dataset_id, id)` with unique index `uq_storage_generations_source_batch` ensuring at most one generation per sync batch.
- **A5 — Supabase Storage RLS Policies:** Complete RLS on `storage.objects` for canonical bucket `youtube-discovery-private` (and legacy alias `youtube-discovery`) authorizing owner partition `<storage_owner_uuid>/...` and logical archive root `ASDY/OLD/<storage_owner_uuid>/...`. Strict enforcement that `UPDATE` and `DELETE` operations are ONLY permitted on temporary paths (`/temp/%`), with permanent manifests and archives immutable.
- **A6 — SECURITY DEFINER Function Hardening:** All security definer functions (`current_user_profile_id`, `audit_log_append_internal`, etc.) hardened with `SET search_path = ''` and schema-qualified references.

Collections status: Completely removed in Phase 1.4.

Owner scope is represented by `owner_id UUID NOT NULL REFERENCES user_profiles(id)`. Every user-owned record is strictly partitioned. Application access remains single-administrator (`role = 'admin'`) for now, while database architecture is natively multi-user-ready.

Migration status: All 3 migrations deployed and synchronized on remote Supabase PostgreSQL. Verified via `npm run db:migrations:check` with exit code 0.

## Environment Variable Map

Blob/auth/quota persistence (server-only, never `NEXT_PUBLIC_*`):

- `BLOB_STORE_ID` — expected store id; validated + compared with observed Blob URL host.
- `BLOB_READ_WRITE_TOKEN` — private SDK token for all Blob I/O. No local-only fallback when missing.
- `BLOB_WEBHOOK_PUBLIC_KEY` — webhook signature verification ONLY. No webhook endpoint exists, so NOT required for reads/writes/auth.
- `ADMIN_EMAIL` — Email of the authoritative admin account in Supabase Auth (default `asdy@youtube.discov.com`).
- `ADMIN_DEFAULT_USERNAME` (default `asdy`), `ADMIN_PASSWORD` / `ADMIN_INITIAL_PASSWORD` / `SUPABASE_ADMIN_PASSWORD` — admin credentials for login and automated Supabase Auth password synchronization (minimum 8 chars). When configured, logging in with username "asdy" automatically maps to `asdy@youtube.discov.com` and synchronizes the password in Supabase Auth.
- `ADMIN_SESSION_SECRET` — session/rate-limit salt (independent secret).
- `SESSION_TTL_SECONDS` / `ADMIN_SESSION_TTL_SECONDS` / `SUPABASE_SESSION_TTL_SECONDS` (default `604800` = 7d = 1 week; accepts raw seconds or human units `7d`, `1w`, `24h`; clamped 300s–30d). Controls both Supabase Auth cookie max-age and local session cookie max-age.
- `API_KEYS_ENCRYPTION_KEY` — 32-byte AES-256-GCM key (base64/hex/raw-32). Saves refused without it. Back up securely.

Public:

- `NEXT_PUBLIC_APP_URL`
- `NEXT_PUBLIC_SUPABASE_URL` — Supabase project API URL (e.g. `https://<ref>.supabase.co`).
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` — Supabase publishable key / anon key for client and server auth.

Server-only:

- `DATABASE_URL` — Supabase PostgreSQL pooled connection string (port 6543/5432 with pgbouncer=true).
- `DIRECT_URL` — Supabase PostgreSQL direct connection string (port 5432).
- `SUPABASE_SECRET_KEY` / `SUPABASE_SERVICE_ROLE_KEY` — Server-only secret keys for bypassing RLS, admin auth, user discovery, and background tasks. NEVER expose to the browser.
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
- `implementation-guide.md`: authoritative engineering implementation specification (v1.3); details Phase 0–1.3, multi-user foundation, direct permanent storage uploads, storage explorer, and approval gates.
- `docs/data-architecture/erd.md`: canonical ERD (v1.3) with 18 tables, full generational chain composite foreign keys with linear parent lineage, current generation trigger, and decoupled resource types.
- `docs/data-architecture/data-dictionary.md`: canonical data dictionary (v1.3) with exact 18 tables, nullable auth_user_id ON DELETE SET NULL, zero-coercion rule, soft-delete key archiving, and account suspension flags.
- `docs/data-architecture/manifest-format.md`: manifest format and physical storage explorer specification (v1.3) with direct permanent uploads to <owner-auth-uuid>/persistence/..., 40/45 MiB sizing, PostgreSQL generation authority, 6 reconciliation states, and raw downloads/ZIP exports.
- `docs/data-architecture/sync-and-recovery.md`: sync and crash recovery architecture (v1.3) detailing Option A single-dataset batches (no batch_items), direct immutable upload saga, row-level locks, and outbox lifecycle.
- `docs/data-architecture/implementation-plan.md`: implementation roadmap across Phases A through G (v1.3) establishing strict approval gates and decoupled execution milestones.
- `docs/data-architecture/adr-001-multi-user-storage-explorer.md`: architectural decision record ADR-001 (v1.3) resolving all v1.3 relational, lifecycle, and storage review findings.
- `docs/data-architecture/current-state.md`: comprehensive Phase 0 audit of repository persistence sources, environments, and legacy dependencies.
- `docs/security/auth-storage-rls.md`: comprehensive security specification (v1.3) including full 18-table RLS matrix, hardened current_user_profile_id(), role immutability trigger, versioned key envelope with AAD, and Supabase Storage path isolation.
- `docs/database/migration-management.md`: read-only Prisma 7 migration CLI guide, verification commands, and exit code reference.
- `scripts/db-migrations/*`: read-only migration management CLI toolkit (`npm run db:migrations`, `npm run test:migrations`).
- `Guide-Files/youtube-discovery_full_guide_2026_updated.md`: primary product and architecture guide.
- `Guide-Files/ai_youtube_discovery_ai_agent_prompt_rules_2026.md`: AI and implementation prompt/safety guide.
- `Guide-Files/git_github_arabic_commands_guide.md`: Arabic Git/GitHub command workflow guide.
- `Guide-Files/npm_commands_arabic_guide.md`: Comprehensive Arabic NPM and NPX commands reference guide.
- `DESIGN_DARK.md`, `DESIGN_LIGHT.md`, `design-inspiration/*`: visual inspiration, not product truth.
- `src/app/globals.css`: design tokens and global layout safeguards; avoid one-off color systems.
- `src/app/layout.tsx`: root metadata, fonts, and theme boot script.
- `src/components/layout/*`: app shell, navigation, theme toggle, and SignOutButton; features responsive desktop and mobile Show/Hide Navbar controls, sidebar collapse button, and top-level sign out; keep provider secrets out.
- `src/components/ui/back-to-top.tsx`: reusable smooth-scrolling floating Back-to-Top button.
- `src/components/search/search-workspace.tsx`: main client search experience; local filters do not call YouTube; includes configurable TTL search persistence (default 168h / 7 days), complete rawJson archive preservation, instant direct load from archive via `?load=[id]`, and Back-to-Top control.
- `src/lib/config/search-storage-config.ts`: centralized safe TTL parser and expiration calculation module.
- `src/lib/blob/blob-paths.ts`: versioned private-Blob pathname layout (`youtube-discovery/v1/...`).
- `src/lib/blob/blob-config.ts`: token/OIDC resolution + validation (no secrets in errors).
- `src/lib/blob/blob-backend.ts`: swappable byte adapter interface + in-memory mock for tests.
- `src/lib/blob/vercel-blob-backend.ts`: production storage adapter delegating to R2StorageBackend (`new-youtube-discovery-private`).
- `src/lib/storage/r2-capability-token.ts`: cryptographic capability token engine; signs short-lived (120s) HMAC-SHA256 JWTs with operation, key scope, and audience validation.
- `src/lib/storage/r2-worker-storage-client.ts`: centralized HTTPS client for the two Cloudflare Workers (`new-youtube-discovery-api` and `old-youtube-discovery-api`).
- `src/lib/storage/r2-blob-backend.ts`: authoritative BlobBackend adapter connecting the app to Cloudflare R2 through the two Workers with local Disk fallback.
- `src/lib/storage/supabase-storage-backend.ts`: backward-compatibility bridge re-exporting R2StorageBackend (Supabase Storage retired).
- `cloudflare/workers/new-youtube-discovery-api/*`: Cloudflare Worker handling active application datasets, manifests, and temp files (`new-youtube-discovery-private`).
- `cloudflare/workers/old-youtube-discovery-api/*`: Cloudflare Worker handling historical archive manifests across the 4 canonical OLD categories (`old-youtube-discovery-private`).
- `scripts/test-cloudflare-r2-workers.mjs`: automated test suite validating capability tokens, worker isolation, and SHA-256 integrity.
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
-`src/lib/auth/require-auth.ts`: per-route `requireAdmin()` guard + same-origin CSRF check; strictly verifies authoritative Supabase session via `getUser()` and fails closed (401) without insecure fallback cookies.
- `src/lib/keys/key-crypto.ts`: AES-256-GCM for managed key values (refuses plaintext saves).
- `src/lib/keys/quota-pools.ts`: project pools, buckets, CAS usage accounting, Pacific-day docs, dashboard math.
- `src/lib/client/auth-fetch.ts`: 401→login redirect fetch wrapper.
- `src/lib/client/blob-upload.ts`: small-direct vs staged-chunked save for large search records.
- `src/app/login/page.tsx`: admin sign-in with high-contrast error alert (`AlertCircle`), input disabling during submission, and default post-login redirect to `/search`.
- `src/proxy.ts`: edge UX gate directing authenticated visitors immediately to `/search` and unauthenticated visitors to `/login`. Replaces deprecated middleware convention.
- `src/app/api/auth/*`: login/logout/username/status/account endpoints; `POST /api/auth/login` verifies credentials against Supabase Auth, binds HTTP-only cookies to response, verifies session with `getUser()` server-side, and enforces configurable 1-week TTL.
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
- `src/app/search-guide/page.tsx`: static Search Guide 2026 reference page (server component, utilities + sections A–I, support badges, RTL Arabic + LTR copyable examples).
- `src/components/search-guide/copy-button.tsx`: client-isolated clipboard button for guide examples.
- `src/components/layout/navigation.tsx`: app nav incl. `Search Guide 2026` (`/search-guide`) entry plus external `Dailymotion Discovery` entry (exact `https://dailymotion-discovery.vercel.app/`, new tab, `noopener noreferrer`) with local brand SVG.
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
- `src/lib/search/query-pipeline.ts`: verbatim-query acceptance helpers (blank-gate only, single-encode round-trip).
- `src/lib/search/query-transforms.ts`: Shuffle Words (Fisher–Yates, quoted phrases stay whole, separators fixed) / Trim Spaces (outer trim + inner collapse to one space) / Shuffle One Word (first 3 grapheme clusters fixed, suffix-only Fisher–Yates) — input-only rewrites, injectable randomness.
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
- `src/lib/old/archive-envelope.ts`: Core envelope types, 4-filter classifier (`VIDEO`, `SHORTS`, `CHANNELS`, `PLAYLISTS`), category detector, pure Node.js ZIP extractor with Zip-Slip/Zip-Bomb protection, NDJSON parser, and SHA-256 calculator.
- `src/lib/old/archive-store.ts`: Store service managing upload to `ASDY/OLD/`, database persistence in `archived_manifests`, SHA-256 deduplication, and listing with storage fallback.
- `src/app/api/old/*`: Backend API routes for preview, import, listing, detail, and download.
- `src/lib/recovery/legacy-scanner.ts`: Core legacy recovery scanner enumerating Vercel Blob via paginated REST API, local disk caches, and evaluating application/compiler caches with strict zero-deletion safety guarantees.
- `src/lib/recovery/legacy-backup-builder.ts`: Offline verifiable backup builder assembling `YouTube-Discovery-Legacy-Backup/` ZIP with source inventory, recovery report, integrity report, ASDY mirrors, and `checksums/SHA256SUMS.txt`.
- `src/lib/recovery/client-browser-scanner.ts`: Client-side scanner capturing IndexedDB (`youtube_discovery_local_v1` across 11 stores) and application-scoped localStorage keys.
- `src/lib/download-center/download-center-service.ts`: Unified inventory and multi-manifest export engine creating `ASDY/NEW/` and `ASDY/OLD/` layouts with `ASDY/export-manifest.json` and `ASDY/SHA256SUMS.txt`.
- `src/components/download-center/download-center-workspace.tsx`: Unified Download Center workspace UI supporting origin filters (ALL, NEW, OLD), 8-category pills, multi-manifest selection, and bulk export.
- `src/components/download-center/legacy-recovery-workspace.tsx`: Dedicated Legacy Data Recovery Center UI with read-only safety guarantees, source discovery matrix, browser storage scanner, and backup download CTA.
- `src/app/download-center/page.tsx`: Page route for `/download-center`.
- `src/app/download-center/legacy-recovery/page.tsx`: Page route for `/download-center/legacy-recovery`.
- `src/app/api/download-center/inventory/route.ts`: Protected endpoint returning unified manifest inventory across NEW and OLD sources.
- `src/app/api/download-center/export/route.ts`: Protected endpoint streaming assembled multi-manifest ZIP.
- `src/app/api/download-center/legacy-recovery/scan/route.ts`: Protected endpoint executing read-only legacy storage scan.
- `src/app/api/download-center/legacy-recovery/backup/route.ts`: Protected endpoint streaming verifiable legacy backup ZIP.
- `scripts/recovery-tests/suites.ts` + `scripts/test-phase1-6-recovery-and-download.mjs`: 93-assertion automated test suite for Phase 1.6 covering legacy scanner, cache evaluation, backup packaging, download center inventory, export layout, and 48 zero-deletion proof checks (`npm run test:recovery`).
- `src/components/saved/raw-json-inspector-dialog.tsx`: Shared raw JSON inspection modal with one-click copy.
- `src/components/old/*`: Workspaces for Dashboard, Saved Items (with 4 filters and inspector), Category Browser (Saved Titles, Saved Playlists, Search History, Other), and Import Preview.
- `src/app/old/*`: Page routes for `/old`, `/old/saved-items`, `/old/saved-titles`, `/old/saved-playlists`, `/old/search-history`, `/old/other`, `/old/import`.
- `scripts/test-phase1-5-database-security.mjs`: Test suite verifying A1-A6 database and storage security controls.
- `scripts/test-phase1-5-old-archive.mjs`: Test suite verifying legacy envelope parsing, 4-filter classification, ZIP extraction, and store functionality.
- `prisma/migrations/20261102220000_phase1_5_security_and_old_archive/migration.sql`: Migration script containing all Phase 1.5 triggers, partial unique indexes, RLS policies, and `archived_manifests` table DDL.
- `scripts/db-migrations/cli.mjs`: Prisma 7 migration management CLI entrypoint (`npm run db:migrations`).
- `scripts/db-migrations/core.mjs`: safe read-only PostgreSQL migration inspector querying `_prisma_migrations`.
- `scripts/db-migrations/local.mjs`: local migration directory inspector and SHA-256 checksum calculator.
- `scripts/db-migrations/reconcile.mjs`: reconciliation engine comparing local files and recorded database history.
- `scripts/db-migrations/renderer.mjs`: terminal dashboard formatter with unicode box art, color-coded indicators, and summary metrics.
- `scripts/db-migrations/test-migrations-cli.mjs`: 43-assertion verification suite covering all 8 representative migration scenarios.
- `docs/data-architecture/current-state.md`: Phase 0 repository, routes, data contracts, and persistence audit.
- `docs/data-architecture/erd.md`: Phase 1 canonical Entity-Relationship Diagram (design proposal pending approval).
- `src/lib/auth/user-profile.ts`: Authoritative administrator user profile resolver and bootstrap mapping Supabase Auth UUID to `user_profiles` (`username = 'asdy'`, `role = 'admin'`, `storage_owner_uuid`).
- `src/lib/backup/project-backup-service.ts`: Full project backup and portability engine exporting all 19 PostgreSQL tables into structured JSON, capturing Prisma schema, all migration SQL, generating pg_dump-compatible logical SQL dump, packaging storage objects from `youtube-discovery-private`, creating `SHA256SUMS.txt`, manifest report, and generating a self-contained Node.js `restore.mjs` script.
- `src/app/api/download-center/full-backup/route.ts`: Protected endpoint streaming the complete full project backup archive (`YouTube-Discovery-Full-Backup-<timestamp>.zip`).
- `scripts/backup-cli.mjs`: Pure Node.js CLI backup runner (`npm run db:backup`) generating identical verifiable full project backups without requiring a running web server.
- `scripts/test-remote-integration.mjs`: Real live integration test suite verifying 41 assertions against remote Supabase PostgreSQL 17 and private Storage bucket `youtube-discovery-private`.
- `prisma/migrations/20261103150000_canonical_private_storage_bucket/migration.sql`: Canonical migration registering the private bucket `youtube-discovery-private` (50 MiB limit) and establishing owner-scoped RLS policies on `storage.objects`.
- `docs/data-architecture/data-dictionary.md`: Phase 1 table-by-table column types, nullability, constraints, indexes.
- `docs/data-architecture/manifest-format.md`: Phase 1 manifest dataset sizing (40/45 MiB), immutable parts, and generational chain.
- `docs/data-architecture/sync-and-recovery.md`: Phase 1 local durability, atomic outbox, power-loss protection, and Save Center.
- `docs/database/migration-management.md`: professional documentation for migration CLI tools, indicators, exit codes, and workflows.
- `prisma/schema.prisma`: canonical DB schema foundation with all 19 domain models and `@prisma/adapter-pg` driver adapter.
- `prisma/migrations/*`: append-only migration history with 3 applied and synchronized migrations (`20261102000000_canonical_v1_4_foundation`, `20261102220000_phase1_5_security_and_old_archive`, `20261103150000_canonical_private_storage_bucket`).
- `scripts/*`: env and DB guardrails using root `.env.local`.
- `vercel-blob-backup/`: Local mirror directory containing all 86 blobs (16.15 MB) downloaded from Vercel Blob before decommissioning, preserving full directory structure (`youtube-discovery/v1/...`).
- `src/lib/recovery/local-data-center-service.ts`: Unified client-side browser storage inventory & management engine. Discovers localStorage, IndexedDB (`youtube_discovery_local_v1`), Cache Storage, and OPFS across 5 canonical dataset categories (`SAVED_ITEMS`, `PLAYLIST`, `SEARCH_HISTORY`, `RESEARCH_QUEUE`, `REFERENCES`) with strict secret redaction and safe deletion safeguards.
- `src/app/api/local-data/backup/route.ts`: Authenticated backup export endpoint structuring client storage into standard directories (`Saved-Items/`, `Playlists/`, etc.) with `backup-manifest.json` and `SHA256SUMS.txt` inside PKZIP 2.0.
- `src/components/local-data/local-data-center-workspace.tsx`: Primary workspace for the dedicated Local Data Center page (`/dashboard/local-data` & `/local-data`), providing 7-card Storage Overview metrics, live Browser Data Explorer with multi-mechanism filtering and safe JSON preview, read-only Backup & Export, and permanent Deletion review.
- `src/components/local-data/local-data-deletion-modal.tsx`: Destructive deletion confirmation dialog requiring exact Arabic confirmation phrase ("احذف بياناتي المحلية"), category filtering, and protected token exclusion.
- `src/app/dashboard/local-data/page.tsx` & `src/app/local-data/page.tsx`: Dedicated page routes wrapped in `AppShell` with full sidebar navigation integration.
- `.env.example`: tracked safe environment template.
- `.github/workflows/ci.yml`: validation workflow.

## Current Limitations And Known Risks

- Quota figures are LOCAL ESTIMATES from persistent request accounting (search.list ≈ 100 u, other calls ≈ 1 u; Pacific-day reset; `YOUTUBE_DAILY_QUOTA_BUDGET` as assumed allocation).
- Remote Vercel Blob objects remain safely in the remote store and can be imported to Supabase Storage once credentials are provided; zero deletion policy preserved.
- Database access is direct to Supabase PostgreSQL 17; all 19 canonical models are active and migrations are synchronized.

## Verification Commands And Expected Checks

- `npm run db:migrations`: Full formatted Prisma 7 migration status dashboard.
- `npm run db:migrations:local`: Inspect local migration files without database access.
- `npm run db:migrations:check`: Validate synchronization between local and database history (strict exit code).
- `npm run db:migrations:json`: Machine-readable JSON export of migration status.
- `npm run db:backup`: Generate complete standalone full project backup ZIP via CLI.
- `node scripts/test-remote-integration.mjs`: Run real remote integration audit against Supabase database & storage (41 assertions).
- `npm run test:migrations`: 43-assertion automated suite verifying all 8 mocked migration scenarios.
- `npm run test:security`: 15-assertion automated suite verifying Phase 1.5 database triggers, single root uniqueness, linear lineage, composite batch FK, storage RLS, and security definer search_path hardening.
- `npm run test:old`: 15-assertion automated suite verifying OLD legacy manifest archive envelope parsing, 4-filter classification, pure Node.js ZIP extraction, and archive store operations.
- `npm run test:recovery`: 93-assertion automated suite verifying Phase 1.6 legacy storage discovery, 8-category classification, cache evaluation, verifiable backup ZIP packaging, download center multi-manifest export, and 48 zero-deletion proof checks.
- `npm run test:auth`: Automated test suite verifying Supabase Auth connection, admin user "asdy" resolution, route-handler cookie integration, and configurable 1-week session TTL.
- `npm run lint`: ESLint validation (0 errors).
- `npm run typecheck`: strict TypeScript check (`tsc --noEmit --incremental false`).
- `npm run test:blob`: 118 assertions unit test suite for storage.
- `npm run test:search`: 77 assertions unit test suite for search query transforms.
- `npm run verify`: One-step end-to-end verification (`npm run lint && npm run typecheck && npm run test:security && npm run test:old && npm run test:recovery && npm run test:auth && npm run build`).

Latest verification results on 2026-11-03 (Complete Remote Supabase Database & Storage Deployment + Full Portability):

- `npm run typecheck`: passed (0 errors; Prisma Client v7.10.1 generated + strict tsc check).
- `npm run db:migrations:check`: passed (`SYNCHRONIZED`, 3/3 applied, 0 pending, 0 failed, exit code 0).
- `node scripts/test-remote-integration.mjs`: passed (41/41 assertions pass covering database tables, triggers, storage upload/download/sha256/deletion, admin profile mapping, relational insert/query, and full backup).
- `npm run test:auth`: passed (7/7 test suites passed: session TTL 604800s, human units parsing, admin client with service role / secret key, route-handler cookie binding, admin user "asdy" resolution, proxy cookie detection, destination redirect).
- `npm run test:migrations`: passed (43/43 assertions pass across all 8 migration scenarios).
- `npm run test:old`: passed (15/15 assertions pass).
- `npm run test:recovery`: passed (93/93 assertions pass).
- Full Project Backup CLI (`npm run db:backup`): passed (created verifiable backup ZIP with all 19 tables, schema, migrations, logical SQL dump, storage objects, and self-contained restore runner).

Latest verification results on 2026-11-03 (Supabase Auth Connection, Admin "asdy" & 1-Week Session TTL):

- `npm run lint`: passed (0 errors, 9 non-blocking disable directive warnings).
- `npm run typecheck`: passed (0 errors; Prisma Client v7.10.1 generated + strict tsc check).
- `npm run test:auth`: passed (all 6 test suites passed: session TTL 604800s, human units parsing, admin client with service role / secret key, route-handler cookie binding, admin user "asdy" resolution, proxy cookie detection).
- `npm run test:security`: passed (15/15 assertions pass).
- `npm run test:old`: passed (15/15 assertions pass).
- `npm run test:recovery`: passed (93/93 assertions pass).
- `npm run test:migrations`: passed (43/43 assertions pass).
- `npm run test:blob`: passed (118/118 assertions pass).
- `npm run test:search`: passed (77/77 assertions pass).
- Production `next build`: passed (all 40 routes compiled cleanly with Turbopack).
- Full `npm run verify`: passed end-to-end (exit code 0).

Latest verification results on 2026-11-02 (Phase 1.6 Legacy Vercel Recovery, Complete Download Center & Media Card Readability):

- `npm run lint`: passed (0 errors, 9 non-blocking disable directive warnings).
- `npm run typecheck`: passed (0 errors; Prisma Client v7.10.1 generated + strict tsc check).
- `npm run test:security`: passed (15/15 assertions pass).
- `npm run test:old`: passed (15/15 assertions pass).
- `npm run test:recovery`: passed (93/93 assertions pass).
- `npm run test:migrations`: passed (43/43 assertions pass).
- `npm run test:blob`: passed (118/118 assertions pass).
- `npm run test:search`: passed (77/77 assertions pass).
- `node scripts/test-manifest-serializer.mjs`: passed (27/27 assertions pass).
- Production `next build`: passed (all 40 routes generated cleanly with Turbopack).
- Full `npm run verify`: passed end-to-end (exit code 0).

Latest verification results on 2026-11-02 (Phase 1.5 Database Security + OLD Legacy Archive):

- `npm run lint`: passed (0 errors).
- `npm run typecheck`: passed (0 errors across all 19 Prisma models and Next.js routes).
- `npm run test:security`: passed (15/15 assertions pass).
- `npm run test:old`: passed (15/15 assertions pass).
- `npm run test:migrations`: passed (43/43 assertions pass).
- `npm run test:blob`: passed (118/118 assertions pass).
- `npm run test:search`: passed (77/77 assertions pass).
- `node scripts/test-manifest-serializer.mjs`: passed (27/27 assertions pass).
- Production `next build`: passed (all static, dynamic, and archive routes compiled).

Latest verification results on 2026-10-15 (query utilities + Search Guide 2026):

- `npm run test:search`: 77 assertions pass (query pipeline + spec-compliant transforms, no network).
- Scoped ESLint on the 6 changed files: clean (0 errors, 0 warnings).
- Full `eslint .`: 8 errors + 56 warnings, ALL pre-existing in vendored skill dot-directories and generated Prisma contract files (`migrations/snapshots`, `src/prisma/contract.d.ts`); zero findings in changed files.
- `tsc --noEmit --incremental false`: passed (0 errors; prisma generate skipped — nothing imports the generated client and the Prisma 8 CLI entry fails in this env, pre-existing).
- Production `next build`: passed (all routes incl. new static `/search-guide`; proxy convention, no Edge warnings).
- Prerendered `/search-guide` HTML + `/search` HTML verified: guide title, utilities, sections A–I, both official links, RTL/lang attributes, and the `/search-guide` nav link all present; `/search-guide` serves 200 (login gate applies as with all pages).
- `npm run` shim note: `node_modules/.bin` lost the `eslint`/`prisma` shims (interrupted relink leftovers); tools were invoked directly via `node <package>/bin|dist/...`. No dependencies changed.

Latest verification results on 2026-10-09:

- `npm run lint`: passed (0 errors, 0 warnings) on the final tree.
- `npm run typecheck`: passed (0 errors, incl. final tree).
- `npm run build`: passed cleanly with Next.js 16.2.6 Turbopack (all routes incl. `/login`, `/api/admin/*`, `/api/blob-upload/*`, `/api/youtube/keys/usage`; proxy convention, no Edge warnings).
- `npm run test:blob`: 118 assertions pass (mocked Blob).
- `npm run test:search`: 58 assertions pass (query pipeline + transforms, no network).
- `npm run test:blob:integration` (real private store, `__test__` records only): small round-trip, 12.1 MiB / 7-chunk exact reassemble, index listing, full cleanup — PASSED.
- Live E2E (dev server, 28 assertions): auth gating, bootstrap, CRUD, CSRF 403, usage without plaintext, diagnostics, idempotent migration, key lifecycle, logout revocation — ALL PASSED.
- Search UI render check (dev server, 11 assertions): full-width input without maxlength, 3 transform buttons with labeled group, options disclosure collapsed with region/panel/select, embedded submit — ALL PASSED.
- Earlier Saved-Library verification (disk era): lifecycle, manifest, export, and search checks passed; superseded by the Blob-backed equivalents above.
- Earlier search-module checks: exact/partial/case-insensitive/multi-token/fuzzy-typo ranking verified.
- Pages `/saved`, `/saved/[id]`, `/` return 200 with the Dailymotion sidebar link present.
- Zod for server route validation.

