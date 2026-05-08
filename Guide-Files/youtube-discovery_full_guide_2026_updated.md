# youtube-discovery — Full 2026 Build Guide

**Guide version:** 2026-05-08  
**Target project:** `youtube-discovery`, a new separate platform inspired by Dailymotion Discovery  
**Suggested repo:** `youtube-discovery`  
**Framework baseline:** Next.js `^16.2.6`, React 19, TypeScript strict mode, Tailwind CSS 4  
**Primary platform:** YouTube public metadata via official APIs  
**Core principle:** metadata discovery only; no downloading, no scraping, no rehosting, no private-data access.

**Canonical platform name:** `youtube-discovery`.

---

## 1. Executive Summary

Build a new professional platform for discovering, collecting, filtering, saving, and analyzing **public YouTube metadata**. The app should feel like a premium 2026 research/discovery SaaS and should reuse the strongest ideas from the existing Dailymotion Discovery platform:

- Manifest-first architecture.
- Strong reusable filters.
- Search inside collected results.
- Saved and temporary manifests.
- Saved channels, playlists, attempts, and collections.
- AI assistants grounded only in real fetched metadata.
- Strong distinction between provider search settings and local result filters.
- Honest API limitation handling.

The platform must support public YouTube search for videos, channels, and playlists; classify Shorts-like videos when possible; explore channel uploads; explore public playlists; run saved-result search; export manifests; and provide AI actions under each video card.

---

## 2. Product Identity

### Project Name

Recommended and canonical:

```text
youtube-discovery
```

Alternative display name:

```text
YouTube Discovery Research Terminal
```

### Mission

Help researchers, analysts, students, content teams, and developers discover and organize public YouTube metadata without starting from scratch every time.

### What the platform does

- Searches public YouTube metadata.
- Fetches structured details for videos, channels, and playlists.
- Stores result sets in manifests.
- Lets users filter, sort, and search inside collected results.
- Lets users save useful results and collections.
- Lets AI reason over known data only.
- Supports future semantic search and multi-platform expansion.

### What the platform must not do

- No video downloading.
- No stream scraping.
- No rehosting.
- No bypassing YouTube restrictions.
- No private playlist/user data access.
- No fabricated AI video results.
- No browser exposure of API keys.

---

## 3. Official API Reality

The implementation must verify official YouTube Data API docs before coding. This guide uses the following assumptions:

### 3.1 Supported official search result types

The YouTube `search.list` endpoint returns matching resources and can be restricted by `type`. The normal official resource types for search are:

```text
video
channel
playlist
```

Design the UI around these types first.

### 3.2 Shorts handling

YouTube Shorts are videos. Do not assume the official API has a universal `type=shorts` search filter. The app may classify **Shorts-like** results after fetching video details using conservative signals:

- duration <= 60 seconds;
- URL or metadata hints when available;
- no guarantee unless the official API exposes a direct field in the future.

Use label:

```text
Shorts-like
```

not:

```text
Guaranteed Short
```

### 3.3 Posts / Community tab

The user wants posts, but the official API does not provide a normal public community-post search surface comparable to videos/channels/playlists. Therefore:

- Add a future-ready Posts tab/state.
- Do not scrape community posts.
- Show honest UI copy when unsupported.
- Add a future adapter only if an official endpoint becomes available.

Suggested UI copy:

```text
Community posts are shown only when an official YouTube API endpoint exposes them. This app does not scrape YouTube pages.
```

### 3.4 Public/private playlists

The app can discover and fetch public playlists that the API returns. It cannot know which private playlists contain a video or which users saved it privately.

Use honest labels:

```text
Known public playlist appearances
```

Do not say:

```text
All playlists containing this video
```

### 3.5 Channel uploads

For complete channel upload exploration, prefer this official pattern:

1. Resolve channel metadata with `channels.list`.
2. Read the uploads playlist from `contentDetails.relatedPlaylists.uploads`.
3. Fetch that playlist using `playlistItems.list`.
4. Batch enrich video IDs using `videos.list`.

