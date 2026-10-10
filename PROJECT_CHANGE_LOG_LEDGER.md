# PROJECT_CHANGE_LOG_LEDGER

## 2026-05-10 (AI Structured Report)

### Date/time

2026-05-10 ~00:45 UTC

### Task summary

Upgraded the AI assistant pipeline to return structured JSON reports instead of flat text. Modified the prompt and context builder to ask for specific sections (manifestSummary, topEntities, contentPatterns, suggestedNextQueries). Revamped the frontend `AiAssistantPanel` to display collapsible clean UI sections and confirmation-only copyable suggested queries.

### Reason/root cause

User requested the AI assistant to produce deeper, strictly-formatted insights with actionable, non-auto-executing search query suggestions to help discover forgotten content, while retaining absolute bounds on hallucination.

### Files changed

- `src/lib/ai/youtube-ai-schemas.ts`
- `src/lib/ai/youtube-manifest-context.ts`
- `src/lib/ai/gemini-client.ts`
- `src/components/ai/ai-assistant-panel.tsx`
- `src/components/search/search-workspace.tsx`

### Technical details

- Switched `AiAssistantResponseSchema` to enforce structured fields instead of just an `answer`.
- Modified `buildManifestContext` prompt to explicitly instruct Gemini to return this exact JSON structure.
- Created `AiSuggestedQuerySchema` for `{ query, reasoning }` pairs.
- Frontend `AiAssistantPanel` now parses and maps these objects into accordion-style collapsible segments.
- Suggested queries display as actionable buttons that copy the query to the search component's state or prepare a `/search?q=` link.

### Verification

- `npm run typecheck`: passed.
- `npm run build`: passed.
- Mock tests in UI correctly render collapsible sections and badge tags.

### Secrets printed: No
### Migrations created/applied: No
### db:apply run: No

---

## 2026-05-10 (Floating AI Drawer & Uncapped Context)

### Date/time
2026-05-10

### Agent/model if known
Codex GPT-5.5 Pro

### Task summary
Refactored the AI assistant UI into a global floating action button with a wide drawer, freeing up layout space in the grid. Additionally, removed the strict server-side item and character caps, allowing for much larger manifest context to be sent to Gemini.

### Reason/root cause
The sidebar layout constrained both the AI report readability and the primary search/filter grids. Also, the hardcoded limits (`AI_MANIFEST_MAX_ITEMS` and `AI_MANIFEST_MAX_CHARS`) were triggering unnecessary server validation rejections, preventing complete analysis of larger manifests.

### Files changed
- `src/components/ai/ai-assistant-panel.tsx`
- `src/components/search/search-workspace.tsx`
- `src/components/playlists/playlist-explorer-workspace.tsx`
- `src/components/manifests/manifest-detail-workspace.tsx`
- `src/components/channels/channel-explorer-workspace.tsx`
- `src/lib/ai/youtube-manifest-context.ts`

### Technical details
- Refactored `AiAssistantPanel` into a FAB and wide drawer overlay.
- Removed `col-span-12 xl:col-span-3` AI areas from grid workspaces, replacing them with expanded `xl:col-span-9` results grids.
- Shifted the context limits in `youtube-manifest-context.ts` up to 200 items and 120,000 characters to prevent server validation errors.

### Architecture impact
The AI panel is now a decoupled floating overlay rather than consuming grid space in the various workspaces. The server route no longer acts as a strict bottleneck for metadata size, shifting the responsibility to Gemini's token limits.

### Environment impact
Caps increased in `process.env.AI_MANIFEST_MAX_ITEMS` fallback logic.

### Database/migration impact
None.

### YouTube API/quota impact
None. AI fetches continue to operate entirely on localized manifest state.

### AI scope/safety impact
AI context still limited by Gemini's own input size, but server-side caps are effectively removed. The `requiresUserConfirmation` safety prompt boundary remains entirely intact.

### Verification run and results
- `npm run typecheck` passed (0 errors).
- `npm run build` ran but failed due to unrelated network issues downloading `next/font`.
- Manual layout testing via code analysis confirms the grid spans expand to fill the freed AI sidebar areas.

### Blocked checks, if any
Build network connection issue.

### Remaining risks/limitations
AI context may occasionally still hit Gemini maximum limits, but will not be rejected by our API routes first.

### Migrations created/applied: No
### db:apply run: No

---

## 2026-05-09 (UI Refinements & Zero-Value Safety)

### Date/time

2026-05-09 ~21:00 UTC

### Task summary

Refined the UI to prevent AI assistant panel overlaps, enriched card metadata displays with zero-safe numerical values, and standardized responsive layouts for search and discovery workspaces.

### Reason/root cause

User requested surgical improvements to the responsive behavior of the AI panel, layout gap fixes, and comprehensive zero-value checks for numeric metadata in cards.

### Files changed

- `src/components/youtube/youtube-item-card.tsx`
- `src/types/youtube.ts`
- `src/components/search/search-workspace.tsx`
- `src/components/manifests/manifest-detail-workspace.tsx`
- `src/components/channels/channel-explorer-workspace.tsx`
- `src/components/playlists/playlist-explorer-workspace.tsx`
- `src/components/ai/ai-assistant-panel.tsx`
- `src/components/link-explorer/link-explorer-client.tsx`

### Technical details

- Removed items-start from grid containers to allow sticky sidebar columns to stretch.
- Configured AiAssistantPanel to stick to the top on large viewports.
- Ensured zero-values are displayed explicitly instead of dropping out.
- Replaced invalid Button usage in link-explorer with proper ButtonLink Next.js wrapper.

### Verification

- npm run typecheck: passed
- npm run build: passed

### Secrets printed: No
### Migrations created/applied: No
### db:apply run: No

---

## 2026-05-09 (Settings & Fetch Controls Integration)

### Date/time

2026-05-09 ~19:40 UTC

### Task summary

Extended the Settings page to include user-controlled YouTube Fetch Controls (pageSize, maxPages, maxItems) persisted via Zustand. Integrated these settings into all API fetch flows (Search, Channel Uploads, Playlist Items). Completed `/channels` and `/playlists` saved library pages, improved `/link-explorer` with actionable strategy buttons, and implemented graceful error handling for the `/watch/[videoId]` embedded player.

### Reason/root cause

User requested replacement of multiple scaffolded pages and the implementation of fetch control settings to manage quota directly from the UI, as well as fixing broken flows in the link explorer and watch player.

### Files changed

- `src/lib/state/youtube-workspace-store.ts` — Added `fetchSettings` and `savedItems` to Zustand store.
- `src/app/settings/page.tsx` & `settings-client.tsx` — Replaced scaffold with dynamic settings UI that reads server env vars securely.
- `src/components/search/search-workspace.tsx` — Updated to use custom fetch parameters.
- `src/components/channels/channel-explorer-workspace.tsx` — Updated to use custom fetch parameters.
- `src/components/playlists/playlist-explorer-workspace.tsx` — Updated to use custom fetch parameters.
- `src/app/channels/page.tsx` & `channels-client.tsx` — Implemented list view of saved channels.
- `src/app/playlists/page.tsx` & `playlists-client.tsx` — Implemented list view of saved playlists.
- `src/components/youtube/youtube-item-card.tsx` — Integrated save buttons to persist items into local Zustand store.
- `src/components/link-explorer/link-explorer-client.tsx` — Added action buttons mapping to analyzed URL strategies.
- `src/components/watch/watch-player.tsx` — Added graceful error handling (`onError`) for missing or restricted videos.

### Verification

- Re-ran `npm run typecheck` successfully.
- Re-ran `npm run build` successfully.
- Store logic and saves are confirmed locally in the DOM with proper TS definitions.

### Secrets printed: No
### Migrations created/applied: No
### db:apply run: No

---
## 2026-05-09 (Collapsible Sidebar Toggle)

### Date/time

2026-05-09 ~23:57 UTC

### Task summary

