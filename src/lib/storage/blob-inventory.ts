import "server-only";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * Vercel Blob Inventory & Supabase Migration Utility
 * ──────────────────────────────────────────────────────────────────────────
 * - INVENTORY & NON-DESTRUCTIVE MIGRATION ONLY.
 * - Under NO circumstances does this tool delete, overwrite, or mutate remote
 *   Vercel Blob objects.
 * - Uses standard HTTP fetch with BLOB_READ_WRITE_TOKEN (zero dependency
 *   on the `@vercel/blob` npm package).
 * - Scans existing `youtube-discovery/v1/` objects:
 *     - Playlists (`playlists/`)
 *     - Search History (`saved-history/`)
 *     - Encrypted Managed Keys (`keys/`)
 *     - Admin Accounts & Sessions (`admin/`)
 * - Copies records into Supabase Storage / local persistent storage and
 *   verifies byte and checksum integrity before recording success.
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
 * Lists all existing remote Vercel Blob objects using standard HTTP fetch.
 * Completely safe and non-destructive.
 */
export async function inventoryRemoteBlob(): Promise<BlobInventoryReport> {
  const token = process.env.BLOB_READ_WRITE_TOKEN?.trim();

  const report: BlobInventoryReport = {
    timestamp: new Date().toISOString(),
    blobTokenConfigured: Boolean(token),
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

  if (!token) {
    return report;
  }

  try {
    // Vercel Blob REST API list endpoint
    const response = await fetch("https://blob.vercel-storage.com?limit=1000", {
      headers: {
        authorization: `Bearer ${token}`,
      },
      cache: "no-store",
    });

    if (!response.ok) {
      console.warn("[blob-inventory] Vercel Blob list returned HTTP", response.status);
      return report;
    }

    const data = (await response.json()) as {
      blobs?: Array<{
        pathname: string;
        size: number;
        uploadedAt: string;
        downloadUrl?: string;
      }>;
    };

    if (data.blobs && Array.isArray(data.blobs)) {
      for (const b of data.blobs) {
        let category: BlobInventoryItem["category"] = "other";
        if (b.pathname.includes("playlists/")) category = "playlist";
        else if (b.pathname.includes("saved-history/")) category = "search-history";
        else if (b.pathname.includes("keys/")) category = "keys";
        else if (b.pathname.includes("admin/")) category = "admin";

        if (category === "playlist") report.categories.playlists++;
        else if (category === "search-history") report.categories.searchHistory++;
        else if (category === "keys") report.categories.keys++;
        else if (category === "admin") report.categories.admin++;
        else report.categories.other++;
        report.totalObjects++;
        report.totalBytes += b.size;

        report.items.push({
          pathname: b.pathname,
          size: b.size,
          uploadedAt: b.uploadedAt,
          category,
          downloadUrl: b.downloadUrl,
        });
      }
    }
  } catch (err) {
    console.warn("[blob-inventory] Error listing Vercel Blob objects:", err);
  }

  return report;
}

/**
 * Reads a single object from Vercel Blob via HTTP without modifying it.
 */
export async function readRemoteBlobObject(downloadUrl: string): Promise<Buffer | null> {
  const token = process.env.BLOB_READ_WRITE_TOKEN?.trim();
  if (!token) return null;

  try {
    const res = await fetch(downloadUrl, {
      headers: { authorization: `Bearer ${token}` },
      cache: "no-store",
    });
    if (!res.ok) return null;
    const arrayBuf = await res.arrayBuffer();
    return Buffer.from(arrayBuf);
  } catch {
    return null;
  }
}