Do not rely only on `search.list(channelId=..., type=video)` for a full upload catalog.

### 3.6 Quota reality

The app must track quota cost estimates. `search.list` is expensive compared with detail lookups. Efficient pattern:

```text
search.list -> IDs
videos.list / channels.list / playlists.list -> detailed metadata in batches
```

---

## 4. Main Platform Features

### 4.1 General YouTube Search

A full `/search` workspace should support:

- Query input.
- Search settings.
- Resource type selector.
- Advanced filters.
- Search progress.
- Temporary search manifest.
- Search inside current results.
- AI search assistant.
- Export JSON/NDJSON.
- Save search manifest.

Search result types:

- Videos.
- Channels.
- Playlists.
- Shorts-like videos after enrichment/classification.
- Live/upcoming/completed videos when official parameters support it.
- Posts only as unsupported/future-ready unless official API supports them.

### 4.2 Strong Filters

The filter system must be reusable across pages and tools.

Filter categories:

- Keyword.
- Year.
- Date range.
- Views min/max.
- Target views.
- Likes min/max if available.
- Comments min/max if available.
- Duration min/max seconds.
- Duration groups: short / medium / long.
- Result type: video, Shorts-like, channel, playlist, live, upcoming, completed.
- Channel/owner.
- Language.
- Region.
- Category/topic.
- Has thumbnail.
- Has description.
- Has captions if supported.
- Embeddable if supported.
- Definition: HD/SD if supported.
- Sort: API order, latest, oldest, most views, least views, most likes, least likes, shortest, longest, title A-Z.

Important numeric rule:

```text
0 views is valid and must be displayed/filterable.
```

### 4.3 Search Settings vs Result Filters

Keep this separation everywhere.

#### Provider Search Settings

These call YouTube only when the user explicitly clicks a fetch/search button:

- query;
- resource type;
- max pages;
- page size;
- region;
- language;
- order;
- publishedAfter / publishedBefore;
- videoDuration;
- videoDefinition;
- videoCaption;
- eventType;
- safeSearch;
- topic/category.

#### Result Filters

These work only on already collected results:

- keyword inside results;
- views/duration/year filters;
- owner/channel filters;
- local sort;
- AI suggested filters after user confirmation.

Rules:

```text
Changing filters must not call YouTube.
Changing search settings must not mutate the current manifest until a new search starts.
Search inside results must not call YouTube.
```

Pipeline:

```text
local search -> result filters -> sort -> pagination/render
```

### 4.4 Manifest System

Every result set must become a manifest.

Manifest types:

```text
youtube_search
youtube_channel_uploads
youtube_playlist
youtube_related_videos
youtube_saved_collection
youtube_ai_result_set
```

Manifest status:

```text
draft
running
complete
partial
failed
stopped
max_items_reached
quota_limited
provider_limited
```

Temporary search manifests:

- Created after every search.
- Stored in current session state and optionally DB if persistence is enabled.
- Exportable.
- Searchable/filterable.
- Clearable.

Durable manifests:

- Saved by user.
- DB-backed.
- Searchable later.
- Usable by AI assistants.
- Associated with saved channels, playlists, collections, and history.

### 4.5 AI Button Under Every Video Card

Every video result card should include:

```text
AI Explore
```

AI Explore can:

- summarize selected metadata;
- search current manifest for similar videos;
- search saved manifests for similar videos;
- suggest filters;
- generate a better related search query;
- optionally call official related search only after user confirmation;
- show known public playlist appearances already discovered by the platform.

It must not:

- invent private playlist relationships;
- claim global relationship knowledge;
- access private user data;
- scrape YouTube.

---

## 5. Pages and UI

### 5.1 Navigation

Suggested routes:

```text
/
/search
/ai-search
/link-explorer
/channels
/channels/[sourceId]
/playlists
/playlists/[playlistId]
/manifests
/collections
/saved
/history
/settings
```

