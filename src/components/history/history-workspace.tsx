"use client";

import {
  AlertTriangle,
  Archive,
  ArrowUpRight,
  BookmarkPlus,
  Check,
  Clock,
  Compass,
  Copy,
  Download,
  ExternalLink,
  Filter,
  Layers,
  Loader2,
  Play,
  RefreshCw,
  Search,
  ShieldAlert,
  Trash2,
  Tv,
  Video,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { startTransition, useEffect, useMemo, useState } from "react";
import type { YouTubeManifestSummary } from "@/types/manifest";
import type {
  SearchHistoryItem,
  YouTubeSearchResourceSelection,
} from "@/types/youtube";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useYouTubeWorkspaceStore } from "@/lib/state/youtube-workspace-store";
import { formatDate, formatFullDateTime, formatRelativeDate } from "@/lib/utils/format";

/* ═══════════════════════════════════════════════════════════════════════════
   Search History Workspace (2026 SaaS)
   ──────────────────────────────────────────────────────────────────────────
   Comprehensive chronological search history tracking every search made
   across the application. Renders each search entry as a wide card stacked
   vertically, displaying:
     1. Search title & query
     2. Chosen YouTube API search options breakdown
     3. Results information, counts, quota, and thumbnail previews
     4. Important action buttons:
        - Copy Search Title (one-click with feedback)
        - Forward to Search (copies title & navigates with auto-paste into input)
        - Rerun Search (forwards and auto-runs)
        - Save to Presets shelf
        - Delete entry from history
   ═══════════════════════════════════════════════════════════════════════════ */

