"use client";

import {
  Download,
  ExternalLink,
  Filter,
  ListVideo,
  Loader2,
  RefreshCw,
  Save,
  Search,
  SkipForward,
  X,
} from "lucide-react";
import { startTransition, useCallback, useEffect, useMemo, useState } from "react";
import type { YouTubeManifest } from "@/types/manifest";
import type {
  NormalizedYouTubeDiscoveryItem,
  YouTubeResultFilters,
} from "@/types/youtube";
import { DEFAULT_YOUTUBE_RESULT_FILTERS } from "@/types/youtube";
import { AiAssistantPanel } from "@/components/ai/ai-assistant-panel";
import { AdvancedFiltersPanel } from "@/components/filters/advanced-filters-panel";
import { ManifestSummary } from "@/components/manifests/manifest-summary";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { YouTubeItemCard } from "@/components/youtube/youtube-item-card";
import { applyYouTubeResultPipeline } from "@/lib/filters/youtube-result-filters";
import { useYouTubeWorkspaceStore } from "@/lib/state/youtube-workspace-store";
import { formatDate } from "@/lib/utils/format";

/* ═══════════════════════════════════════════════════════════════════════════
   Playlist Explorer Workspace
   ──────────────────────────────────────────────────────────────────────────
   Fetches a playlist manifest via the server-side YouTube adapter, stores
   it in Zustand, then provides local-only filtering, sorting, search-inside-
   playlist, order-preserving list view, and AI analysis. Zero additional
   YouTube API calls are made from filter/sort/search interactions.
   ═══════════════════════════════════════════════════════════════════════════ */

interface PlaylistExplorerWorkspaceProps {
  /** Playlist ID or URL passed from the route segment */
  playlistId: string;
}

/** Items-per-page for local pagination */
const PAGE_SIZE = 24;

