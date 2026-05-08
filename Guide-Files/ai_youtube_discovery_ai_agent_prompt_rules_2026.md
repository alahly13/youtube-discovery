# AI YouTube Public Video Discovery — AI Agent Prompt Rules & Master Template 2026

> Use this file before asking any AI agent to modify, debug, design, migrate, document, or extend the `ai-youtube-public-video-discovery` project.
>
> Default requested model: **Codex GPT-5.5 Pro — Extra High Reasoning Mode** or the latest available 2026 coding model.
>
> This file is adapted for a **separate YouTube-focused platform**, inspired by the Dailymotion Discovery workflow, but it must follow **official YouTube Data API constraints** and must not copy Dailymotion-specific API behavior blindly.

---

## 0. Required Opening Line

Every serious prompt should start with:

```text
Spawn a subagent to explore this repo. Use the latest available 2026 coding model for this task, preferably Codex GPT-5.5 Pro in Extra High Reasoning Mode. Spawn multiple subagents to explore this repo before implementation.
```

For a smaller task:

```text
Spawn a subagent to explore this repo. Use the latest available 2026 coding model for this task. Analyze the current codebase first before making any changes.
```

The agent must not implement from assumptions. It must inspect the current repo, current ledger, package versions, API routes, schema, and UI before editing.

---

## 1. Project Identity

**Project:** AI YouTube Public Video Discovery Platform

**Short name:** YouTube Discovery / AI YouTube Discovery

**Recommended repo name:** `youtube-video-discovery` or `ai-youtube-public-video-discovery`

**Framework baseline:** Next.js `^16.2.5`, React 19, TypeScript strict mode, Tailwind CSS 4, shadcn/ui-compatible primitives, Prisma/PostgreSQL/Supabase when persistence is enabled.

**Mission:** Build a professional AI-powered public YouTube metadata discovery platform focused on official YouTube Data API workflows, reusable manifests, advanced filters, saved results, and manifest-aware AI assistants.

**Core capabilities:**

- General public YouTube search
- Search across videos, channels, and playlists where the official API supports it
- Channel Explorer / Channel uploads discovery
- Playlist Explorer
- Link Explorer for YouTube URLs
- Temporary and durable manifests
- Advanced filtering and sorting
- Search inside collected results
- Saved library / collections foundation
- Attempt history and resumable fetch jobs where applicable
- Quota-aware YouTube API usage
- Gemini AI helper routes grounded only in fetched metadata
- Light/Dark mode UI
- Future-ready architecture for semantic search and multi-provider adapters

**Not allowed:**

- No video downloading
- No stream scraping
- No rehosting
- No bypassing YouTube restrictions
- No private data access without explicit OAuth scope and user authorization
- No scraping YouTube web pages to get unsupported data
- No fabricated AI video results
- No fabricated playlist/channel relationships
- No fabricated counts, URLs, IDs, or analytics
- No browser exposure of secrets

---

## 2. Product Mission and User Value

The platform helps researchers, creators, analysts, and content discovery workflows find and organize public YouTube metadata without starting from zero every time.

**What the platform solves:**

- YouTube search is broad and can be hard to refine for research workflows.
- Public result sets need reusable manifests, saved state, filters, and search-inside-results.
- Channels and playlists need structured exploration rather than one-off browser browsing.
- Users need to know what was fetched, when, from which settings, and under what quota cost.
- AI must be grounded in real fetched metadata, not hallucinated search results.

**Main product rule:**

```text
The app fetches public metadata, stores it as structured manifests, and lets filters/search/AI operate only on metadata that the app actually fetched or saved.
```

---

## 3. YouTube-Specific Source of Truth

This project must use official YouTube APIs and official documentation as the source of truth.

**Primary official APIs:**

- YouTube Data API v3
- YouTube Search API via `search.list`
- `videos.list` for full video metadata/details
- `channels.list` for channel metadata and uploads playlist references
- `playlistItems.list` for playlist and channel uploads traversal
- `playlists.list` for playlist metadata
- `commentThreads.list` only if comments are explicitly added later
- OAuth 2.0 only for user-authorized private/account data, not for normal public discovery

**Important YouTube platform reality:**

- `search.list` officially returns search resources such as videos, channels, and playlists. Do not invent unsupported result types.
- Community posts / posts are not a general official public search result type in YouTube Data API v3. Treat them as unsupported/future-ready unless official docs expose them.
- Shorts should be labeled **Shorts-like** when inferred from duration/metadata. Do not guarantee a result is a Short unless official metadata clearly supports that claim.
- Private playlists, playlist save counts, and “which users saved this video” are not generally available as public API data. Do not claim or infer this data.
- A video’s relationship to public playlists can only be known from playlists the app explicitly fetched or official API responses that expose that relationship. Do not claim global playlist membership.
- Quota must be treated as a first-class constraint. Search requests are expensive compared with many detail-list requests; consult official docs before changing request patterns.

