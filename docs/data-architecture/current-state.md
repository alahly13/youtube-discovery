# YouTube Discovery — Repository & Data-Contract Audit (Current State)

**Document:** `docs/data-architecture/current-state.md`  
**Audit Date:** 2 November 2026  
**Implementation Reconciliation:** 5 November 2026  
**Status:** Completed & Verified — Baseline for Phase 1 Database Design, reconciled against the live repository on 2026-11-05  

---

## 0. Implementation Reconciliation (2026-11-05)

The original Phase 0 audit correctly described the repository at the time, but several storage and persistence statements are now historical. The current codebase is authoritative:

- **Object storage is Cloudflare R2, not Supabase Storage.** Active datasets use `new-youtube-discovery-private` through the NEW Worker (`new-youtube-discovery-api`); historical archives use `old-youtube-discovery-private` through the OLD Worker. Supabase Storage is retired; `src/lib/storage/supabase-storage-backend.ts` is only a compatibility re-export.
- **The canonical storage owner is `user_profiles.storage_owner_uuid`, never `auth.users.id`.** All NEW R2 paths are rooted at `asdy/persistence/<storage_owner_uuid>/<dataset-slug>/...`; temporary objects use `asdy/temp/<storage_owner_uuid>/...`.
- **Six Prisma migrations are applied on remote Supabase PostgreSQL**, including `20261104230000_canonical_resource_classification` (applied 2026-11-04/05). The schema contains 19 models (18 canonical + `archived_manifests`).
- **Canonical resource taxonomy is explicit.** `VIDEO`, `VIDEO_SHORT`, `CHANNEL`, `YOUTUBE_PLAYLIST`, `USER_PLAYLIST`, `SAVED_TITLE`, `SAVED_LINK`, and `SAVED_SEARCH` are persisted as discriminators. `VIDEO_SHORT` requires explicit `/shorts/` evidence; duration and aspect ratio never decide it.
- **Saved Titles & Links has a first-class page** at `/saved-titles-links`, backed by the local-first `REFERENCES` dataset and mirrored to `saved_references`.
- **Hydration is snapshot-based and checksum-verified.** Incoming generations replace dataset snapshots, stale local records are removed, pending outbox changes are preserved, and SHA-256 is mandatory.

---

## 1. Executive Summary

This document presents the complete repository, data-contract, route, and persistence inventory for **YouTube Discovery** as mandated by `implementation-guide.md` (Phase 0).

The platform operates as a personal, single-administrator metadata intelligence and research system around the official YouTube Data API v3. Access is securely tied to the single administrator account:
- **Supabase Auth Identity:** `asdy@youtube.discov.com` (with underlying immutable `auth.users.id` UUID).
- **Relational Data Target:** PostgreSQL on Supabase managed via Prisma 7 (`7.10.1`, pinned).
- **Object Storage Target:** Cloudflare R2 private buckets `new-youtube-discovery-private` (active) and `old-youtube-discovery-private` (historical archives), accessed only through dedicated Workers. Local `data/storage/` remains a development fallback.
- **Local Client Durability:** Local-first IndexedDB stores + atomic outbox queue + last-session recovery.

All existing features, data shapes, YouTube Data API integrations, quota accounting semantics, and historical remote storage objects remain fully protected under this audit.

---

## 2. Complete Routes & Workspaces Inventory

The application is structured under Next.js 16.4.2 App Router with React 19.2.4:

