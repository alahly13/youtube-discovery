import "server-only";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * Vercel Blob Inventory (Decommissioned)
 * ──────────────────────────────────────────────────────────────────────────
 * Vercel Blob has been fully decommissioned in favor of Cloudflare / Supabase
 * Storage. All historical blobs were archived into 'vercel-blob-backup/'.
 * This utility returns a clean zero-item report without making network calls.
 * ═══════════════════════════════════════════════════════════════════════════
 */

export interface BlobInventoryItem {
  pathname: string;
  size: number;
  uploadedAt: string;
  category: "playlist" | "search-history" | "keys" | "admin" | "other";
  downloadUrl?: string;
}

export interface BlobInventoryReport {
  timestamp: string;
  blobTokenConfigured: boolean;
  totalObjects: number;
  totalBytes: number;
  categories: {
    playlists: number;
    searchHistory: number;
    keys: number;
    admin: number;
    other: number;
  };
  items: BlobInventoryItem[];
}

/**
 * Returns safe empty inventory now that Vercel Blob is decommissioned.
 */
export async function inventoryRemoteBlob(): Promise<BlobInventoryReport> {
  return {
    timestamp: new Date().toISOString(),
    blobTokenConfigured: false,
    totalObjects: 0,
    totalBytes: 0,
    categories: {
      playlists: 0,
      searchHistory: 0,
      keys: 0,
      admin: 0,
      other: 0,
    },
    items: [],
  };
}

/**
 * Read remote blob object (decommissioned no-op).
 */
export async function readRemoteBlobObject(_downloadUrl: string): Promise<Buffer | null> {
  return null;
}
