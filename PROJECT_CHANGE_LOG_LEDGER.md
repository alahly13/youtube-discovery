# PROJECT_CHANGE_LOG_LEDGER

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
