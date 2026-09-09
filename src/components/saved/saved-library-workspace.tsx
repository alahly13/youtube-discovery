"use client";

import {
  Bookmark,
  Check,
  Copy,
  ExternalLink,
  Film,
  Play,
  Search,
  Star,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useYouTubeWorkspaceStore } from "@/lib/state/youtube-workspace-store";
import { formatCount, formatDate, formatDuration } from "@/lib/utils/format";

/* ═══════════════════════════════════════════════════════════════════════════
   Saved Library Workspace
   ──────────────────────────────────────────────────────────────────────────
   Manages both saved YouTube items (videos, channels, playlists) and saved
   search titles/presets. Fully synchronized with the Zustand workspace store
   and localStorage persistence.
   ═══════════════════════════════════════════════════════════════════════════ */

const LEGACY_STORAGE_KEY = "youtube-discovery-saved-items";

export function SavedLibraryWorkspace() {
  const [activeTab, setActiveTab] = useState<"items" | "searches">("items");
  const [searchQuery, setSearchQuery] = useState("");
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const savedItems = useYouTubeWorkspaceStore((s) => s.savedItems);
  const toggleItemSaved = useYouTubeWorkspaceStore((s) => s.toggleItemSaved);
  const savedSearches = useYouTubeWorkspaceStore((s) => s.savedSearches);
  const deleteSavedSearch = useYouTubeWorkspaceStore((s) => s.deleteSavedSearch);
  const togglePinSavedSearch = useYouTubeWorkspaceStore((s) => s.togglePinSavedSearch);

  /* Migrate legacy saved items from old localStorage key if any */
  useEffect(() => {
    try {
      const raw = localStorage.getItem(LEGACY_STORAGE_KEY);
      if (raw) {
        const legacyItems = JSON.parse(raw);
        if (Array.isArray(legacyItems) && legacyItems.length > 0) {
          legacyItems.forEach((item) => {
            const exists = savedItems.some(
              (i) => i.platformItemId === item.platformItemId && i.itemType === item.itemType,
            );
            if (!exists) {
              toggleItemSaved(item);
            }
          });
        }
      }
    } catch {
      /* Ignore legacy parse failures */
    }
  }, [savedItems, toggleItemSaved]);

  /* Filtered Saved Items */
  const filteredItems = useMemo(() => {
    if (!searchQuery.trim()) return savedItems;
    const q = searchQuery.toLowerCase();
    return savedItems.filter(
      (item) =>
        item.title.toLowerCase().includes(q) ||
        item.channelTitle?.toLowerCase().includes(q) ||
        item.description?.toLowerCase().includes(q) ||
        item.tags.some((tag) => tag.toLowerCase().includes(q)),
    );
  }, [savedItems, searchQuery]);

  /* Filtered Saved Searches */
  const filteredSearches = useMemo(() => {
    const sorted = [...savedSearches].sort((a, b) => {
      if (a.isPinned && !b.isPinned) return -1;
      if (!a.isPinned && b.isPinned) return 1;
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });

    if (!searchQuery.trim()) return sorted;
    const q = searchQuery.toLowerCase();
    return sorted.filter(
      (s) =>
        s.title.toLowerCase().includes(q) ||
        s.query.toLowerCase().includes(q) ||
        s.notes?.toLowerCase().includes(q),
    );
  }, [savedSearches, searchQuery]);

  const handleCopyTitle = async (text: string, id: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 1800);
    } catch {
      /* Fallback if clipboard API is blocked */
    }
  };

  return (
    <div className="space-y-6">
      {/* Tab Navigation & Search */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2 rounded-lg border border-border bg-surface-muted/40 p-1">
          <button
            type="button"
            className={`flex items-center gap-2 rounded-md px-3 py-1.5 text-xs font-medium transition ${
              activeTab === "items"
                ? "bg-surface text-foreground shadow-xs"
                : "text-muted hover:text-foreground"
            }`}
            onClick={() => setActiveTab("items")}
          >
            <Film className="h-3.5 w-3.5" />
            <span>Saved Items</span>
            <Badge tone="primary" className="ml-1 px-1.5 py-0 text-[10px]">
              {savedItems.length}
            </Badge>
          </button>
          <button
            type="button"
            className={`flex items-center gap-2 rounded-md px-3 py-1.5 text-xs font-medium transition ${
              activeTab === "searches"
                ? "bg-surface text-foreground shadow-xs"
                : "text-muted hover:text-foreground"
            }`}
            onClick={() => setActiveTab("searches")}
          >
            <Bookmark className="h-3.5 w-3.5 text-primary" />
            <span>Saved Search Titles</span>
            <Badge tone="ai" className="ml-1 px-1.5 py-0 text-[10px]">
              {savedSearches.length}
            </Badge>
          </button>
        </div>

        {/* Search inside saved library */}
        <div className="relative min-w-[240px]">
          <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted" />
          <input
            className="h-9 w-full rounded-lg border border-border bg-surface pl-9 pr-3 text-xs focus:outline-none focus:ring-2 focus:ring-[var(--ring)]"
            placeholder={
              activeTab === "items"
                ? "Filter saved videos, channels, playlists…"
                : "Filter saved search titles & queries…"
            }
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
      </div>

      {/* Tab 1: Saved Items */}
      {activeTab === "items" && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap gap-2">
              <Badge tone="success">{savedItems.length} saved items</Badge>
              <Badge>
                {savedItems.filter((i) => i.itemType === "video" || i.itemType === "shorts_like").length} videos
              </Badge>
              <Badge>
                {savedItems.filter((i) => i.itemType === "channel").length} channels
              </Badge>
              <Badge>
                {savedItems.filter((i) => i.itemType === "playlist").length} playlists
              </Badge>
            </div>
          </div>

          {filteredItems.length === 0 ? (
            <Card>
              <p className="py-8 text-center text-sm text-muted">
                {savedItems.length === 0
                  ? "No saved items yet. Click the bookmark button on any video, channel, or playlist card to save items here."
                  : "No saved items match your filter."}
              </p>
            </Card>
          ) : (
            <div className="space-y-2">
              {filteredItems.map((item) => (
                <div
                  key={`${item.itemType}-${item.platformItemId}`}
                  className="research-surface flex items-center gap-3 p-3 transition hover:border-border/90"
                >
                  {/* Thumbnail */}
                  <div className="relative h-14 w-24 shrink-0 overflow-hidden rounded-md bg-surface-muted">
                    {item.thumbnailUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={item.thumbnailUrl}
                        alt=""
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <div className="flex h-full items-center justify-center">
                        <Bookmark className="h-4 w-4 text-muted" />
                      </div>
                    )}
                    {item.isAgeRestricted && (
                      <span className="absolute bottom-1 left-1 rounded bg-red-600/90 px-1 text-[9px] font-bold text-white">
                        18+
                      </span>
                    )}
                  </div>

                  {/* Info */}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-foreground" title={item.title}>
                      {item.title}
                    </p>
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted">
                      <Badge tone="neutral">{item.itemType}</Badge>
                      {item.isAgeRestricted && (
                        <Badge tone="danger">🔞 18+ Mature</Badge>
                      )}
                      {item.channelTitle && <span>{item.channelTitle}</span>}
                      {item.durationSeconds !== null && (
                        <span>{formatDuration(item.durationSeconds)}</span>
                      )}
                      {item.viewsCount !== null && (
                        <span>{formatCount(item.viewsCount, "views")}</span>
                      )}
                      {item.publishedAt && (
                        <span>{formatDate(item.publishedAt)}</span>
                      )}
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex shrink-0 items-center gap-1">
                    <button
                      type="button"
                      className="inline-flex items-center gap-1 rounded-lg p-2 text-muted hover:bg-surface-muted hover:text-foreground"
                      onClick={() => handleCopyTitle(item.title, item.platformItemId)}
                      title="Copy title"
                    >
                      {copiedId === item.platformItemId ? (
                        <Check className="h-4 w-4 text-success" />
                      ) : (
                        <Copy className="h-4 w-4" />
                      )}
                    </button>

                    {item.itemType === "channel" ? (
                      <Link
                        href={`/channels/${item.platformItemId}`}
                        className="rounded-lg p-2 text-muted hover:bg-surface-muted hover:text-foreground"
                        title="Explore channel"
                      >
                        <ExternalLink className="h-4 w-4" />
                      </Link>
                    ) : item.itemType === "playlist" ? (
                      <Link
                        href={`/playlists/${item.platformItemId}`}
                        className="rounded-lg p-2 text-muted hover:bg-surface-muted hover:text-foreground"
                        title="Explore playlist"
                      >
                        <ExternalLink className="h-4 w-4" />
                      </Link>
                    ) : (
                      <Link
                        href={`/watch/${item.platformItemId}`}
                        className="rounded-lg p-2 text-muted hover:bg-surface-muted hover:text-foreground"
                        title="Watch video"
                      >
                        <ExternalLink className="h-4 w-4" />
                      </Link>
                    )}

                    <button
                      type="button"
                      className="rounded-lg p-2 text-muted hover:bg-danger/10 hover:text-danger"
                      onClick={() => toggleItemSaved(item)}
                      title="Remove from saved"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Tab 2: Saved Searches */}
      {activeTab === "searches" && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-xs text-muted">
              {filteredSearches.length} saved search title{filteredSearches.length === 1 ? "" : "s"} preserved locally.
            </p>
            <Link href="/search">
              <Button variant="secondary" className="h-8 gap-1.5 px-3 text-xs">
                <Search className="h-3.5 w-3.5" />
                Open Search
              </Button>
            </Link>
          </div>

          {filteredSearches.length === 0 ? (
            <Card>
              <div className="flex flex-col items-center gap-3 py-10 text-center">
                <Bookmark className="h-10 w-10 text-muted/40" />
                <div>
                  <p className="text-sm font-medium text-foreground">No saved search titles yet</p>
                  <p className="mt-1 text-xs text-muted">
                    Go to the Search page, type a query, and click &quot;Save Search Title&quot; to bookmark search titles and parameters here.
                  </p>
                </div>
              </div>
            </Card>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {filteredSearches.map((s) => {
                const isCopied = copiedId === s.id;

                return (
                  <div
                    key={s.id}
                    className="research-surface flex flex-col justify-between rounded-xl border border-border/80 p-4 transition hover:border-primary/40 shadow-xs"
                  >
                    <div>
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <h4
                            className="truncate text-sm font-semibold text-foreground cursor-pointer hover:text-primary"
                            title={`${s.title} (click to copy)`}
                            onClick={() => handleCopyTitle(s.title, s.id)}
                          >
                            {s.title}
                          </h4>
                          <p className="mt-1 font-mono text-xs text-muted truncate" title={s.query}>
                            q: {s.query}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => togglePinSavedSearch(s.id)}
                          className="text-muted hover:text-warning"
                          title={s.isPinned ? "Unpin search" : "Pin to top"}
                        >
                          <Star className={`h-4 w-4 ${s.isPinned ? "fill-warning text-warning" : ""}`} />
                        </button>
                      </div>

                      {s.notes && (
                        <p className="mt-2 text-xs text-muted line-clamp-2 italic bg-surface-muted/50 p-2 rounded-md">
                          {s.notes}
                        </p>
                      )}

                      <div className="mt-3 flex flex-wrap items-center gap-1.5 text-[10px] text-muted">
                        <Badge className="text-[10px] uppercase">{s.resourceSelection}</Badge>
                        {s.settings?.safeSearch === "none" && (
                          <span className="rounded bg-emerald-500/10 px-1.5 py-0.5 text-emerald-600 dark:text-emerald-400 font-medium">
                            Unrestricted Mode
                          </span>
                        )}
                        <span>Saved {formatDate(s.createdAt)}</span>
                      </div>
                    </div>

                    <div className="mt-4 flex items-center justify-between border-t border-border/50 pt-3">
                      <button
                        type="button"
                        onClick={() => handleCopyTitle(s.title, s.id)}
                        className="inline-flex items-center gap-1 text-xs text-muted hover:text-foreground"
                        title="Copy search title"
                      >
                        {isCopied ? <Check className="h-3.5 w-3.5 text-success" /> : <Copy className="h-3.5 w-3.5" />}
                        <span>{isCopied ? "Copied" : "Copy Title"}</span>
                      </button>

                      <div className="flex items-center gap-1">
                        <Link
                          href={`/search?q=${encodeURIComponent(s.query)}`}
                          className="inline-flex items-center gap-1 rounded-md bg-primary-soft px-2.5 py-1 text-xs font-medium text-primary hover:bg-primary/20"
                        >
                          <Play className="h-3 w-3 fill-current" />
                          <span>Run</span>
                        </Link>
                        <button
                          type="button"
                          onClick={() => deleteSavedSearch(s.id)}
                          className="rounded-md p-1 text-muted hover:bg-danger/10 hover:text-danger"
                          title="Delete saved search"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