---

## 4. Repo-First and Ledger-First Discipline

Before editing anything, the agent must inspect the current repo. The real code is the source of truth.

Read first:

```text
youtube_discovery_ledger.md
PROJECT_LEDGER.md
README.md
package.json
package-lock.json
.env.example
prisma.config.ts
prisma/schema.prisma
scripts/
src/app/
src/components/
src/lib/
src/types/
src/stores/
.github/workflows/
Guide-Files/
```

If this file disagrees with the current code, trust the current code and document the mismatch.

After meaningful changes, update:

```text
youtube_discovery_ledger.md
```

or, if still used:

```text
PROJECT_LEDGER.md
```

Ledger entries should include:

```text
Date
Files changed
Summary
Reason/root cause
Technical details
Environment impact
Risks
Verification
Remaining limitations
Whether secrets were printed
Whether db:apply was run
Whether migrations were created/applied
```

---

## 5. Core Non-Negotiable Rules

```text
Do not rebuild from scratch.
Do not redesign architecture unless explicitly requested.
Do not change unrelated areas.
Do not remove working features.
Do not remove fallbacks, guards, normalization helpers, quota guards, or defensive code without proof.
Do not expose secrets.
Do not move backend authority into frontend.
Do not create duplicate systems.
Do not introduce random UI colors or disconnected design systems.
Do not run destructive database commands.
Do not add unsupported YouTube scraping behavior.
Do not let AI invent results.
```

Prefer:

```text
repair → reconnect → harden → extend → refine
```

not:

```text
delete → replace → rebuild
```

---

## 6. Official Documentation Rule 2026

Whenever the task touches version-sensitive tooling or provider behavior, the agent must check current official docs first.

Check official docs for:

- Next.js App Router / Route Handlers
- React 19
- TypeScript
- Tailwind CSS 4
- shadcn/ui-compatible component patterns
- Supabase
- Prisma 7 / `prisma.config.ts`
- dotenv
- Vercel
- GitHub Actions
- YouTube Data API v3
- Google API key and OAuth docs
- YouTube quota docs
- Gemini SDK / Google GenAI docs
- Zustand / TanStack tools if used
- FlexSearch/MiniSearch/Fuse only if search implementation changes

Do not rely only on memory.

---

## 7. Task-Type Classification

Every implementation prompt must declare one type.

### Type A — UI-Only

Use for pages, layout, colors, cards, responsiveness, theme, buttons, filters UI, loading/empty/error states.

Rules:

```text
Do not alter backend behavior.
Do not change API contracts.
Do not redesign unrelated pages.
Preserve responsiveness.
Preserve current interactions unless requested.
Verify mobile/tablet/laptop/desktop layouts.
```

### Type B — Backend-Only

Use for API routes, Prisma, Supabase, migrations, env validation, YouTube services, Gemini routes, fetch jobs, manifest persistence, quota guards, and security.

Rules:

```text
Keep backend authority on the backend.
Preserve route contracts where possible.
Add validation and structured errors.
Do not move secrets to client.
Do not redesign UI.
```

### Type C — Full-Stack

Use when both UI and backend/API contracts must change.

Rules:

```text
Trace browser action → API route → service → YouTube API/database → response → UI rendering.
Do not fix frontend symptoms while leaving backend root cause.
Do not change payload shape without updating all dependent layers.
```

### Type D — New Feature / New Tool

Use for a new page, new route, new explorer, new adapter, new AI assistant, new export, or saved-library feature.

Rules:

```text
Attach the feature to the existing architecture.
Do not create a disconnected second system.
Reuse existing manifest/filter/video-card/AI patterns where appropriate.
Document the feature in the ledger.
```

### Type E — Hybrid / Architecture-Sensitive

Use for middleware/proxy, deployment behavior, auth/session, Prisma/Supabase architecture, large manifest persistence, YouTube quota architecture, AI scope boundaries, and multi-platform architecture.

Rules:

```text
Do not broad-refactor.
Preserve compatibility layers.
Clearly state authority boundaries.
Prefer incremental migration over clean-slate replacement.
```

---

## 8. Environment-Specific Requirement

For runtime-sensitive tasks, separate analysis by:

### 1. Local / Windows / PowerShell

Consider `.env.local`, dotenv, PowerShell syntax, URL-encoded database passwords, `DATABASE_URL`, YouTube API keys, quota tests, and `npm` scripts.

### 2. Vercel Production / Preview

Consider Vercel env vars, build-time vs runtime env, route-handler timeouts, server-only Gemini/Prisma/YouTube API behavior, and no migrations during normal Vercel build.

### 3. Supabase PostgreSQL

Consider Session Pooler, schema, migrations, RLS if user data exists, indexes, manifest persistence, and search indexes.

### 4. GitHub Actions

