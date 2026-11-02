# YouTube Discovery — Phase 0: Repository & Data-Contract Audit

**Document:** `docs/data-architecture/current-state.md`  
**Audit Date:** 2 November 2026  
**Auditor:** Antigravity AI Assistant  
**Status:** Completed & Verified — Authoritative Baseline for Phase 1 Database Design  

---

## 1. Executive Summary

This document presents the complete repository, data-contract, route, and persistence inventory for **YouTube Discovery** as mandated by `implementation-guide.md` (Phase 0).

The platform operates as a personal, single-administrator metadata intelligence and research system around the official YouTube Data API v3. Access is securely tied to the single administrator account:
- **Supabase Auth Identity:** `asdy@youtube.discov.com` (with underlying immutable `auth.users.id` UUID).
- **Relational Data Target:** PostgreSQL on Supabase managed via Prisma 7 (`7.10.1`, pinned).
- **Object Storage Target:** Supabase Storage private bucket `youtube-discovery` with local `data/storage/` fallback.
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
- **Data Preservation Rule:** Remote Blob objects MUST NOT be deleted, truncated, or overwritten until full migration to Supabase Storage is verified and explicitly approved.

### 4.2 Supabase Storage (Authoritative Object Store)
- **Status:** Implemented in `src/lib/storage/supabase-storage-backend.ts`.
- **Bucket:** Private bucket `youtube-discovery`.
- **Planned Hierarchical Path Structure:**
  `<owner-auth-uuid>/persistence/...` and `<owner-auth-uuid>/temp/...`
- **Fallback:** Transparent fallback to `DiskStorageBackend` (`data/storage/`) for offline/local development when Supabase Storage credentials are unconfigured.

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
| Saved Items | Video / Shorts-like | `platformItemId` (YouTube Video ID) | Unique per `(itemType, platformItemId)`. Shorts and Videos share the canonical video identity. |
| Saved Items | Channel | `platformItemId` (YouTube Channel ID `UC...`) | Unique per `platformItemId`. |
| Saved Items | YouTube Playlist | `platformItemId` (YouTube Playlist ID `PL...`) | Unique per `platformItemId`. |
| Personal Playlists | User Playlist | `id` (UUID generated on creation) | Permanent UUID; playlist renames do not alter identity. |
| Personal Playlists | Playlist Entry | `entryId` (UUID per playlist membership) | Unique per playlist. Deduplicated within a playlist by `(youtubeKind, platformItemId)`. Independent of global Saved Items. |
| Personal Playlists | Playlist Group | `id` (UUID generated on creation) | Unique per playlist. Constrained to the owning playlist. |
| Search History | Search History Item | `id` (UUID / timestamp ID) | Unique per search run. Preserves full query, settings, counts, and raw manifest. |
| Saved Searches | Saved Search Preset | `id` (UUID generated on creation) | Unique preset ID. Pinned and sorted independently. |
| Research Queue | Queued Item | `platformItemId` + `queuedAt` | Unique queued entity. Can coexist with Saved Items and Playlists. |
| Saved References | Saved Reference Link | `id` (UUID) | Unique reference ID. Accepts arbitrary web URLs and non-YouTube titles. |
| Managed API Keys | YouTube API Key | `id` (UUID) | Unique per registered key. AES-256-GCM encrypted. Plaintext never stored. |

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
   - Bucket `youtube-discovery` is strictly private.
   - Zero public URLs generated. Reads and writes proceed through authenticated server endpoints.

---

## 8. Current Prisma 7 & PostgreSQL Status

- **Prisma Version:** `7.10.1` (pinned across `prisma`, `@prisma/client`, and `@prisma/adapter-pg`).
- **Driver Adapter:** `@prisma/adapter-pg` with `pg.Pool`.
- **Datasource Configuration:** `prisma.config.ts` loads `DATABASE_URL` (pooled) and `DIRECT_URL` (direct).
- **Prisma Schema (`prisma/schema.prisma`):** Contains minimal foundation (PostgreSQL datasource + client generator).
- **Database Status:** Live Supabase database verified `CONNECTED` over TLS.
- **Migration History Table:** `public._prisma_migrations` is NOT yet initialized (`REGCLASS: null`).
- **Local Migrations:** `prisma/migrations` does not exist yet. No migrations have been created or applied.
- **Integrity Statement:** Application domain schema is intentionally deferred to Phase 1 for owner approval before any migrations are created or applied.

---

## 9. Phase 0 Verification Conclusion

Phase 0 audit is complete and verified against the live repository. All data contracts, boundaries, storage systems, and retention rules have been mapped without executing destructive actions or altering production state.

Proceed to Phase 1: Canonical Database Design, ERD, Data Dictionary, and Manifest Strategy.
