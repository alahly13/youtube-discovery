export const WATCH_SETTINGS_STORAGE_KEY = "youtube-discovery-watch-settings";

export interface WatchExperienceSettings {
  defaultAutoplay: boolean;
  autoplayNext: boolean;
  showPlayerControls: boolean;
  suggestedVideosCount: number;
  suggestionSourcePriority: "manifest" | "same_channel" | "mixed";
  preferRecentVideos: boolean;
  preferHighViews: boolean;
  showShortsLikeInSuggestions: boolean;
}

export const DEFAULT_WATCH_SETTINGS: WatchExperienceSettings = {
  defaultAutoplay: true,
  autoplayNext: false,
  showPlayerControls: true,
  suggestedVideosCount: 8,
  suggestionSourcePriority: "manifest",
  preferRecentVideos: true,
  preferHighViews: false,
  showShortsLikeInSuggestions: true,
};