Consider manual `workflow_dispatch`, secrets, `db:validate`, pre-status, guarded `db:apply`, post-status, and no secret logging.

### 5. Codex / Online Agent Environment

Consider missing dependencies, missing real API keys, blocked live verification, quota limitations, and honest reporting.

---

## 9. Environment Variables and Secret Classes

### Public / Browser-Safe

```env
NEXT_PUBLIC_APP_URL=
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=
```

### Server-Only Secrets

```env
DATABASE_URL=
YOUTUBE_API_KEY=
GEMINI_API_KEY=
SUPABASE_SERVICE_ROLE_KEY=
CRON_SECRET=
WEBHOOK_SECRET=
```

### Optional OAuth / User-Authorized Future Secrets

```env
GOOGLE_OAUTH_CLIENT_ID=
GOOGLE_OAUTH_CLIENT_SECRET=
GOOGLE_OAUTH_REDIRECT_URI=
```

Use OAuth only when the user explicitly wants authenticated/account-owned or private data workflows. Public metadata discovery should normally use `YOUTUBE_API_KEY` server-side.

### Server-Only Config / Feature Flags

```env
YOUTUBE_API_BASE_URL=https://www.googleapis.com/youtube/v3
ENABLE_MANIFEST_PERSISTENCE=true
ENABLE_PGVECTOR=false
YOUTUBE_SEARCH_DEFAULT_MAX_RESULTS=50
YOUTUBE_SEARCH_MAX_PAGES=10
YOUTUBE_SEARCH_MAX_ITEMS=500
YOUTUBE_SEARCH_PAGE_DELAY_MS=250
YOUTUBE_DETAIL_BATCH_SIZE=50
YOUTUBE_QUOTA_DAILY_SOFT_LIMIT=9000
YOUTUBE_QUOTA_WARNING_THRESHOLD=7500
YOUTUBE_DEFAULT_REGION_CODE=
YOUTUBE_DEFAULT_RELEVANCE_LANGUAGE=
GEMINI_MODEL=
AI_MANIFEST_MAX_ITEMS=60
AI_MANIFEST_MAX_CHARS=30000
AI_EMBEDDING_MODEL=
```

Rules:

```text
Do not print secrets.
Do not commit .env or .env.local.
.env.example must explain purpose, required level, accepted values, source, and missing behavior.
dotenv should load env files for standalone scripts.
Runtime env must still be validated safely.
Build stubs must not become runtime truth.
```

---

## 10. YouTube API Rules

```text
Use official YouTube Data API only.
YOUTUBE_API_KEY is server-only.
Do not expose YOUTUBE_API_KEY to the browser.
Do not make browser components call YouTube directly with the key.
Do not scrape YouTube pages.
Do not download videos.
Do not scrape streams.
Do not rehost content.
Do not fabricate results.
Use typed safe results for external API calls.
Preserve partial manifests when fetch fails mid-way.
Track quota cost and warnings where practical.
```

### Provider Request Rules

- Search requests should go through server route handlers.
- Detail hydration should batch IDs where official endpoints support it.
- Do not call high-cost endpoints repeatedly for the same data when a cached/manifest result exists.
- Always normalize API responses before rendering.
- Store raw provider JSON only where useful for audit/debug; queryable fields should be normalized.
- Treat unavailable fields as `null`, not as fabricated values.
- Treat `0` views/comments/likes as valid metadata.

### Supported / Unsupported Concepts

Supported through official API when available:

- Videos
- Channels
- Playlists
- Playlist items
- Channel uploads via uploads playlist
- Public comments if explicitly implemented through official comment endpoints

Unsupported unless official API exposes it:

- Public community posts as general search results
- Global “where this video is saved” data
- Private playlist memberships of other users
- Viewer history
- Subscriber identities
- Private analytics
- Hidden/private/unlisted content without authorization

---

## 11. YouTube Search Architecture Rules

The platform must clearly separate:

### 1. Provider Search Settings

Controls the request to YouTube.

Examples:

```text
query
result type: video/channel/playlist
maxResults/page size
page token / max pages
publishedAfter / publishedBefore
order: relevance/date/rating/viewCount/title/videoCount where supported
regionCode
relevanceLanguage
safeSearch
videoDuration
videoDefinition
videoEmbeddable
videoCaption
videoType
channelId
relatedToVideoId where supported
```

### 2. Temporary Search Manifest

The collected result set returned by YouTube.

It should store:

```text
manifestId
manifestType=SEARCH
platform=YOUTUBE
query
searchSettingsSnapshot
pagesFetched
nextPageToken if any
quotaCostEstimate
itemCount
uniqueItemCount
duplicateCount
createdAt
status
items
```

### 3. Result Filters

Controls filtering/sorting inside the already-collected manifest.

Examples:

