"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { YouTubeManifest, PersistedLastSearch } from "@/types/manifest";
import { LAST_SEARCH_TTL_MS } from "@/types/manifest";
import type { NormalizedYouTubeDiscoveryItem, SavedSearch, SearchHistoryItem, YouTubeResultFilters } from "@/types/youtube";

export type SuggestionSourcePriority = "manifest" | "same_channel" | "mixed";

export interface WatchExperienceSettings {
  defaultAutoplay: boolean;
  suggestedVideosCount: 10 | 20 | 30;
  suggestionSourcePriority: SuggestionSourcePriority;
  includeSameChannel: boolean;
  includeCrossChannel: boolean;
  preferRecentVideos: boolean;
  preferHighViewVideos: boolean;
  showShortsLikeVideos: boolean;
  showPlayerControls: boolean;
  autoplayNext: boolean;
}

export const DEFAULT_WATCH_SETTINGS: WatchExperienceSettings = {
  defaultAutoplay: false,
  suggestedVideosCount: 10,
  suggestionSourcePriority: "manifest",
  includeSameChannel: true,
  includeCrossChannel: true,
  preferRecentVideos: true,
  preferHighViewVideos: false,
  showShortsLikeVideos: true,
  showPlayerControls: true,
  autoplayNext: false,
};

export interface FetchSettings {
  pageSize: number;
  maxPages: number;
  maxItems: number;
  /** Default safeSearch policy: none (unrestricted/sensitive allowed), moderate, or strict */
  defaultSafeSearch: "none" | "moderate" | "strict";
}

export const DEFAULT_FETCH_SETTINGS: FetchSettings = {
  pageSize: 25,
  maxPages: 3,
  maxItems: 150,
  defaultSafeSearch: "none",
};

interface YouTubeWorkspaceStore {
  currentManifest: YouTubeManifest | null;
  savedManifestIds: string[];
  savedItems: NormalizedYouTubeDiscoveryItem[];
  savedSearches: SavedSearch[];
  searchHistory: SearchHistoryItem[];
  watchSettings: WatchExperienceSettings;
  fetchSettings: FetchSettings;
  isSidebarOpen: boolean;
  lastSearch: PersistedLastSearch | null;
  setCurrentManifest: (manifest: YouTubeManifest | null) => void;
  markManifestSaved: (manifestId: string) => void;
  toggleItemSaved: (item: NormalizedYouTubeDiscoveryItem) => void;
  saveSearch: (search: Omit<SavedSearch, "id" | "createdAt">) => SavedSearch;
  updateSavedSearch: (id: string, patch: Partial<SavedSearch>) => void;
  deleteSavedSearch: (id: string) => void;
  togglePinSavedSearch: (id: string) => void;
  recordSearchHistory: (item: Omit<SearchHistoryItem, "id" | "timestamp"> & { id?: string }) => SearchHistoryItem;
  deleteSearchHistoryItem: (id: string) => void;
  clearSearchHistory: () => void;
  setLastSearch: (search: PersistedLastSearch) => void;
  updateLastSearchFilters: (filters: YouTubeResultFilters) => void;
  clearLastSearch: () => void;
  updateWatchSettings: (settings: Partial<WatchExperienceSettings>) => void;
  updateFetchSettings: (settings: Partial<FetchSettings>) => void;
  toggleSidebar: () => void;
}

import {
  formatSearchTtlRemaining,
  getSearchStorageTtlMs,
  isSearchExpired,
} from "@/lib/config/search-storage-config";

/**
 * Validates whether a persisted search session is still fresh against the configurable TTL
 * and contains valid manifest items.
 */
export function isLastSearchValid(lastSearch: PersistedLastSearch | null | undefined): boolean {
  if (!lastSearch || typeof lastSearch.searchedAt !== "number" || !lastSearch.manifest) {
    return false;
  }
  return !isSearchExpired(lastSearch.searchedAt, lastSearch.expiresAt);
}

/**
 * Formats the elapsed time and remaining TTL for a persisted search.
 */
export function formatSearchCacheAge(
  searchedAt: number,
  expiresAt?: number,
): { elapsedText: string; remainingText: string } {
  return formatSearchTtlRemaining(searchedAt, expiresAt);
}