| Route Path | Type | Workspace / Responsibility | Current Backing Storage | Data Contracts |
|---|---|---|---|---|
| `/login` | Public Page | Single-administrator authentication | Supabase Auth (`@supabase/ssr`) with fallback | Admin credentials |
| `/` | Protected Page | System dashboard, product posture, boundaries | Aggregated client/server state | Manifest & quota summaries |
| `/saved` | Protected Page | Dedicated Saved Items workspace with **Daily Calendar Grouping** (Videos, Channels, Playlists) | Zustand store with local persistence | `NormalizedYouTubeDiscoveryItem[]`, `savedAt` |
| `/saved-titles-links` | Protected Page | Dedicated Saved Titles & Links workspace for `SAVED_TITLE` / `SAVED_LINK` references | Local-first `REFERENCES` dataset + `saved_references` | Canonical taxonomy records, `recordId`, `savedAt` |
| `/playlist-manager` | Protected Page | Dedicated Personal Playlist Manager workspace (thumbnail galleries, counts, CRUD) | Server REST `/api/playlists` + Zustand | `UserPlaylistIndexEntry[]` |
| `/saved/[playlistId]` | Protected Page | Dedicated personal playlist workspace (12 sorts, groups/sections, drag-and-drop, export) | Server REST `/api/playlists/[id]` | `UserPlaylistManifest` |
| `/saved-searches` | Protected Page | Reusable pinned search queries, quick rerun links, and notes | LocalStorage / Zustand | `SavedSearch[]` |
| `/search` | Protected Page | YouTube Search workspace (provider settings, filters, card gallery, rawJson preservation) | Memory / LastSearch session cache | `YouTubeSearchSettings`, `YouTubeManifest` |
| `/search-guide` | Public/Static | Search Guide 2026 reference (syntax, Arabic explanations, copyable tokens) | Static Content | None |
| `/ai-search` | Protected Page | Scoped AI Discovery workspace (Gemini 2.5 Flash) | Ephemeral / Server-side validation | `AiAssistantResponseSchema` |
| `/link-explorer` | Protected Page | URL parser and official API strategy selector | Server-side inspection | `LinkExplorerResult` |
| `/channels` | Protected Page | Saved channels library | LocalStorage / Zustand | `NormalizedYouTubeDiscoveryItem[]` |
| `/channels/[sourceId]`| Protected Page | Channel explorer, uploads manifest, local filters, and AI panel | YouTube Data API v3 + Memory | `YouTubeManifest` |
| `/playlists` | Protected Page | Saved YouTube playlists library | LocalStorage / Zustand | `NormalizedYouTubeDiscoveryItem[]` |
| `/playlists/[playlistId]`| Protected Page | YouTube playlist explorer, order-preserving items, AI panel | YouTube Data API v3 + Memory | `YouTubeManifest` |
| `/manifests` | Protected Page | Manifest library with clickable detail navigation | Server REST `/api/youtube/manifests` | `YouTubeManifestSummary[]` |
| `/manifests/[manifestId]`| Protected Page| Manifest detail workspace with search/filter/sort, export | Server REST `/api/youtube/manifests/[id]` | `YouTubeManifest` |
| `/collections` | Protected Page (Legacy) | Legacy collections workspace (Scheduled for safe removal in Phase B) | LocalStorage | `Collection[]` |
| `/history` | Protected Page | Chronological search history with FlexSearch, zero-quota rerun | Server REST `/api/search-storage` | `SearchHistoryItem[]`, `PersistedLastSearch` |
| `/watch/[videoId]` | Protected Page | Embedded player with manifest-first suggested videos sidebar | Zustand watch settings | `NormalizedYouTubeDiscoveryItem` |
| `/settings` | Protected Page | Quota dashboard, API key rotation, storage diagnostics, account security | Server REST `/api/youtube/keys/*`, `/api/admin/*` | Key metadata, quota pools |

---

## 3. Server API Routes & Authority Boundaries

Every data route strictly enforces `requireAdmin()` on the server side:

