"use client";

import {
  Archive,
  ArrowLeft,
  Download,
  ExternalLink,
  Eye,
  FileCode,
  Film,
  Flame,
  Layers,
  ListVideo,
  Play,
  RefreshCw,
  Search,
  ShieldCheck,
  Tv,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { RawJsonInspectorDialog } from "@/components/saved/raw-json-inspector-dialog";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { formatCompactCount, formatDate, formatDuration } from "@/lib/utils/format";
import {
  classifyItemType,
  computeFilterSummary,
  filterEnvelopeItems,
  type OldItemFilterType,
} from "@/lib/old/archive-envelope";
import type { ArchivedManifestRecord } from "@/lib/old/archive-store";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * OLD Saved Items Workspace
 * ──────────────────────────────────────────────────────────────────────────
 * Scope: Workstream B / Saved Items — Phase 1.5
 * Dedicated historical saved items browser with the 4 canonical filters:
 * 1. VIDEO (non-Shorts)
 * 2. SHORTS (isShortsLike: true / shorts_like)
 * 3. CHANNELS
 * 4. PLAYLISTS
 * Includes authentic raw JSON inspection dialog and export download.
 * ═══════════════════════════════════════════════════════════════════════════
 */

export function OldSavedItemsWorkspace() {
  const [manifests, setManifests] = useState<ArchivedManifestRecord[]>([]);
  const [selectedManifestId, setSelectedManifestId] = useState<string>("ALL");
  const [items, setItems] = useState<Record<string, unknown>[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingItems, setLoadingItems] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [typeFilter, setTypeFilter] = useState<OldItemFilterType>("ALL");
  const [searchQuery, setSearchQuery] = useState("");
  const [inspectedItem, setInspectedItem] = useState<Record<string, unknown> | null>(null);

  // 1. Fetch manifests list
  useEffect(() => {
    async function loadManifestList() {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch("/api/old/list?category=saved-items");
        if (!res.ok) throw new Error("Failed to load saved-items archives.");
        const data = await res.json();
        const list: ArchivedManifestRecord[] = data.manifests || [];
        setManifests(list);
        if (list.length > 0) {
          setSelectedManifestId(list[0].id);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load archives.");
      } finally {
        setLoading(false);
      }
    }
    void loadManifestList();
  }, []);

  // 2. Fetch items when selected manifest changes
  useEffect(() => {
    async function loadSelectedManifestItems() {
      if (manifests.length === 0) {
        setItems([]);
        return;
      }

      setLoadingItems(true);
      setError(null);
      try {
        if (selectedManifestId === "ALL") {
          // Aggregate items across all manifests
          const allItems: Record<string, unknown>[] = [];
          for (const m of manifests.slice(0, 5)) {
            const res = await fetch(`/api/old/${m.id}`);
            if (res.ok) {
              const data = await res.json();
              if (data.envelope?.payload?.items) {
                allItems.push(...(data.envelope.payload.items as Record<string, unknown>[]));
              }
            }
          }
          setItems(allItems);
        } else {
          const res = await fetch(`/api/old/${selectedManifestId}`);
          if (!res.ok) throw new Error("Failed to load manifest items.");
          const data = await res.json();
          setItems((data.envelope?.payload?.items as Record<string, unknown>[]) || []);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load items.");
      } finally {
        setLoadingItems(false);
      }
    }

    if (selectedManifestId) {
      void loadSelectedManifestItems();
    }
  }, [selectedManifestId, manifests]);

  // Breakdown counts across the 4 filters
  const counts = useMemo(() => {
    const summary = computeFilterSummary(items);
    return {
      all: items.length,
      videos: summary.total_videos,
      shorts: summary.total_shorts,
      channels: summary.total_channels,
      playlists: summary.total_playlists,
    };
  }, [items]);

  // Filter items matching filter and search
  const filteredItems = useMemo(() => {
    let result = filterEnvelopeItems(items, typeFilter);

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter((item) => {
        const titleMatch = String(item.title || "").toLowerCase().includes(q);
        const channelMatch = String(item.channelTitle || "").toLowerCase().includes(q);
        const idMatch = String(item.platformItemId || item.videoId || item.id || "").toLowerCase().includes(q);
        return titleMatch || channelMatch || idMatch;
      });
    }

    return result;
  }, [items, typeFilter, searchQuery]);

  return (
    <div className="space-y-6">
      {/* Top Header & Breadcrumb */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2 mb-1.5">
            <Link
              href="/old"
              className="flex items-center gap-1 text-xs font-medium text-muted hover:text-foreground transition"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              <span>Back to OLD Archive</span>
            </Link>
            <span className="text-muted/60">•</span>
            <Badge tone="neutral" className="text-[10px] uppercase font-semibold">
              Category: Saved Items
            </Badge>
            <Badge tone="success" className="text-[10px] font-semibold">
              <ShieldCheck className="h-3 w-3 mr-1 inline" />
              Read-Only
            </Badge>
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">
            Archived Saved Items
          </h1>
          <p className="mt-1 text-xs text-muted max-w-2xl">
            Browse historical saved items preserved under <code className="font-mono text-primary text-[11px]">ASDY/OLD/</code>.
            These records are strictly isolated and do not modify your active Saved Items library.
          </p>
        </div>

        <div className="flex items-center gap-2">
          {selectedManifestId !== "ALL" && (
            <a
              href={`/api/old/${selectedManifestId}/download`}
              download
              className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border bg-surface px-3 text-xs font-medium text-foreground hover:bg-surface-muted transition"
            >
              <Download className="h-3.5 w-3.5" />
              <span>Download JSON</span>
            </a>
          )}
          <ButtonLink href="/old/import?category=saved-items" variant="primary" className="h-9 gap-1.5 px-3.5 text-xs">
            <span>Import Another File</span>
          </ButtonLink>
        </div>
      </div>

      {/* Manifest Selector Shelf */}
      {manifests.length > 0 && (
        <Card className="p-4 bg-surface-muted/30">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-2">
              <Archive className="h-4 w-4 text-primary" />
              <span className="text-xs font-semibold text-foreground">Archived File:</span>
              <select
                value={selectedManifestId}
                onChange={(e) => setSelectedManifestId(e.target.value)}
                className="h-8.5 rounded-lg border border-border bg-surface px-3 font-mono text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-[var(--ring)]"
              >
                {manifests.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.manifest_id} ({m.record_count.toLocaleString()} items • {formatDate(m.imported_at)})
                  </option>
                ))}
                {manifests.length > 1 && <option value="ALL">All Saved Items Combined ({counts.all} items)</option>}
              </select>
            </div>

            <div className="text-[11px] text-muted">
              Preserved in <code className="font-mono text-primary">ASDY/OLD/</code>
            </div>
          </div>
        </Card>
      )}

      {error && (
        <Card className="p-4 border-danger/30 bg-danger/5 text-xs text-danger">
          {error}
        </Card>
      )}

      {/* Filter and Search Bar */}
      <Card className="p-4">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          {/* 4 Explicit Filters */}
          <div className="flex flex-wrap items-center gap-1 rounded-lg border border-border/80 bg-surface-muted/50 p-1 text-xs">
            <button
              type="button"
              onClick={() => setTypeFilter("ALL")}
              className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 font-medium transition ${
                typeFilter === "ALL"
                  ? "bg-surface text-foreground shadow-xs font-semibold"
                  : "text-muted hover:text-foreground"
              }`}
            >
              <span>All</span>
              <span className="rounded-full bg-border/60 px-1.5 py-0.2 text-[10px] text-muted">
                {counts.all}
              </span>
            </button>
            <button
              type="button"
              onClick={() => setTypeFilter("VIDEO")}
              className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 font-medium transition ${
                typeFilter === "VIDEO"
                  ? "bg-surface text-foreground shadow-xs font-semibold"
                  : "text-muted hover:text-foreground"
              }`}
            >
              <Film className="h-3.5 w-3.5 text-primary" />
              <span>Videos</span>
              <span className="rounded-full bg-border/60 px-1.5 py-0.2 text-[10px] text-muted">
                {counts.videos}
              </span>
            </button>
            <button
              type="button"
              onClick={() => setTypeFilter("SHORTS")}
              className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 font-medium transition ${
                typeFilter === "SHORTS"
                  ? "bg-surface text-foreground shadow-xs font-semibold"
                  : "text-muted hover:text-foreground"
              }`}
            >
              <Flame className="h-3.5 w-3.5 text-red-500" />
              <span>Shorts</span>
              <span className="rounded-full bg-border/60 px-1.5 py-0.2 text-[10px] text-muted">
                {counts.shorts}
              </span>
            </button>
            <button
              type="button"
              onClick={() => setTypeFilter("CHANNELS")}
              className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 font-medium transition ${
                typeFilter === "CHANNELS"
                  ? "bg-surface text-foreground shadow-xs font-semibold"
                  : "text-muted hover:text-foreground"
              }`}
            >
              <Tv className="h-3.5 w-3.5 text-emerald-500" />
              <span>Channels</span>
              <span className="rounded-full bg-border/60 px-1.5 py-0.2 text-[10px] text-muted">
                {counts.channels}
              </span>
            </button>
            <button
              type="button"
              onClick={() => setTypeFilter("PLAYLISTS")}
              className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 font-medium transition ${
                typeFilter === "PLAYLISTS"
                  ? "bg-surface text-foreground shadow-xs font-semibold"
                  : "text-muted hover:text-foreground"
              }`}
            >
              <ListVideo className="h-3.5 w-3.5 text-indigo-500" />
              <span>Playlists</span>
              <span className="rounded-full bg-border/60 px-1.5 py-0.2 text-[10px] text-muted">
                {counts.playlists}
              </span>
            </button>
          </div>

          {/* Search Box */}
          <div className="relative w-full max-w-xs">
            <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search in archived items..."
              className="h-8.5 w-full rounded-lg border border-border bg-surface pl-9 pr-3 text-xs text-foreground placeholder:text-muted/70 focus:outline-none focus:ring-2 focus:ring-[var(--ring)]"
            />
          </div>
        </div>
      </Card>

      {/* Items Grid */}
      {loading || loadingItems ? (
        <Card className="flex items-center justify-center p-14 text-center">
          <RefreshCw className="h-6 w-6 text-primary animate-spin mb-2" />
          <span className="text-xs text-muted">Loading archived items...</span>
        </Card>
      ) : filteredItems.length > 0 ? (
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {filteredItems.map((rawItem, idx) => {
            const item = rawItem as Record<string, unknown>;
            const itemClassification = classifyItemType(item);
            const isChannel = itemClassification === "CHANNELS";
            const isPlaylist = itemClassification === "PLAYLISTS";
            const isShorts = itemClassification === "SHORTS";
            const isVideo = itemClassification === "VIDEO";

            const itemId = String(item.platformItemId || item.videoId || item.channelId || item.playlistId || item.id || `item_${idx}`);
            const targetUrl = item.url ? String(item.url) : item.videoId ? `https://www.youtube.com/watch?v=${item.videoId}` : undefined;
            const thumbUrl = item.thumbnailUrl ? String(item.thumbnailUrl) : item.thumbnail_url ? String(item.thumbnail_url) : null;
            const title = String(item.title || "Untitled Item");
            const channelTitle = item.channelTitle ? String(item.channelTitle) : null;
            const publishedAt = item.publishedAt ? String(item.publishedAt) : null;

            return (
              <Card
                key={`${itemClassification}-${itemId}-${idx}`}
                className="group relative flex flex-col overflow-hidden rounded-xl border border-border/80 bg-surface shadow-xs transition hover:border-border hover:shadow-md"
              >
                {/* Thumbnail */}
                <div className="relative aspect-video w-full overflow-hidden bg-surface-muted">
                  {thumbUrl ? (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img
                      src={thumbUrl}
                      alt={title}
                      className={`h-full w-full object-cover transition-transform duration-300 group-hover:scale-102 ${
                        isChannel ? "p-6 object-contain rounded-full max-h-36 mx-auto my-auto" : ""
                      }`}
                      loading="lazy"
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-muted">
                      {isChannel ? <Tv className="h-10 w-10 opacity-30" /> : <Play className="h-10 w-10 opacity-30" />}
                    </div>
                  )}

                  {/* Badge */}
                  <div className="absolute top-2.5 left-2.5 flex items-center gap-1.5">
                    {isChannel && (
                      <Badge tone="success" className="text-[10px] uppercase font-semibold">
                        Channel
                      </Badge>
                    )}
                    {isPlaylist && (
                      <Badge tone="ai" className="text-[10px] uppercase font-semibold">
                        Playlist
                      </Badge>
                    )}
                    {isShorts && (
                      <Badge tone="danger" className="text-[10px] uppercase font-semibold">
                        Shorts-like
                      </Badge>
                    )}
                    {isVideo && (
                      <Badge tone="neutral" className="text-[10px] uppercase font-semibold">
                        Video
                      </Badge>
                    )}
                  </div>

                  {/* Duration */}
                  {typeof item.durationSeconds === "number" && item.durationSeconds > 0 && (
                    <div className="absolute bottom-2 right-2 rounded bg-black/80 px-2 py-0.5 text-xs font-semibold text-white backdrop-blur-xs">
                      {formatDuration(item.durationSeconds)}
                    </div>
                  )}
                </div>

                {/* Body */}
                <div className="flex flex-1 flex-col p-4 sm:p-5">
                  <h4
                    className="line-clamp-2 text-base font-bold text-foreground leading-snug tracking-tight"
                    title={title}
                  >
                    {title}
                  </h4>

                  {channelTitle && (
                    <p className="mt-1.5 line-clamp-1 text-xs font-medium text-muted">
                      {channelTitle}
                    </p>
                  )}

                  {/* Metrics */}
                  <div className="mt-3 flex items-center gap-3 text-xs text-muted">
                    {typeof item.viewsCount === "number" && (
                      <span className="flex items-center gap-1 font-medium">
                        <Eye className="h-3.5 w-3.5 text-muted/70" />
                        {formatCompactCount(item.viewsCount)} views
                      </span>
                    )}
                    {publishedAt && (
                      <span className="ml-auto text-[11px] text-muted/80">
                        {formatDate(publishedAt)}
                      </span>
                    )}
                  </div>

                  {/* Footer Actions */}
                  <div className="mt-4 pt-3 flex items-center justify-between border-t border-border/60">
                    <div className="flex items-center gap-1">
                      {targetUrl && (
                        <a
                          href={targetUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex h-8 w-8 items-center justify-center rounded-lg text-muted hover:bg-surface-muted hover:text-foreground transition"
                          title="Open on YouTube"
                          aria-label="Open on YouTube"
                        >
                          <ExternalLink className="h-3.5 w-3.5" />
                        </a>
                      )}
                      <button
                        type="button"
                        onClick={() => setInspectedItem(item)}
                        className="flex h-8 w-8 items-center justify-center rounded-lg text-muted hover:bg-surface-muted hover:text-foreground transition"
                        title="Inspect Raw JSON Metadata"
                        aria-label="Inspect JSON"
                      >
                        <FileCode className="h-3.5 w-3.5" />
                      </button>
                    </div>

                    <span className="text-[10px] text-muted/70 font-mono">
                      ARCHIVED
                    </span>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      ) : (
        <Card className="flex flex-col items-center justify-center p-14 text-center">
          <Layers className="h-10 w-10 text-muted opacity-40 mb-3" />
          <h3 className="text-sm font-semibold text-foreground">No items match your filter</h3>
          <p className="mt-1 text-xs text-muted max-w-sm">
            {manifests.length === 0
              ? "You haven't imported any Saved Items manifests into the OLD Archive yet."
              : "Try switching filters or clearing your search query."}
          </p>
          {manifests.length === 0 && (
            <ButtonLink href="/old/import?category=saved-items" variant="primary" className="mt-4 h-8 gap-1.5 px-3 text-xs">
              <span>Import Saved Items</span>
            </ButtonLink>
          )}
        </Card>
      )}

      {/* Raw JSON Modal */}
      {inspectedItem ? (
        <RawJsonInspectorDialog
          item={inspectedItem}
          open={Boolean(inspectedItem)}
          onClose={() => setInspectedItem(null)}
          title="Archived Item Raw Metadata"
        />
      ) : null}
    </div>
  );
}