### 5.2 Dashboard

Show:

- search count;
- saved manifests;
- saved channels;
- saved playlists;
- quota estimate;
- recent searches;
- recent AI sessions;
- quick actions.

### 5.3 General Search Page

Sections:

1. Search command bar.
2. Quick category chips.
3. Search settings.
4. Search progress.
5. Temporary manifest summary.
6. Search inside current results.
7. Advanced filters.
8. Results toolbar.
9. Results grid/table.
10. AI Search Assistant.

### 5.4 Channel Detail Page

Sections:

- Channel metadata.
- Uploads manifest.
- Search within channel.
- Channel playlists.
- Fetch/history attempts.
- Coverage.
- Saved videos.
- AI channel assistant.

### 5.5 Playlist Detail Page

Sections:

- Playlist metadata.
- Playlist items.
- Result filters.
- Search inside playlist.
- Export/save.
- AI playlist assistant.

### 5.6 Link Explorer

Accepts:

- video URL;
- Shorts URL;
- channel URL;
- handle URL;
- playlist URL.

Resolves:

- entity type;
- IDs;
- official API strategy;
- available actions.

### 5.7 Result Card Design

Each video card must show:

- thumbnail;
- title;
- duration badge;
- channel/owner;
- views;
- likes/comments if available;
- publish date/year;
- language;
- type badge;
- saved state;
- manifest provenance;
- AI Explore button;
- open on YouTube action.

Each card must be responsive and preserve zero values.

---

## 6. Data Types

### 6.1 Normalized YouTube Item

```ts
type YouTubeDiscoveryItemType =
  | "video"
  | "shorts_like"
  | "channel"
  | "playlist"
  | "live"
  | "upcoming"
  | "completed_live"
  | "post_unsupported";

interface NormalizedYouTubeDiscoveryItem {
  id: string;
  platform: "youtube";
  itemType: YouTubeDiscoveryItemType;
  platformItemId: string;
  url: string;
  title: string;
  description: string | null;
  thumbnailUrl: string | null;
  channelId: string | null;
  channelTitle: string | null;
  publishedAt: string | null;
  durationSeconds: number | null;
  viewsCount: number | null;
  likesCount: number | null;
  commentsCount: number | null;
  language: string | null;
  region: string | null;
  tags: string[];
  categoryId: string | null;
  isEmbeddable: boolean | null;
  liveBroadcastContent: "none" | "live" | "upcoming" | "completed" | null;
  isShortsLike: boolean;
  rawJson: unknown;
  manifestId?: string;
  collectedAt?: string;
}
```

### 6.2 Search Settings

```ts
interface YouTubeSearchSettings {
  query: string;
  types: Array<"video" | "channel" | "playlist">;
  pageSize: number;
  maxPages: number;
  maxItems: number;
  order?: "relevance" | "date" | "rating" | "viewCount" | "title" | "videoCount";
  publishedAfter?: string;
  publishedBefore?: string;
  regionCode?: string;
  relevanceLanguage?: string;
  safeSearch?: "none" | "moderate" | "strict";
  videoDuration?: "any" | "short" | "medium" | "long";
  videoDefinition?: "any" | "high" | "standard";
  videoCaption?: "any" | "closedCaption" | "none";
  videoEmbeddable?: "any" | "true";
  eventType?: "live" | "completed" | "upcoming";
  topicId?: string;
}
```

### 6.3 Result Filters