```text
POST /api/auth/login                  -> Public: validates administrator credentials
POST /api/auth/logout                 -> Protected: clears Supabase/server session cookies
GET  /api/auth/username               -> Public: returns current admin username prefill
GET  /api/auth/status                 -> Protected: verifies active session
POST /api/auth/account                -> Protected: updates admin credentials

GET  /api/playlists                   -> Protected: returns lightweight user playlist index
POST /api/playlists                   -> Protected: creates personal playlist & manifest
GET  /api/playlists/[id]              -> Protected: retrieves complete self-contained playlist manifest
PUT  /api/playlists/[id]              -> Protected: meta-patch or atomic full-manifest update
DELETE /api/playlists/[id]            -> Protected: deletes playlist manifest (preserves saved items)

GET  /api/search-storage              -> Protected: lightweight search history index with TTL metadata
POST /api/search-storage              -> Protected: archives complete search record with full rawJson
GET  /api/search-storage/[id]         -> Protected: loads complete search record without YouTube quota
DELETE /api/search-storage/[id]       -> Protected: deletes individual search archive
DELETE /api/search-storage            -> Protected: clears entire search archive

GET  /api/youtube/keys                -> Protected: lists safe masked API keys and active status
POST /api/youtube/keys                -> Protected: registers AES-256-GCM encrypted API key
POST /api/youtube/keys/select         -> Protected: selects active key for runtime rotation
DELETE /api/youtube/keys/[keyId]      -> Protected: deletes custom key with safe fallback
GET  /api/youtube/keys/usage          -> Protected: project-grouped quota pools & usage statistics
PATCH /api/youtube/keys/[keyId]       -> Protected: edits key metadata (project ID, label, priority)

POST /api/youtube/search              -> Protected: executes YouTube search.list & hydrates details
POST /api/youtube/search/next         -> Protected: pagination continuation
POST /api/youtube/details/*           -> Protected: server-only video/channel/playlist detail lookups
POST /api/youtube/channel/uploads/*   -> Protected: channel uploads playlist extraction
POST /api/youtube/playlist/items/*    -> Protected: playlist items fetch preserving order
POST /api/youtube/link/analyze        -> Protected: URL parser & strategy resolution

POST /api/ai/youtube-search-assistant -> Protected: scoped Gemini analysis of search results
POST /api/ai/youtube-manifest-assistant-> Protected: scoped Gemini analysis of manifests
POST /api/ai/youtube-video-explorer   -> Protected: scoped Gemini explorer for single item

GET  /api/admin/storage-status        -> Protected: storage health and backend connection diagnostics
POST /api/admin/storage-verify        -> Protected: write-probe and storage identity verification
POST /api/admin/migrate               -> Protected: idempotent data migration from disk
```

---

## 4. Current Persistence Sources & Inventory

### 4.1 Remote Vercel Blob (Read-Only Legacy Store)
- **Status:** Runtime package `@vercel/blob` removed; remote objects completely preserved and readable via `src/lib/storage/blob-inventory.ts` using standard HTTP fetch with `BLOB_READ_WRITE_TOKEN`.
- **Path convention:** `youtube-discovery/v1/...`
  - Playlists: `youtube-discovery/v1/playlists/<playlist-id>/manifest.json`
  - Search History: `youtube-discovery/v1/saved-history/<search-id>/manifest.json`
  - Encrypted Managed Keys: `youtube-discovery/v1/api-keys/state.json`
  - Admin Credentials/Sessions: `youtube-discovery/v1/admin/account.json`
- **Data Preservation Rule:** Remote Blob objects MUST NOT be deleted, truncated, or overwritten. They remain a read-only historical source and are never treated as active application truth.

### 4.2 Cloudflare R2 (Authoritative Object Store)

- **Status:** Implemented in `src/lib/storage/r2-blob-backend.ts` and `src/lib/storage/r2-worker-storage-client.ts`.
- **Buckets:**
  - `new-youtube-discovery-private` — active application datasets, immutable generations, manifest parts, and temporary exports (`NEW` Worker: `new-youtube-discovery-api`).
  - `old-youtube-discovery-private` — historical legacy archives under `asdy/old/...` (`OLD` Worker: `old-youtube-discovery-api`).
- **Canonical Active Paths:**
  `asdy/persistence/<storage_owner_uuid>/<dataset-slug>/version.json` and
  `asdy/persistence/<storage_owner_uuid>/<dataset-slug>/generations/<generation-id>/...`
- **Canonical Temporary Paths:**
  `asdy/temp/<storage_owner_uuid>/<syncBatchId>/...` and `asdy/temp/<storage_owner_uuid>/exports/<exportId>/...`
- **Legacy Read Compatibility:** Historical `<owner-id>/persistence/...` paths remain readable and are never rewritten in place. New writes use only the canonical `asdy/` hierarchy.
- **Fallback:** Transparent fallback to `DiskStorageBackend` (`data/storage/`) for offline/local development when Worker credentials are unconfigured.
- **Supabase Storage:** Retired for object persistence. `src/lib/storage/supabase-storage-backend.ts` only re-exports the R2 backend for backward compatibility.

### 4.3 Browser LocalStorage & Zustand (Client Cache)
- **`youtube-workspace-store.ts`:**
  - `savedItems`: Array of `NormalizedYouTubeDiscoveryItem` with explicit `savedAt` timestamp.
  - `lastSearch`: Persisted search workspace session (`PersistedLastSearch`) with `searchedAt` and `expiresAt`.
  - `watchPreferences`: Player playback options.
  - `fetchSettings`: Custom `pageSize`, `maxPages`, `maxItems`.