```text
keyword within results
views min/max
duration min/max
year/date
language
channel/owner
has thumbnail
has description
result kind: video/channel/playlist/shorts-like
sort by newest/oldest/most views/least views/duration/title/local relevance
```

### 4. Search Inside Results

Local/server search over the current manifest or saved results.

Rules:

```text
Search-inside-results must not call YouTube.
Filters must not call YouTube.
Changing local filters must not call YouTube.
Only explicit provider search/fetch actions may call YouTube.
Search first, filters second, sort third, render fourth.
```

---

## 12. Channel Explorer Rules for YouTube

Channel Explorer should use official API paths only.

Required concepts:

- Analyze channel URL / handle / channel ID
- Resolve source identity
- Fetch channel metadata through official API
- Discover uploads playlist through channel details where available
- Fetch channel uploads via `playlistItems.list`
- Hydrate videos through `videos.list`
- Store fetch jobs, page attempts, manifests, and coverage
- Support stop/resume when DB persistence exists
- Preserve partial manifests
- Deduplicate by YouTube video ID

Do not:

```text
Do not scrape channel pages.
Do not infer private channel analytics.
Do not claim complete channel coverage unless every planned page/token completed without caps/failures/max limits.
Do not treat Shorts inference as guaranteed unless official metadata supports it.
```

---

## 13. Playlist Explorer Rules

Playlist Explorer should:

- Accept playlist URLs and playlist IDs
- Fetch playlist metadata when public
- Fetch playlist items page by page
- Hydrate video metadata through `videos.list`
- Preserve playlist item order
- Store playlist manifest and manifest items
- Show unavailable/deleted/private videos honestly when the API returns limited placeholders or omits details
- Allow search/filter within playlist manifest

Do not claim a playlist is complete if pagination stopped, failed, or hit quota/max limits.

---

## 14. Link Explorer Rules

Link Explorer should analyze pasted YouTube URLs.

Supported input types:

```text
video URL
shorts URL
channel URL
handle URL
playlist URL
watch URL with list parameter
search URL if supported safely
```

Expected behavior:

- Parse input safely
- Identify object type
- Fetch only official public metadata
- Create a temporary or durable manifest depending on user action
- Preserve source input and normalized ID
- Do not auto-expand massive linked entities without user confirmation
- Do not scrape web HTML

---

## 15. Database and Migration Rules

Before DB/backend work, inspect:

```text
prisma.config.ts
prisma/schema.prisma
prisma/migrations/
scripts/db-validate-env.mjs
scripts/db-apply.mjs
.env.example
README.md
```

Rules:

```text
Use latest canonical schema.
Do not write new backend logic against stale tables.
Create migrations for schema changes.
Never run prisma migrate reset.
Never drop tables unless explicitly requested and proven safe.
Do not use prisma db push as production apply path.
Use prisma migrate deploy for committed production/staging migrations.
Do not run db:apply unless explicitly confirmed by the user.
```

### Canonical Data Concepts

Permanent / durable:

- `VideoSource` — platform source identity: channel, playlist, search source, related-video source
- `Video` — canonical normalized YouTube video metadata
- `Channel` or `VideoSource` channel fields — channel metadata if separated
- `Playlist` or `VideoSource` playlist fields — playlist metadata if separated
- `Collection` — user-owned saved collection
- `SavedVideo` — user saved/favorite reference
- `SourceCatalogSnapshot` — source coverage/metadata snapshots

Temporary / operational:

- `Manifest` — fetched result set
- `ManifestItem` — entity inside a manifest with ordering/context/provenance
- `FetchJob` — resumable fetch process
- `FetchPageAttempt` — page-token/API request attempt
- `FetchJobEvent` — lightweight progress/error event
- `QuotaUsageEvent` — optional quota accounting record

### Useful Unique Constraints

```text
Video(platform, platformVideoId)
VideoSource(platform, externalSourceId, sourceType)
ManifestItem(manifestId, entityKind, entityId)
FetchJob(sourceId, status, updatedAt) index
FetchPageAttempt(fetchJobId, pageToken, createdAt) index
```

### JSON Field Rules

Use JSON for flexible provider payloads, but keep queryable fields as real columns:

```text
title
channelId
channelTitle
publishedAt
durationSeconds
viewsCount
likesCount
commentsCount
thumbnailUrl
language
categoryId
isShortsLike
```

---

## 16. Manifest Rules

A manifest is the platform’s working set of fetched metadata.

Manifest types:

```text
SEARCH
CHANNEL_UPLOADS
PLAYLIST
LINK_EXPLORER
RELATED_VIDEO
SAVED_COLLECTION
AI_SELECTED
TEMPORARY
ARCHIVED
```

Manifest statuses:

```text
DRAFT
RUNNING
COMPLETE
PARTIAL
STOPPED
FAILED
MAX_ITEMS_REACHED
QUOTA_LIMITED
PROVIDER_LIMITED
EXPIRED
```

Rules:

```text
Do not mutate original manifest items when filtering.
Do not mix Search Manifest with Channel Manifest.
Do not mix Channel Uploads Manifest with Playlist Manifest.
Do not overwrite a durable source catalog when creating a temporary search manifest.
Deduplicate within manifest and across durable source catalogs.
Preserve provenance: query, source, page token, fetch job, playlist position, first seen time.
```

---

## 17. Advanced Filter Rules

Filters must apply to the correct source only:

```text
Search filters → current Search Manifest
Channel filters → current Channel Uploads Manifest
Playlist filters → current Playlist Manifest
Saved filters → Saved Library / Collection
AI filters → current allowed AI scope only
```

Rules:

```text
Filter first, sort second, render third after search-inside-results.
Do not mutate original manifest items.
Do not use stale arrays.
Do not trigger new provider searches just because filters changed.
Treat 0 as valid metadata.
Do not use truthiness checks for numeric metadata.
```

Good:

```ts
views === null || views === undefined
raw.statistics?.viewCount ?? null
```

Bad:

```ts
!views
raw.statistics?.viewCount || null
```

Common reusable filters:

```text
keyword
title/description/channel search
views min/max
likes min/max
comments min/max
duration min/max
year from/to
date from/to
language
region/channel
result kind
has thumbnail
has description
shorts-like yes/no
playlist/channel/video only
sort: newest, oldest, most views, least views, highest engagement, duration, title, local relevance
strict metadata mode
```

---

## 18. Search Inside Results Rules

Preferred local/search libraries:

- FlexSearch for loaded browser-side indexing and multilingual current-result search
- MiniSearch if simpler in a specific component
- PostgreSQL full-text/trigram search for durable large saved catalogs if implemented later

Rules:

```text
Search-inside-results must only search already-fetched/saved data.
It must not call YouTube.
It must support Arabic/English/mixed queries where practical.
It should preserve 0 values in indexed metadata.
For very large catalogs, prefer server pagination/search instead of loading everything in the browser.
```

Search fields:

```text
title
description
channel title
channel ID
tags
language
published year/date
duration
views
likes
comments
manifest source
attempt number
playlist title
playlist position
```

---

## 19. Gemini AI Rules

```text
Gemini API key is server-only.
GEMINI_MODEL is server-only and controls model selection.
Gemini must not run from client components.
AI must never invent videos.
AI must only reason over real fetched metadata.
AI output must be validated before applying filters/search params.
If Gemini fails, normal search/filter UI must keep working.
```

Keep AI scopes separate:

- General YouTube search intent helper
- Current Search Manifest
- Current Channel Uploads Manifest
- Current Playlist Manifest
- Current Link Explorer Manifest
- Saved Library / Collections
- Attempt-specific manifest
- Future semantic index

AI must show scope clearly in the UI:

```text
Scope: Current Search Manifest
Scope: Saved Channel Manifest
Scope: Playlist Manifest
Scope: Attempt #N
```

AI must answer with evidence:

```text
Referenced video IDs/titles
Used item count
Scope used
Confidence
Limitations
Suggested filters/search query only after user confirmation
```

Do not create a generic unrestricted AI database query endpoint.

---

## 20. Quota and Rate-Limit Rules

YouTube quota is a product constraint, not an afterthought.

Rules:

```text
Track estimated quota cost per operation when practical.
Show quota warnings before expensive actions.
Avoid repeated detail hydration for the same IDs.
Batch detail requests where official API allows.
Preserve partial manifests if quota or provider errors happen mid-run.
Do not retry endlessly.
Use exponential backoff only where appropriate and bounded.
Log sanitized provider errors.
Do not print API keys.
```

UI should show:

```text
Estimated quota cost
Pages fetched
Items collected
Hydrated details count
Quota-limited status
Retry/resume availability
```

---

## 21. UI and Design Rules

For UI tasks:

```text
Preserve functionality.
Improve visual hierarchy.
Use premium 2026 design.
Support dark and light mode.
Avoid random colors.
Avoid harsh pure black or blinding pure white.
Ensure all pages are responsive.
Keep cards spacious and readable.
Do not sacrifice usability for decoration.
```

Important UI areas:

- App shell
- Dashboard/home
- General Search page
- AI Search page
- Channel Explorer
- Playlist Explorer
- Link Explorer
- Saved Library
- Manifest detail pages
- Fetch history/attempt pages
- Video cards
- Channel cards
- Playlist cards
- Filters
- Active filter chips
- Fetch/search progress
- Manifest summary
- Empty/loading/error states
- Theme toggle
- Favicon/browser icon

Video cards must show:

- Thumbnail with stable aspect ratio
- Title with line clamp
- Channel/owner
- Views, preserving `0 views`
- Duration
- Published date/year
- Language if available
- Result type / shorts-like badge if applicable
- Actions
- Open on YouTube action
- AI action button for manifest-aware related/search assistant
- Provenance chips: manifest, query, source, playlist, page token, attempt

