# youtube-discovery Project Ledger

Last updated: 2026-05-08

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
- FlexSearch, Zustand, TanStack Query, and Framer Motion are installed for planned local search/state/UX expansion.

## Runtime And Deployment Paths

- Local Windows/PowerShell: run from `F:\discovery\youtube-discovery`; keep local secrets in root `.env.local`; use `vercel env pull .env.local --yes` when linked to Vercel.
- Vercel production/preview: configure server-only variables in Vercel Project Settings; do not run database migrations during normal build.
- Supabase PostgreSQL: `DATABASE_URL` is server-only; `db:apply` uses guarded `prisma migrate deploy` and requires explicit confirmation.
- GitHub Actions: `.github/workflows/ci.yml` runs npm install, DB schema validation, lint, typecheck, and build on Node 24.
- Codex/online environment: provider keys and DB may be missing; live provider/DB checks must be reported honestly.

## Architecture Overview

The app is manifest-first. Every provider fetch returns a `YouTubeManifest` with provenance, settings snapshot, pages fetched, quota estimate, status, duplicate count, warnings/errors, and normalized items.

The current durable persistence schema is committed but migrations have not been applied by this agent. Runtime manifest routes use an explicit non-durable in-memory store until database repositories are enabled.

Search pipeline: provider settings -> explicit fetch -> temporary manifest -> local search -> local filters -> local sort -> render/export/AI.

AI pipeline: route-validated prompt -> explicit scope -> capped manifest context -> Gemini if configured -> server-validated response with evidence refs, limitations, confidence, and confirmation-only suggestions.

## Route Map And Page Responsibilities

- `/`: dashboard with product posture, system boundaries, quick actions, and manifest overview.
- `/search`: general YouTube Search workspace with provider settings, manifest summary, local filters, result cards, export, and scoped AI panel.
- `/ai-search`: AI Search / AI Discovery workspace and safety contract.
- `/link-explorer`: parses YouTube URLs and reports official API strategy without scraping.
- `/channels`: saved channel library scaffold.
- `/channel-explorer`: channel uploads workflow scaffold.
- `/channels/[sourceId]`: channel detail scaffold for uploads manifests, attempts, and AI analyst.
- `/playlists`: saved playlist library scaffold.
- `/playlist-explorer`: playlist workflow scaffold.
- `/playlists/[playlistId]`: playlist detail scaffold.
- `/manifests`: manifest library scaffold and runtime manifest API note.
- `/manifests/[manifestId]`: manifest detail scaffold.
- `/collections`: collection scaffold.
- `/saved`: saved library scaffold.
- `/history`: fetch/search history scaffold.
- `/settings`: environment, quota, and API-status scaffold.

## API Route Map And Backend Authority Boundaries

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

Owner scope is represented by `ownerId` defaults for saved/persistent user data. No auth provider is implemented yet, so this is a schema foundation rather than a complete multi-user security model.

Legacy tables: none in this repository.

Migration status: created but not applied. `db:apply` was not run.

## Environment Variable Map

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
- `DESIGN_DARK.md`, `DESIGN_LIGHT.md`, `design-inspiration/*`: visual inspiration, not product truth.
- `src/app/globals.css`: design tokens and global layout safeguards; avoid one-off color systems.
- `src/app/layout.tsx`: root metadata, fonts, and theme boot script.
- `src/components/layout/*`: app shell, navigation, theme toggle; keep provider secrets out.
- `src/components/search/search-workspace.tsx`: main client search experience; local filters do not call YouTube.
- `src/components/youtube/youtube-item-card.tsx`: video/channel/playlist item card; preserves zero numeric values.
- `src/components/ai/ai-assistant-panel.tsx`: scoped AI client panel; sends only manifest snapshots.
- `src/components/manifests/manifest-summary.tsx`: temporary manifest status and quota summary.
- `src/lib/platforms/youtube/*`: server-only official YouTube adapter, normalizer, quota, errors, URL analyzer, search/channel/playlist services.
- `src/lib/filters/youtube-result-filters.ts`: zero-safe local filter and sort pipeline.
- `src/lib/manifests/*`: manifest builder and current runtime store.
- `src/lib/ai/*`: server-only Gemini client, context builder, and response schemas.
- `src/lib/validation/youtube-schemas.ts`: Zod route contracts.
- `src/types/*`: normalized YouTube and manifest contracts.
- `prisma/schema.prisma`: canonical DB schema.
- `prisma/migrations/*`: append-only migration history.
- `scripts/*`: env and DB guardrails using root `.env.local`.
- `.env.example`: tracked safe environment template.
- `.github/workflows/ci.yml`: validation workflow.

## Current Limitations And Known Risks

- Live YouTube verification requires `YOUTUBE_API_KEY`; missing key returns a controlled unavailable error.
- Live Gemini verification requires `GEMINI_API_KEY`; missing key returns a scoped unavailable response.
- Prisma migration exists but was not applied; runtime manifest persistence is currently non-durable memory.
- No auth provider is implemented; owner scope is a schema foundation only.
- Saved library, collections, history, channel detail, playlist detail, and manifest detail pages are production shell scaffolds awaiting durable repository integration.
- The root `DESIGN.md` requested by the prompt is absent; `Guide-Files/DESIGN.md`, `DESIGN_DARK.md`, `DESIGN_LIGHT.md`, and HTML inspiration files were used.

## Verification Commands And Expected Checks

- `npm run db:validate`: validates env shape and Prisma schema.
- `npm run lint`: ESLint validation.
- `npm run typecheck`: Prisma generate plus strict TypeScript.
- `npm run build`: env preflight, Prisma generate, Next build.
- `npm run db:status`: checks migration status only when `DATABASE_URL` is present.
- `npm run db:apply`: guarded migration deploy; requires `CONFIRM_DB_APPLY=true`.

Latest verification results on 2026-05-08:

- `npm run db:validate`: passed.
- `npm run lint`: passed.
- `npm run typecheck`: passed.
- `npm run build`: passed.
- Dev server: running at `http://localhost:3000` for local review.
- HTTP smoke checks: core pages and Link Explorer API returned successful responses.
- `npm run db:status`: blocked by Prisma schema engine error against the configured endpoint; migration status not verified.
- `npm audit fix`: no non-breaking fix available; moderate transitive advisories remain pending upstream/non-breaking updates.