- **`user-playlists-store.ts`:**
  - Client-side cache of personal playlists, active playlist manifest, undo history.
- **`collections` & `saved-searches`:**
  - Kept in browser storage pending migration to the local-first IndexedDB engine.

---

## 5. Data Entities & Deduplication Rules

| Domain | Entity | Stable Identifier | Deduplication Rule |
|---|---|---|---|
| Saved Items | Video (`VIDEO`) / Short (`VIDEO_SHORT`) | `platformItemId` (YouTube Video ID) | Unique per `(resourceType, platformItemId)`. `VIDEO_SHORT` requires explicit `/shorts/` URL evidence or an authoritative provider field; duration/aspect ratio never classify a record. |
| Saved Items | Channel | `platformItemId` (YouTube Channel ID `UC...`) | Unique per `platformItemId`. |
| Saved Items | YouTube Playlist | `platformItemId` (YouTube Playlist ID `PL...`) | Unique per `platformItemId`. |
| Personal Playlists | User Playlist | `id` (UUID generated on creation) | Permanent UUID; playlist renames do not alter identity. |
| Personal Playlists | Playlist Entry | `entryId` (UUID per playlist membership) | Unique per playlist. Deduplicated within a playlist by `(youtubeKind, platformItemId)`. Independent of global Saved Items. |
| Personal Playlists | Playlist Group | `id` (UUID generated on creation) | Unique per playlist. Constrained to the owning playlist. |
| Search History | Search History Item | `id` (UUID / timestamp ID) | Unique per search run. Preserves full query, settings, counts, and raw manifest. |
| Saved Searches | Saved Search Preset | `id` (UUID generated on creation) | Unique preset ID. Pinned and sorted independently. |
| Research Queue | Queued Item | `platformItemId` + `queuedAt` | Unique queued entity. Can coexist with Saved Items and Playlists. |
| Saved References | Saved Title (`SAVED_TITLE`) / Saved Link (`SAVED_LINK`) | `recordId` (stable) | Unique per owner + `recordId`. `SAVED_TITLE` may be title-only; `SAVED_LINK` requires a URL. |
| Managed API Keys | YouTube API Key | `id` (UUID) | Unique per registered key. AES-256-GCM encrypted. Plaintext never stored. |

### 5.1 Canonical Resource Taxonomy (2026)

Resource type is a discriminator, not a UI label. It is persisted on manifest records, database index rows, Worker uploads, R2 parts, hydration, exports, and the Manifest Explorer.

| Resource Type | Meaning | Classification Evidence |
|---|---|---|
| `VIDEO` | Standard YouTube video | Video ID / watch URL / authoritative `video` entity |
| `VIDEO_SHORT` | YouTube Short | Explicit `/shorts/<id>` URL or authoritative provider field only |
| `CHANNEL` | YouTube channel | `UC...` channel ID / channel URL |
| `YOUTUBE_PLAYLIST` | Public YouTube playlist | Playlist ID / `playlist?list=` URL |
| `USER_PLAYLIST` | Personal playlist owned by the user | `user_playlists` record; never confused with a YouTube playlist |
| `SAVED_TITLE` | Title-only saved reference | `REFERENCES` dataset with a title and no required URL |
| `SAVED_LINK` | Saved external/bookmark link | `REFERENCES` dataset with a URL |
| `SAVED_SEARCH` | Saved search preset | `saved_search_presets`; never search history |

Distinct concepts that must not be collapsed:

- Resource type ≠ dataset type (`SAVED_ITEMS`, `PLAYLIST`, `SEARCH_HISTORY`, `RESEARCH_QUEUE`, `REFERENCES`).
- Saved search ≠ search history.
- User playlist ≠ YouTube playlist.
- Original title ≠ user custom title.
- Stable IDs (`recordId`, `resourceType`, `resourceId`, `ownerId`, `datasetId`, `generationId`, `originDeviceId`) are never derived from title, filename, array index, or date.

Records that cannot be classified with reliable evidence are returned as `UNKNOWN`/`LEGACY`, never silently coerced into a plausible type. Historical data is read through compatibility adapters that preserve the original values.

---

## 6. Retention Policies & TTL Mappings

