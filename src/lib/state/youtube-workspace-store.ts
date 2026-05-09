"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { YouTubeManifest } from "@/types/manifest";

import type { NormalizedYouTubeDiscoveryItem } from "@/types/youtube";

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
}

export const DEFAULT_FETCH_SETTINGS: FetchSettings = {
  pageSize: 25,
  maxPages: 3,
  maxItems: 150,
};

interface YouTubeWorkspaceStore {
  currentManifest: YouTubeManifest | null;
  savedManifestIds: string[];
  savedItems: NormalizedYouTubeDiscoveryItem[];
  watchSettings: WatchExperienceSettings;
  fetchSettings: FetchSettings;
  isSidebarOpen: boolean;
  setCurrentManifest: (manifest: YouTubeManifest | null) => void;
  markManifestSaved: (manifestId: string) => void;
  toggleItemSaved: (item: NormalizedYouTubeDiscoveryItem) => void;
  updateWatchSettings: (settings: Partial<WatchExperienceSettings>) => void;
  updateFetchSettings: (settings: Partial<FetchSettings>) => void;
  toggleSidebar: () => void;
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
        watchSettings: state.watchSettings,
        fetchSettings: state.fetchSettings,
        isSidebarOpen: state.isSidebarOpen,
      }),
    },
  ),
);