```ts
interface YouTubeResultFilters {
  keyword: string;
  minViews: number | null;
  maxViews: number | null;
  targetViews: number | null;
  minLikes: number | null;
  maxLikes: number | null;
  minComments: number | null;
  maxComments: number | null;
  durationMinSec: number | null;
  durationMaxSec: number | null;
  year: number | null;
  yearFrom: number | null;
  yearTo: number | null;
  publishedAfter: string | null;
  publishedBefore: string | null;
  itemTypes: YouTubeDiscoveryItemType[];
  channelId: string | null;
  channelName: string | null;
  language: string | null;
  hasThumbnail: "any" | "yes" | "no";
  hasDescription: "any" | "yes" | "no";
  sort:
    | "api_order"
    | "latest"
    | "oldest"
    | "most_views"
    | "least_views"
    | "most_likes"
    | "least_likes"
    | "most_comments"
    | "least_comments"
    | "shortest"
    | "longest"
    | "title_az"
    | "title_za";
  strictMetadata: boolean;
}
```

---

## 7. Tech Stack

Recommended baseline:

```text
Next.js ^16.2.6
React 19
TypeScript strict mode
Tailwind CSS 4
shadcn/ui or custom primitives
lucide-react
Zod
Prisma 7
Supabase PostgreSQL
@prisma/adapter-pg + pg if Prisma runtime requires adapter
Zustand or TanStack Query
FlexSearch
Gemini SDK
```

Use latest stable compatible versions at implementation time.

---

## 8. Environment Variables

```env
NEXT_PUBLIC_APP_URL="http://localhost:3000"
DATABASE_URL="postgresql://..."

YOUTUBE_API_BASE_URL="https://www.googleapis.com/youtube/v3"
YOUTUBE_API_KEY="PUT_SERVER_ONLY_YOUTUBE_API_KEY_HERE"
YOUTUBE_DEFAULT_REGION="US"
YOUTUBE_DEFAULT_RELEVANCE_LANGUAGE="en"
YOUTUBE_SEARCH_PAGE_SIZE="50"
YOUTUBE_SEARCH_MAX_PAGES="10"
YOUTUBE_SEARCH_MAX_ITEMS="500"
YOUTUBE_SEARCH_DELAY_MS="250"
YOUTUBE_SEARCH_CONCURRENCY="1"
YOUTUBE_DAILY_QUOTA_BUDGET="10000"
ENABLE_YOUTUBE_MANIFEST_PERSISTENCE="true"

GEMINI_API_KEY="PUT_SERVER_ONLY_GEMINI_KEY_HERE"
GEMINI_MODEL="PUT_MODEL_NAME_HERE"
AI_MANIFEST_MAX_ITEMS="60"
AI_MANIFEST_MAX_CHARS="30000"
```

Rules:

- Do not create `NEXT_PUBLIC_YOUTUBE_API_KEY`.
- Do not print keys.
- Do not commit `.env` or `.env.local`.
- Missing YouTube key should disable YouTube features gracefully, not crash the whole app.

---

## 9. YouTube API Adapter

Recommended file structure:

```text
src/lib/platforms/youtube/youtube-client.ts
src/lib/platforms/youtube/youtube-normalize.ts
src/lib/platforms/youtube/youtube-search-service.ts
src/lib/platforms/youtube/youtube-channel-service.ts
src/lib/platforms/youtube/youtube-playlist-service.ts
src/lib/platforms/youtube/youtube-related-service.ts
src/lib/platforms/youtube/youtube-url-analyzer.ts
src/lib/platforms/youtube/youtube-quota.ts
src/lib/platforms/youtube/youtube-errors.ts
```

### Search flow

1. Validate request with Zod.
2. Call `search.list` for discovery.
3. Split IDs by type.
4. Call `videos.list`, `channels.list`, and `playlists.list` for details.
5. Normalize results.
6. Build manifest.
7. Persist if enabled.
8. Return manifest + quota estimate + provider warnings.

### Channel uploads flow

1. Analyze URL or handle.
2. Resolve channel ID.
3. Fetch channel metadata and uploads playlist ID.
4. Page through `playlistItems.list`.
5. Batch video details through `videos.list`.
6. Create channel uploads manifest.
7. Support stop/resume if DB persistence is enabled.

### Playlist flow

1. Resolve playlist ID.
2. Fetch playlist metadata.
3. Page through `playlistItems.list`.
4. Batch enrich videos.
5. Create playlist manifest.