export function PlaylistExplorerWorkspace({
  playlistId,
}: PlaylistExplorerWorkspaceProps) {
  /* ──── State ──────────────────────────────────────────────────────────── */
  const [manifest, setManifest] = useState<YouTubeManifest | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<YouTubeResultFilters>({
    ...DEFAULT_YOUTUBE_RESULT_FILTERS,
    sort: "api_order",
  });
  const [selectedItem, setSelectedItem] =
    useState<NormalizedYouTubeDiscoveryItem | null>(null);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [viewMode, setViewMode] = useState<"list" | "grid">("list");
  const [currentPlayIndex, setCurrentPlayIndex] = useState<number | null>(null);

  const setCurrentManifest = useYouTubeWorkspaceStore(
    (s) => s.setCurrentManifest,
  );
  const fetchSettings = useYouTubeWorkspaceStore((s) => s.fetchSettings);

  /* ──── Playlist metadata (first item in manifest is the playlist) ──── */
  const playlistItem = useMemo(
    () =>
      manifest?.normalizedItems.find((item) => item.itemType === "playlist") ??
      null,
    [manifest],
  );

  /* ──── Video items only (exclude playlist item) ────────────────────── */
  const videoItems = useMemo(
    () =>
      manifest?.normalizedItems.filter(
        (item) => item.itemType !== "playlist",
      ) ?? [],
    [manifest],
  );

  /* ──── Filtered + sorted items (LOCAL ONLY) ────────────────────────── */
  const filteredItems = useMemo(
    () => applyYouTubeResultPipeline(videoItems, filters),
    [videoItems, filters],
  );

  /* ──── Paginated view ─────────────────────────────────────────────── */
  const visibleItems = useMemo(
    () => filteredItems.slice(0, visibleCount),
    [filteredItems, visibleCount],
  );

  /* ──── Fetch playlist items manifest ─────────────────────────────── */
  const fetchPlaylist = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/youtube/playlist/items/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          input: playlistId,
          maxPages: fetchSettings.maxPages,
          maxItems: fetchSettings.maxItems,
        }),
      });

      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(
          (body as { message?: string }).message ??
            `Playlist fetch failed (${response.status})`,
        );
      }

      const payload = (await response.json()) as YouTubeManifest;
      startTransition(() => {
        setManifest(payload);
        setCurrentManifest(payload);
      });
    } catch (err) {
      startTransition(() => setError(err instanceof Error ? err.message : "Unknown error"));
    } finally {
      startTransition(() => setLoading(false));
    }
  }, [playlistId, setCurrentManifest, fetchSettings]);

  /* ──── Auto-fetch on mount ───────────────────────────────────────── */
  useEffect(() => {
    void fetchPlaylist();
  }, [fetchPlaylist]);

  /* ──── Export manifest helpers ────────────────────────────────────── */
  function exportManifest(format: "json" | "ndjson") {
    if (!manifest) return;
    const content =
      format === "json"
        ? JSON.stringify(manifest, null, 2)
        : manifest.normalizedItems
            .map((item) => JSON.stringify(item))
            .join("\n");
    const blob = new Blob([content], {
      type:
        format === "json" ? "application/json" : "application/x-ndjson",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${manifest.manifestId}.${format}`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  /* ──── Play next navigation ──────────────────────────────────────── */
  function playNext() {
    if (currentPlayIndex === null) {
      setCurrentPlayIndex(0);
    } else if (currentPlayIndex < filteredItems.length - 1) {
      setCurrentPlayIndex(currentPlayIndex + 1);
    }
  }

  /* ──── Loading state ─────────────────────────────────────────────── */
  if (loading && !manifest) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 py-24">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="text-sm text-muted">
          Fetching playlist items via official YouTube API…
        </p>
        <p className="text-xs text-muted">
          Building structured manifest preserving original order
        </p>
      </div>
    );
  }

  /* ──── Error state ───────────────────────────────────────────────── */
  if (error && !manifest) {
    return (
      <div className="space-y-4">
        <Card className="border-danger/30">
          <CardHeader title="Playlist fetch failed" eyebrow="Error" />
          <p className="text-sm text-danger">{error}</p>
          <Button className="mt-4" onClick={fetchPlaylist}>
            <RefreshCw className="h-4 w-4" />
            Retry
          </Button>
        </Card>
      </div>
    );
  }

  if (!manifest) return null;

  /* ──── Main workspace ────────────────────────────────────────────── */
  return (
    <div className="space-y-6">
      {/* ── Playlist header ───────────────────────────────────────────── */}
      <Card className="overflow-hidden p-0">
        <div className="h-24 bg-gradient-to-r from-ai/20 via-ai/10 to-primary/10 sm:h-32" />
        <div className="relative px-5 pb-5">
          <div className="-mt-8 flex flex-col gap-4 sm:-mt-10 sm:flex-row sm:items-end">
            <div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-xl border-4 border-surface bg-surface-muted sm:h-24 sm:w-24">
              {playlistItem?.thumbnailUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={playlistItem.thumbnailUrl}
                  alt=""
                  className="h-full w-full object-cover"
                />
              ) : (
                <ListVideo className="h-8 w-8 text-muted" />
              )}
            </div>
            <div className="min-w-0 flex-1 pb-1">
              <h1 className="truncate text-2xl font-bold text-foreground sm:text-3xl">
                {playlistItem?.title ?? `Playlist ${playlistId}`}
              </h1>
              <div className="mt-1 flex flex-wrap items-center gap-3 text-sm text-muted">
                {playlistItem?.channelTitle && (
                  <Badge>{playlistItem.channelTitle}</Badge>
                )}
                {playlistItem?.publishedAt && (
                  <Badge>Created {formatDate(playlistItem.publishedAt)}</Badge>
                )}
                <Badge tone="ai">{videoItems.length} items</Badge>
              </div>
              {playlistItem?.description && (
                <p className="mt-2 line-clamp-2 text-sm text-muted">
                  {playlistItem.description}
                </p>
              )}
            </div>
            <div className="flex shrink-0 gap-2">
              <a
                href={playlistItem?.url ?? `https://www.youtube.com/playlist?list=${playlistId}`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex h-10 items-center gap-2 rounded-lg border border-border bg-surface px-4 text-sm text-muted transition hover:bg-surface-muted hover:text-foreground"
              >
                <ExternalLink className="h-4 w-4" />
                YouTube
              </a>
              <Button
                variant="secondary"
                onClick={fetchPlaylist}
                disabled={loading}
              >
                <RefreshCw
                  className={`h-4 w-4 ${loading ? "animate-spin" : ""}`}
                />
                Refresh
              </Button>
            </div>
          </div>
        </div>
      </Card>

      {/* ── Manifest summary ──────────────────────────────────────────── */}
      <div className="workspace-grid-12">
        <div className="col-span-12 xl:col-span-8">
          <ManifestSummary manifest={manifest} />
        </div>
        <div className="col-span-12 xl:col-span-4">
          <Card>
            <CardHeader
              title="Playlist manifest"
              eyebrow="Order-preserving manifest"
            />
            <p className="text-sm text-muted">
              All {videoItems.length} playlist items are stored locally with
              original position order preserved. Filters and sorting are local
              only.
            </p>
            {manifest.warnings.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-2">
                {manifest.warnings.map((w) => (
                  <Badge key={w.code} tone="warning">
                    {w.message}
                  </Badge>
                ))}
              </div>
            )}
          </Card>
        </div>
      </div>

      {/* ── Filter + Results + AI Grid ────────────────────────────────── */}
      <section className="workspace-grid-12 items-start">
        {/* ── Advanced Filters Panel ─────────────────────────────────── */}
        <AdvancedFiltersPanel
          filters={filters}
          onFiltersChange={(f) => { setFilters(f); setVisibleCount(PAGE_SIZE); }}
          totalCount={videoItems.length}
          filteredCount={filteredItems.length}
          defaultSort="api_order"
          searchPlaceholder="Search inside playlist…"
          showTypeFilters={false}
        />

        {/* ── Results area ────────────────────────────────────────────── */}
        <div className="col-span-12 space-y-4 xl:col-span-6">
          {/* Results toolbar */}
          <div className="research-surface p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-xs text-muted">
                <Filter className="h-3.5 w-3.5" />
                local search → local filters → local sort → render
              </div>
              <div className="flex gap-2">
                <button
                  className={`rounded px-2 py-1 text-xs ${viewMode === "list" ? "bg-primary-soft text-primary" : "text-muted hover:text-foreground"}`}
                  onClick={() => setViewMode("list")}
                >
                  List
                </button>
                <button
                  className={`rounded px-2 py-1 text-xs ${viewMode === "grid" ? "bg-primary-soft text-primary" : "text-muted hover:text-foreground"}`}
                  onClick={() => setViewMode("grid")}
                >
                  Grid
                </button>
              </div>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <Badge tone="success">
                Showing {filteredItems.length} of {videoItems.length} results
              </Badge>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button
                variant="secondary"
                onClick={() => exportManifest("json")}
              >
                <Download className="h-4 w-4" />
                Export JSON
              </Button>
              <Button
                variant="secondary"
                onClick={() => exportManifest("ndjson")}
              >
                <Download className="h-4 w-4" />
                Export NDJSON
              </Button>
              <Button variant="secondary">
                <Save className="h-4 w-4" />
                Save manifest
              </Button>
              <Button variant="ai" onClick={playNext}>
                <SkipForward className="h-4 w-4" />
                Play next
              </Button>
            </div>
          </div>

          {/* Currently playing indicator */}
          {currentPlayIndex !== null && filteredItems[currentPlayIndex] && (
            <Card className="border-ai/30">
              <div className="flex items-center gap-3">
                <Badge tone="ai">Now playing</Badge>
                <span className="truncate text-sm font-medium text-foreground">
                  #{currentPlayIndex + 1}{" "}
                  {filteredItems[currentPlayIndex].title}
                </span>
                <a
                  href={filteredItems[currentPlayIndex].url}
                  target="_blank"
                  rel="noreferrer"
                  className="ml-auto text-sm text-ai hover:underline"
                >
                  Open →
                </a>
              </div>
            </Card>
          )}

          {/* Items - list or grid */}
          {viewMode === "list" ? (
            <div className="space-y-2">
              {visibleItems.map((item, index) => (
                <PlaylistListItem
                  key={`${item.itemType}-${item.platformItemId}`}
                  item={item}
                  index={index}
                  isPlaying={
                    currentPlayIndex !== null &&
                    filteredItems[currentPlayIndex]?.platformItemId ===
                      item.platformItemId
                  }
                  onPlay={() => {
                    const realIndex = filteredItems.findIndex(
                      (fi) => fi.platformItemId === item.platformItemId,
                    );
                    setCurrentPlayIndex(realIndex >= 0 ? realIndex : null);
                  }}
                  onAiExplore={setSelectedItem}
                />
              ))}
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              {visibleItems.map((item) => (
                <YouTubeItemCard
                  key={`${item.itemType}-${item.platformItemId}`}
                  item={item}
                  onAiExplore={setSelectedItem}
                />
              ))}
            </div>
          )}

          {/* Load more */}
          {visibleCount < filteredItems.length && (
            <div className="flex justify-center">
              <Button
                variant="secondary"
                onClick={() => setVisibleCount((c) => c + PAGE_SIZE)}
              >
                Load more ({filteredItems.length - visibleCount} remaining)
              </Button>
            </div>
          )}

          {filteredItems.length === 0 && (
            <Card>
              <p className="py-8 text-center text-sm text-muted">
                No items match the current filters. Try adjusting or resetting
                the filter criteria.
              </p>
            </Card>
          )}
        </div>

        {/* ── AI sidebar ──────────────────────────────────────────────── */}
        <div className="col-span-12 xl:col-span-3">
          <AiAssistantPanel
            manifest={manifest}
            selectedItem={selectedItem}
          />
        </div>
      </section>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   Playlist List Item — compact row view preserving original playlist order.
   Includes position number, thumbnail, title, duration, views, and actions.
   ═══════════════════════════════════════════════════════════════════════════ */
function PlaylistListItem({
  item,
  index,
  isPlaying,
  onPlay,
  onAiExplore,
}: {
  item: NormalizedYouTubeDiscoveryItem;
  index: number;
  isPlaying: boolean;
  onPlay: () => void;
  onAiExplore: (item: NormalizedYouTubeDiscoveryItem) => void;
}) {
  const position = item.playlistPosition ?? index;

  return (
    <div
      className={`research-surface flex items-center gap-3 p-3 transition ${isPlaying ? "border-ai/50 bg-ai-soft/20" : ""}`}
    >
      {/* Position number */}
      <span className="w-8 shrink-0 text-center font-mono text-xs text-muted">
        {position + 1}
      </span>

      {/* Thumbnail */}
      <div className="h-14 w-24 shrink-0 overflow-hidden rounded-md bg-surface-muted">
        {item.thumbnailUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={item.thumbnailUrl}
            alt=""
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="flex h-full items-center justify-center text-xs text-muted">
            No thumb
          </div>
        )}
      </div>

      {/* Info */}
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-foreground">
          {item.title}
        </p>
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
          {item.channelTitle && <span>{item.channelTitle}</span>}
          {item.durationSeconds !== null && (
            <Badge>
              {Math.floor(item.durationSeconds / 60)}:
              {String(item.durationSeconds % 60).padStart(2, "0")}
            </Badge>
          )}
          {item.viewsCount !== null && (
            <Badge>
              {Intl.NumberFormat("en", {
                notation: item.viewsCount >= 10000 ? "compact" : "standard",
              }).format(item.viewsCount)}{" "}
              views
            </Badge>
          )}
          {item.publishedAt && (
            <span>{formatDate(item.publishedAt)}</span>
          )}
        </div>
      </div>

      {/* Actions */}
      <div className="flex shrink-0 gap-1">
        <button
          className="rounded-lg p-2 text-muted hover:bg-surface-muted hover:text-foreground"
          title="Play"
          onClick={onPlay}
        >
          <SkipForward className="h-4 w-4" />
        </button>
        <button
          className="rounded-lg p-2 text-ai hover:bg-ai-soft/30"
          title="AI Explore"
          onClick={() => onAiExplore(item)}
        >
          <ListVideo className="h-4 w-4" />
        </button>
        <a
          href={item.url}
          target="_blank"
          rel="noreferrer"
          className="rounded-lg p-2 text-muted hover:bg-surface-muted hover:text-foreground"
          title="Open on YouTube"
        >
          <ExternalLink className="h-4 w-4" />
        </a>
      </div>
    </div>
  );
}