---

## 22. YouTube Result Types and Cards

Normalize all results into common item types:

```text
video
channel
playlist
shorts_like_video
unknown
```

Rules:

```text
Channels and playlists are not videos; do not render them as video-only cards.
Use separate cards or unified cards with clear type badges.
Search result cards may start with search-snippet metadata, then hydrate details when requested.
Do not show views/duration for channels/playlists unless official metadata for that entity supports the shown field.
```

Cards:

- Video Card
- Channel Card
- Playlist Card
- Manifest Item Card
- AI Recommendation/Reference Card

---

## 23. Middleware / Proxy Safety Rules

Middleware/proxy must be Edge-safe.

```text
Do not import Prisma in middleware/proxy.
Do not import Gemini in middleware/proxy.
Do not import YouTube API server clients in middleware/proxy.
Do not import server-only env validation in middleware/proxy.
Do not require DATABASE_URL in middleware/proxy.
Do not use Node-only modules in middleware/proxy.
Use public Supabase env only if needed.
Matcher should exclude static assets, images, favicon, and Next internals.
```

If Vercel shows middleware/proxy errors, inspect imports first.

---

## 24. Dependency Discipline

Before adding packages:

```text
Inspect package.json.
Inspect package-lock.json.
Verify current versions.
Prefer existing dependencies.
Add packages only when truly needed.
Justify new dependencies.
Keep lockfile aligned.
```

Preferred dependencies:

- Existing UI primitives before adding new UI libraries
- lucide-react for icons if already present
- FlexSearch if already selected for result search
- Prisma/Supabase only in server-only layers

Do not import undeclared packages.

---

## 25. Security and Privacy Rules

```text
Server-only secrets stay server-only.
Do not expose YOUTUBE_API_KEY, GEMINI_API_KEY, DATABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
Do not log raw secrets.
Do not store private OAuth tokens unless the auth/security model is explicitly designed.
Do not scrape or bypass YouTube access restrictions.
Do not claim private, deleted, hidden, or unavailable data exists unless official API returns it.
```

If OAuth is later implemented:

```text
Use least-privilege scopes.
Store tokens securely.
Clearly separate public discovery from user-authorized private/account data.
Never mix one user’s private data into another user’s manifests.
```

---

## 26. Suggested Pages

Core pages:

```text
/                         Dashboard
/search                   General YouTube Search
/ai-search                AI Search / AI Discovery Workspace
/channel-explorer         YouTube Channel Explorer
/playlist-explorer        Playlist Explorer
/link-explorer            YouTube URL Link Explorer
/channels                 Saved Channels
/channels/[sourceId]      Saved Channel Detail / Combined Manifest
/channels/[sourceId]/attempts/[attemptId]  Attempt Detail
/playlists                Saved Playlists
/manifests/[manifestId]   Manifest Detail
/saved                    Saved Library / Collections
/settings                 API/quota/profile settings if needed
```

Every page should preserve light/dark mode and responsive behavior.

---

## 27. Suggested API Routes

Provider search and details:

```text
POST /api/youtube/search
POST /api/youtube/videos/details
POST /api/youtube/channels/analyze
POST /api/youtube/channels/metadata
POST /api/youtube/playlists/analyze
POST /api/youtube/playlists/fetch
POST /api/youtube/link/analyze
```

Fetch jobs:

```text
POST /api/youtube/jobs/start
POST /api/youtube/jobs/next
POST /api/youtube/jobs/stop
GET  /api/youtube/jobs/[id]/status
GET  /api/youtube/history
GET  /api/youtube/coverage
```

Saved/manifests:

```text
GET  /api/youtube/sources
GET  /api/youtube/sources/[sourceId]/combined-manifest
GET  /api/youtube/sources/[sourceId]/attempts
GET  /api/youtube/attempts/[attemptId]
POST /api/youtube/search-saved
POST /api/manifests/filter
POST /api/manifests/export
```

AI:

```text
POST /api/ai/youtube-search-assistant
POST /api/ai/manifest-assistant
POST /api/ai/filter-helper
POST /api/ai/summarize-manifest
```

Do not create routes that bypass validation or expose secrets.

---

## 28. Verification Rules

After meaningful changes, run when possible:

```bash
npm run db:validate
npm run env:validate
npm run typecheck
npm run build
npm run lint
```

For UI changes, verify:

```text
/
/search
/ai-search
/channel-explorer
/playlist-explorer
/link-explorer
/channels
/saved
```

For DB changes, verify:

```bash
npm run db:status
npx prisma validate
npx prisma generate
```

Only apply migrations with explicit confirmation:

```powershell
$env:CONFIRM_DB_APPLY="true"; npm run db:apply
```

or:

```bash
CONFIRM_DB_APPLY=true npm run db:apply
```

