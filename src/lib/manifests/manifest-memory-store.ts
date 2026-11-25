import "server-only";

import type { YouTubeManifest, YouTubeManifestSummary } from "@/types/manifest";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * Non-Authoritative Single-Instance Transient Manifest Cache (Server-Only)
 * ──────────────────────────────────────────────────────────────────────────
 * Architecture Classification:
 *   - Class A temporary processing manifests are owned locally by browser
 *     IndexedDB (`src/lib/manifests/local-manifest-store.ts` -> `temp_manifests`).
 *   - This process-local cache exists ONLY as a bounded transient fallback within
 *     a single Node/serverless invocation and is NEVER authoritative across
 *     multiple Vercel serverless instances.
 * ═══════════════════════════════════════════════════════════════════════════
 */

const MAX_TRANSIENT_MANIFESTS = 30;
const TRANSIENT_TTL_MS = 30 * 60 * 1000;

type StoreGlobal = typeof globalThis & {
  __youtubeDiscoveryManifestStore?: Map<string, YouTubeManifest>;
  __youtubeDiscoveryManifestMeta?: Map<string, number>;
};

function getStore() {
  const storeGlobal = globalThis as StoreGlobal;
  storeGlobal.__youtubeDiscoveryManifestStore ??= new Map<string, YouTubeManifest>();
  storeGlobal.__youtubeDiscoveryManifestMeta ??= new Map<string, number>();
  return {
    store: storeGlobal.__youtubeDiscoveryManifestStore,
    meta: storeGlobal.__youtubeDiscoveryManifestMeta,
  };
}

function pruneTransientStore() {
  const { store, meta } = getStore();
  const now = Date.now();
  for (const [id, touchedAt] of meta.entries()) {
    if (now - touchedAt > TRANSIENT_TTL_MS) {
      meta.delete(id);
      store.delete(id);
    }
  }
  while (store.size > MAX_TRANSIENT_MANIFESTS) {
    const oldestKey = store.keys().next().value;
    if (!oldestKey) break;
    store.delete(oldestKey);
    meta.delete(oldestKey);
  }
}

export function saveManifestInMemory(manifest: YouTubeManifest, saved = false) {
  const { store, meta } = getStore();
  const nextManifest = { ...manifest, saved };
  store.set(nextManifest.manifestId, nextManifest);
  meta.set(nextManifest.manifestId, Date.now());
  pruneTransientStore();
  return nextManifest;
}

export function listMemoryManifests(): YouTubeManifestSummary[] {
  pruneTransientStore();
  return Array.from(getStore().store.values())
    .sort((a, b) => b.collectedAt.localeCompare(a.collectedAt))
    .map((manifest) => ({
      manifestId: manifest.manifestId,
      manifestType: manifest.manifestType,
      title: manifest.title,
      status: manifest.status,
      itemCount: manifest.uniqueItemCount,
      quotaCostEstimate: manifest.quotaCostEstimate,
      collectedAt: manifest.collectedAt,
      saved: Boolean(manifest.saved),
    }));
}

export function getMemoryManifest(manifestId: string) {
  pruneTransientStore();
  const { store, meta } = getStore();
  const found = store.get(manifestId) ?? null;
  if (found) {
    meta.set(manifestId, Date.now());
  }
  return found;
}