---

## 10. Database and Prisma

Use these concepts.

Permanent:

- `VideoSource`
- `YouTubeVideo`
- `YouTubeChannel`
- `YouTubePlaylist`
- `Manifest`
- `ManifestItem`
- `SavedVideo`
- `Collection`
- `AiSession`

Operational:

- `SearchJob`
- `SearchPageAttempt`
- `FetchJob`
- `FetchJobEvent`
- `ProviderRequestLog`
- `QuotaUsageEvent`

Suggested unique constraints:

```text
YouTubeVideo(platformVideoId)
YouTubeChannel(platformChannelId)
YouTubePlaylist(platformPlaylistId)
ManifestItem(manifestId, itemType, platformItemId)
VideoSource(platform, sourceType, externalSourceId)
```

Do not duplicate videos by title only.

Dedupe order:

1. platform + platform item ID;
2. canonical URL;
3. conservative fingerprint only when provider ID is unavailable.

---

## 11. Search Inside Results

Use FlexSearch for loaded browser results if already installed or if selected for the new project.

Index fields:

- title;
- description;
- channel title;
- tags;
- language;
- published year;
- duration;
- views;
- item type;
- playlist title;
- saved notes.

Search scopes:

- Current search manifest.
- Current channel manifest.
- Current playlist manifest.
- Saved manifest.
- Collection.
- AI candidate set.

For large manifests, use server pagination/search and avoid loading everything into the browser at once.

---

## 12. AI System

### 12.1 AI principles

AI must only answer using provided metadata.

It must not invent:

- videos;
- IDs;
- URLs;
- private playlist relationships;
- channel totals;
- views/likes/comments;
- availability.

### 12.2 Assistants

Build:

- General Search AI Assistant.
- Manifest AI Assistant.
- Video AI Explorer.
- Channel AI Analyst.
- Playlist AI Analyst.
- Collection AI Assistant.

### 12.3 Video AI Explorer

On each card, the AI button opens context-specific actions:

- summarize this video metadata;
- find similar in current manifest;
- find similar in saved manifests;
- generate a related search query;
- find known public playlist appearances from saved data;
- related videos via official API after confirmation.

### 12.4 AI context builder

Create:

```text
src/lib/ai/youtube-manifest-context.ts
src/lib/ai/youtube-ai-schemas.ts
src/app/api/ai/youtube-search-assistant/route.ts
src/app/api/ai/youtube-manifest-assistant/route.ts
src/app/api/ai/youtube-video-explorer/route.ts
```

Use top-K candidate selection. Do not send huge manifests blindly.

---

## 13. Related and Similar Results

### Similar inside current data

No API call. Use:

- title similarity;
- tags overlap;
- channel match;
- category match;
- description terms;
- duration similarity;
- language match.

### Related via official API

If official API supports related video lookup, use only after explicit user action.

### Playlist appearances

Show only known public playlist appearances discovered by the app. Do not claim all public/private playlists.

---

## 14. UI Design Direction

Use the user-provided screenshot as inspiration:

- premium black dark mode;
- warm beige/gold highlights;
- compact top navigation;
- search-first interface;
- category chips;
- strong filters;
- results by year charts;
- result cards with metadata.

### Dark mode

```css
--background: #050505;
--surface: #10100f;
--surface-elevated: #171615;
--surface-muted: #201e1b;
--border: #2f2b25;
--foreground: #f4eadc;
--muted-foreground: #b6a78f;
--primary: #f3c991;
--primary-strong: #f6b96a;
--success: #34d399;
--warning: #fbbf24;
--error: #f87171;
```

### Light mode

```css
--background: #f8f4ec;
--surface: #ffffff;
--surface-elevated: #fffaf3;
--surface-muted: #f1eadf;
--border: #dfd2bf;
--foreground: #1e1a16;
--muted-foreground: #7b6a58;
--primary: #9f6434;
--primary-strong: #7c4624;
```

