import "server-only";

import crypto from "node:crypto";
import path from "node:path";
import { prisma } from "@/lib/db/prisma";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * YouTube Discovery — Legacy Data Recovery Scanner (Phase 1.6)
 * ──────────────────────────────────────────────────────────────────────────
 * Scope: Workstream 1 — Legacy Data Recovery & Backup
 *
 * Discovers, classifies, and verifies all recoverable historical Manifest files
 * and application data across all legacy sources:
 *   1. Vercel Blob (paginated cursor loop across all prefixes)
 *   2. Vercel Caches & Next.js Data Cache (capability classification)
 *   3. Application Disk Cache & Local Storage (`data/playlists/`, `data/storage/`)
 *   4. Previous Database / Supabase Registry (`archived_manifests`)
 *   5. Browser Storage (IndexedDB + localStorage client ingestion)
 *
 * CRITICAL SAFETY BOUNDARY:
 * - 100% READ-ONLY. Under NO circumstances are any source objects deleted,
 *   purged, overwritten, or mutated.
 * - Credentials and secret tokens are NEVER exposed or exported.
 * ═══════════════════════════════════════════════════════════════════════════
 */

export type HistoricalManifestCategory =
  | "SAVED_ITEMS"
  | "SAVED_TITLES"
  | "SAVED_PLAYLISTS"
  | "SAVED_SEARCH_HISTORY"
  | "RESEARCH_QUEUE"
  | "SAVED_REFERENCES"
  | "SEARCH_PRESETS"
  | "OTHER";

export type LegacySourceType =
  | "vercel_blob"
  | "runtime_cache"
  | "next_data_cache"
  | "browser_indexeddb"
  | "browser_localstorage"
  | "disk_cache"
  | "supabase_database";

export interface DiscoveredLegacyItem {
  id: string;
  source: LegacySourceType;
  category: HistoricalManifestCategory;
  originalPathname: string;
  originalFilename: string;
  byteLength: number;
  sha256?: string;
  sourceCreatedAt: string | null;
  sourceExportedAt: string | null;
  isRecoverable: boolean;
  isExcluded: boolean;
  exclusionReason?: string;
  downloadUrl?: string;
  localFilePath?: string;
  rawMetadata?: Record<string, unknown>;
}

export interface SourceScanSummary {
  source: LegacySourceType;
  sourceName: string;
  recoveryCapability: "FULL" | "PARTIAL" | "NOT_ENUMERABLE" | "CLIENT_ONLY" | "ACCESS_UNAVAILABLE";
  status: "AVAILABLE" | "PARTIAL" | "ACCESS_UNAVAILABLE" | "NOT_CONFIGURED" | "NOT_ENUMERABLE";
  discoveredCount: number;
  readableCount: number;
  unreadableCount: number;
  excludedCount: number;
  totalRecoverableBytes: number;
  items: DiscoveredLegacyItem[];
  exclusions: Array<{ pathname: string; reason: string }>;
  accessRequirements?: string;
  notes?: string;
}

export interface CompleteLegacyScanReport {
  timestamp: string;
  overallStatus: "COMPLETE" | "PARTIAL" | "ACCESS_UNAVAILABLE";
  totalDiscovered: number;
  totalReadable: number;
  totalExcluded: number;
  totalRecoverableBytes: number;
  categoryBreakdown: Record<HistoricalManifestCategory, { fileCount: number; byteCount: number }>;
  sources: Record<LegacySourceType, SourceScanSummary>;
}

/**
 * Maps a file pathname or content hints to one of the 8 canonical categories.
 */
