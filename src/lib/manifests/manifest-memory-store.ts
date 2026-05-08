import "server-only";

import type { YouTubeManifest, YouTubeManifestSummary } from "@/types/manifest";

type StoreGlobal = typeof globalThis & {
  __youtubeDiscoveryManifestStore?: Map<string, YouTubeManifest>;
};

function getStore() {
  const storeGlobal = globalThis as StoreGlobal;
  storeGlobal.__youtubeDiscoveryManifestStore ??= new Map<string, YouTubeManifest>();
  return storeGlobal.__youtubeDiscoveryManifestStore;
}

// This runtime store keeps temporary and saved manifests available while the
// Prisma migration is not yet applied. It is intentionally documented as
// non-durable so future agents do not mistake it for database persistence.
export function saveManifestInMemory(manifest: YouTubeManifest, saved = false) {
  const store = getStore();
  const nextManifest = { ...manifest, saved };
  store.set(nextManifest.manifestId, nextManifest);
  return nextManifest;
}

export function listMemoryManifests(): YouTubeManifestSummary[] {
  return Array.from(getStore().values())
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
  return getStore().get(manifestId) ?? null;
}