### Components

- Search command bar.
- Category chips.
- Filter sidebar/drawer.
- Result cards.
- Metadata badges.
- Result analytics by year.
- Manifest stats.
- Quota usage badge.
- AI action chips.
- Empty/loading/error states.

---

## 15. Implementation Phases

### Phase 0 — Project setup

- Create Next.js project.
- Add TypeScript strict mode.
- Add Tailwind 4.
- Add UI primitives.
- Add Prisma/Supabase.
- Add env validation.
- Add lint/build/typecheck scripts.

### Phase 1 — Design system

- Dark/light themes.
- App shell.
- Navigation.
- UI primitives.
- Video/channel/playlist cards.

### Phase 2 — YouTube adapter

- YouTube client.
- Error handling.
- Quota estimator.
- Search wrapper.
- Detail wrappers.
- Normalization.

### Phase 3 — General search

- Search page.
- Search settings.
- Search progress.
- Temporary manifest.
- Result filters.
- Search inside results.
- Export.

### Phase 4 — Persistence

- Prisma schema.
- Migrations.
- Manifest repository.
- Saved manifests.
- Saved results.

### Phase 5 — Channel uploads

- URL analyzer.
- Channel resolver.
- Uploads playlist fetch.
- Attempts/history.
- Resume.

### Phase 6 — Playlist explorer

- Playlist resolver.
- Playlist items fetch.
- Playlist manifest.
- Playlist filters and AI.

### Phase 7 — AI assistants

- General search assistant.
- Manifest assistant.
- Video AI Explorer.
- Channel/playlist assistants.

### Phase 8 — Saved library

- Collections.
- Saved videos.
- Tags.
- Notes.
- Saved search.

### Phase 9 — Scale and production hardening

- Pagination.
- Virtualization.
- Quota dashboards.
- Error monitoring.
- Vercel deployment.
- GitHub Actions guarded migrations.

---

## 16. API Routes

Recommended routes:

```text
POST /api/youtube/search
POST /api/youtube/search/next
POST /api/youtube/details/videos
POST /api/youtube/details/channels
POST /api/youtube/details/playlists
POST /api/youtube/channel/analyze
POST /api/youtube/channel/uploads/start
POST /api/youtube/channel/uploads/next
POST /api/youtube/playlist/analyze
POST /api/youtube/playlist/items/start
POST /api/youtube/playlist/items/next
POST /api/youtube/related/start
GET  /api/youtube/manifests
GET  /api/youtube/manifests/[manifestId]
POST /api/youtube/manifests/[manifestId]/search
POST /api/youtube/manifests/[manifestId]/filter
POST /api/youtube/manifests/[manifestId]/save
POST /api/ai/youtube-search-assistant
POST /api/ai/youtube-manifest-assistant
POST /api/ai/youtube-video-explorer
```

---

## 17. Verification

Run:

```bash
npm run typecheck
npm run build
npm run db:validate
npm run db:status
npx prisma validate
npx prisma generate
```

Manual tests:

1. Search `music`.
2. Search `football`.
3. Search Arabic query.
4. Filter by year.
5. Filter by views including `0 views`.
6. Sort latest/oldest/most views/least views.
7. Search inside current manifest.
8. Export manifest.
9. Save manifest.
10. Open saved manifest.
11. Use AI Explore on a video.
12. Ask AI about current manifest.
13. Explore channel uploads.
14. Explore public playlist.
15. Confirm filters do not call YouTube.
16. Confirm secrets are not printed.

---

## 18. Agent Implementation Prompt