Do not claim a migration was applied unless it truly ran against the real database.

---

## 29. Required Final Agent Report

Every agent must end with:

```text
Summary
Root cause or reason for change
Files changed
What changed
What was preserved
Environment-specific impact
Verification results
Blocked tests, if any
Remaining risks/limitations
Ledger update confirmation
```

For UI tasks:

```text
Light/dark mode checked?
Responsive behavior checked?
Pages reviewed?
Cards/forms/filters checked?
```

For DB tasks:

```text
Canonical schema impact
Migration impact
Read/write path impact
Whether db:apply was run
Whether secrets were printed
```

For YouTube/API tasks:

```text
Official YouTube docs checked?
Quota impact?
API key exposure checked?
Provider errors handled?
Partial manifests preserved?
Unsupported data avoided?
```

For AI tasks:

```text
AI scope used
Context item count
No-invention guard preserved
Referenced videos returned?
GEMINI_MODEL behavior
Whether Gemini key was printed
```

---

## 30. Short Universal Prompt Template

```text
Spawn a subagent to explore this repo. Use the latest available 2026 coding model for this task, preferably Codex GPT-5.5 Pro in Extra High Reasoning Mode.

Spawn multiple subagents to explore this repo in parallel:
1. architecture and dependency tracing
2. frontend/UI flow tracing
3. backend/API/runtime tracing
4. environment/Supabase/Prisma/Gemini/YouTube tracing
5. build/test/deployment verification

Analyze the current codebase first before making any changes.

Project:
AI YouTube Public Video Discovery Platform.

Important:
This is an existing or planned production-style project. Do not rebuild from scratch unless this is explicitly a greenfield scaffold task. Do not redesign the architecture unless explicitly requested. Do not remove working features. Do not change unrelated areas. Make only the minimal, surgical, backward-compatible changes required for this task.

Read first:
- youtube_discovery_ledger.md
- PROJECT_LEDGER.md
- README.md
- package.json
- package-lock.json
- relevant source files

Task type:
[UI-only / Backend-only / Full-stack / New feature / Hybrid]

Task:
[write the exact task]

Expected result:
[write the desired end state]

Environment paths to consider:
1. Local/Windows/PowerShell
2. Vercel production/preview
3. Supabase Postgres Session Pooler
4. GitHub Actions migration workflow
5. Codex/online agent environment
6. YouTube API quota and key environment

Do not:
- rebuild the app unnecessarily
- change unrelated files
- expose secrets
- run destructive DB commands
- remove fallbacks or guards without proof
- let AI fabricate videos
- add downloading/scraping/rehosting
- call YouTube from filters/search-inside-results

Verification:
Run relevant checks:
- npm run typecheck
- npm run build
- npm run db:validate if DB/env touched
- npm run db:status if DB connection can be tested
- npm run lint if available

Update:
- youtube_discovery_ledger.md or PROJECT_LEDGER.md

Final response must include:
- files changed
- what changed
- what was preserved
- verification
- limitations
- quota impact if YouTube API touched
- whether secrets were printed
- whether db:apply was run
```

---

## 31. JSON Prompt Template

```json
{
  "prompt_for": "Codex GPT-5.5 Pro Extra High Mode",
  "project": "AI YouTube Public Video Discovery Platform",
  "year": 2026,
  "mode": "Update existing project, do not rebuild from scratch unless explicitly greenfield",
  "startup_instruction": "Spawn a subagent to explore this repo. Spawn multiple subagents to explore this repo before implementation.",
  "task_type": "UI-only | Backend-only | Full-stack | New feature | Hybrid",
  "main_goal": "WRITE_THE_EXACT_GOAL_HERE",
  "must_do_first": [
    "Read youtube_discovery_ledger.md if present.",
    "Read PROJECT_LEDGER.md and README.md.",
    "Inspect package.json and package-lock.json.",
    "Analyze the current codebase before changing anything.",
    "Trace relevant imports, routes, services, state, and runtime boundaries.",
    "Check official docs for any version-sensitive framework/library/API behavior.",
    "Check official YouTube Data API docs if provider behavior is touched.",
    "Identify the smallest safe edit surface."
  ],
  "project_rules": [
    "Do not rebuild from scratch unnecessarily.",
    "Do not change unrelated areas.",
    "Do not remove working features.",
    "Do not expose secrets.",
    "Do not add downloading, scraping, rehosting, or stream bypassing.",
    "Do not let AI fabricate video results.",
    "Preserve Search Manifest, Channel Manifest, Playlist Manifest, Saved Library, and AI scope separation.",
    "Treat 0 numeric metadata as valid.",
    "Do not call YouTube from local filters or search-inside-results."
  ],
  "environment_paths": [
    "Local / Windows / PowerShell",
    "Vercel Production / Preview",
    "Supabase Postgres Session Pooler",
    "GitHub Actions migrations",
    "Codex / online agent environment",
    "YouTube API key and quota environment"
  ],
  "files_to_inspect_first": [
    "README.md",
    "PROJECT_LEDGER.md",
    "youtube_discovery_ledger.md",
    "package.json",
    "package-lock.json",
    "prisma.config.ts",
    "prisma/schema.prisma",
    "scripts/",
    "src/app/",
    "src/components/",
    "src/lib/",
    ".github/workflows/"
  ],
  "task_requirements": [
    "ADD_TASK_SPECIFIC_REQUIREMENTS_HERE"
  ],
  "do_not": [
    "Do not run prisma migrate reset.",
    "Do not drop tables.",
    "Do not print DATABASE_URL, YOUTUBE_API_KEY, GEMINI_API_KEY, or any secrets.",
    "Do not import server-only code into client components.",
    "Do not import Prisma/Gemini/YouTube server clients into middleware/proxy.",
    "Do not claim live verification if it was not performed."
  ],
  "verification_requirements": [
    "Run npm run typecheck when possible.",
    "Run npm run build when possible.",
    "Run npm run db:validate if env/database code was touched.",
    "Run npm run lint if available.",
    "Explain blocked tests clearly."
  ],
  "ledger_update_required": true,
  "final_response_required": [
    "Summary",
    "Files changed",
    "What changed",
    "What was preserved",
    "Environment impact",
    "Quota impact if relevant",
    "Verification results",
    "Remaining limitations",
    "Ledger update confirmation"
  ]
}
```

