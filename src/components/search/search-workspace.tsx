"use client";

import {
  AlertTriangle,
  Bookmark,
  BookmarkPlus,
  Check,
  ChevronDown,
  ChevronUp,
  Copy,
  Download,
  Filter,
  Loader2,
  Play,
  RotateCcw,
  Save,
  Search,
  ShieldAlert,
  SlidersHorizontal,
  Star,
  Trash2,
  X,
} from "lucide-react";
import { startTransition, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import type { YouTubeManifest } from "@/types/manifest";
import type {
  NormalizedYouTubeDiscoveryItem,
  SavedSearch,
  YouTubeResultFilters,
  YouTubeSearchResourceSelection,
  YouTubeSearchSettings,
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

/* ═══════════════════════════════════════════════════════════════════════════
   Search Workspace — Primary YouTube Discovery Interface
   ──────────────────────────────────────────────────────────────────────────
   Provider search bar → YouTube API call → normalized manifest → local
   filter/sort/search → render cards + AI panel. All filtering after the
   initial fetch is LOCAL ONLY — zero additional YouTube API calls.
   ═══════════════════════════════════════════════════════════════════════════ */

/* ── Default YouTube API v3 search settings ──────────────────────────────
   regionCode defaults to US per user request. safeSearch defaults to "none"
   for the least-filtered results YouTube allows. All other API parameters
   start at their neutral/"any" values so they don't restrict results until
   the user explicitly changes them. These defaults mirror the full
   YouTubeSearchSettings interface so every API parameter is always present
   in state and sent to the backend on search.
   ──────────────────────────────────────────────────────────────────────── */

export const YOUTUBE_REGION_OPTIONS: { value: string; label: string }[] = [
  { value: "", label: "Worldwide / Any Region (Unrestricted Default)" },
  { value: "US", label: "United States (US)" },
  { value: "GB", label: "United Kingdom (GB)" },
  { value: "EG", label: "Egypt (EG) — مصر" },
  { value: "SA", label: "Saudi Arabia (SA) — السعودية" },
  { value: "AE", label: "United Arab Emirates (AE) — الإمارات" },
  { value: "KW", label: "Kuwait (KW) — الكويت" },
  { value: "QA", label: "Qatar (QA) — قطر" },
  { value: "OM", label: "Oman (OM) — عُمان" },
  { value: "BH", label: "Bahrain (BH) — البحرين" },
  { value: "JO", label: "Jordan (JO) — الأردن" },
  { value: "LB", label: "Lebanon (LB) — لبنان" },
  { value: "IQ", label: "Iraq (IQ) — العراق" },
  { value: "MA", label: "Morocco (MA) — المغرب" },
  { value: "DZ", label: "Algeria (DZ) — الجزائر" },
  { value: "TN", label: "Tunisia (TN) — تونس" },
  { value: "CA", label: "Canada (CA)" },
  { value: "DE", label: "Germany (DE)" },
  { value: "FR", label: "France (FR)" },
  { value: "ES", label: "Spain (ES)" },
  { value: "IT", label: "Italy (IT)" },
  { value: "NL", label: "Netherlands (NL)" },
  { value: "SE", label: "Sweden (SE)" },
  { value: "CH", label: "Switzerland (CH)" },
  { value: "PL", label: "Poland (PL)" },
  { value: "TR", label: "Turkey (TR)" },
  { value: "JP", label: "Japan (JP)" },
  { value: "KR", label: "South Korea (KR)" },
  { value: "IN", label: "India (IN)" },
  { value: "AU", label: "Australia (AU)" },
  { value: "BR", label: "Brazil (BR)" },
  { value: "MX", label: "Mexico (MX)" },
  { value: "AR", label: "Argentina (AR)" },
  { value: "ZA", label: "South Africa (ZA)" },
  { value: "NG", label: "Nigeria (NG)" },
  { value: "ID", label: "Indonesia (ID)" },
];

export const YOUTUBE_LANGUAGE_OPTIONS: { value: string; label: string }[] = [
  { value: "", label: "Any Language" },
  { value: "en", label: "English (en)" },
  { value: "ar", label: "Arabic (ar) — العربية" },
  { value: "es", label: "Spanish (es) — Español" },
  { value: "fr", label: "French (fr) — Français" },
  { value: "de", label: "German (de) — Deutsch" },
  { value: "ja", label: "Japanese (ja) — 日本語" },
  { value: "ko", label: "Korean (ko) — 한국어" },
  { value: "pt", label: "Portuguese (pt) — Português" },
  { value: "ru", label: "Russian (ru) — Русский" },
  { value: "zh-Hans", label: "Chinese (zh-Hans) — 简体中文" },
  { value: "hi", label: "Hindi (hi) — हिन्दी" },
  { value: "tr", label: "Turkish (tr) — Türkçe" },
  { value: "it", label: "Italian (it) — Italiano" },
];

const initialSettings: YouTubeSearchSettings = {
  query: "",
  types: ["video"],
  pageSize: 25,
  maxPages: 3,
  maxItems: 150,
  order: "relevance",
  safeSearch: "none",
  regionCode: "",
  relevanceLanguage: undefined,
  videoDuration: "any",
  videoDefinition: "any",
  videoCaption: "any",
  videoEmbeddable: "any",
  eventType: undefined,
  publishedAfter: undefined,
  publishedBefore: undefined,
  topicId: undefined,
};

/** Items-per-page for local pagination of results */
const PAGE_SIZE = 24;

/* ── Helper: count how many API settings differ from defaults ────────────
   Used to show an active-count badge on the API Settings toggle button
   so the user knows at a glance how many parameters are non-default.
   ──────────────────────────────────────────────────────────────────────── */
function countActiveApiSettings(settings: YouTubeSearchSettings): number {
  let count = 0;
  if (settings.order !== "relevance") count++;
  if (settings.safeSearch !== "none") count++;
  if (settings.regionCode && settings.regionCode !== "") count++;
  if (settings.relevanceLanguage) count++;
  if (settings.videoDuration !== "any") count++;
  if (settings.videoDefinition !== "any") count++;
  if (settings.videoCaption !== "any") count++;
  if (settings.videoEmbeddable !== "any") count++;
  if (settings.eventType) count++;
  if (settings.publishedAfter) count++;
  if (settings.publishedBefore) count++;
  if (settings.topicId) count++;
  return count;
}

export function SearchWorkspace() {
  const [settings, setSettings] = useState<YouTubeSearchSettings>(initialSettings);
  const [resourceSelection, setResourceSelection] = useState<YouTubeSearchResourceSelection>("ALL");
  const [filters, setFilters] = useState<YouTubeResultFilters>({ ...DEFAULT_YOUTUBE_RESULT_FILTERS, sort: "latest" });
  const [manifest, setManifest] = useState<YouTubeManifest | null>(null);
  const [selectedItem, setSelectedItem] = useState<NormalizedYouTubeDiscoveryItem | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  /* ── Search Params & History Forwarding State ────────────────────────── */
  const searchParams = useSearchParams();
  const [pastedFromHistory, setPastedFromHistory] = useState(false);

  /* ── Saved searches state ─────────────────────────────────────────────── */
  const savedSearches = useYouTubeWorkspaceStore((s) => s.savedSearches);
  const saveSearch = useYouTubeWorkspaceStore((s) => s.saveSearch);
  const updateSavedSearch = useYouTubeWorkspaceStore((s) => s.updateSavedSearch);
  const deleteSavedSearch = useYouTubeWorkspaceStore((s) => s.deleteSavedSearch);
  const togglePinSavedSearch = useYouTubeWorkspaceStore((s) => s.togglePinSavedSearch);
  const recordSearchHistory = useYouTubeWorkspaceStore((s) => s.recordSearchHistory);

  const [savedSearchesOpen, setSavedSearchesOpen] = useState(false);
  const [isSaveModalOpen, setIsSaveModalOpen] = useState(false);
  const [saveTitleInput, setSaveTitleInput] = useState("");
  const [saveNotesInput, setSaveNotesInput] = useState("");
  const [saveFeedback, setSaveFeedback] = useState<string | null>(null);
  const [copiedSearchId, setCopiedSearchId] = useState<string | null>(null);
  const [editingSearchId, setEditingSearchId] = useState<string | null>(null);
  const [editTitleValue, setEditTitleValue] = useState("");

  /* ── API Settings panel collapsed/expanded state ─────────────────────── */
  const [apiSettingsOpen, setApiSettingsOpen] = useState(false);

  const setCurrentManifest = useYouTubeWorkspaceStore((s) => s.setCurrentManifest);
  const fetchSettings = useYouTubeWorkspaceStore((s) => s.fetchSettings);

  const totalItems = useMemo(() => manifest?.normalizedItems ?? [], [manifest]);
  const filteredItems = useMemo(
    () => applyYouTubeResultPipeline(totalItems, filters),
    [totalItems, filters],
  );
  const visibleItems = useMemo(() => filteredItems.slice(0, visibleCount), [filteredItems, visibleCount]);

  /* Badge count of API settings that differ from defaults */
  const activeApiCount = countActiveApiSettings(settings);

  /* ── Whether the current resource type selection is video-only ─────── */
  const isVideoOnly = resourceSelection === "video";

  /* ── Search Input Ref & Keyboard Shortcut ───────────────────────────── */
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        (e.key === "/" || ((e.metaKey || e.ctrlKey) && e.key === "k")) &&
        document.activeElement?.tagName !== "INPUT" &&
        document.activeElement?.tagName !== "TEXTAREA" &&
        document.activeElement?.tagName !== "SELECT"
      ) {
        e.preventDefault();
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  /* ── Unrestricted / sensitive content mode ─────────────────────────── */
  const isUnrestrictedMode = (settings.safeSearch ?? "none") === "none";
  const toggleUnrestrictedMode = () => {
    setSettings((s) => ({
      ...s,
      safeSearch: isUnrestrictedMode ? "moderate" : "none",
    }));
  };

  const executeSearch = useCallback(
    async (
      overrideQuery?: string,
      overrideResource?: YouTubeSearchResourceSelection,
      overrideSettings?: Partial<YouTubeSearchSettings>,
    ) => {
      const activeQuery = (overrideQuery ?? settings.query).trim();
      if (!activeQuery) return;

      const activeResource = overrideResource ?? resourceSelection;
      const activeSettings: YouTubeSearchSettings = {
        ...settings,
        ...(overrideSettings ?? {}),
        query: activeQuery,
      };

      setLoading(true);
      setError(null);
      setVisibleCount(PAGE_SIZE);

      try {
        const nextTypes = activeResource === "ALL" ? ["video", "channel", "playlist"] : [activeResource];
        const response = await fetch("/api/youtube/search", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...activeSettings,
            regionCode: activeSettings.regionCode ? activeSettings.regionCode.trim() : undefined,
            relevanceLanguage: activeSettings.relevanceLanguage ? activeSettings.relevanceLanguage.trim() : undefined,
            types: nextTypes,
            pageSize: fetchSettings.pageSize,
            maxPages: fetchSettings.maxPages,
            maxItems: fetchSettings.maxItems,
            /* Clear video-only params when searching non-video types to avoid
               Zod validation error (video filters require type=video only) */
            ...(nextTypes.length !== 1 || nextTypes[0] !== "video"
              ? {
                  videoDuration: "any",
                  videoDefinition: "any",
                  videoCaption: "any",
                  videoEmbeddable: "any",
                  eventType: undefined,
                }
              : {}),
          }),
        });

        const payload = await response.json();

        if (!response.ok) {
          const msg = (payload as { message?: string }).message ?? `Search failed (${response.status})`;
          setError(msg);
          // Record failed search in history so the user can review and retry
          recordSearchHistory({
            title: activeQuery,
            query: activeQuery,
            resourceSelection: activeResource,
            settings: { ...activeSettings },
            resultsCount: 0,
            status: "failed",
          });
          return;
        }

        const newManifest = payload as YouTubeManifest;
        setManifest(newManifest);
        setCurrentManifest(newManifest);

        // Record successful search in persistent history with clean query title
        const items = newManifest.normalizedItems ?? [];
        const videoCount = items.filter((i) => i.itemType === "video" || i.itemType === "shorts_like").length;
        const channelCount = items.filter((i) => i.itemType === "channel").length;
        const playlistCount = items.filter((i) => i.itemType === "playlist").length;
        const topThumbs = items
          .map((i) => i.thumbnailUrl)
          .filter((t): t is string => Boolean(t))
          .slice(0, 4);

        recordSearchHistory({
          title: activeQuery,
          query: activeQuery,
          resourceSelection: activeResource,
          settings: { ...activeSettings },
          resultsCount: newManifest.itemCount ?? items.length,
          videoCount,
          channelCount,
          playlistCount,
          quotaCostEstimate: newManifest.quotaCostEstimate,
          status: (newManifest.itemCount ?? items.length) === 0
            ? "empty"
            : (["complete", "failed", "partial", "empty"] as const).includes(newManifest.status as "complete" | "failed" | "partial" | "empty")
              ? (newManifest.status as "complete" | "failed" | "partial" | "empty")
              : "complete",
          manifestId: newManifest.manifestId,
          topThumbnails: topThumbs,
        });
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : "Network error";
        setError(errorMsg);
        recordSearchHistory({
          title: activeQuery,
          query: activeQuery,
          resourceSelection: activeResource,
          settings: { ...activeSettings },
          resultsCount: 0,
          status: "failed",
        });
      } finally {
        setLoading(false);
      }
    },
    [fetchSettings, recordSearchHistory, resourceSelection, setCurrentManifest, settings],
  );

  /* ── Detect Query from URL (Forwarded from History with auto-paste) ─── */
  useEffect(() => {
    const qParam = searchParams.get("q");
    if (qParam && qParam.trim()) {
      const decodedQuery = qParam.trim();

      /* startTransition batches these state updates at low priority,
         avoiding synchronous cascading renders inside the effect body
         (required by react-hooks/set-state-in-effect rule). */
      startTransition(() => {
        setSettings((prev) => ({ ...prev, query: decodedQuery }));
        setPastedFromHistory(true);
      });

      // Auto-focus and highlight search input with auto-paste feeling
      setTimeout(() => {
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
      }, 100);

      const timer = setTimeout(() => setPastedFromHistory(false), 4500);

      /* Defer autorun so executeSearch (which calls setState internally)
         does not run synchronously inside the effect body. The search
         fires on the next macrotask — effectively immediate but lint-safe. */
      let autorunTimer: ReturnType<typeof setTimeout> | undefined;
      if (searchParams.get("autorun") === "true") {
        autorunTimer = setTimeout(() => void executeSearch(decodedQuery), 0);
      }

      return () => {
        clearTimeout(timer);
        if (autorunTimer) clearTimeout(autorunTimer);
      };
    }
  }, [searchParams, executeSearch]);

  async function runSearch() {
    await executeSearch();
  }

  /* ── Save Search Title Handlers ──────────────────────────────────────── */
  const handleOpenSaveModal = () => {
    if (!settings.query.trim()) return;
    setSaveTitleInput(settings.query.trim());
    setSaveNotesInput("");
    setIsSaveModalOpen(true);
  };

  const handleConfirmSave = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!saveTitleInput.trim()) return;

    saveSearch({
      title: saveTitleInput.trim(),
      query: settings.query.trim(),
      resourceSelection,
      settings: { ...settings },
      notes: saveNotesInput.trim() || undefined,
    });

    setIsSaveModalOpen(false);
    setSaveFeedback(`Saved search title: "${saveTitleInput.trim()}"`);
    setTimeout(() => setSaveFeedback(null), 3500);
  };

  const handleLoadSavedSearch = (s: SavedSearch, autoExecute = false) => {
    setSettings((prev) => ({
      ...prev,
      ...s.settings,
      query: s.query,
    }));
    setResourceSelection(s.resourceSelection);
    setSavedSearchesOpen(false);

    if (autoExecute) {
      void executeSearch(s.query, s.resourceSelection, s.settings);
    }
  };

  const handleCopySearchTitle = async (search: SavedSearch) => {
    try {
      await navigator.clipboard.writeText(search.title);
      setCopiedSearchId(search.id);
      setTimeout(() => setCopiedSearchId(null), 1800);
    } catch {
      /* Fallback if clipboard fails */
    }
  };

  const sortedSavedSearches = useMemo(() => {
    return [...savedSearches].sort((a, b) => {
      if (a.isPinned && !b.isPinned) return -1;
      if (!a.isPinned && b.isPinned) return 1;
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });
  }, [savedSearches]);

  /* ── Reset all API settings to their initial defaults ────────────────── */
  function resetApiSettings() {
    setSettings((prev) => ({
      ...prev,
      order: "relevance",
      safeSearch: "none",
      regionCode: "",
      relevanceLanguage: undefined,
      videoDuration: "any",
      videoDefinition: "any",
      videoCaption: "any",
      videoEmbeddable: "any",
      eventType: undefined,
      publishedAfter: undefined,
      publishedBefore: undefined,
      topicId: undefined,
    }));
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

          {pastedFromHistory && (
            <div className="mb-3 flex items-center gap-2 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-1.5 text-xs font-medium text-emerald-600 dark:text-emerald-400 animate-slide-in">
              <Check className="h-4 w-4 shrink-0 text-emerald-500" />
              <span>Search title auto-pasted from history. Ready to run or modify.</span>
            </div>
          )}

          <form
            className="grid gap-3 md:grid-cols-[minmax(0,1fr)_10rem_10rem_auto]"
            onSubmit={(e) => {
              e.preventDefault();
              void runSearch();
            }}
          >
            <div className="relative min-w-0 flex-1">
              <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
              <input
                ref={searchInputRef}
                className={`h-11 w-full rounded-lg border bg-surface pl-10 pr-16 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--ring)] transition-all ${
                  pastedFromHistory
                    ? "border-emerald-500 ring-2 ring-emerald-500/50 shadow-sm shadow-emerald-500/20"
                    : "border-border"
                }`}
                value={settings.query}
                onChange={(e) => setSettings((c) => ({ ...c, query: e.target.value }))}
                placeholder="Search YouTube videos, channels, playlists… (Press '/' to focus)"
              />
              {settings.query && (
                <button
                  type="button"
                  onClick={() => {
                    setSettings((c) => ({ ...c, query: "" }));
                    searchInputRef.current?.focus();
                  }}
                  className="absolute right-9 top-1/2 -translate-y-1/2 rounded p-1 text-muted hover:text-foreground hover:bg-surface-muted transition-colors"
                  title="Clear search query"
                  aria-label="Clear search query"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
              <kbd className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 hidden select-none rounded border border-border bg-surface-muted px-1.5 py-0.5 font-mono text-[10px] text-muted sm:inline-block">
                /
              </kbd>
            </div>
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

            {/* ── API Settings toggle button ──────────────────────────────
                Shows a badge with the count of non-default settings so the
                user can see at a glance how many API parameters are active.
                ──────────────────────────────────────────────────────────── */}
            <Button
              type="button"
              variant="secondary"
              className="h-11 gap-1.5"
              onClick={() => setApiSettingsOpen((v) => !v)}
              title={apiSettingsOpen ? "Collapse API settings" : "Expand API settings"}
            >
              <SlidersHorizontal className="h-4 w-4" />
              <span className="hidden sm:inline">API Settings</span>
              {activeApiCount > 0 && (
                <Badge tone="primary" className="ml-1 px-1.5 py-0 text-[10px]">
                  {activeApiCount}
                </Badge>
              )}
              {apiSettingsOpen ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
            </Button>

            <Button type="submit" className="h-11" disabled={loading || !settings.query.trim()}>
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
              Search
            </Button>
          </form>

          {/* ── Quick Controls & Unrestricted Mode Bar ────────────────── */}
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-border/50 pt-3">
            <div className="flex flex-wrap items-center gap-2">
              {/* Unrestricted / Sensitive Mode Toggle */}
              <button
                type="button"
                onClick={toggleUnrestrictedMode}
                className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium border transition ${
                  isUnrestrictedMode
                    ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 shadow-xs unrestricted-glow"
                    : "border-border bg-surface text-muted hover:text-foreground"
                }`}
                title="When active, YouTube safeSearch is set to 'none', enabling discovery of all sensitive and mature (18+ / 35+) public content."
              >
                <ShieldAlert className="h-3.5 w-3.5" />
                <span>
                  {isUnrestrictedMode
                    ? "Unrestricted Mode (Sensitive & 18+/35+ Allowed)"
                    : "Filtered (Moderate)"}
                </span>
                <span className={`inline-block h-2 w-2 rounded-full ${isUnrestrictedMode ? "bg-emerald-500 animate-pulse" : "bg-muted/50"}`} />
              </button>

              {/* Save Search Title Button */}
              <Button
                type="button"
                variant="secondary"
                className="h-8 gap-1.5 px-3 text-xs"
                disabled={!settings.query.trim()}
                onClick={handleOpenSaveModal}
                title="Save this search query with a custom title"
              >
                <BookmarkPlus className="h-3.5 w-3.5 text-primary" />
                <span>Save Search Title</span>
              </Button>

              {/* Saved Searches Toggle */}
              <Button
                type="button"
                variant="ghost"
                className={`h-8 gap-1.5 px-3 text-xs ${savedSearchesOpen ? "bg-surface-muted text-foreground" : "text-muted"}`}
                onClick={() => setSavedSearchesOpen((v) => !v)}
                title="View and rerun your saved search titles"
              >
                <Bookmark className="h-3.5 w-3.5" />
                <span>Saved Searches</span>
                {savedSearches.length > 0 && (
                  <Badge tone="primary" className="px-1.5 py-0 text-[10px]">
                    {savedSearches.length}
                  </Badge>
                )}
                {savedSearchesOpen ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
              </Button>
            </div>

            {saveFeedback && (
              <div className="flex items-center gap-1.5 text-xs font-medium text-success">
                <Check className="h-3.5 w-3.5" />
                <span>{saveFeedback}</span>
              </div>
            )}
          </div>

          {/* ── Collapsible Saved Searches Shelf ──────────────────────── */}
          {savedSearchesOpen && (
            <div className="mt-4 rounded-lg border border-border/80 bg-surface-muted/40 p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Bookmark className="h-4 w-4 text-primary" />
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted">
                    Saved Search Titles ({sortedSavedSearches.length})
                  </p>
                </div>
                {sortedSavedSearches.length > 0 && (
                  <span className="text-[11px] text-muted">
                    Click Run to execute or click title to copy
                  </span>
                )}
              </div>

              {sortedSavedSearches.length === 0 ? (
                <div className="py-4 text-center text-xs text-muted">
                  No saved searches yet. Enter a search query and click &quot;Save Search Title&quot; to bookmark it here.
                </div>
              ) : (
                <div className="grid gap-2 max-h-72 overflow-y-auto pr-1 sm:grid-cols-2">
                  {sortedSavedSearches.map((s) => {
                    const isCopied = copiedSearchId === s.id;
                    const isEditing = editingSearchId === s.id;

                    return (
                      <div
                        key={s.id}
                        className="flex flex-col justify-between rounded-lg border border-border/70 bg-surface p-3 transition hover:border-primary/40 shadow-xs"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0 flex-1">
                            {isEditing ? (
                              <div className="flex items-center gap-1">
                                <input
                                  className="h-7 w-full rounded border border-border bg-surface px-2 text-xs"
                                  value={editTitleValue}
                                  onChange={(e) => setEditTitleValue(e.target.value)}
                                  autoFocus
                                />
                                <button
                                  className="rounded bg-primary px-2 py-1 text-[11px] text-white"
                                  onClick={() => {
                                    if (editTitleValue.trim()) {
                                      updateSavedSearch(s.id, { title: editTitleValue.trim() });
                                    }
                                    setEditingSearchId(null);
                                  }}
                                >
                                  Save
                                </button>
                                <button
                                  className="rounded px-1.5 py-1 text-[11px] text-muted hover:text-foreground"
                                  onClick={() => setEditingSearchId(null)}
                                >
                                  Cancel
                                </button>
                              </div>
                            ) : (
                              <p
                                className="truncate text-xs font-semibold text-foreground cursor-pointer hover:text-primary"
                                title={`${s.title} (click to copy)`}
                                onClick={() => handleCopySearchTitle(s)}
                              >
                                {s.title}
                              </p>
                            )}
                            <p className="mt-0.5 truncate text-[11px] text-muted font-mono" title={s.query}>
                              q: {s.query}
                            </p>
                            {s.notes && (
                              <p className="mt-0.5 line-clamp-1 text-[10px] text-muted italic">
                                {s.notes}
                              </p>
                            )}
                          </div>
                          <button
                            type="button"
                            onClick={() => togglePinSavedSearch(s.id)}
                            className="text-muted hover:text-warning"
                            title={s.isPinned ? "Unpin search" : "Pin to top"}
                          >
                            <Star className={`h-3.5 w-3.5 ${s.isPinned ? "fill-warning text-warning" : ""}`} />
                          </button>
                        </div>

                        <div className="mt-2.5 flex items-center justify-between border-t border-border/40 pt-2 text-[10px] text-muted">
                          <div className="flex items-center gap-1.5">
                            <Badge className="px-1 py-0 text-[9px] uppercase">{s.resourceSelection}</Badge>
                            {s.settings?.safeSearch === "none" && (
                              <span className="text-emerald-500 font-medium">Unrestricted</span>
                            )}
                          </div>
                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() => handleCopySearchTitle(s)}
                              className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-surface-muted hover:text-foreground"
                              title="Copy search title"
                            >
                              {isCopied ? <Check className="h-3 w-3 text-success" /> : <Copy className="h-3 w-3" />}
                              <span>{isCopied ? "Copied" : "Copy"}</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setEditingSearchId(s.id);
                                setEditTitleValue(s.title);
                              }}
                              className="rounded px-1.5 py-0.5 hover:bg-surface-muted hover:text-foreground"
                              title="Rename search title"
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              onClick={() => handleLoadSavedSearch(s, true)}
                              className="inline-flex items-center gap-1 rounded bg-primary-soft px-2 py-0.5 font-medium text-primary hover:bg-primary/20"
                              title="Load and run search immediately"
                            >
                              <Play className="h-2.5 w-2.5 fill-current" />
                              Run
                            </button>
                            <button
                              type="button"
                              onClick={() => deleteSavedSearch(s.id)}
                              className="rounded p-0.5 text-muted hover:text-danger hover:bg-danger/10"
                              title="Delete saved search"
                            >
                              <Trash2 className="h-3 w-3" />
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

          {/* ═══════════════════════════════════════════════════════════════
             Collapsible API Search Settings Panel
             ───────────────────────────────────────────────────────────────
             Exposes all YouTube Data API v3 search.list parameters in a
             responsive grid. Video-only filters are visually muted when
             the resource type is not "video" to signal they'll be ignored.
             Each control updates the settings state which is spread into
             the API call body on search. No extra API calls happen here.
             ═══════════════════════════════════════════════════════════════ */}
          {apiSettingsOpen && (
            <div className="mt-4 space-y-4 rounded-lg border border-border/60 bg-surface-muted/30 p-4">
              {/* Panel header with reset */}
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold uppercase tracking-wider text-muted">
                  YouTube API v3 Search Parameters
                </p>
                <Button
                  type="button"
                  variant="ghost"
                  className="h-7 gap-1 px-2 text-xs text-muted hover:text-foreground"
                  onClick={resetApiSettings}
                  title="Reset all API settings to defaults"
                >
                  <RotateCcw className="h-3 w-3" />
                  Reset
                </Button>
              </div>

              {/* ── Sort & Safety ─────────────────────────────────────────── */}
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <ApiSelect
                  label="Sort Order"
                  value={settings.order ?? "relevance"}
                  onChange={(v) => setSettings((s) => ({ ...s, order: v as YouTubeSearchSettings["order"] }))}
                  options={[
                    { value: "relevance", label: "Relevance" },
                    { value: "date", label: "Upload Date" },
                    { value: "rating", label: "Rating" },
                    { value: "viewCount", label: "View Count" },
                    { value: "title", label: "Title (A–Z)" },
                    { value: "videoCount", label: "Video Count" },
                  ]}
                />
                <ApiSelect
                  label="Safe Search"
                  value={settings.safeSearch ?? "none"}
                  onChange={(v) => setSettings((s) => ({ ...s, safeSearch: v as YouTubeSearchSettings["safeSearch"] }))}
                  options={[
                    { value: "none", label: "None (Unrestricted / Sensitive & 18+ Allowed)" },
                    { value: "moderate", label: "Moderate (Standard Filter)" },
                    { value: "strict", label: "Strict (Full Filter)" },
                  ]}
                />
              </div>

              {/* ── Region & Language ─────────────────────────────────────── */}
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <ApiSelect
                  label="Region (Country / Content Market)"
                  value={settings.regionCode ?? "US"}
                  onChange={(v) => setSettings((s) => ({ ...s, regionCode: v || undefined }))}
                  options={YOUTUBE_REGION_OPTIONS}
                />
                <ApiSelect
                  label="Relevance Language"
                  value={settings.relevanceLanguage ?? ""}
                  onChange={(v) => setSettings((s) => ({ ...s, relevanceLanguage: v || undefined }))}
                  options={YOUTUBE_LANGUAGE_OPTIONS}
                />
              </div>

              {/* ── Date Range ────────────────────────────────────────────── */}
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <ApiDateInput
                  label="Published After"
                  value={settings.publishedAfter ?? ""}
                  onChange={(v) => setSettings((s) => ({
                    ...s,
                    publishedAfter: v ? new Date(v).toISOString() : undefined,
                  }))}
                />
                <ApiDateInput
                  label="Published Before"
                  value={settings.publishedBefore ?? ""}
                  onChange={(v) => setSettings((s) => ({
                    ...s,
                    publishedBefore: v ? new Date(v).toISOString() : undefined,
                  }))}
                />
              </div>

              {/* ── Video-Only Filters ────────────────────────────────────── */}
              <div>
                {!isVideoOnly && (
                  <p className="mb-2 text-[10px] text-muted italic">
                    ⚠ Video-only filters below apply only when resource type is &quot;Videos&quot;
                  </p>
                )}
                <div className={`grid gap-3 sm:grid-cols-2 lg:grid-cols-4 ${!isVideoOnly ? "opacity-50" : ""}`}>
                  <ApiSelect
                    label="Duration"
                    value={settings.videoDuration ?? "any"}
                    onChange={(v) => setSettings((s) => ({ ...s, videoDuration: v as YouTubeSearchSettings["videoDuration"] }))}
                    options={[
                      { value: "any", label: "Any" },
                      { value: "short", label: "Short (< 4 min)" },
                      { value: "medium", label: "Medium (4–20 min)" },
                      { value: "long", label: "Long (> 20 min)" },
                    ]}
                  />
                  <ApiSelect
                    label="Definition"
                    value={settings.videoDefinition ?? "any"}
                    onChange={(v) => setSettings((s) => ({ ...s, videoDefinition: v as YouTubeSearchSettings["videoDefinition"] }))}
                    options={[
                      { value: "any", label: "Any" },
                      { value: "high", label: "HD" },
                      { value: "standard", label: "SD" },
                    ]}
                  />
                  <ApiSelect
                    label="Captions"
                    value={settings.videoCaption ?? "any"}
                    onChange={(v) => setSettings((s) => ({ ...s, videoCaption: v as YouTubeSearchSettings["videoCaption"] }))}
                    options={[
                      { value: "any", label: "Any" },
                      { value: "closedCaption", label: "Has Captions" },
                      { value: "none", label: "No Captions" },
                    ]}
                  />
                  <ApiSelect
                    label="Embeddable"
                    value={settings.videoEmbeddable ?? "any"}
                    onChange={(v) => setSettings((s) => ({ ...s, videoEmbeddable: v as YouTubeSearchSettings["videoEmbeddable"] }))}
                    options={[
                      { value: "any", label: "Any" },
                      { value: "true", label: "Embeddable Only" },
                    ]}
                  />
                </div>
              </div>

              {/* ── Live & Topics ─────────────────────────────────────────── */}
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <ApiSelect
                  label="Event Type"
                  value={settings.eventType ?? ""}
                  onChange={(v) => setSettings((s) => ({ ...s, eventType: (v || undefined) as YouTubeSearchSettings["eventType"] }))}
                  options={[
                    { value: "", label: "Any (no filter)" },
                    { value: "live", label: "Live Now" },
                    { value: "completed", label: "Completed Live" },
                    { value: "upcoming", label: "Upcoming Live" },
                  ]}
                  disabled={!isVideoOnly}
                />
                <ApiTextInput
                  label="Topic ID"
                  value={settings.topicId ?? ""}
                  onChange={(v) => setSettings((s) => ({ ...s, topicId: v || undefined }))}
                  placeholder="/m/04rlf"
                  maxLength={100}
                  hint="Freebase topic ID (e.g. /m/04rlf = Music)"
                />
              </div>
            </div>
          )}
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
        <section className="workspace-grid-12">
          {/* ── Advanced Filters Panel ──────────────────────────────────── */}
          <AdvancedFiltersPanel
            filters={filters}
            onFiltersChange={(f) => { setFilters(f); setVisibleCount(PAGE_SIZE); }}
            totalCount={totalItems.length}
            filteredCount={filteredItems.length}
            defaultSort="latest"
            searchPlaceholder="Search inside results (no API calls)"
            showTypeFilters={true}
          />

          {/* ── Results area ─────────────────────────────────────────────── */}
          <div className="col-span-12 space-y-4 xl:col-span-9">
            {/* Results toolbar */}
            <div className="research-surface p-4">
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
                <Filter className="h-3.5 w-3.5" />
                local search → local filters → local sort → render
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <Badge tone="success">
                  Showing {filteredItems.length} of {totalItems.length} results
                </Badge>
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
        </section>
      )}

      {manifest && !loading && (
        <AiAssistantPanel
          manifest={manifest}
          selectedItem={selectedItem}
          onSuggestedQuery={(q) => {
            setSettings((prev) => ({ ...prev, query: q }));
            window.scrollTo({ top: 0, behavior: "smooth" });
          }}
        />
      )}

      {/* ── Save Search Title Modal ────────────────────────────────────── */}
      {isSaveModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs">
          <div className="w-full max-w-md rounded-xl border border-border bg-surface p-6 shadow-xl animate-scale-in">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <BookmarkPlus className="h-5 w-5 text-primary" />
                <h3 className="text-base font-semibold text-foreground">Save Search Title</h3>
              </div>
              <button
                type="button"
                onClick={() => setIsSaveModalOpen(false)}
                className="rounded-lg p-1 text-muted hover:bg-surface-muted hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <p className="mt-1 text-xs text-muted">
              Give this search query a clear title to save it to your local research presets.
            </p>

            <form onSubmit={handleConfirmSave} className="mt-4 space-y-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-foreground">
                  Search Title / Label <span className="text-danger">*</span>
                </label>
                <input
                  type="text"
                  required
                  className="h-10 w-full rounded-lg border border-border bg-surface px-3 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--ring)]"
                  placeholder="e.g. 2026 AI Breakdown or Sensitive Content Exploration"
                  value={saveTitleInput}
                  onChange={(e) => setSaveTitleInput(e.target.value)}
                  autoFocus
                />
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium text-muted">
                  YouTube Query (Locked)
                </label>
                <input
                  type="text"
                  disabled
                  className="h-9 w-full rounded-lg border border-border bg-surface-muted px-3 text-xs text-muted font-mono opacity-80"
                  value={settings.query}
                />
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium text-muted">
                  Notes (Optional)
                </label>
                <textarea
                  className="w-full rounded-lg border border-border bg-surface p-2.5 text-xs focus:outline-none focus:ring-2 focus:ring-[var(--ring)]"
                  rows={2}
                  placeholder="Add context, research keywords, tags…"
                  value={saveNotesInput}
                  onChange={(e) => setSaveNotesInput(e.target.value)}
                />
              </div>

              <div className="flex items-center justify-between rounded-lg border border-border/60 bg-surface-muted/30 p-2.5 text-xs text-muted">
                <span>Resource: <strong>{resourceSelection}</strong></span>
                <span>
                  SafeSearch:{" "}
                  <strong className={settings.safeSearch === "none" ? "text-emerald-500" : ""}>
                    {settings.safeSearch === "none" ? "Unrestricted (None)" : settings.safeSearch}
                  </strong>
                </span>
              </div>

              <div className="mt-5 flex justify-end gap-2 pt-2">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setIsSaveModalOpen(false)}
                >
                  Cancel
                </Button>
                <Button type="submit" variant="primary">
                  Save Search Title
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   API Settings Sub-Components — reusable select, text input, date input
   ──────────────────────────────────────────────────────────────────────────
   These small form controls are styled to match the search workspace's
   design language. They provide labels, hints, and consistent sizing for
   the collapsible API settings panel.
   ═══════════════════════════════════════════════════════════════════════════ */

function ApiSelect({
  label,
  value,
  onChange,
  options,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
  disabled?: boolean;
}) {
  return (
    <div className="space-y-1">
      <label className="text-[11px] font-medium text-muted">{label}</label>
      <select
        className="h-9 w-full rounded-md border border-border bg-surface px-2.5 text-xs focus:outline-none focus:ring-2 focus:ring-[var(--ring)] disabled:cursor-not-allowed disabled:opacity-40"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </div>
  );
}

function ApiTextInput({
  label,
  value,
  onChange,
  placeholder,
  maxLength,
  hint,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  maxLength?: number;
  hint?: string;
}) {
  return (
    <div className="space-y-1">
      <label className="text-[11px] font-medium text-muted">{label}</label>
      <input
        className="h-9 w-full rounded-md border border-border bg-surface px-2.5 text-xs uppercase focus:outline-none focus:ring-2 focus:ring-[var(--ring)]"
        value={value}
        onChange={(e) => onChange(e.target.value.trim())}
        placeholder={placeholder}
        maxLength={maxLength}
      />
      {hint && <p className="text-[10px] text-muted/70">{hint}</p>}
    </div>
  );
}

function ApiDateInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  /* Convert ISO string back to YYYY-MM-DD for the date input */
  const dateValue = value ? value.slice(0, 10) : "";

  return (
    <div className="space-y-1">
      <label className="text-[11px] font-medium text-muted">{label}</label>
      <input
        type="date"
        className="h-9 w-full rounded-md border border-border bg-surface px-2.5 text-xs focus:outline-none focus:ring-2 focus:ring-[var(--ring)]"
        value={dateValue}
        onChange={(e) => onChange(e.target.value)}
      />
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
