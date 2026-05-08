"use client";

import { AlertTriangle, Download, Filter, Loader2, Save, Search, X } from "lucide-react";
import { useMemo, useState } from "react";
import type { YouTubeManifest } from "@/types/manifest";
import type {
  NormalizedYouTubeDiscoveryItem,
  YouTubeResultFilters,
  YouTubeSearchResourceSelection,
  YouTubeSearchSettings,
} from "@/types/youtube";
import { DEFAULT_YOUTUBE_RESULT_FILTERS } from "@/types/youtube";
import { AiAssistantPanel } from "@/components/ai/ai-assistant-panel";
import { ManifestSummary } from "@/components/manifests/manifest-summary";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { YouTubeItemCard } from "@/components/youtube/youtube-item-card";
import { applyYouTubeResultPipeline } from "@/lib/filters/youtube-result-filters";
import { useYouTubeWorkspaceStore } from "@/lib/state/youtube-workspace-store";

/* ═══════════════════════════════════════════════════════════════════════════
   Search Workspace — Primary YouTube Discovery Interface
   ──────────────────────────────────────────────────────────────────────────
   Provider search bar → YouTube API call → normalized manifest → local
   filter/sort/search → render cards + AI panel. All filtering after the
   initial fetch is LOCAL ONLY — zero additional YouTube API calls.
   ═══════════════════════════════════════════════════════════════════════════ */

const initialSettings: YouTubeSearchSettings = {
  query: "",
  types: ["video"],
  pageSize: 25,
  maxPages: 3,
  maxItems: 150,
};

/** Items-per-page for local pagination of results */
const PAGE_SIZE = 24;