```text
Use the latest available 2026 coding model for this task, preferably Codex GPT-5.5 Pro in Extra High Reasoning Mode. Spawn multiple subagents to explore the repo before implementation.

Project:
youtube-discovery.

Task type:
New full-stack platform / YouTube public metadata discovery / manifest-based search system.

Main goal:
Build a new separate Next.js ^16.2.6 platform inspired by the existing Dailymotion Discovery platform, but focused on public YouTube metadata discovery through official APIs. The app must support general YouTube search, advanced filters, temporary and durable manifests, saved results, channel uploads exploration, playlist exploration, search-inside-results, AI assistants grounded in real metadata, and future-ready collections.

Important:
This is not a video downloader, not a scraper, and not a rehosting tool. Use official YouTube APIs only. Do not access private data. Do not fabricate videos, counts, URLs, playlist relationships, or unavailable metadata.

Core requirements:
- Next.js ^16.2.6
- React 19
- TypeScript strict mode
- Tailwind CSS 4
- Supabase PostgreSQL
- Prisma 7
- Zod validation
- FlexSearch for loaded-result search
- Gemini AI server-only helpers
- Server-only YOUTUBE_API_KEY
- Server-only GEMINI_API_KEY and GEMINI_MODEL
- Dark/light mode
- Metadata-only architecture

Build pages:
- /
- /search
- /ai-search
- /link-explorer
- /channels
- /channels/[sourceId]
- /playlists
- /playlists/[playlistId]
- /manifests
- /collections
- /saved
- /history

Implement:
- YouTube API adapter
- General search
- Search settings
- Temporary search manifests
- Durable saved manifests
- Result filters
- Search inside results
- Video/channel/playlist result cards
- Channel uploads explorer via uploads playlist
- Playlist explorer
- AI assistant over current/saved manifests
- AI Explore button under every video card
- Zero-safe filtering
- Quota tracking
- Export JSON/NDJSON
- Honest limitations for Shorts/posts/private playlists

Do not:
- scrape
- download videos
- rehost videos
- access private data
- expose API keys
- use fake data
- let filters call YouTube
- let AI invent metadata
- claim all playlists/private relationships

Verification:
- npm run typecheck
- npm run build
- npm run db:validate
- npm run db:status
- npx prisma validate
- npx prisma generate

Final response must include:
- Summary
- Files changed
- Architecture implemented
- YouTube API behavior
- Search and filter behavior
- Manifest behavior
- AI behavior
- DB/migration status
- Verification
- Limitations
- Secrets printed?
- db:apply run?
```

---

## 19. Official Documentation References

Check during implementation:

- YouTube Data API overview: https://developers.google.com/youtube/v3/getting-started
- YouTube Data API reference: https://developers.google.com/youtube/v3/docs
- `search.list`: https://developers.google.com/youtube/v3/docs/search/list
- `videos.list`: https://developers.google.com/youtube/v3/docs/videos/list
- `channels.list`: https://developers.google.com/youtube/v3/docs/channels/list
- channels resource: https://developers.google.com/youtube/v3/docs/channels
- `playlists.list`: https://developers.google.com/youtube/v3/docs/playlists/list
- `playlistItems.list`: https://developers.google.com/youtube/v3/docs/playlistItems/list
- `activities.list`: https://developers.google.com/youtube/v3/docs/activities/list
- `commentThreads`: https://developers.google.com/youtube/v3/docs/commentThreads
- quota calculator: https://developers.google.com/youtube/v3/determine_quota_cost
- quota and compliance audits: https://developers.google.com/youtube/v3/guides/quota_and_compliance_audits
- revision history: https://developers.google.com/youtube/v3/revision_history
- Next.js: https://nextjs.org/docs
- Prisma: https://www.prisma.io/docs
- Supabase: https://supabase.com/docs
- FlexSearch: https://github.com/nextapps-de/flexsearch

---

## 20. Final Build Rules

- Use official APIs only.
- Keep provider search settings separate from result filters.
- Keep temporary manifests separate from durable manifests.
- Keep Search, Channel, Playlist, Saved Library, and AI scopes separate.
- Treat unknown metadata as unknown.
- Treat `0` numeric metadata as valid.
- Never claim complete coverage unless proven.
- Never expose secrets.
- Always update the project ledger after meaningful changes.
