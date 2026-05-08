"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { YouTubeManifest } from "@/types/manifest";

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

interface YouTubeWorkspaceStore {
  currentManifest: YouTubeManifest | null;
  savedManifestIds: string[];
  watchSettings: WatchExperienceSettings;
  isSidebarOpen: boolean;
  setCurrentManifest: (manifest: YouTubeManifest | null) => void;
  markManifestSaved: (manifestId: string) => void;
  updateWatchSettings: (settings: Partial<WatchExperienceSettings>) => void;
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
      watchSettings: DEFAULT_WATCH_SETTINGS,
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
      updateWatchSettings: (settings) =>
        set((state) => ({
          watchSettings: {
            ...state.watchSettings,
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
        watchSettings: state.watchSettings,
        isSidebarOpen: state.isSidebarOpen,
      }),
    },
  ),
);