export function SearchWorkspace() {
  const [settings, setSettings] = useState<YouTubeSearchSettings>(initialSettings);
  const [resourceSelection, setResourceSelection] = useState<YouTubeSearchResourceSelection>("ALL");
  const [filters, setFilters] = useState<YouTubeResultFilters>({ ...DEFAULT_YOUTUBE_RESULT_FILTERS, sort: "latest" });
  const [manifest, setManifest] = useState<YouTubeManifest | null>(null);
  const [selectedItem, setSelectedItem] = useState<NormalizedYouTubeDiscoveryItem | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  const setCurrentManifest = useYouTubeWorkspaceStore((s) => s.setCurrentManifest);

  const filteredItems = useMemo(
    () => applyYouTubeResultPipeline(manifest?.normalizedItems ?? [], filters),
    [manifest?.normalizedItems, filters],
  );
  const visibleItems = useMemo(() => filteredItems.slice(0, visibleCount), [filteredItems, visibleCount]);

  const activeChips = [
    filters.keyword ? `Keyword: ${filters.keyword}` : null,
    filters.channelName ? `Channel: ${filters.channelName}` : null,
    filters.language ? `Language: ${filters.language}` : null,
    filters.shortsLikeOnly ? "Shorts-like only" : null,
  ].filter(Boolean) as string[];

  async function runSearch() {
    if (!settings.query.trim()) return;
    setLoading(true);
    setError(null);
    setVisibleCount(PAGE_SIZE);

    try {
      const nextTypes = resourceSelection === "ALL" ? ["video", "channel", "playlist"] : [resourceSelection];
      const response = await fetch("/api/youtube/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...settings, types: nextTypes }),
      });

      const payload = await response.json();

      if (!response.ok) {
        const msg = (payload as { message?: string }).message ?? `Search failed (${response.status})`;
        setError(msg);
        return;
      }

      const newManifest = payload as YouTubeManifest;
      setManifest(newManifest);
      setCurrentManifest(newManifest);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* ── Provider Search Bar ──────────────────────────────────────── */}
      <section className="workspace-grid-12">
        <Card className="col-span-12 xl:col-span-8">
          <CardHeader
            title="YouTube provider search"
            eyebrow="Provider call happens only on Search/Enter"
          />
          <form
            className="grid gap-3 md:grid-cols-[minmax(0,1fr)_12rem_10rem]"
            onSubmit={(e) => {
              e.preventDefault();
              void runSearch();
            }}
          >
            <input
              className="h-11 rounded-lg border border-border bg-surface px-3 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--ring)]"
              value={settings.query}
              onChange={(e) => setSettings((c) => ({ ...c, query: e.target.value }))}
              placeholder="Search YouTube videos, channels, playlists…"
            />
            <select
              className="h-11 rounded-lg border border-border bg-surface px-3 text-sm"
              value={resourceSelection}
              onChange={(e) => setResourceSelection(e.target.value as YouTubeSearchResourceSelection)}
            >
              <option value="ALL">ALL</option>
              <option value="video">Videos</option>
              <option value="channel">Channels</option>
              <option value="playlist">Playlists</option>
            </select>
            <Button type="submit" className="h-11" disabled={loading || !settings.query.trim()}>
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
              Search
            </Button>
          </form>
        </Card>
        <div className="col-span-12 xl:col-span-4">
          {manifest ? (
            <ManifestSummary manifest={manifest} />
          ) : (
            <Card>
              <CardHeader title="No manifest" eyebrow="Waiting for search" />
              <p className="text-sm text-muted">
                Enter a query and press Search to fetch real YouTube metadata via the official API.
              </p>
            </Card>
          )}
        </div>
      </section>

      {/* ── Error Display ────────────────────────────────────────────── */}
      {error && (
        <Card className="border-danger/30">
          <div className="flex items-start gap-3">
            <AlertTriangle className="h-5 w-5 shrink-0 text-danger" />
            <div>
              <p className="text-sm font-medium text-danger">Search failed</p>
              <p className="mt-1 text-sm text-muted">{error}</p>
            </div>
          </div>
        </Card>
      )}

      {/* ── Loading State ────────────────────────────────────────────── */}
      {loading && (
        <div className="flex items-center justify-center gap-3 py-12">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
          <p className="text-sm text-muted">Fetching from YouTube Data API v3…</p>
        </div>
      )}

      {/* ── Empty State ──────────────────────────────────────────────── */}
      {!manifest && !loading && !error && (
        <Card>
          <div className="flex flex-col items-center gap-4 py-12 text-center">
            <Search className="h-12 w-12 text-muted/40" />
            <div>
              <p className="text-lg font-medium text-foreground">Ready to discover</p>
              <p className="mt-1 text-sm text-muted">
                Type a search query above and press <kbd className="rounded border border-border bg-surface-muted px-1.5 py-0.5 text-xs">Enter</kbd> to fetch real YouTube data via the official API.
              </p>
            </div>
          </div>
        </Card>
      )}

      {/* ── Filters + Results + AI Grid ──────────────────────────────── */}
      {manifest && !loading && (
        <section className="workspace-grid-12 items-start">
          <Card className="col-span-12 xl:col-span-3">
            <CardHeader title="Local filters" eyebrow="Search inside results (no API calls)" />
            <div className="space-y-2">
              <input
                className="h-10 w-full rounded-lg border border-border bg-surface px-3 text-sm"
                placeholder="Search inside results (no API calls)"
                value={filters.keyword}
                onChange={(e) => setFilters((c) => ({ ...c, keyword: e.target.value }))}
              />
              <input
                className="h-10 w-full rounded-lg border border-border bg-surface px-3 text-sm"
                placeholder="Channel name"
                value={filters.channelName ?? ""}
                onChange={(e) => setFilters((c) => ({ ...c, channelName: e.target.value || null }))}
              />
              <input
                className="h-10 w-full rounded-lg border border-border bg-surface px-3 text-sm"
                placeholder="Language"
                value={filters.language ?? ""}
                onChange={(e) => setFilters((c) => ({ ...c, language: e.target.value || null }))}
              />
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={filters.shortsLikeOnly}
                  onChange={(e) => setFilters((c) => ({ ...c, shortsLikeOnly: e.target.checked }))}
                />
                Shorts-like only
              </label>
              <select
                className="h-10 w-full rounded-lg border border-border bg-surface px-3 text-sm"
                value={filters.sort}
                onChange={(e) => setFilters((c) => ({ ...c, sort: e.target.value as YouTubeResultFilters["sort"] }))}
              >
                <option value="latest">newest</option>
                <option value="oldest">oldest</option>
                <option value="most_views">most views</option>
                <option value="least_views">least views</option>
                <option value="most_likes">most likes</option>
                <option value="shortest">shortest</option>
                <option value="longest">longest</option>
                <option value="title_az">A-Z</option>
              </select>
            </div>
          </Card>

          <div className="col-span-12 space-y-4 xl:col-span-6">
            <div className="research-surface p-4">
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
                <Filter className="h-3.5 w-3.5" />
                local search → local filters → local sort → render
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {activeChips.map((chip) => (
                  <Badge key={chip}>
                    {chip}
                    <button className="ml-1" aria-label="clear">
                      <X className="h-3 w-3" />
                    </button>
                  </Badge>
                ))}
                <Badge tone="success">{filteredItems.length} results</Badge>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button variant="secondary" onClick={() => exportManifest(manifest, "json")}>
                  <Download className="h-4 w-4" />
                  Export JSON
                </Button>
                <Button variant="secondary" onClick={() => exportManifest(manifest, "ndjson")}>
                  <Download className="h-4 w-4" />
                  Export NDJSON
                </Button>
                <Button variant="secondary">
                  <Save className="h-4 w-4" />
                  Save manifest
                </Button>
              </div>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              {visibleItems.map((item) => (
                <YouTubeItemCard
                  key={`${item.itemType}-${item.platformItemId}`}
                  item={item}
                  onAiExplore={setSelectedItem}
                />
              ))}
            </div>
            {/* Load more pagination */}
            {visibleCount < filteredItems.length && (
              <div className="flex justify-center">
                <Button variant="secondary" onClick={() => setVisibleCount((c) => c + PAGE_SIZE)}>
                  Load more ({filteredItems.length - visibleCount} remaining)
                </Button>
              </div>
            )}
            {filteredItems.length === 0 && (
              <Card>
                <p className="py-8 text-center text-sm text-muted">
                  No items match the current filters. Try adjusting or resetting.
                </p>
              </Card>
            )}
          </div>
          <div className="col-span-12 xl:col-span-3">
            <AiAssistantPanel manifest={manifest} selectedItem={selectedItem} />
          </div>
        </section>
      )}
    </div>
  );
}

function exportManifest(manifest: YouTubeManifest, format: "json" | "ndjson") {
  const content =
    format === "json"
      ? JSON.stringify(manifest, null, 2)
      : manifest.normalizedItems.map((item) => JSON.stringify(item)).join("\n");
  const blob = new Blob([content], {
    type: format === "json" ? "application/json" : "application/x-ndjson",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${manifest.manifestId}.${format}`;
  anchor.click();
  URL.revokeObjectURL(url);
}
