"use client";

import {
  Archive,
  Download,
  Filter,
  Loader2,
  Save,
  Search,
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
import { ManifestSummary } from "@/components/manifests/manifest-summary";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { YouTubeItemCard } from "@/components/youtube/youtube-item-card";
import { applyYouTubeResultPipeline } from "@/lib/filters/youtube-result-filters";

/* ═══════════════════════════════════════════════════════════════════════════
   Manifest Detail Workspace
   ──────────────────────────────────────────────────────────────────────────
   Fetches a specific manifest from the runtime memory store by manifestId,
   then provides local filtering, sorting, search-inside-manifest, export,
   and scoped AI analysis. All interactions are local-only.
   ═══════════════════════════════════════════════════════════════════════════ */

interface ManifestDetailWorkspaceProps {
  manifestId: string;
}

const PAGE_SIZE = 24;

export function ManifestDetailWorkspace({
  manifestId,
}: ManifestDetailWorkspaceProps) {
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

  const filteredItems = useMemo(
    () =>
      applyYouTubeResultPipeline(
        manifest?.normalizedItems ?? [],
        filters,
      ),
    [manifest, filters],
  );

  const visibleItems = useMemo(
    () => filteredItems.slice(0, visibleCount),
    [filteredItems, visibleCount],
  );

  const fetchManifest = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/youtube/manifests/${manifestId}`);
      if (!response.ok) {
        throw new Error(`Manifest not found (${response.status})`);
      }
      const payload = (await response.json()) as YouTubeManifest;
      startTransition(() => setManifest(payload));
    } catch (err) {
      startTransition(() => setError(err instanceof Error ? err.message : "Unknown error"));
    } finally {
      startTransition(() => setLoading(false));
    }
  }, [manifestId]);

  useEffect(() => {
    void fetchManifest();
  }, [fetchManifest]);

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

  if (loading && !manifest) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 py-24">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="text-sm text-muted">Loading manifest…</p>
      </div>
    );
  }

  if (error) {
    return (
      <Card className="border-danger/30">
        <CardHeader title="Manifest not found" eyebrow="Error" />
        <p className="text-sm text-danger">{error}</p>
        <p className="mt-2 text-xs text-muted">
          Runtime manifests exist only during the current server process.
          Durable persistence requires database migration to be applied.
        </p>
      </Card>
    );
  }

  if (!manifest) return null;

  return (
    <div className="space-y-6">
      {/* Header */}
      <Card>
        <div className="flex items-start gap-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary-soft text-primary">
            <Archive className="h-6 w-6" />
          </div>
          <div className="min-w-0 flex-1">
            <Badge tone="primary">{manifest.manifestType}</Badge>
            <h1 className="mt-2 text-2xl font-bold text-foreground">
              {manifest.title}
            </h1>
            <p className="mt-1 text-sm text-muted">
              Manifest ID: {manifest.manifestId}
            </p>
          </div>
        </div>
      </Card>

      <ManifestSummary manifest={manifest} />

      {/* Filters + Results + AI */}
      <section className="workspace-grid-12 items-start">
        <Card className="col-span-12 xl:col-span-3">
          <CardHeader
            title="Local filters"
            eyebrow="Search inside manifest"
          />
          <div className="space-y-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
              <input
                className="h-10 w-full rounded-lg border border-border bg-surface pl-9 pr-3 text-sm"
                placeholder="Search inside manifest…"
                value={filters.keyword}
                onChange={(e) =>
                  setFilters((c) => ({ ...c, keyword: e.target.value }))
                }
              />
            </div>
            <select
              className="h-9 w-full rounded-lg border border-border bg-surface px-3 text-sm"
              value={filters.sort}
              onChange={(e) =>
                setFilters((c) => ({
                  ...c,
                  sort: e.target.value as YouTubeResultFilters["sort"],
                }))
              }
            >
              <option value="api_order">Original order</option>
              <option value="latest">Newest first</option>
              <option value="oldest">Oldest first</option>
              <option value="most_views">Most views</option>
              <option value="least_views">Least views</option>
              <option value="title_az">Title A→Z</option>
            </select>
            <Button
              variant="ghost"
              className="w-full"
              onClick={() =>
                setFilters({
                  ...DEFAULT_YOUTUBE_RESULT_FILTERS,
                  sort: "api_order",
                })
              }
            >
              <X className="h-4 w-4" />
              Reset
            </Button>
          </div>
        </Card>

        <div className="col-span-12 space-y-4 xl:col-span-6">
          <div className="research-surface p-4">
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
              <Filter className="h-3.5 w-3.5" />
              {filteredItems.length} results from manifest
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
                Save
              </Button>
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            {visibleItems.map((item) => (
              <YouTubeItemCard
                key={`${item.itemType}-${item.platformItemId}`}
                item={item}
                onAiExplore={setSelectedItem}
              />
            ))}
          </div>
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
        </div>

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