export function HistoryWorkspace() {
  const router = useRouter();

  /* ── Zustand Persistent Store ────────────────────────────────────────── */
  const searchHistory = useYouTubeWorkspaceStore((s) => s.searchHistory);
  const deleteSearchHistoryItem = useYouTubeWorkspaceStore(
    (s) => s.deleteSearchHistoryItem,
  );
  const clearSearchHistory = useYouTubeWorkspaceStore(
    (s) => s.clearSearchHistory,
  );
  const saveSearch = useYouTubeWorkspaceStore((s) => s.saveSearch);

  /* ── Local State & Filter Controls ───────────────────────────────────── */
  const [keywordFilter, setKeywordFilter] = useState("");
  const [resourceFilter, setResourceFilter] = useState<
    "ALL" | "video" | "channel" | "playlist"
  >("ALL");
  const [modeFilter, setModeFilter] = useState<"ALL" | "unrestricted" | "filtered">(
    "ALL",
  );
  const [sortOrder, setSortOrder] = useState<"newest" | "oldest" | "most_results">(
    "newest",
  );

  /* ── Runtime Server Manifests (Secondary Tab / Merge) ────────────────── */
  const [activeTab, setActiveTab] = useState<"searches" | "raw_manifests">(
    "searches",
  );
  const [serverManifests, setServerManifests] = useState<
    YouTubeManifestSummary[]
  >([]);
  const [loadingManifests, setLoadingManifests] = useState(false);

  /* Feedback indicators */
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [feedbackMessage, setFeedbackMessage] = useState<string | null>(null);
  const [isClearModalOpen, setIsClearModalOpen] = useState(false);

  /* ── Fetch runtime server manifests for secondary tab ───────────────── */
  async function fetchServerManifests() {
    setLoadingManifests(true);
    try {
      const res = await fetch("/api/youtube/manifests");
      if (res.ok) {
        const data = (await res.json()) as {
          manifests: YouTubeManifestSummary[];
        };
        startTransition(() => setServerManifests(data.manifests ?? []));
      }
    } finally {
      startTransition(() => setLoadingManifests(false));
    }
  }

  /* eslint-disable react-hooks/set-state-in-effect -- Mount-only fetch for raw manifests */
  useEffect(() => {
    fetchServerManifests();
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

  /* ── Filtered & Sorted Search History ────────────────────────────────── */
  const filteredSearches = useMemo(() => {
    return searchHistory
      .filter((item) => {
        // Keyword match
        if (keywordFilter.trim()) {
          const q = keywordFilter.toLowerCase();
          const matchTitle = item.title.toLowerCase().includes(q);
          const matchQuery = item.query.toLowerCase().includes(q);
          const matchRegion = (item.settings?.regionCode ?? "")
            .toLowerCase()
            .includes(q);
          if (!matchTitle && !matchQuery && !matchRegion) return false;
        }

        // Resource type match
        if (resourceFilter !== "ALL" && item.resourceSelection !== resourceFilter) {
          return false;
        }

        // Mode filter match
        if (modeFilter === "unrestricted") {
          if (item.settings?.safeSearch !== "none") return false;
        } else if (modeFilter === "filtered") {
          if (item.settings?.safeSearch === "none") return false;
        }

        return true;
      })
      .sort((a, b) => {
        if (sortOrder === "newest") {
          return new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();
        }
        if (sortOrder === "oldest") {
          return new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime();
        }
        if (sortOrder === "most_results") {
          return b.resultsCount - a.resultsCount;
        }
        return 0;
      });
  }, [searchHistory, keywordFilter, resourceFilter, modeFilter, sortOrder]);

  /* ── Statistics Summary ──────────────────────────────────────────────── */
  const stats = useMemo(() => {
    const totalSearches = searchHistory.length;
    const totalResultsFound = searchHistory.reduce(
      (sum, item) => sum + (item.resultsCount || 0),
      0,
    );
    const unrestrictedCount = searchHistory.filter(
      (item) => item.settings?.safeSearch === "none",
    ).length;
    const latestSearchTime =
      searchHistory.length > 0 ? searchHistory[0].timestamp : null;

    return {
      totalSearches,
      totalResultsFound,
      unrestrictedCount,
      latestSearchTime,
    };
  }, [searchHistory]);

  /* ── Action Handlers ─────────────────────────────────────────────────── */

  const cleanDisplayTitle = (raw: string | undefined | null) => (raw ?? "").replace(/^Search:\s*/i, "").trim();

  /**
   * One-click copy of the search title with visual feedback
   */
  const handleCopyTitle = async (item: SearchHistoryItem) => {
    const textToCopy = cleanDisplayTitle(item.title) || item.query;
    try {
      await navigator.clipboard.writeText(textToCopy);
      setCopiedId(item.id);
      setTimeout(() => setCopiedId(null), 2000);
      showToast(`Copied title: "${textToCopy}"`);
    } catch {
      /* Clipboard fallback */
    }
  };

  /**
   * Forward to Search page: copies title to clipboard, auto-pastes into the input
   */
  const handleForwardToSearch = async (
    item: SearchHistoryItem,
    autoRun = false,
  ) => {
    const textToCopy = cleanDisplayTitle(item.title) || item.query;
    try {
      await navigator.clipboard.writeText(textToCopy);
    } catch {
      /* Ignore clipboard error */
    }

    // Build URL query with auto-run flag if requested
    const params = new URLSearchParams({
      q: item.query,
      forwarded: "true",
    });
    if (autoRun) {
      params.set("autorun", "true");
    }

    router.push(`/search?${params.toString()}`);
  };

  /**
   * Save search title into the preset shelf (savedSearches)
   */
  const handleSaveToPresets = (item: SearchHistoryItem) => {
    const titleToSave = cleanDisplayTitle(item.title) || item.query;
    saveSearch({
      title: titleToSave,
      query: item.query,
      resourceSelection: item.resourceSelection,
      settings: item.settings,
      notes: `Saved from Search History (${formatDate(item.timestamp)})`,
    });
    showToast(`Saved "${titleToSave}" to your Saved Searches preset shelf!`);
  };

  /**
   * Export all search history as formatted JSON
   */
  const handleExportHistory = () => {
    const dataStr = JSON.stringify(searchHistory, null, 2);
    const blob = new Blob([dataStr], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `youtube_discovery_search_history_${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showToast("Exported search history to JSON file.");
  };

  const showToast = (msg: string) => {
    setFeedbackMessage(msg);
    setTimeout(() => setFeedbackMessage(null), 3500);
  };

  function getResourceIcon(type: YouTubeSearchResourceSelection) {
    switch (type) {
      case "video":
        return <Video className="h-4 w-4 text-primary" />;
      case "channel":
        return <Tv className="h-4 w-4 text-blue-500" />;
      case "playlist":
        return <Archive className="h-4 w-4 text-amber-500" />;
      default:
        return <Compass className="h-4 w-4 text-emerald-500" />;
    }
  }

  return (
    <div className="space-y-6">
      {/* ── Toast Feedback Notification ───────────────────────────────── */}
      {feedbackMessage && (
        <div className="fixed bottom-6 right-6 z-50 flex items-center gap-2 rounded-xl border border-primary/40 bg-surface px-4 py-3 text-sm font-medium text-foreground shadow-2xl animate-slide-in">
          <Check className="h-4 w-4 text-success" />
          <span>{feedbackMessage}</span>
        </div>
      )}

      {/* ── Workspace Header / Telemetry Cards ─────────────────────────── */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="research-surface flex items-center justify-between p-4">
          <div>
            <p className="text-xs font-medium text-muted">Total Searches Made</p>
            <p className="text-2xl font-bold text-foreground">
              {stats.totalSearches}
            </p>
          </div>
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary-soft text-primary">
            <Search className="h-5 w-5" />
          </div>
        </div>

        <div className="research-surface flex items-center justify-between p-4">
          <div>
            <p className="text-xs font-medium text-muted">Total Results Discovered</p>
            <p className="text-2xl font-bold text-foreground">
              {stats.totalResultsFound.toLocaleString()}
            </p>
          </div>
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-500">
            <Layers className="h-5 w-5" />
          </div>
        </div>

        <div className="research-surface flex items-center justify-between p-4">
          <div>
            <p className="text-xs font-medium text-muted">Unrestricted (18+/35+)</p>
            <p className="text-2xl font-bold text-emerald-500">
              {stats.unrestrictedCount}
            </p>
          </div>
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-500">
            <ShieldAlert className="h-5 w-5" />
          </div>
        </div>

        <div className="research-surface flex items-center justify-between p-4">
          <div>
            <p className="text-xs font-medium text-muted">Last Activity</p>
            <p className="truncate text-sm font-semibold text-foreground">
              {stats.latestSearchTime
                ? formatRelativeDate(stats.latestSearchTime)
                : "No searches yet"}
            </p>
          </div>
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-surface-muted text-muted">
            <Clock className="h-5 w-5" />
          </div>
        </div>
      </div>

      {/* ── View Mode Tabs: Search History (Wide Cards) vs Raw Manifests ── */}
      <div className="flex items-center justify-between border-b border-border/60 pb-3">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setActiveTab("searches")}
            className={`inline-flex items-center gap-2 rounded-lg px-3.5 py-1.5 text-xs font-semibold transition ${
              activeTab === "searches"
                ? "bg-primary text-white shadow-xs"
                : "text-muted hover:bg-surface-muted hover:text-foreground"
            }`}
          >
            <Search className="h-3.5 w-3.5" />
            <span>Search History ({searchHistory.length})</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("raw_manifests")}
            className={`inline-flex items-center gap-2 rounded-lg px-3.5 py-1.5 text-xs font-semibold transition ${
              activeTab === "raw_manifests"
                ? "bg-primary text-white shadow-xs"
                : "text-muted hover:bg-surface-muted hover:text-foreground"
            }`}
          >
            <Layers className="h-3.5 w-3.5" />
            <span>Server Manifests ({serverManifests.length})</span>
          </button>
        </div>

        {activeTab === "searches" && searchHistory.length > 0 && (
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              className="h-8 gap-1.5 px-3 text-xs"
              onClick={handleExportHistory}
              title="Download entire search history as a JSON file"
            >
              <Download className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Export JSON</span>
            </Button>
            <Button
              variant="danger"
              className="h-8 gap-1.5 px-3 text-xs"
              onClick={() => setIsClearModalOpen(true)}
              title="Clear all recorded search history"
            >
              <Trash2 className="h-3.5 w-3.5" />
              <span>Clear History</span>
            </Button>
          </div>
        )}
      </div>

      {/* ── TAB 1: SEARCH HISTORY (WIDE CARDS STACKED VERTICALLY) ─────── */}
      {activeTab === "searches" && (
        <div className="space-y-4">
          {/* Search & Filter Toolbar */}
          <div className="flex flex-col gap-3 rounded-xl border border-border/70 bg-surface p-3 sm:flex-row sm:items-center sm:justify-between">
            {/* Search Input */}
            <div className="relative min-w-0 flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
              <input
                className="h-9 w-full rounded-lg border border-border bg-surface pl-9 pr-3 text-xs focus:outline-none focus:ring-2 focus:ring-[var(--ring)]"
                placeholder="Filter history by title, query keyword, region…"
                value={keywordFilter}
                onChange={(e) => setKeywordFilter(e.target.value)}
              />
            </div>

            {/* Quick Filters */}
            <div className="flex flex-wrap items-center gap-2">
              {/* Resource Filter */}
              <select
                className="h-9 rounded-lg border border-border bg-surface px-2.5 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-[var(--ring)]"
                value={resourceFilter}
                onChange={(e) =>
                  setResourceFilter(
                    e.target.value as "ALL" | "video" | "channel" | "playlist",
                  )
                }
              >
                <option value="ALL">All Resources</option>
                <option value="video">Videos Only</option>
                <option value="channel">Channels Only</option>
                <option value="playlist">Playlists Only</option>
              </select>

              {/* Mode Filter */}
              <select
                className="h-9 rounded-lg border border-border bg-surface px-2.5 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-[var(--ring)]"
                value={modeFilter}
                onChange={(e) =>
                  setModeFilter(
                    e.target.value as "ALL" | "unrestricted" | "filtered",
                  )
                }
              >
                <option value="ALL">All Modes</option>
                <option value="unrestricted">Unrestricted (18+/35+)</option>
                <option value="filtered">Filtered Only</option>
              </select>

              {/* Sort Order — Default is Latest (newest first) */}
              <select
                className="h-9 rounded-lg border border-border bg-surface px-2.5 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-[var(--ring)]"
                value={sortOrder}
                onChange={(e) =>
                  setSortOrder(
                    e.target.value as "newest" | "oldest" | "most_results",
                  )
                }
              >
                <option value="newest">Latest</option>
                <option value="oldest">Old</option>
                <option value="most_results">Most Results</option>
              </select>
            </div>
          </div>

          {/* Results Count Badge */}
          <div className="flex items-center justify-between text-xs text-muted">
            <span>
              Showing <strong>{filteredSearches.length}</strong> of{" "}
              {searchHistory.length} saved searches
            </span>
            {keywordFilter && (
              <button
                type="button"
                onClick={() => setKeywordFilter("")}
                className="text-primary hover:underline"
              >
                Clear filter
              </button>
            )}
          </div>

          {/* Empty State */}
          {filteredSearches.length === 0 ? (
            <Card>
              <div className="flex flex-col items-center gap-3 py-12 text-center">
                <Search className="h-12 w-12 text-muted/40" />
                <div>
                  <p className="text-base font-medium text-foreground">
                    {searchHistory.length === 0
                      ? "No searches recorded yet"
                      : "No history entries match your search criteria"}
                  </p>
                  <p className="mt-1 text-xs text-muted">
                    {searchHistory.length === 0
                      ? "Every search you perform in this app will automatically be recorded here with its title, options, and results."
                      : "Try clearing your keyword or changing the filter options above."}
                  </p>
                </div>
                {searchHistory.length === 0 && (
                  <Button
                    variant="primary"
                    className="mt-2 text-xs"
                    onClick={() => router.push("/search")}
                  >
                    <Search className="h-3.5 w-3.5" />
                    Go to Search Workspace
                  </Button>
                )}
              </div>
            </Card>
          ) : (
            /* ═════════════════════════════════════════════════════════════
               WIDE CARDS STACKED VERTICALLY (ABOVE EACH OTHER)
               ─────────────────────────────────────────────────────────────
               Each search renders as a spacious, feature-packed wide card
               with full chosen search options breakdown, results info,
               preview thumbnails, copy title, and forward-to-search.
               ═════════════════════════════════════════════════════════════ */
            <div className="space-y-4">
              {filteredSearches.map((item) => {
                const isCopied = copiedId === item.id;
                const isUnrestricted = item.settings?.safeSearch === "none";
                const hasThumbnails =
                  item.topThumbnails && item.topThumbnails.length > 0;

                return (
                  <div
                    key={item.id}
                    className="group relative rounded-xl border border-border/80 bg-surface p-5 shadow-xs transition hover:border-primary/50 hover:shadow-md"
                  >
                    {/* ── CARD HEADER: Title + Timestamp + Action Buttons ── */}
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                      {/* Left: Icon, Title, Query, Time */}
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2.5">
                          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border bg-surface-muted">
                            {getResourceIcon(item.resourceSelection)}
                          </div>
                          <div className="min-w-0 flex-1">
                            <h3
                              className="truncate text-base font-semibold text-foreground group-hover:text-primary transition-colors cursor-pointer"
                              title={`${cleanDisplayTitle(item.title) || item.query} (Click to copy title)`}
                              onClick={() => handleCopyTitle(item)}
                            >
                              {cleanDisplayTitle(item.title) || item.query}
                            </h3>
                            <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
                              <span className="font-mono text-[11px] text-muted/90">
                                q: &quot;{item.query}&quot;
                              </span>
                              <span>•</span>
                              <span className="flex items-center gap-1">
                                <Clock className="h-3 w-3" />
                                {formatRelativeDate(item.timestamp)}
                              </span>
                              <span>•</span>
                              {/* Full date + time always visible on each research card */}
                              <span className="text-[11px] text-muted/80">
                                {formatFullDateTime(item.timestamp)}
                              </span>
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* Right: Important Action Buttons */}
                      <div className="flex flex-wrap items-center gap-2 pt-1 lg:pt-0">
                        {/* 1. Copy Title Button */}
                        <Button
                          type="button"
                          variant="secondary"
                          className="h-8 gap-1.5 px-3 text-xs"
                          onClick={() => handleCopyTitle(item)}
                          title="Copy search title to clipboard"
                        >
                          {isCopied ? (
                            <>
                              <Check className="h-3.5 w-3.5 text-success" />
                              <span className="text-success font-medium">Copied!</span>
                            </>
                          ) : (
                            <>
                              <Copy className="h-3.5 w-3.5" />
                              <span>Copy Title</span>
                            </>
                          )}
                        </Button>

                        {/* 2. Forward to Search Page Button */}
                        <Button
                          type="button"
                          variant="primary"
                          className="h-8 gap-1.5 px-3 text-xs font-semibold shadow-xs"
                          onClick={() => handleForwardToSearch(item, false)}
                          title="Copy title, forward to Search page, and auto-paste into the search input"
                        >
                          <ArrowUpRight className="h-3.5 w-3.5" />
                          <span>Forward to Search</span>
                        </Button>

                        {/* 3. Rerun Search Immediately Button */}
                        <Button
                          type="button"
                          variant="secondary"
                          className="h-8 gap-1.5 px-2.5 text-xs text-primary hover:bg-primary-soft"
                          onClick={() => handleForwardToSearch(item, true)}
                          title="Load and immediately execute this search with exact same options"
                        >
                          <Play className="h-3 w-3 fill-current" />
                          <span className="hidden sm:inline">Rerun</span>
                        </Button>

                        {/* 4. Bookmark to Saved Searches Shelf */}
                        <Button
                          type="button"
                          variant="ghost"
                          className="h-8 w-8 p-0 text-muted hover:text-primary"
                          onClick={() => handleSaveToPresets(item)}
                          title="Bookmark this search title into your Saved Searches shelf"
                        >
                          <BookmarkPlus className="h-4 w-4" />
                        </Button>

                        {/* 5. Delete Entry from History */}
                        <Button
                          type="button"
                          variant="ghost"
                          className="h-8 w-8 p-0 text-muted hover:text-danger hover:bg-danger/10"
                          onClick={() => deleteSearchHistoryItem(item.id)}
                          title="Delete this entry from search history"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>

                    {/* ── SECTION 2: CHOSEN SEARCH OPTIONS ─────────────────── */}
                    <div className="mt-4 rounded-lg border border-border/50 bg-surface-muted/30 p-3">
                      <div className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted">
                        <Filter className="h-3 w-3" />
                        <span>Chosen Search Options</span>
                      </div>

                      <div className="flex flex-wrap items-center gap-1.5">
                        {/* Resource Type */}
                        <Badge tone="primary" className="text-[11px]">
                          Resource: {item.resourceSelection.toUpperCase()}
                        </Badge>

                        {/* Unrestricted / SafeSearch Badge */}
                        {isUnrestricted ? (
                          <span className="inline-flex items-center gap-1 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 text-[11px] font-semibold text-emerald-600 dark:text-emerald-400 unrestricted-glow">
                            <ShieldAlert className="h-3 w-3" />
                            Unrestricted Mode (18+/35+ Allowed)
                          </span>
                        ) : (
                          <Badge tone="neutral" className="text-[11px]">
                            SafeSearch: {item.settings?.safeSearch ?? "Moderate"}
                          </Badge>
                        )}

                        {/* Order / Sort */}
                        {item.settings?.order && (
                          <Badge tone="neutral" className="text-[11px]">
                            Sort: {item.settings.order}
                          </Badge>
                        )}

                        {/* Region */}
                        {item.settings?.regionCode && (
                          <Badge tone="neutral" className="text-[11px]">
                            Region: {item.settings.regionCode}
                          </Badge>
                        )}

                        {/* Language */}
                        {item.settings?.relevanceLanguage && (
                          <Badge tone="neutral" className="text-[11px]">
                            Lang: {item.settings.relevanceLanguage}
                          </Badge>
                        )}

                        {/* Duration (if video) */}
                        {item.settings?.videoDuration &&
                          item.settings.videoDuration !== "any" && (
                            <Badge tone="neutral" className="text-[11px]">
                              Duration: {item.settings.videoDuration}
                            </Badge>
                          )}

                        {/* Definition (HD/SD) */}
                        {item.settings?.videoDefinition &&
                          item.settings.videoDefinition !== "any" && (
                            <Badge tone="neutral" className="text-[11px]">
                              Definition: {item.settings.videoDefinition.toUpperCase()}
                            </Badge>
                          )}

                        {/* Captions */}
                        {item.settings?.videoCaption &&
                          item.settings.videoCaption !== "any" && (
                            <Badge tone="neutral" className="text-[11px]">
                              Captions: {item.settings.videoCaption}
                            </Badge>
                          )}

                        {/* Event type (live/upcoming) */}
                        {item.settings?.eventType && (
                          <Badge tone="warning" className="text-[11px]">
                            Live: {item.settings.eventType}
                          </Badge>
                        )}

                        {/* Published After / Before */}
                        {item.settings?.publishedAfter && (
                          <Badge tone="neutral" className="text-[11px]">
                            After: {item.settings.publishedAfter.slice(0, 10)}
                          </Badge>
                        )}
                        {item.settings?.publishedBefore && (
                          <Badge tone="neutral" className="text-[11px]">
                            Before: {item.settings.publishedBefore.slice(0, 10)}
                          </Badge>
                        )}

                        {/* Max Items */}
                        <Badge tone="neutral" className="text-[11px]">
                          Fetch Limit: {item.settings?.pageSize ?? 25} / page
                        </Badge>
                      </div>
                    </div>

                    {/* ── SECTION 3: RESULTS INFO & THUMBNAILS PREVIEW ─────── */}
                    <div className="mt-3 flex flex-col gap-3 rounded-lg border border-border/50 bg-surface-muted/20 p-3 sm:flex-row sm:items-center sm:justify-between">
                      {/* Left: Results Metrics */}
                      <div className="space-y-1.5">
                        <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted">
                          <Layers className="h-3 w-3" />
                          <span>Results Information</span>
                        </div>
                        <div className="flex flex-wrap items-center gap-2 text-xs">
                          {/* Total count badge — shows clear status for all search outcomes including no-results */}
                          <Badge
                            tone={
                              item.status === "failed"
                                ? "danger"
                                : item.status === "empty"
                                  ? "warning"
                                  : item.resultsCount > 0
                                    ? "success"
                                    : "warning"
                            }
                            className="font-semibold"
                          >
                            {item.status === "failed"
                              ? "Search Failed"
                              : item.status === "empty"
                                ? "No Results Found"
                                : `${item.resultsCount} Results Discovered`}
                          </Badge>

                          {/* Breakdown */}
                          {item.videoCount !== undefined &&
                            item.videoCount > 0 && (
                              <span className="text-muted">
                                <strong>{item.videoCount}</strong> videos
                              </span>
                            )}
                          {item.channelCount !== undefined &&
                            item.channelCount > 0 && (
                              <span className="text-muted">
                                • <strong>{item.channelCount}</strong> channels
                              </span>
                            )}
                          {item.playlistCount !== undefined &&
                            item.playlistCount > 0 && (
                              <span className="text-muted">
                                • <strong>{item.playlistCount}</strong> playlists
                              </span>
                            )}

                          {/* Quota estimate */}
                          {item.quotaCostEstimate !== undefined &&
                            item.quotaCostEstimate > 0 && (
                              <span className="text-muted/80">
                                (~{item.quotaCostEstimate} quota units)
                              </span>
                            )}

                          {/* Status */}
                          <Badge
                            tone={
                              item.status === "complete"
                                ? "success"
                                : item.status === "failed"
                                  ? "danger"
                                  : "neutral"
                            }
                            className="capitalize"
                          >
                            {item.status}
                          </Badge>
                        </div>
                      </div>

                      {/* Right: Thumbnails Strip & Manifest Link */}
                      <div className="flex items-center gap-3">
                        {hasThumbnails && (
                          <div className="flex -space-x-3 overflow-hidden rounded-md p-1">
                            {item.topThumbnails?.map((thumb, idx) => (
                              <div
                                key={idx}
                                className="relative h-9 w-14 shrink-0 overflow-hidden rounded border border-surface bg-surface-muted shadow-xs transition hover:scale-105 hover:z-10"
                              >
                                <Image
                                  src={thumb}
                                  alt="Result preview"
                                  fill
                                  sizes="56px"
                                  className="object-cover"
                                  unoptimized
                                />
                              </div>
                            ))}
                          </div>
                        )}

                        {item.manifestId && (
                          <Link
                            href={`/manifests/${item.manifestId}`}
                            className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs text-muted hover:border-primary/40 hover:text-primary transition"
                            title="Inspect full manifest details"
                          >
                            <span>Manifest</span>
                            <ExternalLink className="h-3 w-3" />
                          </Link>
                        )}
                      </div>
                    </div>

                    {/* ── CARD FOOTER: Full Date + Time Stamp ────────────────── */}
                    {/* Always-visible complete timestamp at the bottom of each research card */}
                    <div className="mt-3 flex items-center gap-2 border-t border-border/40 pt-2.5 text-[11px] text-muted/70">
                      <Clock className="h-3 w-3 shrink-0" />
                      <span>Searched on {formatFullDateTime(item.timestamp)}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ── TAB 2: RAW SERVER MANIFESTS (BACKWARDS COMPATIBILITY) ─────── */}
      {activeTab === "raw_manifests" && (
        <div className="space-y-4">
          <div className="flex items-center justify-between text-xs text-muted">
            <p>
              Runtime server manifests created during the current Node.js
              process session.
            </p>
            <Button
              variant="secondary"
              className="h-8 gap-1 px-2 text-xs"
              onClick={fetchServerManifests}
              disabled={loadingManifests}
            >
              {loadingManifests ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <RefreshCw className="h-3.5 w-3.5" />
              )}
              <span>Refresh</span>
            </Button>
          </div>

          {serverManifests.length === 0 ? (
            <Card>
              <p className="py-8 text-center text-sm text-muted">
                No runtime manifests found on the server.
              </p>
            </Card>
          ) : (
            <div className="space-y-2">
              {serverManifests.map((m) => (
                <Link
                  key={m.manifestId}
                  href={`/manifests/${m.manifestId}`}
                  className="group block"
                >
                  <div className="research-surface flex items-center gap-3 p-3 transition group-hover:border-primary/40">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-surface-muted text-muted">
                      {m.manifestType.includes("channel") ? (
                        <Tv className="h-4 w-4" />
                      ) : m.manifestType.includes("playlist") ? (
                        <Archive className="h-4 w-4" />
                      ) : (
                        <Search className="h-4 w-4" />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-foreground group-hover:text-primary">
                        {m.title}
                      </p>
                      <div className="flex flex-wrap gap-2 text-xs text-muted">
                        <Badge>{m.manifestType}</Badge>
                        <Badge>{m.itemCount} items</Badge>
                        <Badge
                          tone={
                            m.status === "complete"
                              ? "success"
                              : m.status === "failed"
                                ? "danger"
                                : "warning"
                          }
                        >
                          {m.status}
                        </Badge>
                        <span>{formatDate(m.collectedAt)}</span>
                      </div>
                    </div>
                    <ExternalLink className="h-4 w-4 shrink-0 text-muted opacity-0 transition group-hover:opacity-100" />
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Clear All History Confirmation Modal ──────────────────────── */}
      {isClearModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs">
          <div className="w-full max-w-sm rounded-xl border border-border bg-surface p-6 shadow-xl animate-scale-in">
            <div className="flex items-center gap-3 text-danger">
              <AlertTriangle className="h-6 w-6 shrink-0" />
              <h3 className="text-base font-semibold text-foreground">
                Clear Search History?
              </h3>
            </div>
            <p className="mt-2 text-xs text-muted leading-relaxed">
              This will permanently delete all {searchHistory.length} recorded
              searches from your local browser history. This action cannot be
              undone.
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <Button
                type="button"
                variant="ghost"
                onClick={() => setIsClearModalOpen(false)}
              >
                Cancel
              </Button>
              <Button
                type="button"
                variant="danger"
                onClick={() => {
                  clearSearchHistory();
                  setIsClearModalOpen(false);
                  showToast("Cleared all search history.");
                }}
              >
                Yes, Clear All
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