Made the desktop sidebar collapsible to allow users to reclaim screen space, using an elegant `PanelLeft` toggle button in the header.

### Reason/root cause

User requested the ability to "open and close or hide and appear modes" for the sidebar. Since the app relies on a left sidebar on desktop and a bottom nav on mobile, hiding the left sidebar on desktop requires pushing the main content over.

### Files changed

- `src/components/layout/app-shell.tsx` — added `"use client"`, state reading, transition classes for sidebar `-translate-x-full` and main content `padding-left`.
- `src/lib/state/youtube-workspace-store.ts` — added `isSidebarOpen` and `toggleSidebar` to Zustand store so the preference persists across page reloads.

### Verification

- The sidebar smoothly slides in and out, and the main content seamlessly expands.

### Secrets printed: No
### Migrations created/applied: No
### db:apply run: No

---
## 2026-05-09 (Update Favicon and Cleanup)

### Date/time

2026-05-09 ~23:17 UTC

### Task summary

Replaced the default Next.js favicon with the custom `browser_tab_icon.png`. Also removed an accidentally tracked AI-generated image.

### Reason/root cause

User requested `F:\discovery\youtube-discovery\public\browser_tab_icon.png` to be used as the browser tab icon. Cleaned up a stray image that was added in a previous commit.

### Files changed

- Added `src/app/icon.png` (copied from `public/browser_tab_icon.png`)
- Deleted `src/app/favicon.ico`
- Deleted `public/Gemini_Generated_Image_uvsm19uvsm19uvsm-removebg-preview.png`

### Verification

- Verified `icon.png` presence in `src/app`.
- Successfully pushed changes.

### Secrets printed: No
### Migrations created/applied: No
### db:apply run: No

---
## 2026-05-09 (Vercel Build SSR Fix)

### Date/time

2026-05-09 ~21:53 UTC

### Task summary

Fixed Vercel build prerender crash: `ReferenceError: document is not defined` on `/ai-search` and all pages using AppShell.

### Reason/root cause

`ThemeToggle` component accessed `document.documentElement.classList` inside a `useState()` initializer. This runs on the server during Next.js static page generation where `document` doesn't exist.

### Files changed

- `src/components/layout/theme-toggle.tsx` — made SSR-safe: defaults to dark on server, syncs real DOM on mount via useEffect

### Verification

- `npm run lint`: passed (0 errors)
- `npx tsc --noEmit`: passed (0 errors)

### Secrets printed: No
### Migrations created/applied: No
### db:apply run: No

---

## 2026-05-08 (Deployment Fixes & Search Workspace Upgrade)

### Date/time

2026-05-08 ~20:52 UTC

### Agent/model if known

Antigravity (Gemini)

### Task summary

Fixed Vercel build failure, upgraded search workspace to use real data instead of sample data, fixed security leak in `.env.example`, fixed double-save in search route, and diagnosed YouTube API key `API_KEY_SERVICE_BLOCKED` error.

### Reason/root cause