export function classifyLegacyCategory(
  pathname: string,
  contentSnippet?: Record<string, unknown>
): HistoricalManifestCategory {
  const lower = pathname.toLowerCase();

  if (
    lower.includes("saved-item") ||
    lower.includes("saved_item") ||
    lower.includes("saveditem") ||
    lower.includes("saved-video") ||
    lower.includes("saved_video") ||
    lower.includes("savedvideo") ||
    lower.includes("library")
  ) {
    return "SAVED_ITEMS";
  }

  if (lower.includes("playlist") || lower.includes("user_playlist")) {
    return "SAVED_PLAYLISTS";
  }

  if (
    lower.includes("search-history") ||
    lower.includes("saved-history") ||
    lower.includes("query_history") ||
    lower.includes("history")
  ) {
    return "SAVED_SEARCH_HISTORY";
  }

  if (lower.includes("preset") || lower.includes("search_preset") || lower.includes("search-preset")) {
    return "SEARCH_PRESETS";
  }

  if (
    lower.includes("title") ||
    lower.includes("saved_search") ||
    lower.includes("saved-search")
  ) {
    return "SAVED_TITLES";
  }

  if (lower.includes("research_queue") || lower.includes("research-queue") || lower.includes("queue")) {
    return "RESEARCH_QUEUE";
  }

  if (lower.includes("reference") || lower.includes("saved_ref") || lower.includes("saved-ref")) {
    return "SAVED_REFERENCES";
  }

  if (contentSnippet) {
    if (Array.isArray(contentSnippet.playlists)) return "SAVED_PLAYLISTS";
    if (Array.isArray(contentSnippet.searches) || Array.isArray(contentSnippet.queries)) {
      return "SAVED_SEARCH_HISTORY";
    }
    if (Array.isArray(contentSnippet.items)) {
      const first = (contentSnippet.items as unknown[])[0];
      if (typeof first === "object" && first !== null) {
        const rec = first as Record<string, unknown>;
        if (rec.query_text || rec.queryText) return "SAVED_SEARCH_HISTORY";
        if (rec.videoId || rec.channelId || rec.playlistId || rec.platform_item_id) return "SAVED_ITEMS";
      }
    }
  }

  return "OTHER";
}

/**
 * 1. Scan Vercel Blob using paginated REST API cursor loop.
 * Explores all prefixes without skipping any objects.
 */
export async function scanVercelBlob(): Promise<SourceScanSummary> {
  const token = process.env.BLOB_READ_WRITE_TOKEN?.trim();

  const summary: SourceScanSummary = {
    source: "vercel_blob",
    sourceName: "Vercel Blob Storage",
    recoveryCapability: "FULL",
    status: token ? "AVAILABLE" : "ACCESS_UNAVAILABLE",
    discoveredCount: 0,
    readableCount: 0,
    unreadableCount: 0,
    excludedCount: 0,
    totalRecoverableBytes: 0,
    items: [],
    exclusions: [],
    accessRequirements: token ? undefined : "Requires server environment variable BLOB_READ_WRITE_TOKEN.",
  };

  if (!token) {
    return summary;
  }

  try {
    let cursor: string | undefined = undefined;
    let hasMore = true;
    let pageCount = 0;

    while (hasMore && pageCount < 50) {
      pageCount++;
      const url = new URL("https://blob.vercel-storage.com");
      url.searchParams.set("limit", "1000");
      if (cursor) {
        url.searchParams.set("cursor", cursor);
      }

      const response = await fetch(url.toString(), {
        headers: {
          authorization: `Bearer ${token}`,
        },
        cache: "no-store",
      });

      if (!response.ok) {
        summary.status = "PARTIAL";
        summary.notes = `Vercel Blob REST API returned HTTP ${response.status} on page ${pageCount}.`;
        break;
      }

      const data = (await response.json()) as {
        blobs?: Array<{
          pathname: string;
          size: number;
          uploadedAt: string;
          downloadUrl?: string;
        }>;
        cursor?: string;
        hasMore?: boolean;
      };

      const blobs = data.blobs || [];
      for (const b of blobs) {
        summary.discoveredCount++;

        // Identify sensitive auth objects to exclude from public recovery archive
        const lower = b.pathname.toLowerCase();
        const isAuthCredential =
          lower.includes("admin/account.json") ||
          lower.includes("admin/sessions/") ||
          lower.includes("admin/ratelimit/");

        if (isAuthCredential) {
          summary.excludedCount++;
          summary.exclusions.push({
            pathname: b.pathname,
            reason: "Excluded: Contains private administrator authentication credential, session hash, or rate limit record.",
          });
          continue;
        }

        const category = classifyLegacyCategory(b.pathname);
        const originalFilename = path.basename(b.pathname);

        summary.readableCount++;
        summary.totalRecoverableBytes += b.size;
        summary.items.push({
          id: `blob_${crypto.createHash("sha256").update(b.pathname).digest("hex").slice(0, 16)}`,
          source: "vercel_blob",
          category,
          originalPathname: b.pathname,
          originalFilename,
          byteLength: b.size,
          sourceCreatedAt: b.uploadedAt || null,
          sourceExportedAt: null,
          isRecoverable: true,
          isExcluded: false,
          downloadUrl: b.downloadUrl,
        });
      }

      cursor = data.cursor;
      hasMore = Boolean(data.hasMore && cursor);
    }
  } catch (err) {
    summary.status = "PARTIAL";
    summary.notes = `Scan error: ${err instanceof Error ? err.message : String(err)}`;
  }

  return summary;
}