| Concept | Location | Default Retention | Config / Rule |
|---|---|---|---|
| Search Workspace Cache | `lastSearch` in Zustand/Storage | 168 hours (7 days) | `SEARCH_STORAGE_TTL_HOURS` |
| Search History Records | Manifest Archive | Permanent | `expiresAt: null` (never purged by TTL) |
| Personal Playlists | Dedicated Manifests | Permanent | No TTL |
| Global Saved Items | Library | Permanent | No TTL |
| API Key Quota Cooldown | Managed Key Store | 24 hours | Quotas reset daily at Pacific midnight |
| YouTube Daily Quota | Quota Pools | Resets daily | `America/Los_Angeles` midnight |
| Admin Session Cookie | SSR Cookie | 7 days (604,800s) | `ADMIN_SESSION_TTL_SECONDS` |
| Upload Staging Session | Temp Storage | 24 hours | Staged upload cleanup |
| Temporary Manifests | Temp Storage | 24 hours | `TEMP_DATA_TTL_HOURS` |

---

## 7. Cryptographic & Security Audit

1. **API Key Encryption:**
   - Cipher: AES-256-GCM (`node:crypto`).
   - Master Key: Loaded from `API_KEYS_ENCRYPTION_KEY` (must decode to exactly 32 bytes).
   - IV: Fresh 12-byte random IV per save.
   - Bundle shape: `{ v: 1, iv: "<base64url>", data: "<base64url>" }` (data contains ciphertext + 16-byte auth tag).
   - Plaintext safety: Plaintext is decrypted only in server-side API caller functions. Only masked strings (e.g. `...3a8f`) are returned to the client.
2. **Administrator Authentication:**
   - Identity: `asdy@youtube.discov.com` verified through Supabase Auth JWT / cookie.
   - Cross-schema reference: `admin_profiles.auth_user_id` -> `auth.users.id`.
   - Passwords: Never stored or processed in application tables or manifests.
3. **Storage Security:**
   - R2 buckets `new-youtube-discovery-private` and `old-youtube-discovery-private` are strictly private.
   - Zero public URLs are generated. Reads and writes proceed through authenticated server endpoints and HMAC capability tokens.
   - The NEW Worker enforces owner namespaces (`asdy/persistence/<storage_owner_uuid>/`, `asdy/temp/<storage_owner_uuid>/`), rejects path traversal, validates size/SHA-256, and restricts DELETE to disposable temp objects.

---

## 8. Current Prisma 7 & PostgreSQL Status

- **Prisma Version:** `7.10.1` (pinned across `prisma`, `@prisma/client`, and `@prisma/adapter-pg`).
- **Driver Adapter:** `@prisma/adapter-pg` with `pg.Pool`.
- **Datasource Configuration:** `prisma.config.ts` loads `DATABASE_URL` (pooled) and `DIRECT_URL` (direct), with automatic Session Pooler fallback for IPv6-only Supabase direct hosts.
- **Prisma Schema (`prisma/schema.prisma`):** 19 models (18 canonical + `archived_manifests`), including canonical resource classification fields.
- **Database Status:** Live Supabase PostgreSQL 17 verified `CONNECTED` over TLS.
- **Migration History Table:** `public._prisma_migrations` initialized and synchronized.
- **Applied Migrations (6):**
  1. `20261102000000_canonical_v1_4_foundation`
  2. `20261102220000_phase1_5_security_and_old_archive`
  3. `20261103150000_canonical_private_storage_bucket`
  4. `20261103173000_old_and_new_buckets_separation`
  5. `20261104200000_device_identity_and_origin_metadata`
  6. `20261104230000_canonical_resource_classification`
- **Latest additive migration:** adds `saved_items_index.resource_type/resource_id`, `saved_references.record_id/resource_type/resource_id/origin_device_*` and nullable `url`, `saved_search_presets` classification/origin fields, unique `(owner_id, record_id)` guards, and `storage_datasets` unique `(owner_id, dataset_type)`.
- **No reset was performed.** The migration was applied with `npx prisma migrate deploy`; existing data was preserved.
- **Integrity Statement:** The live schema and applied migrations are authoritative. Documentation is descriptive; code and migrations win on any disagreement.

---

## 9. Phase 0 Verification Conclusion

Phase 0 audit is complete and verified against the live repository. All data contracts, boundaries, storage systems, and retention rules have been mapped without executing destructive actions or altering production state.

The 2026-11-05 reconciliation updates the storage target to Cloudflare R2, records the six applied migrations, and adds the canonical resource taxonomy and Saved Titles & Links workspace. No historical objects were deleted or rewritten.
