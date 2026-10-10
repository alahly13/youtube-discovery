"use client";

import {
  AlertTriangle,
  Bookmark,
  BookmarkPlus,
  Check,
  ChevronDown,
  ChevronUp,
  Clock,
  Copy,
  Dices,
  Download,
  Eraser,
  Filter,
  Loader2,
  Play,
  RotateCcw,
  Save,
  Search,
  ShieldAlert,
  Shuffle,
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
import { BackToTop } from "@/components/ui/back-to-top";
import { applyYouTubeResultPipeline } from "@/lib/filters/youtube-result-filters";
import { authFetch } from "@/lib/client/auth-fetch";
import { saveSearchRecord } from "@/lib/client/blob-upload";
import { isSubmittableQuery } from "@/lib/search/query-pipeline";
import {
  shuffleOneWord,
  shuffleWords,
  trimSpaces,
  type QueryTransformResult,
} from "@/lib/search/query-transforms";
import {
  formatSearchCacheAge,
  isLastSearchValid,
  useYouTubeWorkspaceStore,
} from "@/lib/state/youtube-workspace-store";

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
  /* Secondary controls live in a collapsible panel (collapsed by default)
     so the search input owns its own full-width row. */
  const [optionsOpen, setOptionsOpen] = useState(false);
  /* Smart-transform feedback (no-op notes) + double-fire guard. */
  const [transformNote, setTransformNote] = useState<string | null>(null);
  const transformBusyRef = useRef(false);

  const setCurrentManifest = useYouTubeWorkspaceStore((s) => s.setCurrentManifest);
  const fetchSettings = useYouTubeWorkspaceStore((s) => s.fetchSettings);

  /* ── 24h Persisted Last Search State ─────────────────────────────────── */
  const lastSearch = useYouTubeWorkspaceStore((s) => s.lastSearch);
  const setLastSearch = useYouTubeWorkspaceStore((s) => s.setLastSearch);
  const updateLastSearchFilters = useYouTubeWorkspaceStore((s) => s.updateLastSearchFilters);
  const clearLastSearch = useYouTubeWorkspaceStore((s) => s.clearLastSearch);

  const hasRestoredRef = useRef(false);
  const [isRestoredFromCache, setIsRestoredFromCache] = useState(false);

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
      const rawQuery = overrideQuery ?? settings.query;
      /* Blank-gate only: whitespace-only input is blocked WITHOUT modifying
         the query. A non-blank query is submitted EXACTLY as entered. */
      if (!isSubmittableQuery(rawQuery)) return;
      const activeQuery = rawQuery;

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
        const response = await authFetch("/api/youtube/search", {
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
        setIsRestoredFromCache(false);
        hasRestoredRef.current = true;

        const searchRecordId = `search-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const searchedAt = Date.now();

        // Persist search results for configurable TTL or until a new search is performed
        setLastSearch({
          id: searchRecordId,
          query: activeQuery,
          resourceSelection: activeResource,
          settings: { ...activeSettings },
          filters,
          manifest: newManifest,
          searchedAt,
        });

        // Also persist complete record with full rawJson to server Blob archive
        // (direct POST for small records, staged chunked upload when large).
        saveSearchRecord({
          id: searchRecordId,
          query: activeQuery,
          resourceSelection: activeResource,
          settings: { ...activeSettings },
          filters,
          manifest: newManifest,
        }).catch((archiveErr: unknown) => {
          console.error("Failed to archive search on server:", archiveErr);
        });

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
          id: searchRecordId,
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
    [fetchSettings, filters, recordSearchHistory, resourceSelection, setCurrentManifest, setLastSearch, settings],
  );

  /* ── Clear All Search Results and Persisted Cache ──────────────────── */
  const handleClearSearch = useCallback(() => {
    startTransition(() => {
      setManifest(null);
      setIsRestoredFromCache(false);
      setSettings(initialSettings);
      setError(null);
    });
    setCurrentManifest(null);
    clearLastSearch();
    hasRestoredRef.current = true;
    authFetch("/api/search-storage", { method: "DELETE" }).catch(() => {});
  }, [clearLastSearch, setCurrentManifest]);

  /* ── Direct Load from Archived Search Record (?load=...) ───────────── */
  useEffect(() => {
    const loadId = searchParams.get("load");
    if (!loadId) return;
    const validLoadId = loadId;

    let cancelled = false;
    async function loadArchivedSearch() {
      try {
        setLoading(true);
        setError(null);
        const res = await authFetch(`/api/search-storage/${encodeURIComponent(validLoadId)}`);
        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.error || "Archived search not found or expired");
        }
        const data = await res.json();
        if (cancelled) return;
        const record = data.record;
        if (record && record.manifest) {
          startTransition(() => {
            setManifest(record.manifest);
            setSettings(record.settings);
            setResourceSelection(record.resourceSelection);
            if (record.filters) {
              setFilters(record.filters);
            }
            setIsRestoredFromCache(true);
          });
          setCurrentManifest(record.manifest);
          setLastSearch({
            id: record.id,
            query: record.query,
            resourceSelection: record.resourceSelection,
            settings: record.settings,
            filters: record.filters,
            manifest: record.manifest,
            searchedAt: record.searchedAt,
            expiresAt: record.expiresAt ?? undefined,
          });
          hasRestoredRef.current = true;
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load archived search");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    loadArchivedSearch();
    return () => {
      cancelled = true;
    };
  }, [searchParams, setCurrentManifest, setLastSearch]);

  /* ── Restore Persisted Last Search (Valid for configurable TTL) ────── */
  useEffect(() => {
    // If URL has a specific query parameter (?q=... or ?load=...), let those take precedence
    if (searchParams.get("q") || searchParams.get("load")) return;
    if (hasRestoredRef.current) return;

    if (lastSearch) {
      if (!isLastSearchValid(lastSearch)) {
        clearLastSearch();
        return;
      }

      hasRestoredRef.current = true;
      startTransition(() => {
        setManifest(lastSearch.manifest);
        setSettings(lastSearch.settings);
        setResourceSelection(lastSearch.resourceSelection);
        if (lastSearch.filters) {
          setFilters(lastSearch.filters);
        }
        setIsRestoredFromCache(true);
      });
      setCurrentManifest(lastSearch.manifest);
      return;
    }

    // Fallback: restore latest complete search from server archive if store was empty
    let cancelled = false;
    authFetch("/api/search-storage/latest")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled || !data || !data.record) return;
        const rec = data.record;
        if (rec.manifest) {
          hasRestoredRef.current = true;
          startTransition(() => {
            setManifest(rec.manifest);
            setSettings(rec.settings);
            setResourceSelection(rec.resourceSelection);
            if (rec.filters) {
              setFilters(rec.filters);
            }
            setIsRestoredFromCache(true);
          });
          setCurrentManifest(rec.manifest);
          setLastSearch({
            id: rec.id,
            query: rec.query,
            resourceSelection: rec.resourceSelection,
            settings: rec.settings,
            filters: rec.filters,
            manifest: rec.manifest,
            searchedAt: rec.searchedAt,
            expiresAt: rec.expiresAt ?? undefined,
          });
        }
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [lastSearch, searchParams, clearLastSearch, setCurrentManifest, setLastSearch]);

  /* ── Periodic & Focus-based Expiration Guard (24h TTL) ──────────────── */
  useEffect(() => {
    const checkExpiration = () => {
      if (lastSearch && !isLastSearchValid(lastSearch)) {
        clearLastSearch();
        if (isRestoredFromCache) {
          startTransition(() => {
            setManifest(null);
            setIsRestoredFromCache(false);
          });
        }
      }
    };

    window.addEventListener("focus", checkExpiration);
    const interval = setInterval(checkExpiration, 60 * 1000);
    return () => {
      window.removeEventListener("focus", checkExpiration);
      clearInterval(interval);
    };
  }, [lastSearch, isRestoredFromCache, clearLastSearch]);

  /* ── Detect Query from URL (Forwarded from History with auto-paste) ─── */
  /* Next.js decodes ?q= exactly once; the value is used verbatim (blank-gated). */
  useEffect(() => {
    const qParam = searchParams.get("q");
    if (qParam && isSubmittableQuery(qParam)) {
      const decodedQuery = qParam;

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

  /* ── Smart Query Transformations ───────────────────────────────────
     Each button reads the LIVE input state, transforms it, writes the
     result back to the visible input, and submits the transformed string
     EXPLICITLY via executeSearch override — never relying on just-updated
     state (which would submit the stale pre-transform query). The
     transformed query then flows through the normal pipeline (history,
     filters, quota, pagination) untouched. No-ops show a subtle note and
     fire no search; in-flight searches block re-entry via the busy ref. */
  const runQueryTransform = (transform: (query: string) => QueryTransformResult) => {
    if (loading || transformBusyRef.current) return;
    const current = settings.query;
    if (!isSubmittableQuery(current)) {
      setTransformNote("Type a search query first");
      return;
    }
    const result = transform(current);
    if (!result.changed) {
      setTransformNote(result.message ?? "No change");
      return;
    }
    transformBusyRef.current = true;
    setTransformNote(null);
    setSettings((c) => ({ ...c, query: result.query }));
    void executeSearch(result.query).finally(() => {
      transformBusyRef.current = false;
    });
  };

  /* ── Save Search Title Handlers ────────────────────────────────────────
     Title is a user label (trimmed, blank-guarded). The saved QUERY is the
     exact submitted string, preserved verbatim for faithful re-execution. */
  const handleOpenSaveModal = () => {
    if (!isSubmittableQuery(settings.query)) return;
    setSaveTitleInput(settings.query.trim());
    setSaveNotesInput("");
    setIsSaveModalOpen(true);
  };

  const handleConfirmSave = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!saveTitleInput.trim()) return;

    saveSearch({
      title: saveTitleInput.trim(),
      query: settings.query,
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
            className="w-full"
            onSubmit={(e) => {
              e.preventDefault();
              void runSearch();
            }}
          >
            {/* ── Full-width premium search input ───────────────────────
                The input owns its own row (w-full, min-w-0). The submit
                action lives INSIDE the input container so it never shrinks
                the text field. Enter submission is preserved via the form.
                ─────────────────────────────────────────────────────────── */}
            <div className="relative w-full min-w-0">
              <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
              <input
                ref={searchInputRef}
                aria-label="YouTube search query"
                className={`h-12 w-full min-w-0 rounded-xl border bg-surface pl-11 pr-24 text-[15px] shadow-xs transition-all focus:outline-none focus:ring-2 focus:ring-[var(--ring)] sm:pr-32 ${
                  pastedFromHistory
                    ? "border-emerald-500 ring-2 ring-emerald-500/50 shadow-sm shadow-emerald-500/20"
                    : "border-border focus:border-primary/50"
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
                  className="absolute right-24 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-muted transition-colors hover:bg-surface-muted hover:text-foreground sm:right-28"
                  title="Clear search query"
                  aria-label="Clear search query"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
              <button
                type="submit"
                disabled={loading || !isSubmittableQuery(settings.query)}
                className="absolute right-1.5 top-1/2 inline-flex h-9 -translate-y-1/2 items-center gap-1.5 rounded-lg border border-primary bg-primary px-3 text-sm font-medium text-white transition hover:bg-primary-strong disabled:cursor-not-allowed disabled:opacity-50 dark:text-[#240004] sm:px-4"
                title="Run YouTube search (Enter)"
              >
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                <span className="hidden sm:inline">Search</span>
              </button>
            </div>
          </form>

          {/* ── Smart query transformations ──────────────────────────
              Three buttons directly under the full-width Search Bar. Each
              rewrites the LIVE input value and auto-submits the transformed
              query through the normal pipeline. Independent of the options
              panel below (which keeps its own collapsed/expanded state). */}
          <div
            className="mt-2.5 flex flex-wrap items-center gap-2"
            role="group"
            aria-label="Smart query transformations"
          >
            <TransformButton
              icon={<Shuffle className="h-3.5 w-3.5" />}
              label="Shuffle Words"
              title="Randomly reorder the words (Enter to run a plain search instead)"
              disabled={loading || !isSubmittableQuery(settings.query)}
              onClick={() => runQueryTransform(shuffleWords)}
            />
            <TransformButton
              icon={<Eraser className="h-3.5 w-3.5" />}
              label="Trim Spaces"
              title="Remove leading and trailing whitespace only"
              disabled={loading || !isSubmittableQuery(settings.query)}
              onClick={() => runQueryTransform(trimSpaces)}
            />
            <TransformButton
              icon={<Dices className="h-3.5 w-3.5" />}
              label="Shuffle One Word"
              title="Shuffle the characters inside one randomly picked word"
              disabled={loading || !isSubmittableQuery(settings.query)}
              onClick={() => runQueryTransform(shuffleOneWord)}
            />
            {transformNote && (
              <span role="status" className="text-xs text-muted">
                {transformNote}
              </span>
            )}
          </div>

          {/* ── Collapsible search options (collapsed by default) ───────
              Resource type, API parameters, and quick controls live here.
              Collapsing never resets state, never submits, and the input +
              Enter submission work independently of this panel. */}
          <div className="mt-3">
            <button
              type="button"
              onClick={() => setOptionsOpen((v) => !v)}
              aria-expanded={optionsOpen}
              aria-controls="search-options-panel"
              className="flex w-full items-center justify-between gap-3 rounded-xl border border-border bg-surface px-3.5 py-2.5 text-sm transition hover:border-primary/40 hover:bg-surface-muted/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
            >
              <span className="flex min-w-0 items-center gap-2">
                <SlidersHorizontal className="h-4 w-4 shrink-0 text-muted" />
                <span className="truncate font-medium">Search options & filters</span>
                {activeApiCount > 0 && (
                  <Badge tone="primary" className="shrink-0 px-1.5 py-0 text-[10px]">
                    {activeApiCount} active
                  </Badge>
                )}
                {resourceSelection !== "ALL" && (
                  <Badge tone="neutral" className="shrink-0 px-1.5 py-0 text-[10px] uppercase">
                    {resourceSelection}
                  </Badge>
                )}
              </span>
              {optionsOpen ? (
                <ChevronUp className="h-4 w-4 shrink-0 text-muted" />
              ) : (
                <ChevronDown className="h-4 w-4 shrink-0 text-muted" />
              )}
            </button>
            <div
              id="search-options-panel"
              role="region"
              aria-label="Search options and filters"
              inert={!optionsOpen}
              className={`grid transition-all duration-300 ease-in-out ${
                optionsOpen ? "mt-3 grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
              }`}
            >
              <div className="min-h-0 overflow-hidden">
                <div className="grid gap-3 rounded-xl border border-border/60 bg-surface-muted/30 p-3 sm:grid-cols-2">
                  <div className="space-y-1">
                    <label htmlFor="search-resource-type" className="text-[11px] font-medium text-muted">
                      Resource type
                    </label>
                    <select
                      id="search-resource-type"
                      className="h-10 w-full rounded-lg border border-border bg-surface px-3 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--ring)]"
                      value={resourceSelection}
                      onChange={(e) => setResourceSelection(e.target.value as YouTubeSearchResourceSelection)}
                    >
                      <option value="ALL">ALL</option>
                      <option value="video">Videos</option>
                      <option value="channel">Channels</option>
                      <option value="playlist">Playlists</option>
                    </select>
                  </div>
                  <div className="space-y-1">
                    <span className="text-[11px] font-medium text-muted">
                      API parameters{activeApiCount > 0 ? ` (${activeApiCount} active)` : ""}
                    </span>
                    {/* ── API Settings toggle button ────────────────────
                        Badge shows the count of non-default settings.
                        ──────────────────────────────────────────────── */}
                    <Button
                      type="button"
                      variant="secondary"
                      className="h-10 w-full gap-1.5"
                      onClick={() => setApiSettingsOpen((v) => !v)}
                      title={apiSettingsOpen ? "Collapse API settings" : "Expand API settings"}
                      aria-expanded={apiSettingsOpen}
                    >
                      <SlidersHorizontal className="h-4 w-4" />
                      <span>API Settings</span>
                      {activeApiCount > 0 && (
                        <Badge tone="primary" className="ml-1 px-1.5 py-0 text-[10px]">
                          {activeApiCount}
                        </Badge>
                      )}
                      {apiSettingsOpen ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                    </Button>
                  </div>
                </div>

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
                disabled={!isSubmittableQuery(settings.query)}
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
              </div>
            </div>
          </div>
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
            onFiltersChange={(f) => {
              setFilters(f);
              setVisibleCount(PAGE_SIZE);
              updateLastSearchFilters(f);
            }}
            totalCount={totalItems.length}
            filteredCount={filteredItems.length}
            defaultSort="latest"
            searchPlaceholder="Search inside results (no API calls)"
            showTypeFilters={true}
          />

          {/* ── Results area ─────────────────────────────────────────────── */}
          <div className="col-span-12 space-y-4 xl:col-span-9">
            {/* ── 24-Hour Persisted Search Banner ──────────────────────── */}
            {lastSearch && isLastSearchValid(lastSearch) && (
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-primary/30 bg-primary-soft/30 px-3.5 py-2.5 text-xs text-foreground shadow-xs animate-slide-in">
                <div className="flex items-center gap-2 min-w-0">
                  <Clock className="h-4 w-4 shrink-0 text-primary animate-pulse" />
                  <span className="truncate">
                    <strong>Last Search Persisted (24h Cache):</strong> Results for &ldquo;{lastSearch.query}&rdquo; remain stored for one day ({formatSearchCacheAge(lastSearch.searchedAt).elapsedText} • {formatSearchCacheAge(lastSearch.searchedAt).remainingText} remaining)
                  </span>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Button
                    type="button"
                    variant="ghost"
                    className="h-7 text-xs text-muted hover:text-danger hover:bg-danger/10"
                    onClick={handleClearSearch}
                    title="Clear persisted search results and reset workspace"
                  >
                    <Trash2 className="h-3.5 w-3.5 mr-1" />
                    Clear Results
                  </Button>
                </div>
              </div>
            )}

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
                <Button variant="ghost" onClick={handleClearSearch} title="Clear search results and cached manifest">
                  <Trash2 className="h-4 w-4 text-danger/80" />
                  Clear results
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

      {/* ── Floating Back to Top Button ─────────────────────────────────── */}
      <BackToTop threshold={350} />
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

function TransformButton({
  icon,
  label,
  title,
  disabled,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  title: string;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={label}
      className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-surface px-3 text-xs font-medium text-foreground shadow-xs transition hover:border-primary/50 hover:bg-primary-soft hover:text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-border disabled:hover:bg-surface disabled:hover:text-foreground"
    >
      <span className="text-primary">{icon}</span>
      <span>{label}</span>
    </button>
  );
}

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