// This client store preserves non-secret workspace context across Search,
// Watch, Channel, and Playlist navigation. It intentionally stores only
// normalized manifest metadata and user display preferences; provider keys,
// database authority, and privileged persistence stay on server routes.
export const useYouTubeWorkspaceStore = create<YouTubeWorkspaceStore>()(
  persist(
    (set) => ({
      currentManifest: null,
      savedManifestIds: [],
      savedItems: [],
      savedSearches: [],
      searchHistory: [],
      watchSettings: DEFAULT_WATCH_SETTINGS,
      fetchSettings: DEFAULT_FETCH_SETTINGS,
      isSidebarOpen: true,
      setCurrentManifest: (manifest) => set({ currentManifest: manifest }),
      markManifestSaved: (manifestId) =>
        set((state) => ({
          savedManifestIds: state.savedManifestIds.includes(manifestId)
            ? state.savedManifestIds
            : [...state.savedManifestIds, manifestId],
          currentManifest:
            state.currentManifest?.manifestId === manifestId
              ? { ...state.currentManifest, saved: true }
              : state.currentManifest,
        })),
      toggleItemSaved: (item) =>
        set((state) => {
          const isSaved = state.savedItems.some((i) => i.platformItemId === item.platformItemId && i.itemType === item.itemType);
          if (isSaved) {
            return { savedItems: state.savedItems.filter((i) => !(i.platformItemId === item.platformItemId && i.itemType === item.itemType)) };
          }
          // Exclude rawJson to save space in localStorage
          const itemToSave = { ...item, rawJson: undefined };
          return { savedItems: [...state.savedItems, itemToSave] };
        }),
      saveSearch: (searchData) => {
        const id = `search-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        const newSearch: SavedSearch = {
          ...searchData,
          id,
          createdAt: new Date().toISOString(),
        };
        set((state) => ({
          savedSearches: [newSearch, ...state.savedSearches],
        }));
        return newSearch;
      },
      updateSavedSearch: (id, patch) =>
        set((state) => ({
          savedSearches: state.savedSearches.map((s) =>
            s.id === id ? { ...s, ...patch, updatedAt: new Date().toISOString() } : s
          ),
        })),
      deleteSavedSearch: (id) =>
        set((state) => ({
          savedSearches: state.savedSearches.filter((s) => s.id !== id),
        })),
      togglePinSavedSearch: (id) =>
        set((state) => ({
          savedSearches: state.savedSearches.map((s) =>
            s.id === id ? { ...s, isPinned: !s.isPinned } : s
          ),
        })),
      recordSearchHistory: (itemData) => {
        const id = itemData.id || `hist-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        const newItem: SearchHistoryItem = {
          ...itemData,
          id,
          timestamp: new Date().toISOString(),
        };
        set((state) => ({
          // Store up to 100 most recent searches in history
          searchHistory: [newItem, ...state.searchHistory.filter((h) => h.id !== id)].slice(0, 100),
        }));
        return newItem;
      },
      deleteSearchHistoryItem: (id) =>
        set((state) => ({
          searchHistory: state.searchHistory.filter((item) => item.id !== id),
        })),
      clearSearchHistory: () =>
        set(() => ({
          searchHistory: [],
        })),
      lastSearch: null,
      setLastSearch: (search) =>
        set({
          lastSearch: search,
        }),
      updateLastSearchFilters: (filters) =>
        set((state) => ({
          lastSearch: state.lastSearch ? { ...state.lastSearch, filters } : null,
        })),
      clearLastSearch: () =>
        set({
          lastSearch: null,
        }),
      updateWatchSettings: (settings) =>
        set((state) => ({
          watchSettings: {
            ...state.watchSettings,
            ...settings,
          },
        })),
      updateFetchSettings: (settings) =>
        set((state) => ({
          fetchSettings: {
            ...state.fetchSettings,
            ...settings,
          },
        })),
      toggleSidebar: () => set((state) => ({ isSidebarOpen: !state.isSidebarOpen })),
    }),
    {
      name: "youtube-discovery-workspace",
      partialize: (state) => ({
        currentManifest: state.currentManifest,
        savedManifestIds: state.savedManifestIds,
        savedItems: state.savedItems,
        savedSearches: state.savedSearches,
        searchHistory: state.searchHistory,
        watchSettings: state.watchSettings,
        fetchSettings: state.fetchSettings,
        isSidebarOpen: state.isSidebarOpen,
        lastSearch: state.lastSearch,
      }),
    },
  ),
);