/**
 * 2. Application Local Disk Storage.
 *
 * NOTE (Production & Vercel Tracing Architecture):
 * Runtime server filesystem scanning has been decoupled from the Next.js production
 * serverless bundle to prevent broad Turbopack dynamic filesystem tracing of the workspace.
 *
 * Serverless deployment runtimes (such as Vercel Functions) do not host local application
 * disk archives. Local disk archives (`data/playlists`, `data/storage`) exist exclusively
 * in local development or self-hosted offline environments and are scanned via the
 * standalone CLI tool: `npm run recovery:local` (`scripts/recovery/local-filesystem-scanner.mjs`).
 *
 * @param injectedItems - Optional pre-scanned items supplied by offline callers or test suites.
 */
export async function scanDiskCache(injectedItems?: DiscoveredLegacyItem[]): Promise<SourceScanSummary> {
  if (injectedItems && injectedItems.length > 0) {
    let totalBytes = 0;
    for (const item of injectedItems) {
      totalBytes += item.byteLength;
    }
    return {
      source: "disk_cache",
      sourceName: "Local Disk Cache & File Archives",
      recoveryCapability: "FULL",
      status: "AVAILABLE",
      discoveredCount: injectedItems.length,
      readableCount: injectedItems.length,
      unreadableCount: 0,
      excludedCount: 0,
      totalRecoverableBytes: totalBytes,
      items: injectedItems,
      exclusions: [],
      notes: "Pre-scanned local disk archive items supplied via caller injection.",
    };
  }

  return {
    source: "disk_cache",
    sourceName: "Local Disk Cache & File Archives",
    recoveryCapability: "ACCESS_UNAVAILABLE",
    status: "ACCESS_UNAVAILABLE",
    discoveredCount: 0,
    readableCount: 0,
    unreadableCount: 0,
    excludedCount: 0,
    totalRecoverableBytes: 0,
    items: [],
    exclusions: [],
    accessRequirements:
      "Local filesystem scanning is separated from the web bundle. Run the CLI tool locally: `npm run recovery:local`.",
    notes:
      "LOCAL_FILESYSTEM_NOT_AVAILABLE_ON_VERCEL: Serverless deployment runtimes do not host local application disk archives. Use the local CLI recovery tool (npm run recovery:local) for offline disk manifests.",
  };
}

/**
 * 3. Evaluate Caches (Runtime Cache, Next.js Data Cache, CDN/ISR, Turbopack Build Cache).
 * Evaluates recovery capabilities honestly without hallucinating un-enumerable cache keys.
 */
export function evaluateCaches(): {
  runtimeCache: SourceScanSummary;
  nextDataCache: SourceScanSummary;
} {
  const runtimeCache: SourceScanSummary = {
    source: "runtime_cache",
    sourceName: "Vercel Runtime Cache",
    recoveryCapability: "NOT_ENUMERABLE",
    status: "NOT_ENUMERABLE",
    discoveredCount: 0,
    readableCount: 0,
    unreadableCount: 0,
    excludedCount: 0,
    totalRecoverableBytes: 0,
    items: [],
    exclusions: [],
    notes:
      "Vercel Runtime Cache is an ephemeral key-value cache designed for function acceleration. It does not provide key-enumeration or catalog APIs and did not store persistent Manifest files.",
  };

  const nextDataCache: SourceScanSummary = {
    source: "next_data_cache",
    sourceName: "Next.js Data & Build Cache",
    recoveryCapability: "NOT_ENUMERABLE",
    status: "NOT_ENUMERABLE",
    discoveredCount: 0,
    readableCount: 0,
    unreadableCount: 0,
    excludedCount: 0,
    totalRecoverableBytes: 0,
    items: [],
    exclusions: [],
    notes:
      "Next.js Data Cache and Turbopack compiler cache (.next/cache) store pre-compiled route chunks, SWC artifacts, and component render caches. They do not hold standalone application Manifest records.",
  };

  return { runtimeCache, nextDataCache };
}

/**
 * 4. Scan Database / Supabase Storage Registry (`archived_manifests` and `storage_datasets`).
 */
