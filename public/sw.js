/* global self, caches, clients, fetch, Response, URL, crypto, console */

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * YouTube Discovery — Minimal PWA Service Worker
 * ──────────────────────────────────────────────────────────────────────────
 * Scope: Handles the Web Share Target POST only.
 *
 * Why this file exists:
 *   The Web Share Target API cannot hand a POST body to a page. This worker
 *   receives `POST /share-target`, stores the sanitized fields in Cache
 *   Storage under a random 128-bit token, records the current canonical owner
 *   as a hint, and returns a 303 redirect to the review page. The token is the
 *   only share-specific value that enters the URL.
 *
 * Deliberately NOT implemented:
 *   - No navigation caching. Authenticated pages must always come from the
 *     network and remain protected by the server-side auth proxy.
 *   - No external fetches. The only fetch is the same-origin auth status.
 *   - No dynamic imports or eval.
 *
 * Future agents:
 *   - Keep the cache name, prefix, field limits, and max age in sync with
 *     `src/lib/pwa/share-target.ts`.
 *   - Always return a 303 redirect after a POST so a refresh does not submit
 *     the share form again.
 * ═══════════════════════════════════════════════════════════════════════════
 */

const SHARE_PATH = "/share-target";
const CACHE_NAME = "youtube-discovery-share-target-v1";
const CACHE_PREFIX = "/__share-target__/";
const PAYLOAD_VERSION = 1;
const MAX_AGE_MS = 60 * 60 * 1000;
const FIELD_LIMITS = {
  title: 4096,
  text: 32768,
  url: 8192,
};

self.addEventListener("install", (event) => {
  // Activate the newest worker immediately; the worker has no versioned
  // navigation cache that would make an immediate takeover unsafe.
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (event) => {
  const request = event.request;

  // Only the share POST is intercepted. Every GET (including /share-target)
  // continues to the network and remains subject to the auth proxy.
  if (request.method !== "POST") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname !== SHARE_PATH) return;

  event.respondWith(handleShareTarget(request));
});

async function handleShareTarget(request) {
  try {
    const formData = await request.formData();

    const fields = {
      title: safeField(formData.get("title"), FIELD_LIMITS.title),
      text: safeField(formData.get("text"), FIELD_LIMITS.text),
      url: safeField(formData.get("url"), FIELD_LIMITS.url),
    };

    const ownerHint = await resolveOwnerHint();
    const token = createToken();
    const payload = {
      version: PAYLOAD_VERSION,
      token,
      createdAt: new Date().toISOString(),
      ownerHint,
      fields,
    };

    try {
      const cache = await caches.open(CACHE_NAME);
      await cache.put(
        payloadKey(token),
        new Response(JSON.stringify(payload), {
          headers: {
            "Content-Type": "application/json; charset=utf-8",
            "Cache-Control": "no-store",
          },
        })
      );
      await pruneExpired(cache);
    } catch {
      return redirectToReview("storage");
    }

    return redirectToReview(token);
  } catch {
    // A malformed or unsupported share body should still land on a readable
    // explanation page instead of showing a browser network error.
    return redirectToReview("unreadable");
  }
}

/**
 * Stores only a same-origin canonical owner hint. If the user is signed out,
 * the hint is null and the page will require authentication before review.
 */
async function resolveOwnerHint() {
  try {
    const response = await fetch("/api/auth/status", {
      cache: "no-store",
      credentials: "same-origin",
      headers: { "Cache-Control": "no-cache" },
    });
    if (!response.ok) return null;

    const data = await response.json();
    if (!data || data.authenticated !== true) return null;

    const owner = String(data.storageOwnerUuid || data.userId || "").trim();
    return owner || null;
  } catch {
    return null;
  }
}

function createToken() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function payloadKey(token) {
  return `${self.location.origin}${CACHE_PREFIX}${token}`;
}

function redirectToReview(value) {
  const target = new URL(SHARE_PATH, self.location.origin);
  if (value && /^[a-f0-9]{32}$/.test(value)) {
    target.searchParams.set("share", value);
  } else {
    target.searchParams.set("shareError", value || "unknown");
  }
  return Response.redirect(target.href, 303);
}

function safeField(value, limit) {
  if (typeof value !== "string") return "";

  const clean = value
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g, "")
    .replace(/[\u200B-\u200F\u202A-\u202E\u2060-\u2064\uFEFF]/g, "")
    .trim();

  if (clean.length <= limit) return clean;
  return clean.slice(0, limit).trimEnd();
}

/**
 * Bounded cleanup: this worker stores at most one entry per share. Expired
 * entries are deleted here so abandoned shares do not accumulate forever.
 */
async function pruneExpired(cache) {
  const requests = await cache.keys();
  const now = Date.now();

  await Promise.all(
    requests.map(async (request) => {
      try {
        const url = new URL(request.url);
        if (!url.pathname.startsWith(CACHE_PREFIX)) return;

        const response = await cache.match(request);
        const payload = response ? await response.json() : null;
        const createdAt =
          payload && typeof payload.createdAt === "string"
            ? Date.parse(payload.createdAt)
            : NaN;

        if (!Number.isFinite(createdAt) || now - createdAt > MAX_AGE_MS) {
          await cache.delete(request);
        }
      } catch {
        await cache.delete(request);
      }
    })
  );
}
