# old-youtube-discovery-api

Dedicated Cloudflare Worker managing historical archive manifests across the 4 canonical OLD categories in the private R2 bucket: `old-youtube-discovery-private`.

## Canonical OLD Archive Paths

- `asdy/old/saved-items/` (OLD Saved Items)
- `asdy/old/saved-playlists/` (OLD Saved Playlists)
- `asdy/old/saved-titles-links/` (OLD Saved Titles & Links)
- `asdy/old/saved-search-history/` (OLD Saved Search History)
- `asdy/old/unclassified/` (Unclassified imports)

## Configuration

- **Worker Name:** `old-youtube-discovery-api`
- **R2 Binding:** `env.OLD_BUCKET` -> `old-youtube-discovery-private`
- **Live URL:** `https://old-youtube-discovery-api.elmahdyabdulla208.workers.dev`
- **Authentication:** Web Crypto HMAC-SHA256 Capability Grant JWTs
- **Safety Policy:** Committed historical manifests cannot be deleted via the API (Zero-deletion guarantee).

## Secret Setup (One-Time)

To set the shared authentication secret on Cloudflare Workers, run:

```bash
npx wrangler secret put WORKER_AUTH_SECRET --config cloudflare/workers/old-youtube-discovery-api/wrangler.jsonc
```

When prompted, paste the `R2_OLD_WORKER_AUTH_SECRET` (or `WORKER_AUTH_SECRET`) configured in your root `.env` file.

## Deployment

To deploy this Worker to Cloudflare:

```bash
# 1. Login to Cloudflare CLI if not already authenticated:
npx wrangler login

# 2. Deploy the Worker:
npm run worker:old:deploy
```

## Logs & Monitoring

To stream live logs from the deployed worker:

```bash
npm run worker:old:tail
```
