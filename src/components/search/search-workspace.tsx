"use client";

import { Download, Filter, Loader2, Save, Search } from "lucide-react";
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
      const response = await fetch("/api/youtube/search", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(settings) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.message ?? "Search failed.");
      setManifest(payload as YouTubeManifest);
      setSelectedItem(null);
    } catch (searchError) {
      setError(searchError instanceof Error ? searchError.message : "Search failed.");
    } finally {
      setLoading(false);
    }
  }

  async function saveManifest() {
    await fetch(`/api/youtube/manifests/${manifest.manifestId}/save`, { method: "POST" });
    setManifest((current) => ({ ...current, saved: true }));
  }

  return (
    <div className="space-y-6">
      <section className="grid gap-4 xl:grid-cols-12">
        <Card className="xl:col-span-8">
          <CardHeader title="YouTube provider search" eyebrow="Calls YouTube only when you click Search or press Enter" />
          <form
            className="grid gap-3 md:grid-cols-[minmax(0,1fr)_13rem_10rem_10rem]"
            onSubmit={(e) => {
              e.preventDefault();
              void runSearch();
            }}
          >
            <input value={settings.query} onChange={(e) => setSettings((c) => ({ ...c, query: e.target.value }))} className="h-11 rounded-lg border border-border bg-surface px-3" placeholder="Search on YouTube..." />
            <select value={settings.types[0]} onChange={(e) => setSettings((c) => ({ ...c, types: [e.target.value as YouTubeSearchSettings["types"][number]] }))} className="h-11 rounded-lg border border-border bg-surface px-3">
              <option value="video">Videos</option><option value="channel">Channels</option><option value="playlist">Playlists</option>
            </select>
            <NumberInput label="Page size" value={settings.pageSize} min={1} max={50} onChange={(v) => v !== null && setSettings((c) => ({ ...c, pageSize: v }))} />
            <Button variant="primary" type="submit" disabled={loading} className="h-11">{loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}Search</Button>
          </form>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => exportManifest(manifest, "json")}><Download className="h-4 w-4" />Export JSON</Button>
            <Button variant="secondary" onClick={() => exportManifest(manifest, "ndjson")}><Download className="h-4 w-4" />Export NDJSON</Button>
            <Button variant="secondary" onClick={() => void saveManifest()}><Save className="h-4 w-4" />Save manifest</Button>
          </div>
          {error ? <p className="mt-3 rounded-lg border border-danger/30 bg-danger/10 p-3 text-sm text-danger">{error}</p> : null}
        </Card>
        <div className="xl:col-span-4"><ManifestSummary manifest={manifest} /></div>
      </section>

      <section className="grid gap-4 xl:grid-cols-12">
        <Card className="xl:col-span-3">
          <CardHeader title="Local filters" eyebrow="Search inside results (no API calls)" />
          <div className="space-y-3">
            <label className="block"><span className="mb-1 flex items-center gap-2 text-xs text-muted"><Filter className="h-3.5 w-3.5" />Keyword inside results</span><input value={filters.keyword} onChange={(e) => setFilters((c) => ({ ...c, keyword: e.target.value }))} className="h-10 w-full rounded-lg border border-border bg-surface px-3" placeholder="title, channel, tags" /></label>
            <NumberInput label="Min views" value={filters.minViews ?? ""} min={0} onChange={(v) => setFilters((c) => ({ ...c, minViews: v }))} />
            <NumberInput label="Max views" value={filters.maxViews ?? ""} min={0} onChange={(v) => setFilters((c) => ({ ...c, maxViews: v }))} />
            <select value={filters.sort} onChange={(e) => setFilters((c) => ({ ...c, sort: e.target.value as YouTubeResultFilters["sort"] }))} className="h-10 w-full rounded-lg border border-border bg-surface px-3">
              <option value="latest">Newest</option><option value="oldest">Oldest</option><option value="most_views">Most views</option><option value="least_views">Least views</option><option value="most_likes">Most likes</option><option value="shortest">Shortest</option><option value="longest">Longest</option><option value="title_az">A-Z</option>
            </select>
          </div>
        </Card>
        <div className="space-y-4 xl:col-span-6">
          <div className="research-surface flex flex-wrap items-center justify-between gap-2 p-4"><p className="text-xs text-muted">local search → local filters → local sort → render</p><div className="flex gap-2"><Badge tone="success">No filter API calls</Badge><Badge>{filteredItems.length} shown</Badge></div></div>
          <div className="grid gap-4 md:grid-cols-2">{filteredItems.map((item) => <YouTubeItemCard key={`${item.itemType}-${item.platformItemId}`} item={item} onAiExplore={setSelectedItem} />)}</div>
        </div>
        <div className="xl:col-span-3"><AiAssistantPanel manifest={manifest} selectedItem={selectedItem} /></div>
      </section>
    </div>
  );
}

function exportManifest(manifest: YouTubeManifest, format: "json" | "ndjson") { const content = format === "json" ? JSON.stringify(manifest, null, 2) : manifest.normalizedItems.map((item) => JSON.stringify(item)).join("\n"); const blob = new Blob([content], { type: format === "json" ? "application/json" : "application/x-ndjson" }); const url = URL.createObjectURL(blob); const anchor = document.createElement("a"); anchor.href = url; anchor.download = `${manifest.manifestId}.${format === "json" ? "json" : "ndjson"}`; anchor.click(); URL.revokeObjectURL(url); }

function NumberInput({ label, value, min, max, onChange }: { label: string; value: number | ""; min?: number; max?: number; onChange: (value: number | null) => void; }) {
  return <label className="block"><span className="mb-1 block text-xs text-muted">{label}</span><input type="number" value={value} min={min} max={max} onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))} className="h-10 w-full rounded-lg border border-border bg-surface px-3" /></label>;
}