---

## 32. Example UI Prompt

```text
Spawn a subagent to explore this repo. Use the latest available 2026 coding model for this task, preferably Codex GPT-5.5 Pro in Extra High Reasoning Mode.

Task type: UI-only.

Task:
Improve the YouTube Search page layout and result cards so the page feels like a premium 2026 public video metadata discovery workspace in both dark and light mode.

Rules:
- Do not change YouTube API logic.
- Do not change manifest/filter logic.
- Do not touch Prisma/Supabase/Gemini routes.
- Preserve all existing actions and data.
- Only improve UI, spacing, hierarchy, responsiveness, cards, and theme consistency.

Inspect first:
- src/app/search/page.tsx
- src/components/video/
- src/components/filters/
- src/components/search/
- src/app/globals.css
- theme/layout files

Verify:
- npm run typecheck
- npm run build
- Review /search, /channel-explorer, /saved where shared cards are used.

Update youtube_discovery_ledger.md.
```

---

## 33. Example Backend Prompt

```text
Spawn a subagent to explore this repo. Use the latest available 2026 coding model for this task, preferably Codex GPT-5.5 Pro in Extra High Reasoning Mode.

Task type: Backend-only.

Task:
Implement the server-side YouTube search route with safe request validation, server-only YOUTUBE_API_KEY usage, typed normalized responses, quota-aware metadata, and temporary search manifest output.

Rules:
- Use official YouTube Data API only.
- Do not expose YOUTUBE_API_KEY.
- Do not scrape YouTube pages.
- Do not download or rehost video content.
- Do not let filters call YouTube.
- Preserve partial manifests if later pages fail.
- Return controlled errors.

Inspect:
- src/app/api/youtube/search/route.ts
- src/lib/platforms/youtube/
- src/lib/manifests/
- src/lib/config/env.ts
- src/types/
- .env.example
- README.md

Verify:
- npm run typecheck
- npm run build
- npm run db:validate if env validation changed

Update youtube_discovery_ledger.md.
```

---

## 34. Example Full-Stack Prompt

```text
Spawn a subagent to explore this repo. Use the latest available 2026 coding model for this task, preferably Codex GPT-5.5 Pro in Extra High Reasoning Mode.

Task type: Full-stack.

Task:
Build the general YouTube Search workspace with provider search settings, temporary search manifests, search-inside-results, advanced local filters, result cards for video/channel/playlist types, and export JSON/NDJSON.

Rules:
- Provider search settings call YouTube only when the user explicitly clicks Search.
- Search-inside-results and filters must never call YouTube.
- Keep Search Manifest separate from Channel Manifest and Saved Library.
- Treat 0 numeric metadata as valid.
- Use official YouTube Data API only.
- Do not download, scrape, or rehost.
- Do not expose secrets.

Verify:
- npm run typecheck
- npm run build
- Manual test /search with a real query if YOUTUBE_API_KEY is available.
- If API key is missing, show controlled unavailable state and do not claim live provider verification.

Update youtube_discovery_ledger.md.
```

---

## 35. Final Rule

When in doubt:

```text
Read the ledger.
Read the code.
Check official docs.
Respect YouTube API limitations and quota.
Change only the necessary files.
Preserve architecture.
Do not expose secrets.
Do not scrape/download/rehost.
Do not let AI invent videos.
Verify honestly.
Update the ledger.
```