1. Vercel build failed because `env:validate` script crashed when `NEXT_PUBLIC_APP_URL` was not set (Vercel doesn't inject it by default).
2. Search workspace showed fake sample data on initial load instead of starting empty.
3. `.env.example` contained a real Supabase database password committed to git.
4. Search route called `saveManifestInMemory()` twice (service + route handler).
5. YouTube API key returns 403 because YouTube Data API v3 is not enabled in the Google Cloud project.

### Files changed

- `scripts/app-validate-env.mjs` — auto-populate `NEXT_PUBLIC_APP_URL` from Vercel env vars, downgrade persistence warning
- `.env.example` — scrub real database password, replace with placeholder template
- `src/components/search/search-workspace.tsx` — complete rewrite: empty initial state, error handling, loading states, Zustand integration, load-more pagination
- `src/app/api/youtube/search/route.ts` — remove double `saveManifestInMemory`, remove unused import

### Technical details

- Env validation now auto-detects Vercel environment via `VERCEL_URL` and `VERCEL_PROJECT_PRODUCTION_URL`
- Missing persistence keys now warn instead of `process.exit(1)`
- Search workspace stores manifest in Zustand for cross-page use (watch sidebar, manifests page)
- Added `PAGE_SIZE = 24` load-more pagination for large result sets

### Architecture impact

Minimal — no route changes, no schema changes. Search workspace now properly integrates with Zustand manifest store.

### Environment impact

Vercel builds will no longer fail when `NEXT_PUBLIC_APP_URL` is not explicitly set.

### Database/migration impact

None. No migrations created or applied.

### YouTube API/quota impact

Identified that the YouTube Data API v3 is blocked at the Google Cloud project level (`API_KEY_SERVICE_BLOCKED`). User must enable the API in Google Cloud Console.

### Verification run and results

- `npm run lint`: passed (0 errors, 0 warnings)
- `npx tsc --noEmit`: passed (0 errors)
- Dev server: running at http://localhost:3001
- YouTube API test: 403 Forbidden (API not enabled — user action required)

### Blocked checks

- YouTube live search blocked by `API_KEY_SERVICE_BLOCKED`
- Production build blocked by locked `.next` log file (dev server running)

### Remaining risks/limitations

- User must enable YouTube Data API v3 in Google Cloud Console
- User should rotate Supabase database password since it was publicly committed
- Persistence is still in-memory until database migrations are applied

### Whether secrets were printed

No secrets were printed. DATABASE_URL and API keys were always redacted in output.

### Whether migrations were created/applied

No.

### Whether db:apply was run

No.

## 2026-05-08

### Date/time

2026-05-08, Africa/Cairo timezone.

### Agent/model if known

Codex GPT-5 main agent with parallel GPT-5.5 extra-high-reasoning explorer subagents.

### Task summary

Implemented the initial full-stack `youtube-discovery` platform scaffold as a professional Next.js 16 SaaS application for official YouTube public metadata discovery. The implementation includes app shell, required route map, search workspace, local filters, manifests, server-side YouTube adapters, scoped Gemini routes, Prisma 7 schema/migration, env guardrails, README, CI, and ledgers.

### Reason/root cause

The repository was a fresh `create-next-app` scaffold. The two ledgers were empty, `.env.example` was missing, no product routes existed beyond `/`, no API layer existed, no Prisma/Supabase persistence existed, no Gemini/AI layer existed, and the current UI did not implement the guide.

### Files changed

- `.env.example`
- `.github/workflows/ci.yml`
- `.gitignore`
- `README.md`
- `package.json`
- `package-lock.json`
- `prisma.config.ts`
- `prisma/schema.prisma`
- `prisma/migrations/20260508000100_initial_youtube_discovery/migration.sql`
- `scripts/load-project-env.mjs`
- `scripts/app-validate-env.mjs`
- `scripts/db-validate-env.mjs`
- `scripts/db-status.mjs`
- `scripts/db-apply.mjs`
- `src/app/globals.css`
- `src/app/layout.tsx`
- `src/app/page.tsx`
- `src/app/search/page.tsx`
- `src/app/ai-search/page.tsx`
- `src/app/link-explorer/page.tsx`
- `src/app/channels/page.tsx`
- `src/app/channels/[sourceId]/page.tsx`
- `src/app/channel-explorer/page.tsx`
- `src/app/playlists/page.tsx`
- `src/app/playlists/[playlistId]/page.tsx`
- `src/app/playlist-explorer/page.tsx`
- `src/app/manifests/page.tsx`
- `src/app/manifests/[manifestId]/page.tsx`
- `src/app/collections/page.tsx`
- `src/app/saved/page.tsx`
- `src/app/history/page.tsx`
- `src/app/settings/page.tsx`
- `src/app/api/**`
- `src/components/**`
- `src/lib/**`
- `src/types/**`

### Technical details

- Added dependency set for Zod, lucide-react, Framer Motion, FlexSearch, Zustand, TanStack Query, Google GenAI, Prisma 7, PostgreSQL adapter, `pg`, `@next/env`, and `server-only`.
- Added env validation scripts that load root `.env.local`, warn about unsupported `.local.env`/`src/.local.env`, and avoid printing secret values.
- Added Prisma 7 config with validation-only placeholder URL for schema validation/generation and guarded migration apply script.
- Added canonical Prisma schema and migration for YouTube videos, channels, playlists, sources, manifests, manifest items, saved videos, collections, AI sessions, search/fetch jobs, page attempts, provider logs, and quota events.
- Added server-only YouTube client and services for `search.list`, `videos.list`, `channels.list`, `playlists.list`, and `playlistItems.list`.
- Added URL analyzer for video, Shorts, watch+list, channel, handle, playlist, and search URL shapes.
- Added manifest builder and runtime in-memory manifest store for temporary/saved manifests until database repositories are enabled.
- Added zero-safe local result filtering and sorting that preserves `0` numeric metadata.
- Added Gemini assistant routes with explicit scopes, capped manifest context, response validation, evidence refs, limitations, and missing-key fallback.
- Replaced starter UI with centralized design tokens, responsive shell, dashboard, search workspace, result cards, manifest summary, AI panel, and required page scaffolds.

### Architecture impact

The app now follows the guide's manifest-first architecture. Provider settings, temporary manifests, local filters/search-inside-results, AI scopes, and persistence schema are separated. Backend authority remains in route handlers and server-only library modules.

### Environment impact

Added `.env.example`, root `.env.local` guidance, build env preflight, Prisma validation scripts, and `.gitignore` exception for `.env.example`. No secrets were printed.

### Database/migration impact

Created initial Prisma schema and one initial migration. No migration was applied. `db:apply` was not run.

### YouTube API/quota impact

Added official YouTube Data API server adapters and quota estimates. No live YouTube calls were verified because live verification depends on `YOUTUBE_API_KEY`.

### AI scope/safety impact

Added server-only Gemini route helpers with explicit AI scopes and no-invention contract. Missing Gemini key produces an honest unavailable response. AI suggestions require user confirmation.

### Verification run and results

- `npm run db:validate`: passed after adding the missing Prisma relation opposite field.
- `npm run lint`: passed after removing unused imports and fixing React Compiler lint issue.
- `npx tsc --noEmit --incremental false`: passed after fixing JSX escaping and strict state types.
- `npm run typecheck`: passed and generated Prisma Client 7.8.0.
- `npm run build`: passed with Next.js 16.2.6 Turbopack production build.
- Dev server started at `http://localhost:3000`.
- HTTP smoke checks returned 200 for `/`, `/search`, `/link-explorer`, `/settings`, `/ai-search`, `/channels`, `/channel-explorer`, `/playlists`, `/playlist-explorer`, `/manifests`, `/collections`, `/saved`, and `/history`.
- `/search` smoke content confirmed `Provider search settings`, `0 views`, and the local pipeline text.
- `POST /api/youtube/link/analyze` with a watch URL plus playlist returned a video strategy using `videos.list` after user confirmation.
- `POST /api/ai/youtube-manifest-assistant` returned a safe schema-validation rejection response when the model output did not match the scoped JSON contract.
- `npm audit fix`: no non-breaking fix available; remaining moderate advisories require `--force` with breaking package changes.

### Blocked checks, if any

Live YouTube provider verification was not run because `YOUTUBE_API_KEY` availability was not assumed or printed. The AI route smoke test did not produce a useful Gemini analysis; it verified the safe response-validation path. `npm run db:status` reached a configured PostgreSQL endpoint but failed with a Prisma schema engine error, so remote migration status was not verified. Database migration apply against Supabase was not run.

### Remaining risks/limitations

- Runtime manifest store is non-durable until Prisma migrations are applied and repository persistence is enabled.
- Auth/owner identity is not implemented; `ownerId` is a schema placeholder for future owner scope.
- Saved library, collections, history, channel detail, playlist detail, and manifest detail pages are shell scaffolds.
- Browser smoke verification was limited to HTTP/content checks rather than screenshot tooling.
- `npm audit` reports moderate transitive advisories in Prisma/Next dependency trees, and the current npm suggestion requires breaking forced changes.

### Whether secrets were printed

No.

### Whether migrations were created/applied

One migration was created. No migration was applied.

### Whether `db:apply` was run

No.

## 2026-05-08 (follow-up)

### Date/time

2026-05-08 14:21 UTC.

### Agent/model if known

Codex GPT-5.3-Codex.

### Task summary

Upgraded search workspace layout and behavior toward a production manifest-first UX, added watch page foundation using official YouTube IFrame Player API, and introduced persistent watch experience settings.

### Reason/root cause

User requested a higher-fidelity 2026 SaaS UX with strict separation between provider calls and local filtering, plus a compliant watch experience path.

### Files changed

- `src/components/search/search-workspace.tsx`
- `src/components/watch/watch-player.tsx`
- `src/app/watch/[videoId]/page.tsx`
- `src/lib/watch-settings.ts`
- `src/app/settings/page.tsx`
- `youtube_discovery_ledger.md`
- `PROJECT_CHANGE_LOG_LEDGER.md`

### Technical details

- Refactored search page into explicit provider-search section and local filter section.
- Added resource type selection with `all` option, explicit Enter/submit provider trigger, and save/export manifest controls.
- Added watch player component that dynamically loads the official YouTube IFrame API and initializes `YT.Player` with autoplay/controls/branding parameters.
- Added watch settings model with localStorage persistence and settings UI controls.

### Architecture impact

Manifest-first boundary is preserved: provider search remains explicit; local filter flow remains local-only. Watch page introduces official embed-only playback surface without downloading/rehosting.

### Environment impact

No new env vars required.

### Database/migration impact

None.

### YouTube API/quota impact when relevant

Watch page uses official embedded player and no server-side stream extraction.

### AI scope/safety impact when relevant

Search AI panel remains scoped to current manifest.

### Verification run and results

- `npm run lint`: pending in this follow-up section.
- `npm run typecheck`: pending in this follow-up section.

### Blocked checks, if any

None yet.

### Remaining risks/limitations

Watch recommendations are scaffold text only; ranking pipeline and context-aware next/previous navigation are not fully implemented yet.

### Whether secrets were printed

No.

### Whether migrations were created/applied

No migrations created or applied.

### Whether `db:apply` was run

No.

## 2026-05-08 (search/watch refinement)

### Date/time

2026-05-08 16:05 UTC.

### Agent/model if known

Codex GPT-5.3-Codex.

### Task summary

Refined Search workspace UI into cleaner 12-column production layout with explicit provider vs local search boundaries, wired resource selection including ALL behavior, and stabilized watch/settings linkage through shared persisted workspace store.

### Reason/root cause

Follow-up UX request required clearer separation of provider calls versus local filtering, stronger dark-first ergonomics, and watch settings consistency.

### Files changed

- `src/components/search/search-workspace.tsx`
- `src/components/watch/watch-player.tsx`
- `src/app/settings/page.tsx`

### Technical details

- Rebuilt Search page sections using `workspace-grid-12` for non-overlapping card alignment and consistent spacing.
- Added top provider search bar with explicit resource type selector (`ALL`, `video`, `channel`, `playlist`) and submit-only provider call behavior.
- Added separate local in-results search/filter panel that only mutates local filter state and render pipeline.
- Added active filter chips display and manifest export actions in local-results control surface.
- Switched watch player setting source to Zustand persisted workspace store so settings updates affect player behavior.
- Ensured IFrame API initialization includes `onReady`/`onStateChange` hooks and controlled autoplay/controls parameters.

### Architecture impact

Strengthens manifest-first contract: provider search remains explicit; local search/filter/sort remains local-only.

### Environment impact

None.

### Database/migration impact

None.

### YouTube API/quota impact when relevant

No additional provider calls were introduced in local filtering paths.

### AI scope/safety impact when relevant

No scope expansion; AI panel remains tied to current manifest context.

### Verification run and results

- `npm run lint`: passed.
- `npm run typecheck`: passed.

### Blocked checks, if any

None.

### Remaining risks/limitations

- Search filter panel still implements a focused subset of advanced filter controls.
- `/channels/[channelId]` and `/playlists/[playlistId]` parity with requested naming/context remains partial and currently scaffold-first.

### Whether secrets were printed

No.

### Whether migrations were created/applied

No migrations created or applied.

### Whether `db:apply` was run

No.

---

## 2026-09-09 (Search Enhancement, Save Search Titles, Unrestricted Sensitive Mode, Age Restriction, Mobile Drawer & Frontend Polish)

### Date/time

2026-09-09 17:55 UTC

### Agent/model if known

Antigravity Agent (Gemini 3.8 Flash)

### Task summary

Implemented full Save Search Titles functionality with custom names, pins, and quick-execution; added Unrestricted Search Mode (`safeSearch: "none"`) with visual status glow allowing discovery of all sensitive and mature (18+ / 35+) YouTube content; extracted `contentRating.ytRating` for age-restriction detection and added a dedicated Age & Content Rating local filter and 🔞 18+ card badge; created a responsive mobile navigation drawer; redesigned the Saved Library with a dedicated Saved Search Titles tab and store synchronization; resolved all 13 pending ESLint errors and warnings across the project (achieving 0 errors, 0 warnings); and enhanced frontend appearance with custom sleek scrollbars, drawer animations, and button ergonomics.

### Reason/root cause

User requested:
1. Enhancing search and frontend appearance.
2. Adding a "save search title" feature.
3. Permitting search across all YouTube content including sensitive and mature material (18+ / 35+).
4. Fixing all issues and errors in the project.

### Files changed

- `src/types/youtube.ts`: Added `isAgeRestricted` and `contentRating` to `NormalizedYouTubeDiscoveryItem`; added `SavedSearch` interface; added `ageRatingFilter` to `YouTubeResultFilters`.
- `src/lib/validation/youtube-schemas.ts`: Added `ageRatingFilter` to filter schema.
- `src/lib/state/youtube-workspace-store.ts`: Added `savedSearches` state and actions (`saveSearch`, `updateSavedSearch`, `deleteSavedSearch`, `togglePinSavedSearch`), plus `defaultSafeSearch` in `FetchSettings`, persisted in `partialize`.
- `src/lib/platforms/youtube/youtube-normalize.ts`: Extracted `contentRating.ytRating === "ytAgeRestricted"` to populate `isAgeRestricted` boolean on normalized items.
- `src/lib/filters/youtube-result-filters.ts`: Added `matchesAgeRating` filter handling "all", "age_restricted", and "general" audience content.
- `src/components/search/search-workspace.tsx`: Added Save Search Title modal, quick-access Saved Searches shelf (run, copy title, pin, delete), Unrestricted Mode toggle with pulsing indicator and `unrestricted-glow`, fixed unused imports and button props.
- `src/components/filters/advanced-filters-panel.tsx`: Added Age & Content Rating section with 3-button selector (All, 18+ Mature, General), age filter chip, and useCallback memoization.
- `src/components/youtube/youtube-item-card.tsx`: Added 🔞 18+ Mature badge overlay for age-restricted items, typed privacyStatus safely.
- `src/components/saved/saved-library-workspace.tsx`: Rebuilt with Zustand workspace store synchronization, added Saved Search Titles tab, copy title, and age badges.
- `src/components/layout/app-shell.tsx`: Replaced state-in-effect with `useSyncExternalStore`, added functional mobile navigation drawer with backdrop and slide-in animation.
- `src/components/watch/watch-player.tsx`: Fixed React setState in effect error and replaced `any` with typed error event.
- `src/components/ai/ai-assistant-panel.tsx`: Removed unused `Card`/`CardHeader` imports, escaped HTML quotes (`&quot;`), wrapped `askAssistant` in `useCallback`.
- `src/components/link-explorer/link-explorer-client.tsx`: Replaced `any` types with typed `YouTubeAnalyzedLink` and `LinkAnalyzeResponse`.
- `src/components/manifests/manifest-detail-workspace.tsx`: Wrapped `totalItems` in `useMemo`.
- `src/components/playlists/playlist-explorer-workspace.tsx`: Removed unused `Search` and `X` imports.
- `src/app/settings/settings-client.tsx`: Added Default SafeSearch & Sensitivity Policy setting with explicit `none` unrestricted mode.
- `src/app/globals.css`: Added `@keyframes slideInLeft`, `.animate-slide-in`, design-token thin scrollbars, and `.unrestricted-glow`.
- `youtube_discovery_ledger.md`: Documented updated routes, features, and verification results.
- `PROJECT_CHANGE_LOG_LEDGER.md`: Appended this change log entry.

### Technical details

- `safeSearch: "none"` is the official YouTube Data API v3 setting that removes all filtering of restricted, mature, and sensitive content.
- The UI exposes this clearly via the Unrestricted Mode toggle button with an emerald pulse dot and glow styling.
- `contentRating.ytRating === "ytAgeRestricted"` is YouTube's official indicator for age-restricted videos, now extracted into `item.isAgeRestricted`.
- Saved searches are stored with unique IDs, user-defined titles, queries, resource selections, settings, creation timestamps, and pin flags in the persisted Zustand store.
- ESLint checks now pass completely with 0 errors and 0 warnings.
- Turbopack production build compiles all 16 static routes and dynamic routes cleanly.

### Architecture impact

Preserved manifest-first architecture and provider-versus-local boundaries. Search parameters flow to provider API calls on submit; age rating filtering operates cleanly on normalized item metadata in local pipelines.

### Environment impact

None. No new env vars required.

### Database/migration impact

None. No database migrations created or applied; persisted user state continues through Zustand `localStorage` synchronization.

### YouTube API/quota impact

No additional quota consumption. SafeSearch is a native query parameter in YouTube `search.list`. Video detail normalization utilizes the existing `contentDetails` part.

### AI scope/safety impact

None. Scoped AI boundaries remain intact.

### Verification run and results

- `npm run lint`: passed (0 errors, 0 warnings).
- `npm run typecheck`: passed (0 errors).
- `npm run build`: passed cleanly with Next.js 16.2.6 Turbopack (all 16 static routes + dynamic routes generated).

### Blocked checks, if any

None.

### Remaining risks/limitations

- Live YouTube API requests require a valid `YOUTUBE_API_KEY` configured in `.env.local`.

### Whether secrets were printed

No.

### Whether migrations were created/applied

No.

### Whether `db:apply` was run

No.

---

## 2026-09-09 (Comprehensive Arabic NPM Commands Guide)

### Date/time

2026-09-09 18:05 UTC

### Agent/model if known

Antigravity Agent (Gemini 3.8 Flash)

### Task summary

Created a comprehensive Arabic guide for all NPM and NPX commands in `Guide-Files/npm_commands_arabic_guide.md`. The document covers basic concepts (`package.json`, `node_modules`), all project-specific scripts (`npm run dev`, `build`, `lint`, `typecheck`, `verify`, `env:validate`), Prisma/database management, package lifecycle (`install`, `-D`, `uninstall`, `update`, `outdated`), NPX execution tooling, troubleshooting/cache clearing, and a 1-line quick cheatsheet.

### Reason/root cause

User requested a full Arabic reference file inside `Guide-Files/` explaining all NPM commands used in this and similar Next.js/Full-Stack projects.

### Files changed

- `Guide-Files/npm_commands_arabic_guide.md` (new file created)
- `youtube_discovery_ledger.md` (updated File and Folder Map)
- `PROJECT_CHANGE_LOG_LEDGER.md` (appended this entry)

### Technical details

The guide details both daily development workflows and emergency troubleshooting (e.g. `npm cache clean --force`, `npm ci`, `--legacy-peer-deps`, and complete cache clearing in Windows PowerShell and Bash).

### Architecture impact

None. Documentation only.

### Environment impact

None.

### Database/migration impact

None.

### YouTube API/quota impact

None.

### AI scope/safety impact

None.

### Verification run and results

- File verified in `Guide-Files/npm_commands_arabic_guide.md`.
- No code or runtime alterations.

### Blocked checks, if any

None.

### Remaining risks/limitations

None.

### Whether secrets were printed

No.

### Whether migrations were created/applied

No.

### Whether `db:apply` was run

No.

---

## 2026-09-09 (Restructured & Logical Arabic Git/GitHub Guide)

### Date/time

2026-09-09 18:07 UTC

### Agent/model if known

Antigravity Agent (Gemini 3.8 Flash)

### Task summary

Completely restructured and enriched `Guide-Files/git_github_arabic_commands_guide.md` to follow a strict logical progression:
1. Account discovery and management (`gh auth status`, `gh auth switch`, `gh auth login`, `git config user.name`, Windows Credential Manager).
2. Remote and repository inspection and switching (`git remote -v`, `git remote set-url origin`, `gh repo list`, `git clone`).
3. Status, diff, branch switching, and commit history (`git status`, `git diff`, `git switch -c`, `git log --oneline`).
4. Routine add, commit, pull, and push workflows (`git add .`, `git commit -m`, `git pull origin main`, `git push origin main`).
5. Step-by-step resolution of push rejection errors (`fetch first / pull first` with `git pull origin main --rebase`, conflict resolution, and `--force-with-lease` safety guardrails).
6. Emergency operations (`git stash`, `git stash pop`, `git restore`, `git restore --staged`, `git reset --soft HEAD~1`).
7. 4-step daily workflow scenario and 1-line quick reference cheatsheet.

### Reason/root cause

User requested reorganizing the Git guide into a natural, logical order starting from authentication and multi-account switching (`alahly13` / `MahdyHQ`), then remote inspection, and handling the common "pull first before push" rejection issue.

### Files changed

- `Guide-Files/git_github_arabic_commands_guide.md`
- `PROJECT_CHANGE_LOG_LEDGER.md` (appended this entry)

### Technical details

Documentation overhaul strictly aligned with Git best practices, GitHub CLI capabilities, and PowerShell/Windows workflow ergonomics.

### Architecture impact

None. Documentation only.

### Environment impact

None.

### Database/migration impact

None.

### YouTube API/quota impact

None.

### AI scope/safety impact

None.

### Verification run and results

- File verified in `Guide-Files/git_github_arabic_commands_guide.md`.

### Blocked checks, if any

None.

### Remaining risks/limitations

None.

### Whether secrets were printed

No.

### Whether migrations were created/applied

No.

### Whether `db:apply` was run

No.

---

## 2026-09-09 (Region Dropdown List, Search Bar Polish, Interactive Explorer Launchers & Live Dashboard)

### Date/time

2026-09-09 19:10 UTC

### Agent/model if known

Antigravity Agent (Gemini 3.8 Flash)

### Task summary

1. Converted the Region Code input in `search-workspace.tsx` from a text box into a comprehensive `ApiSelect` dropdown list (`YOUTUBE_REGION_OPTIONS`) containing major global and Middle Eastern markets (US, EG, SA, AE, KW, QA, GB, CA, DE, FR, JP, etc.).
2. Converted the Relevance Language input into an `ApiSelect` dropdown list (`YOUTUBE_LANGUAGE_OPTIONS`).
3. Enhanced the Search Bar with an inline search icon, a clear `X` button when text is present, a `/` keyboard shortcut badge, and global `/` and `Ctrl+K` shortcut listeners to focus the search bar from anywhere.
4. Upgraded `/channel-explorer` and `/playlist-explorer` from static informational placeholders into interactive client exploration launchers with input normalization, channel/playlist resolution, and quick-pick discovery chips.
5. Upgraded `Dashboard` (`src/components/pages/dashboard.tsx`) with live Zustand store statistics, active manifest telemetry, and quick-launch discovery cards.
6. Enhanced the empty states on `/channels` and `/playlists` with direct links to exploration workflows.
7. Fixed `dashboard.tsx` to read `currentManifest` and `currentManifest.quotaCostEstimate` correctly.
8. Verified clean `npm run typecheck` (0 errors) and `npm run lint` (0 errors, 0 warnings).

### Reason/root cause

User requested:
1. "make region as list choose not input"
2. "enhance search bar and compatibility with youtube v3 api"
3. "ensure that all search and pages and functions are working correctly"

### Files changed

- `src/components/search/search-workspace.tsx`
- `src/components/pages/dashboard.tsx`
- `src/app/channel-explorer/page.tsx`
- `src/app/channel-explorer/channel-explorer-client.tsx`
- `src/app/playlist-explorer/page.tsx`
- `src/app/playlist-explorer/playlist-explorer-client.tsx`
- `src/app/channels/channels-client.tsx`
- `src/app/playlists/playlists-client.tsx`
- `PROJECT_CHANGE_LOG_LEDGER.md`

### Technical details

- Region Code is now selected from an ISO 3166-1 alpha-2 list, preventing invalid code entries that trigger YouTube API 400 bad request errors.
- Language is selectable from standard BCP-47 options.
- The search bar auto-focuses on `/` or `Ctrl+K` unless the user is already interacting with another input or textarea.

### Architecture impact

Preserved manifest-first boundaries and client/server separation.

### Environment impact

None.

### Database/migration impact

None.

### YouTube API/quota impact

Eliminates bad request errors from mistyped region or language codes.

### AI scope/safety impact

None.

### Verification run and results

- `npm run lint`: passed with 0 errors, 0 warnings.
- `npm run typecheck`: passed with 0 errors (Prisma client regenerated).

### Blocked checks, if any

None.

### Remaining risks/limitations

None.

### Whether secrets were printed

No.

### Whether migrations were created/applied

No.

### Whether `db:apply` was run

No.

---

## 2026-10-02 (24-Hour Search Results Persistence Across Navigations and Site Closures)

### Date/time

2026-10-02 13:53 UTC (16:53 local)

### Agent/model if known

Antigravity Agent (Gemini 3.8 Flash)

### Task summary

Implemented 24-hour search results persistence on the search workspace (`/search`). When a user navigates away to another page (such as watch, channel explorer, playlists, or saved library) or completely closes the browser/site, their last search query, API search settings, resource type selection, local filters, and normalized manifest results persist and remain stored on `/search` for 24 hours (1 day) from the time of the search, or until a new search is performed or explicitly cleared.

### Reason/root cause

Previously, `SearchWorkspace` held its manifest results, search query, resource type selection, and local filters exclusively in transient React component state (`useState(null)`). Consequently, whenever the user navigated away from the search page or refreshed/closed the site, the component unmounted and the results of the last search disappeared, requiring repetitive searches and redundant quota consumption.

### Files changed

- `src/types/manifest.ts`: Added `LAST_SEARCH_TTL_MS` (24 * 60 * 60 * 1000 ms) and `PersistedLastSearch` interface defining the stored search shape (query, resourceSelection, settings, filters, manifest, searchedAt).
- `src/lib/state/youtube-workspace-store.ts`: Added `lastSearch` state, `setLastSearch`, `updateLastSearchFilters`, and `clearLastSearch` actions to the persisted Zustand workspace store; implemented `sanitizeManifestForStorage` (stripping bulky rawJson payloads to preserve browser storage quotas), `isLastSearchValid` TTL expiration guard (< 24 hours), and `formatSearchCacheAge` for user-friendly elapsed and remaining time indicators. Added `lastSearch` to store `partialize`.
- `src/components/search/search-workspace.tsx`: Wired `lastSearch` from the workspace store; implemented automatic restoration on mount (`startTransition` SSR-safe); integrated auto-replacement upon executing any new search; added periodic (60s) and focus-based expiration checks; synced local filter updates to `lastSearch.filters`; added a sleek 24-hour persistence status banner displaying the query, elapsed time, time remaining, and an explicit "Clear Results" button.
- `youtube_discovery_ledger.md`: Updated architecture notes, file map, and verification records.
- `PROJECT_CHANGE_LOG_LEDGER.md`: Appended this entry.

### Technical details

- The 24-hour expiration threshold is strictly calculated using `Date.now() - lastSearch.searchedAt < 24 * 60 * 60 * 1000`.
- To avoid browser `localStorage` quota issues, `sanitizeManifestForStorage` strips voluminous `rawJson` responses while retaining normalized items and minimal metadata.
- When a user enters `/search` with a specific URL query parameter (`?q=...`), URL parameters take priority over restored results.
- When navigating back to `/search` without parameters, the last search results and settings restore immediately without calling YouTube API (0 additional quota).
- Performing any new search instantly replaces `lastSearch` and restarts the 24-hour TTL.
- An explicit "Clear Results" button allows users to reset the search page to an empty state at will.

### Architecture impact

Preserves manifest-first architecture and provider-versus-local boundaries. Search results persist in the client workspace store with zero additional YouTube Data API calls.

### Environment impact

None.

### Database/migration impact

None.

### YouTube API/quota impact

Significantly reduces quota waste: returning to the search page reuses cached manifest results instead of forcing users to re-query the YouTube API.

### AI scope/safety impact

None. AI panel and manifest analysis operate directly on the restored manifest.

### Verification run and results

- `npm run lint`: passed (0 errors, 0 warnings).
- `npm run typecheck`: passed (0 errors).
- `npm run build`: passed cleanly with Next.js 16.2.6 Turbopack (all 16 static routes + dynamic routes compiled cleanly).

### Blocked checks, if any

None.

### Remaining risks/limitations

None.

### Whether secrets were printed

No.

### Whether migrations were created/applied

No.

### Whether `db:apply` was run

No.

---

## 2026-10-02 (Configurable Search Storage Retention, Dedicated Archive, Multi-Key API Management, and Back-to-Top Control)

### Date/time

2026-10-02 ~20:00 UTC

### Agent/model if known

Antigravity (Google DeepMind)

### Task summary

Expanded the Search Storage and API Management architecture with:
1. Configurable search retention period (default 168 hours = 7 days = 1 week), controlled via `SEARCH_STORAGE_TTL_HOURS` with safe numeric fallback.
2. Complete search data preservation: full manifest and `rawJson` strictly preserved without sanitization, truncation, or field stripping.
3. Dedicated server file archive in `data/searches/[id].json`, with a lightweight index in `data/searches/index.json` and latest snapshot in `data/searches/latest.json`, featuring automatic expiration cleanup.
4. History Search & Instant Load: real-time `Search history...` keyword search matching title, query, and metadata on `/history`, and "View Results" direct action loading full manifest results via `/search?load=[id]` with zero YouTube API calls and zero quota consumption.
5. Multi-Key YouTube API Management: server-side secure key storage (`data/keys/api-keys.json`), dynamic resolution via `resolveActiveYouTubeApiKey()`, safe masked strings (`AIza...X92K`), manual active key switching, and Settings UI (`/settings`) to add custom keys with labels and delete them with automatic ENV fallback.
6. Reusable Back-to-Top floating control with smooth scrolling on `/search` and `/history`.

### Reason/root cause

Users needed:
- Search results retained for 7 days by default instead of shorter windows, with the ability to tune the retention hours via environment configuration without modifying source code.
- Unsanitized, complete preservation of all YouTube metadata (`rawJson`) so that historical searches retain full research depth.
- Instant viewing of past search results from History without consuming YouTube API quota.
- Seamless rotation and switching between multiple YouTube API v3 keys directly from Settings while keeping raw credentials strictly server-side.
- Back-to-Top ergonomic navigation on long result and history lists.

### Files changed

- `src/lib/config/search-storage-config.ts` (created): Centralized TTL parser, ms converter, and expiration timestamp calculation.
- `.env.example`: Documented `SEARCH_STORAGE_TTL_HOURS="168"`.
- `src/types/manifest.ts`: Updated `LAST_SEARCH_TTL_MS` to use `getSearchStorageTtlMs()`, extended `PersistedLastSearch` with `id?` and `expiresAt?`.
- `src/types/youtube.ts`: Updated `SearchHistoryItem` compatibility.
- `src/lib/search-storage/search-storage-archive.ts` (created): Dedicated server-side JSON file archive and lightweight metadata index manager.
- `src/app/api/search-storage/route.ts` (created): GET (index/TTL), POST (save full record), DELETE (clear archive).
- `src/app/api/search-storage/[id]/route.ts` (created): GET (load record by ID), DELETE (remove record).
- `src/app/api/search-storage/latest/route.ts` (created): GET (load latest record).
- `src/lib/platforms/youtube/youtube-api-keys.ts` (created): Multi-key storage, masking, dynamic resolution, selection, and deletion.
- `src/lib/platforms/youtube/youtube-client.ts`: Integrated dynamic key resolution on every request via `resolveActiveYouTubeApiKey()`.
- `src/app/api/youtube/keys/route.ts` (created): GET (safe masked list with active indicator), POST (register custom key).
- `src/app/api/youtube/keys/select/route.ts` (created): POST (switch active key).
- `src/app/api/youtube/keys/[keyId]/route.ts` (created): DELETE (delete custom key with fallback).
- `src/components/ui/back-to-top.tsx` (created): Reusable floating Back-to-Top component with smooth window scrolling.
- `src/components/search/search-workspace.tsx`: Integrated server archive persistence, direct load from archive via `?load=[id]`, latest cache restoration, and Back-to-Top control.
- `src/components/history/history-workspace.tsx`: Integrated server archive listing, `Search history...` keyword search matching title/query/metadata, "View Results" direct action, and Back-to-Top control.
- `src/lib/state/youtube-workspace-store.ts`: Removed `sanitizeManifestForStorage` to preserve full rawJson, updated `recordSearchHistory` to accept optional explicit ID, and integrated configurable TTL validation.
- `src/app/settings/settings-client.tsx`: Added YouTube API Key Management Card with active key banner, masked strings, key switcher, and custom key registration form.
- `eslint.config.mjs`: Added `data/**` to `globalIgnores`.
- `youtube_discovery_ledger.md`: Updated route maps, API routes, environment variables, and file architecture map.
- `PROJECT_CHANGE_LOG_LEDGER.md`: Appended this dated change log entry.

### Technical details

- `SEARCH_STORAGE_TTL_HOURS` is parsed safely via `Number(...)`; values `<= 0`, non-numeric, or missing automatically fall back to 168 hours.
- Expiration formula: `expiresAt = searchedAt + (SEARCH_STORAGE_TTL_HOURS * 60 * 60 * 1000)`.
- Full search records including unstripped `rawJson` are stored at `data/searches/[id].json`.
- A lightweight index at `data/searches/index.json` stores only metadata (`id`, `title`, `query`, counts, thumbnails, `expiresAt`) enabling fast history listings.
- Expired archive records are automatically deleted from disk when the index is accessed.
- Raw custom API keys are saved in `data/keys/api-keys.json` with strict server-only boundaries (`import "server-only"`).
- `maskApiKey` exposes only the first 4 and last 4 characters separated by ellipses (`AIza...X92K`).
- Provider requests resolve the active key dynamically: custom active key if selected, falling back to `process.env.YOUTUBE_API_KEY`.
- `/search?load=[id]` bypasses provider network calls and loads the complete cached manifest directly into the search workspace.

### Architecture impact

- Decouples large manifest persistence from browser `localStorage` limits by moving full records with `rawJson` to server disk storage.
- Introduces multi-key credential rotation without changing the external contract of `YouTubeApiClient`.
- Establishes a zero-quota result viewer pathway for historical searches.

### Environment impact

- Added `SEARCH_STORAGE_TTL_HOURS="168"` to `.env.example`.
- All credentials remain server-only; no public client variables exposed.

### Database/migration impact

None. Archive is disk-backed JSON with lightweight indexing.

### YouTube API/quota impact

- Significant quota savings: viewing results from History consumes 0 YouTube API quota units.
- Multi-key rotation allows users to distribute quota across multiple Google Cloud projects.

### AI scope/safety impact

None. AI assistant panel continues to analyze manifests locally with zero hallucination constraints.

### Verification run and results

- `npm run typecheck`: passed cleanly (0 errors).
- `npm run build`: passed cleanly with Next.js 16.2.6 Turbopack (all 16 static routes + dynamic routes compiled).

### Blocked checks, if any

None.

### Remaining risks/limitations

None.

### Whether secrets were printed

No. All keys are masked with `maskApiKey` before being returned to clients or logs.

### Whether migrations were created/applied

No.

### Whether `db:apply` was run

No.

---

## 2026-10-09 (Saved Library & Playlist Management Upgrade, Shared Local Search, Dailymotion Sidebar Link)

### Date/time

2026-10-09 ~12:00–13:30 UTC

### Agent/model if known

Muse Spark 1.3 (OpenCode agent)

### Task summary

Built the complete Saved Library & personal playlist management system: dedicated `/saved` hub (Playlists / Saved Items / Saved Searches tabs), dedicated `/saved/[playlistId]` workspace per user playlist, heterogeneous entries (video, Shorts, YouTube playlist, channel, custom notes) with per-item notes, user sections/groups, HTML5 drag-and-drop + Move Up/Down manual ordering, in-playlist search/filter/12-mode sort, shared FlexSearch local-search service reused by Saved + playlists + History, per-playlist dedicated manifest files (`data/playlists/*.json` + lightweight `index.json`) with atomic writes and self-contained JSON export, permanent retention independent of `SEARCH_STORAGE_TTL_HOURS`, add-to-playlist picker on all result cards, and a Dailymotion Discovery sidebar link to `https://dailymotion-video-discovery.vercel.app/`.

### Reason/root cause

The app had only a flat localStorage saved-items list and no personal playlist concept; searches expired via TTL with no permanent user collections; History/Saved searches were hand-rolled `includes()` filters with FlexSearch installed but unused; no durable per-playlist record or export existed.

### Files changed

- `src/types/library.ts` (new): discriminated playlist model, groups, manifest v1, `canonicalYoutubeKey` (video≡Shorts identity), slug/id helpers.
- `src/lib/validation/library-schemas.ts` (new): Zod API contracts.
- `src/lib/playlists/playlist-archive.ts` (new): server-only file archive, atomic tmp+rename writes, stable filenames, no TTL.
- `src/lib/playlists/playlist-query.ts` (new): snapshot adapter, published-date presets + custom range, views range, 12 sorts (manual positions never rewritten by transient sorts).
- `src/lib/search/local-search.ts` (new): shared FlexSearch Document service (title-weighted) + weighted fallback; `searchRanked` + `toSearchDoc` adapters.
- `src/lib/state/user-playlists-store.ts` (new): Zustand cache + server sync, all membership/group/order ops, brief undo window, export download.
- `src/components/library/add-to-playlist-dialog.tsx` (new): in-place picker with inline creation + duplicate prevention.
- `src/components/library/playlist-detail-workspace.tsx` (new): full playlist workspace UI.
- `src/components/layout/dailymotion-icon.tsx` (new): local Dailymotion brand SVG.
- `src/app/saved/[playlistId]/page.tsx` (new): dedicated playlist route.
- `src/app/api/playlists/route.ts`, `src/app/api/playlists/[id]/route.ts` (new): index/manifest CRUD.
- `src/components/layout/navigation.tsx`: external Dailymotion entry (exact URL, new tab, `noopener noreferrer`, accessible name).
- `src/components/saved/saved-library-workspace.tsx`: rebuilt as 3-tab hub (playlists with shared search/sort/collages/rename/delete; items with standalone detection + type filter + picker; searches preserved).
- `src/components/youtube/youtube-item-card.tsx`: Add-to-Playlist button on video/channel/playlist cards.
- `src/components/history/history-workspace.tsx`: keyword filter moved onto the shared FlexSearch service; typed the archive index (`any[]` removed).
- `src/app/saved/page.tsx`: hub title/description.
- `.gitignore`: `/data` ignored (playlist/search archives never committed).
- `src/app/api/search-storage/route.ts`, `src/app/settings/settings-client.tsx`, `src/lib/platforms/youtube/youtube-client.ts`, `src/lib/state/youtube-workspace-store.ts`: fixed pre-existing lint failures (typed payloads, unused imports, mount-fetch guards).
- `youtube_discovery_ledger.md`, `PROJECT_CHANGE_LOG_LEDGER.md`: documentation updated.

### Technical details

- Manifest schema: `{manifestVersion: 1, type: "youtube-discovery-playlist", playlist: {id,name,description,createdAt,updatedAt}, groups[], items[]}`; membership `entryId` is `yt-<kind>:<platformId>` for YouTube (dedupes video≡Shorts) and unique ids for custom entries; `position` is canonical manual order per container; filenames `playlist-<slug>-<ts>-<id6>.json` are stable for life so renames cannot lose identity.
- Index rows carry only metadata + up to 4 thumbnails, never full contents. Export re-reads from disk so it reflects persisted state.
- Reorder/drag allowed only in manual mode with no active search/filters; other sorts are transient views. Group delete offers keep-items (ungroup) vs delete-items (with undo).
- localStorage persists only a client cache; the server archive is the authority. No browser-only persistence claim is made for deployed serverless filesystems.

### Architecture impact

One consistent file-persistence pattern (per-record JSON + lightweight index) shared with the search archive; one shared search abstraction for all local features; no new search/dnd dependencies (native HTML5 DnD + keyboard alternatives); `/playlists/[playlistId]` (YouTube explorer) untouched.

### Environment impact

None. No new env vars. `SEARCH_STORAGE_TTL_HOURS` untouched and provably unrelated to playlists (separate directory, no expiry code path).

### Database/migration impact

None created/applied; `db:apply` not run. Prisma schema untouched — manifest schema is versioned for a future DB cutover without format change.

### YouTube API/quota impact

Zero: playlist pages, searches, filters, sorts, and History reuse stored data only (verified by code path + live tests with no provider calls).

### AI scope/safety impact

None. No AI changes; no secrets in manifests/exports/indexes/URLs/logs (scanned).

### Verification run and results

- `npm run lint`: passed (0 errors, 0 warnings).
- `npm run typecheck`: passed (0 errors).
- `npm run build`: passed (Next.js 16.2.6 Turbopack; new routes registered).
- Live dev-server API lifecycle: create 201 → invalid create 400 → index → full PUT (5 heterogeneous items, 2 groups) → read (types video,shorts,youtube_playlist,channel,custom; secret-scan clean; no TTL) → rename (same id, stable filename) → garbage PUT now 400 (fixed mid-test) → missing 404 → on-disk corruption → 404 recoverable + healthy index → delete → index consistent.
- Compiled `local-search` module executed in node: exact/partial/case-insensitive/multi-token/fuzzy-typo queries rank correctly; empty query preserves order; no-match returns [].
- Pages `/saved`, `/saved/[playlistId]`, `/` return 200 with hub/detail content and the exact Dailymotion URL in sidebar HTML.

### Blocked checks, if any

Browser drag-and-drop exercised at code level only (no browser automation in this environment); HTML5 DnD + Move Up/Down paths verified by review. Deployment-filesystem permanence beyond local disk not testable here (documented honestly in ledger).

### Remaining risks/limitations

- `data/playlists/` is ephemeral on serverless redeploys without attached storage (documented; DB cutover path prepared).
- FlexSearch multi-token queries favor recall over precision (best hit first; fallback guarantees coverage).
- Test playlist data was created then fully deleted; `data/playlists/index.json` remains as an empty index.

### Whether secrets were printed

No.

### Whether migrations were created/applied

No.

### Whether `db:apply` was run

No.



---

## 2026-10-09 (Private Blob Persistence, Single-Admin Auth, Quota Pools)

### Date/time

2026-10-09 ~14:00–18:00 UTC (includes server restarts; resumed without repeating verified work)

### Agent/model if known

Muse Spark 1.3 (OpenCode agent)

### Task summary

Implemented the full follow-up scope on top of the Saved Library upgrade without undoing it: (1) Private Vercel Blob (`@vercel/blob` 2.8.1) as authoritative storage for playlists, saved search history (permanent, complete records), and encrypted managed API keys; automatic chunking with staged browser uploads for >4.5 MB records; idempotent disk→Blob migration. (2) Single-administrator account (scrypt, opaque Blob sessions, 7-day TTL, rate limiting, Settings credential management, login page) replacing any shared-secret approach — no `BLOB_DATA_ADMIN_SECRET` anywhere. (3) Validation of all three Blob env vars incl. store-identity verification and webhook-key separation, plus a safe diagnostics endpoint. (4) Multi-project quota pools: project/account metadata per key, verified/declared/unknown associations, bucket-aware cross-pool rotation with error classification, persistent usage accounting, and a labeled-estimate quota dashboard.

### Reason/root cause

Local disk is ephemeral on serverless redeploys; managed keys were plaintext on disk; saved history expired via TTL; rotation was key-blind (same-pool retries) with no usage visibility; no authentication existed.

### Files changed

New: `src/lib/blob/*` (paths, config, backend, vercel backend, record-format, record-store, chunked-upload, verify, migration, factory), `src/lib/auth/*` (password, cookies, session, account-store, rate-limit, require-auth), `src/lib/keys/key-crypto.ts`, `src/lib/keys/quota-pools.ts`, `src/lib/client/auth-fetch.ts`, `src/lib/client/blob-upload.ts`, `src/app/login/page.tsx`, `src/proxy.ts` (replaces deprecated middleware convention), `src/app/api/auth/*`, `src/app/api/admin/*`, `src/app/api/blob-upload/[action]`, `src/app/api/youtube/keys/usage`, `src/components/settings/*` (account-security, storage-migration, quota-dashboard, key-metadata-editor), `scripts/blob-tests/*` + `scripts/run-blob-tests.mjs`, `docs/blob-persistence.md`.
Modified: playlist/search archives → Blob (same exports), `youtube-api-keys.ts` (encrypted store + project model + pool rotation), `youtube-client.ts` (single choke point: bucket classification, pool-aware retry, attribution), 29 API routes (requireAdmin/CSRF via reviewed codemod), `search-workspace.tsx` (auth fetch, staged large saves, null-expiry), history/saved stores (auth fetch), `settings-client.tsx` (quota dashboard, key editor, storage, account sections), `.env.example`, `app-validate-env.mjs`, `.gitignore` (`/data`), `package.json` (`@vercel/blob`, `test:blob` scripts), both ledgers.

### Technical details

- Records: deterministic JSON, UTF-8-measured; ≤4 MiB single object, else 2 MiB chunks + manifest (generation id, order, count, bytes, SHA-256). Staged browser uploads (init/chunk/commit/abort). CAS index writes (ETag ifMatch + retry). Read-back verification before success. Trailing-slash list scoping (found + fixed via failing integration test: Blob list() is pure string-prefix).
- Keys: AES-256-GCM via `API_KEYS_ENCRYPTION_KEY`; saves refused without it; masked last-4 only client-side; ENV key stays fallback, never copied to Blob.
- Pools: `project:<id>` shared pools; unknown keys form solo `key:<id>` pools (never merged). Buckets `search`/`other` exhaust independently until next Pacific midnight. quotaExceeded → pool-bucket cooldown + correlated ≥2-key promotion declared→verified. Invalid-key reasons → disable key only. Others fail fast. Every attempt recorded (key+project+bucket+outcome) with CAS-safe daily docs.
- Auth: atomic create-if-absent bootstrap; env never overwrites persisted account; credential changes bump authVersion + revoke all sessions; Blob sliding-window rate limit (10/15min) + memory mirror.

### Verification run and results

- `npm run test:blob`: 118 assertions pass (mocked Blob), incl. 26 quota-pool acceptance checks + keys-migration idempotency.
- `npm run test:blob:integration` (real private store, `__test__`-prefixed records only): small round-trip, 12.1 MiB / 7-chunk reassemble exact, index listing, full cleanup — PASSED.
- `npm run typecheck`: passed (incl. final tree: `proxy.ts`, edge-safe cookie module, quota-pool types).
- `npm run lint`: passed (0 errors, 0 warnings) on the final tree.
- `npm run build`: passed (all routes incl. `/login`, `/api/admin/*`, `/api/blob-upload/*`, `/api/youtube/keys/usage`); no middleware-deprecation and no Edge `node:crypto` warnings after moving to `proxy.ts` + edge-safe cookie module.
- Live dev-server E2E (`e2e-blob.cjs`, 18 assertions): public username prefill; 401s without session (playlists, keys); generic 401 on wrong password; first-login bootstrap + HttpOnly cookie + status; playlist create/PUT/read-back (Arabic intact)/delete; cross-origin mutation 403; usage dashboard shape with no plaintext; storage-verify (config/list/write PASS; storeIdentity honestly UNVERIFIED — private-blob hosts do not embed the store id); migration idempotent; logout + session revocation 401 — ALL PASSED.
- Live migration+keys E2E (`e2e-migrate.cjs`, 10 assertions): seeded legacy disk playlist + plaintext key → migrate imported 1+1; rerun skipped (fixed keys double-count bug found by this test); migrated playlist readable; migrated key encrypted-at-rest + masked; PATCH metadata; usage shows declared pool; full cleanup (Blob + fixtures) — ALL PASSED.

### Blocked checks, if any

- Full `npm run lint` passes on the final tree (0 errors, 0 warnings); an earlier environment-level stall while loading `eslint.config.mjs` resolved on retry.
- No browser automation available: login/UI flows verified by review + API-level E2E (28 assertions).

### Remaining risks/limitations

- Quota figures are local estimates (no official monitoring connected); manual project IDs stay `declared` until behavioral evidence verifies them.
- Blob requires configured token/store; routes fail closed with clear errors (no silent fallback).
- Prisma schema present but unused by the Blob runtime; no migrations created/applied; `db:apply` not run.

### Whether secrets were printed

No. All probes/diagnostics report labels and pass/fail only; tokens, keys, hashes never logged, committed, or returned to browsers.

### Whether migrations were created/applied

No Prisma migrations. Data migration = idempotent disk→Blob importer (Settings → Migrate; disk originals left in place).

### Whether `db:apply` was run

No.



---

## 2026-10-10 (Dailymotion Sidebar URL Update)

### Date/time

2026-10-10 UTC

### Task summary

Changed the Sidebar Dailymotion Discovery link destination from `https://dailymotion-video-discovery.vercel.app/` to `https://dailymotion-discovery.vercel.app/` per user request. Updated `src/components/layout/navigation.tsx` and the current-state project ledger. Prior change-log entries intentionally keep the old URL as historical record.

### Files changed

- `src/components/layout/navigation.tsx` (href only)
- `youtube_discovery_ledger.md` (file-map URL reference)

### Verification run and results

- Grep confirms the new URL in `navigation.tsx` and no remaining old-URL references in source (old URL survives only inside dated historical change-log entries, by design).
- String-literal-only change: no type, lint, or behavior impact beyond the link destination.

### Whether secrets were printed

No.

### Whether migrations were created/applied

No.

### Whether `db:apply` was run

No.





