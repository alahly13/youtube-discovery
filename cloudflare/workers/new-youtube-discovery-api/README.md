# new-youtube-discovery-api

Dedicated Cloudflare Worker managing active application data, manifests, datasets, generation parts, and temporary objects in the private R2 bucket: `new-youtube-discovery-private`.

## Configuration

- **Worker Name:** `new-youtube-discovery-api`
- **R2 Binding:** `env.NEW_BUCKET` -> `new-youtube-discovery-private`
- **Live URL:** `https://new-youtube-discovery-api.elmahdyabdulla208.workers.dev`
- **Authentication:** Web Crypto HMAC-SHA256 Capability Grant JWTs

## Secret Setup (One-Time)

To set the shared authentication secret on Cloudflare Workers, run:

```bash
npx wrangler secret put WORKER_AUTH_SECRET --config cloudflare/workers/new-youtube-discovery-api/wrangler.jsonc
```

When prompted, paste the `R2_NEW_WORKER_AUTH_SECRET` (or `WORKER_AUTH_SECRET`) configured in your root `.env` file.

## Deployment

To deploy this Worker to Cloudflare:

```bash
# 1. Login to Cloudflare CLI if not already authenticated:
npx wrangler login

# 2. Deploy the Worker:
npm run worker:new:deploy
```

## Logs & Monitoring

To stream live logs from the deployed worker:

```bash
npm run worker:new:tail
```
