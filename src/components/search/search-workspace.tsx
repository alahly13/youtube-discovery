"use client";

import { Download, Filter, Loader2, Save, Search, X } from "lucide-react";
import { useMemo, useState } from "react";
import type { YouTubeManifest } from "@/types/manifest";
import type { NormalizedYouTubeDiscoveryItem, YouTubeResultFilters, YouTubeSearchResourceSelection, YouTubeSearchSettings } from "@/types/youtube";
import { DEFAULT_YOUTUBE_RESULT_FILTERS } from "@/types/youtube";
import { AiAssistantPanel } from "@/components/ai/ai-assistant-panel";
import { ManifestSummary } from "@/components/manifests/manifest-summary";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { YouTubeItemCard } from "@/components/youtube/youtube-item-card";
import { sampleManifest } from "@/lib/demo/sample-data";
import { applyYouTubeResultPipeline } from "@/lib/filters/youtube-result-filters";

const initialSettings: YouTubeSearchSettings = { query: "ai agents 2026", types: ["video"], pageSize: 25, maxPages: 2, maxItems: 50 };

export function SearchWorkspace() {
  const [settings, setSettings] = useState<YouTubeSearchSettings>(initialSettings);
  const [resourceSelection, setResourceSelection] = useState<YouTubeSearchResourceSelection>("ALL");
  const [filters, setFilters] = useState<YouTubeResultFilters>({ ...DEFAULT_YOUTUBE_RESULT_FILTERS, sort: "latest" });
  const [manifest, setManifest] = useState<YouTubeManifest>(sampleManifest);
  const [selectedItem, setSelectedItem] = useState<NormalizedYouTubeDiscoveryItem | null>(null);
  const [loading, setLoading] = useState(false);

  const filteredItems = useMemo(() => applyYouTubeResultPipeline(manifest.normalizedItems, filters), [manifest.normalizedItems, filters]);
  const activeChips = [filters.keyword ? `Keyword: ${filters.keyword}` : null, filters.channelName ? `Channel: ${filters.channelName}` : null, filters.language ? `Language: ${filters.language}` : null, filters.shortsLikeOnly ? "Shorts-like only" : null].filter(Boolean) as string[];

  async function runSearch() {
    setLoading(true);
    const nextTypes = resourceSelection === "ALL" ? ["video", "channel", "playlist"] : [resourceSelection];
    const response = await fetch("/api/youtube/search", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...settings, types: nextTypes }) });
    const payload = await response.json();
    if (response.ok) setManifest(payload as YouTubeManifest);
    setLoading(false);
  }

  return <div className="space-y-6">
    <section className="workspace-grid-12">
      <Card className="col-span-12 xl:col-span-8"><CardHeader title="YouTube provider search" eyebrow="Primary search bar - provider call happens only on Search/Enter" />
        <form className="grid gap-3 md:grid-cols-[minmax(0,1fr)_12rem_10rem]" onSubmit={(e)=>{e.preventDefault(); void runSearch();}}>
          <input className="h-11 rounded-lg border border-border bg-surface px-3" value={settings.query} onChange={(e)=>setSettings((c)=>({...c,query:e.target.value}))} placeholder="Search YouTube videos, channels, playlists" />
          <select className="h-11 rounded-lg border border-border bg-surface px-3" value={resourceSelection} onChange={(e)=>setResourceSelection(e.target.value as YouTubeSearchResourceSelection)}><option value="ALL">ALL</option><option value="video">Videos</option><option value="channel">Channels</option><option value="playlist">Playlists</option></select>
          <Button type="submit" className="h-11" disabled={loading}>{loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}Search</Button>
        </form>
      </Card>
      <div className="col-span-12 xl:col-span-4"><ManifestSummary manifest={manifest} /></div>
    </section>

    <section className="workspace-grid-12 items-start">
      <Card className="col-span-12 xl:col-span-3"><CardHeader title="Local filters" eyebrow="Search inside results (no API calls)" />
        <div className="space-y-2">
          <input className="h-10 w-full rounded-lg border border-border bg-surface px-3" placeholder="Search inside results (no API calls)" value={filters.keyword} onChange={(e)=>setFilters((c)=>({...c,keyword:e.target.value}))} />
          <input className="h-10 w-full rounded-lg border border-border bg-surface px-3" placeholder="Channel name" value={filters.channelName ?? ""} onChange={(e)=>setFilters((c)=>({...c,channelName:e.target.value || null}))} />
          <input className="h-10 w-full rounded-lg border border-border bg-surface px-3" placeholder="Language" value={filters.language ?? ""} onChange={(e)=>setFilters((c)=>({...c,language:e.target.value || null}))} />
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={filters.shortsLikeOnly} onChange={(e)=>setFilters((c)=>({...c,shortsLikeOnly:e.target.checked}))} />Shorts-like only</label>
          <select className="h-10 w-full rounded-lg border border-border bg-surface px-3" value={filters.sort} onChange={(e)=>setFilters((c)=>({...c,sort:e.target.value as YouTubeResultFilters['sort']}))}><option value="latest">newest</option><option value="oldest">oldest</option><option value="most_views">most views</option><option value="least_views">least views</option><option value="most_likes">most likes</option><option value="shortest">shortest</option><option value="longest">longest</option><option value="title_az">A-Z</option></select>
        </div>
      </Card>

      <div className="col-span-12 space-y-4 xl:col-span-6">
        <div className="research-surface p-4"><div className="flex flex-wrap items-center gap-2 text-xs text-muted"><Filter className="h-3.5 w-3.5" />local search → local filters → local sort → render</div>
        <div className="mt-3 flex flex-wrap gap-2">{activeChips.map((chip)=><Badge key={chip}>{chip}<button className="ml-1" aria-label="clear"><X className="h-3 w-3"/></button></Badge>)}<Badge tone="success">{filteredItems.length} results</Badge></div>
        <div className="mt-3 flex flex-wrap gap-2"><Button variant="secondary" onClick={() => exportManifest(manifest, "json")}><Download className="h-4 w-4" />Export JSON</Button><Button variant="secondary" onClick={() => exportManifest(manifest, "ndjson")}><Download className="h-4 w-4" />Export NDJSON</Button><Button variant="secondary"><Save className="h-4 w-4" />Save manifest</Button></div></div>
        <div className="grid gap-4 md:grid-cols-2">{filteredItems.map((item)=><YouTubeItemCard key={`${item.itemType}-${item.platformItemId}`} item={item} onAiExplore={setSelectedItem} />)}</div>
      </div>
      <div className="col-span-12 xl:col-span-3"><AiAssistantPanel manifest={manifest} selectedItem={selectedItem} /></div>
    </section>
  </div>;
}

function exportManifest(manifest: YouTubeManifest, format: "json" | "ndjson") { const content = format === "json" ? JSON.stringify(manifest, null, 2) : manifest.normalizedItems.map((item) => JSON.stringify(item)).join("\n"); const blob = new Blob([content], { type: format === "json" ? "application/json" : "application/x-ndjson" }); const url = URL.createObjectURL(blob); const anchor = document.createElement("a"); anchor.href = url; anchor.download = `${manifest.manifestId}.${format}`; anchor.click(); URL.revokeObjectURL(url); }
