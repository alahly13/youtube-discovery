# youtube-discovery

Professional Next.js 16 SaaS workspace for discovering, filtering, saving, exporting, and AI-analyzing public YouTube metadata through official YouTube Data API workflows only.

## Current Stack

- Next.js `16.2.6` App Router
- React `19.2.4`
- TypeScript strict mode
- Tailwind CSS 4 CSS-first tokens
- Supabase Auth & Supabase PostgreSQL foundation (under redesign)
- Zod route validation
- lucide-react icons
- Framer Motion, Zustand, TanStack Query, FlexSearch installed for richer follow-on UX/state/search work
- Google GenAI server-only helper routes

## Local Setup

Use PowerShell from the repo root:

```powershell
npm install
Copy-Item .env.example .env.local
npm run dev
```

Set real secrets only in root `.env.local` locally or Vercel Project Settings for deployments. Do not place env files under `src/`; the scripts warn about unsupported `.local.env` and `src/.local.env`.

For a linked Vercel project, sync local envs with:

```powershell
vercel env pull .env.local --yes
```

## Required Environment Variables

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

Browser-safe:

- `NEXT_PUBLIC_APP_URL`
- `NEXT_PUBLIC_SUPABASE_URL` only if client Supabase auth is added
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` only if client Supabase auth is added

Never create `NEXT_PUBLIC_YOUTUBE_API_KEY` or `NEXT_PUBLIC_GEMINI_API_KEY`.

## Verification

```powershell
npm run lint
npm run typecheck
npm run build
```

## Implemented Surface

- App shell with responsive navigation and theme toggle
- Dashboard at `/`
- Search workspace at `/search`
- AI workspace at `/ai-search`
- Link Explorer at `/link-explorer`
- Channels, playlists, manifests, collections, saved library, history, and settings routes
- Server-only YouTube adapter modules for search/details/channel uploads/playlist flows
- API routes for YouTube search/details/link/channel/playlist/manifests
- AI routes for scoped Gemini assistants
- Data architecture ready for upcoming database schema and Supabase Auth integration

Live YouTube calls require `YOUTUBE_API_KEY`. Live Gemini calls require `GEMINI_API_KEY`. Missing keys return honest unavailable states instead of crashing the app.
