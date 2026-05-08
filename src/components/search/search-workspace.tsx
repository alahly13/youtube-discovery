"use client";

import { Download, Filter, Loader2, Search } from "lucide-react";
import { useMemo, useState } from "react";
import type { YouTubeManifest } from "@/types/manifest";
import type { NormalizedYouTubeDiscoveryItem, YouTubeResultFilters, YouTubeSearchSettings } from "@/types/youtube";
import { DEFAULT_YOUTUBE_RESULT_FILTERS } from "@/types/youtube";
import { AiAssistantPanel } from "@/components/ai/ai-assistant-panel";
import { ManifestSummary } from "@/components/manifests/manifest-summary";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { YouTubeItemCard } from "@/components/youtube/youtube-item-card";
import { sampleManifest } from "@/lib/demo/sample-data";
import { applyYouTubeResultPipeline } from "@/lib/filters/youtube-result-filters";

const initialSettings: YouTubeSearchSettings = {
  query: "ai agents 2026",
  types: ["video"],
  pageSize: 25,
  maxPages: 2,
  maxItems: 50,
  order: "relevance",
  safeSearch: "moderate",
  videoDuration: "any",
  videoDefinition: "any",
  videoCaption: "any",
  videoEmbeddable: "any",
};

export function SearchWorkspace() {
  const [settings, setSettings] = useState<YouTubeSearchSettings>(initialSettings);
  const [filters, setFilters] = useState<YouTubeResultFilters>(DEFAULT_YOUTUBE_RESULT_FILTERS);
  const [manifest, setManifest] = useState<YouTubeManifest>(sampleManifest);
  const [selectedItem, setSelectedItem] = useState<NormalizedYouTubeDiscoveryItem | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const filteredItems = useMemo(() => applyYouTubeResultPipeline(manifest.normalizedItems, filters), [manifest, filters]);

  async function runSearch() {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/youtube/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings),
      });
      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload.message ?? "Search failed.");
      }

      setManifest(payload as YouTubeManifest);
      setSelectedItem(null);
    } catch (searchError) {
      setError(searchError instanceof Error ? searchError.message : "Search failed.");
    } finally {
      setLoading(false);
    }
  }

  function exportManifest(format: "json" | "ndjson") {
    const content =
      format === "json"
        ? JSON.stringify(manifest, null, 2)
        : manifest.normalizedItems.map((item) => JSON.stringify(item)).join("\n");
    const blob = new Blob([content], { type: format === "json" ? "application/json" : "application/x-ndjson" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${manifest.manifestId}.${format === "json" ? "json" : "ndjson"}`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-6">
      <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_24rem]">
        <Card>
          <CardHeader title="Provider search settings" eyebrow="Calls YouTube only when Execute runs" />
          <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_12rem_10rem_10rem]">
            <label className="block">
              <span className="mb-1 block text-xs text-muted">Query</span>
              <input
                value={settings.query}
                onChange={(event) => setSettings((current) => ({ ...current, query: event.target.value }))}
                className="h-11 w-full rounded-lg border border-border bg-surface px-3 text-sm outline-none focus:ring-2 focus:ring-[var(--ring)]"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs text-muted">Resource type</span>
              <select
                value={settings.types[0]}
                onChange={(event) => setSettings((current) => ({ ...current, types: [event.target.value as "video" | "channel" | "playlist"] }))}
                className="h-11 w-full rounded-lg border border-border bg-surface px-3 text-sm outline-none focus:ring-2 focus:ring-[var(--ring)]"
              >
                <option value="video">Videos</option>
                <option value="channel">Channels</option>
                <option value="playlist">Playlists</option>
              </select>
            </label>
            <NumberInput
              label="Page size"
              value={settings.pageSize}
              min={1}
              max={50}
              onChange={(value) => {
                if (value !== null) {
                  setSettings((current) => ({ ...current, pageSize: value }));
                }
              }}
            />
            <NumberInput
              label="Max pages"
              value={settings.maxPages}
              min={1}
              max={10}
              onChange={(value) => {
                if (value !== null) {
                  setSettings((current) => ({ ...current, maxPages: value }));
                }
              }}
            />
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button variant="primary" onClick={runSearch} disabled={loading}>
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
              Execute provider search
            </Button>
            <Button variant="secondary" onClick={() => exportManifest("json")}>
              <Download className="h-4 w-4" />
              Export JSON
            </Button>
            <Button variant="secondary" onClick={() => exportManifest("ndjson")}>
              <Download className="h-4 w-4" />
              Export NDJSON
            </Button>
          </div>
          {error ? <p className="mt-3 rounded-lg border border-danger/30 bg-danger/10 p-3 text-sm text-danger">{error}</p> : null}
        </Card>
        <ManifestSummary manifest={manifest} />
      </section>

      <section className="grid gap-4 xl:grid-cols-[20rem_minmax(0,1fr)_24rem]">
        <Card>
          <CardHeader title="Local result filters" eyebrow="No provider calls" />
          <div className="space-y-3">
            <label className="block">
              <span className="mb-1 flex items-center gap-2 text-xs text-muted">
                <Filter className="h-3.5 w-3.5" />
                Search inside results
              </span>
              <input
                value={filters.keyword}
                onChange={(event) => setFilters((current) => ({ ...current, keyword: event.target.value }))}
                className="h-10 w-full rounded-lg border border-border bg-surface px-3 text-sm outline-none focus:ring-2 focus:ring-[var(--ring)]"
                placeholder="Title, channel, tags..."
              />
            </label>
            <NumberInput label="Min views" value={filters.minViews ?? ""} min={0} onChange={(value) => setFilters((current) => ({ ...current, minViews: value }))} />
            <NumberInput label="Max views" value={filters.maxViews ?? ""} min={0} onChange={(value) => setFilters((current) => ({ ...current, maxViews: value }))} />
            <NumberInput label="Min duration seconds" value={filters.durationMinSec ?? ""} min={0} onChange={(value) => setFilters((current) => ({ ...current, durationMinSec: value }))} />
            <label className="block">
              <span className="mb-1 block text-xs text-muted">Local sort</span>
              <select
                value={filters.sort}
                onChange={(event) => setFilters((current) => ({ ...current, sort: event.target.value as YouTubeResultFilters["sort"] }))}
                className="h-10 w-full rounded-lg border border-border bg-surface px-3 text-sm outline-none focus:ring-2 focus:ring-[var(--ring)]"
              >
                <option value="api_order">API order</option>
                <option value="latest">Latest</option>
                <option value="oldest">Oldest</option>
                <option value="most_views">Most views</option>
                <option value="least_views">Least views</option>
                <option value="shortest">Shortest</option>
                <option value="longest">Longest</option>
                <option value="title_az">Title A-Z</option>
              </select>
            </label>
            <label className="flex items-center gap-2 text-sm text-muted">
              <input
                type="checkbox"
                checked={filters.strictMetadata}
                onChange={(event) => setFilters((current) => ({ ...current, strictMetadata: event.target.checked }))}
              />
              Strict metadata mode
            </label>
          </div>
        </Card>

        <div className="space-y-4">
          <div className="research-surface flex flex-wrap items-center justify-between gap-3 p-4">
            <div>
              <p className="text-sm font-medium">Results pipeline</p>
              <p className="text-xs text-muted">local search {"->"} local filters {"->"} local sort {"->"} render</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Badge tone="success">Provider calls from filters: 0</Badge>
              <Badge>{filteredItems.length} shown</Badge>
              <Badge>{manifest.uniqueItemCount} collected</Badge>
            </div>
          </div>
          <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
            {filteredItems.map((item) => (
              <YouTubeItemCard key={`${item.itemType}-${item.platformItemId}`} item={item} onAiExplore={setSelectedItem} />
            ))}
          </div>
          {filteredItems.length === 0 ? (
            <div className="research-surface flex min-h-48 items-center justify-center p-6 text-center text-muted">
              No results match the current local filters. Adjust filters without spending YouTube quota.
            </div>
          ) : null}
        </div>

        <AiAssistantPanel manifest={manifest} selectedItem={selectedItem} />
      </section>
    </div>
  );
}

function NumberInput({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  value: number | "";
  min?: number;
  max?: number;
  onChange: (value: number | null) => void;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs text-muted">{label}</span>
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        onChange={(event) => onChange(event.target.value === "" ? null : Number(event.target.value))}
        className="h-10 w-full rounded-lg border border-border bg-surface px-3 text-sm outline-none focus:ring-2 focus:ring-[var(--ring)]"
      />
    </label>
  );
}