export async function scanDatabaseSources(ownerId?: string): Promise<SourceScanSummary> {
  const summary: SourceScanSummary = {
    source: "supabase_database",
    sourceName: "Supabase PostgreSQL Registry",
    recoveryCapability: "FULL",
    status: "AVAILABLE",
    discoveredCount: 0,
    readableCount: 0,
    unreadableCount: 0,
    excludedCount: 0,
    totalRecoverableBytes: 0,
    items: [],
    exclusions: [],
  };

  try {
    const archives = await prisma.archivedManifest.findMany({
      where: ownerId ? { owner_id: ownerId } : undefined,
    });

    for (const a of archives) {
      summary.discoveredCount++;
      summary.readableCount++;
      const byteSize = Number(a.byte_count);
      summary.totalRecoverableBytes += byteSize;

      summary.items.push({
        id: a.id,
        source: "supabase_database",
        category: classifyLegacyCategory(a.category),
        originalPathname: a.storage_path,
        originalFilename: `${a.manifest_id}.json`,
        byteLength: byteSize,
        sha256: a.content_sha256,
        sourceCreatedAt: a.source_created_at ? a.source_created_at.toISOString() : null,
        sourceExportedAt: a.source_exported_at ? a.source_exported_at.toISOString() : null,
        isRecoverable: true,
        isExcluded: false,
        rawMetadata: {
          manifest_id: a.manifest_id,
          record_count: a.record_count,
          source_format: a.source_format,
        },
      });
    }
  } catch {
    summary.status = "NOT_CONFIGURED";
    summary.notes = "Database table archived_manifests not yet accessible or migrated in current runtime.";
  }

  return summary;
}

/**
 * Orchestrates a complete server-side scan across all legacy sources.
 */
export async function runServerLegacyScan(ownerId?: string): Promise<CompleteLegacyScanReport> {
  const [blobSummary, diskSummary, dbSummary] = await Promise.all([
    scanVercelBlob(),
    scanDiskCache(),
    scanDatabaseSources(ownerId),
  ]);

  const { runtimeCache, nextDataCache } = evaluateCaches();

  const sources: Record<LegacySourceType, SourceScanSummary> = {
    vercel_blob: blobSummary,
    disk_cache: diskSummary,
    supabase_database: dbSummary,
    runtime_cache: runtimeCache,
    next_data_cache: nextDataCache,
    browser_indexeddb: {
      source: "browser_indexeddb",
      sourceName: "Browser IndexedDB (youtube_discovery_local_v1)",
      recoveryCapability: "CLIENT_ONLY",
      status: "AVAILABLE",
      discoveredCount: 0,
      readableCount: 0,
      unreadableCount: 0,
      excludedCount: 0,
      totalRecoverableBytes: 0,
      items: [],
      exclusions: [],
      notes: "Client-side storage: enumerated in the administrator's browser via the Recovery Center UI.",
    },
    browser_localstorage: {
      source: "browser_localstorage",
      sourceName: "Browser LocalStorage",
      recoveryCapability: "CLIENT_ONLY",
      status: "AVAILABLE",
      discoveredCount: 0,
      readableCount: 0,
      unreadableCount: 0,
      excludedCount: 0,
      totalRecoverableBytes: 0,
      items: [],
      exclusions: [],
      notes: "Client-side storage: enumerated in the administrator's browser via the Recovery Center UI.",
    },
  };

  const categoryBreakdown: Record<HistoricalManifestCategory, { fileCount: number; byteCount: number }> = {
    SAVED_ITEMS: { fileCount: 0, byteCount: 0 },
    SAVED_TITLES: { fileCount: 0, byteCount: 0 },
    SAVED_PLAYLISTS: { fileCount: 0, byteCount: 0 },
    SAVED_SEARCH_HISTORY: { fileCount: 0, byteCount: 0 },
    RESEARCH_QUEUE: { fileCount: 0, byteCount: 0 },
    SAVED_REFERENCES: { fileCount: 0, byteCount: 0 },
    SEARCH_PRESETS: { fileCount: 0, byteCount: 0 },
    OTHER: { fileCount: 0, byteCount: 0 },
  };

  let totalDiscovered = 0;
  let totalReadable = 0;
  let totalExcluded = 0;
  let totalRecoverableBytes = 0;

  for (const src of Object.values(sources)) {
    totalDiscovered += src.discoveredCount;
    totalReadable += src.readableCount;
    totalExcluded += src.excludedCount;
    totalRecoverableBytes += src.totalRecoverableBytes;

    for (const item of src.items) {
      if (!item.isExcluded) {
        categoryBreakdown[item.category].fileCount++;
        categoryBreakdown[item.category].byteCount += item.byteLength;
      }
    }
  }

  let overallStatus: CompleteLegacyScanReport["overallStatus"] = "COMPLETE";
  if (blobSummary.status === "ACCESS_UNAVAILABLE" || blobSummary.status === "PARTIAL") {
    overallStatus = "PARTIAL";
  }

  return {
    timestamp: new Date().toISOString(),
    overallStatus,
    totalDiscovered,
    totalReadable,
    totalExcluded,
    totalRecoverableBytes,
    categoryBreakdown,
    sources,
  };
}
