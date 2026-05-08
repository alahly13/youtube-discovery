import type { NormalizedYouTubeDiscoveryItem } from "@/types/youtube";
import type { WatchExperienceSettings } from "@/lib/state/youtube-workspace-store";

export interface RankedSuggestion {
  item: NormalizedYouTubeDiscoveryItem;
  score: number;
  reasons: string[];
}

const VIDEO_ITEM_TYPES = new Set(["video", "shorts_like", "live", "upcoming", "completed_live"]);

export function getPlayableManifestVideos(items: NormalizedYouTubeDiscoveryItem[]) {
  return items.filter((item) => VIDEO_ITEM_TYPES.has(item.itemType) && Boolean(item.platformItemId));
}

// Watch suggestions are intentionally manifest-local. The ranking combines
// transparent metadata signals but never invents related videos or performs a
// provider fetch during local watch, channel, or playlist navigation.
export function rankSuggestedVideos({
  currentVideo,
  candidates,
  settings,
}: {
  currentVideo: NormalizedYouTubeDiscoveryItem | null;
  candidates: NormalizedYouTubeDiscoveryItem[];
  settings: WatchExperienceSettings;
}): RankedSuggestion[] {
  if (!currentVideo) {
    return [];
  }

  const currentTerms = extractTerms(currentVideo);
  const currentViews = currentVideo.viewsCount;
  const currentDuration = currentVideo.durationSeconds;

  return getPlayableManifestVideos(candidates)
    .filter((candidate) => candidate.platformItemId !== currentVideo.platformItemId)
    .filter((candidate) => settings.showShortsLikeVideos || !candidate.isShortsLike)
    .filter((candidate) => {
      const sameChannel = Boolean(currentVideo.channelId && candidate.channelId === currentVideo.channelId);
      return sameChannel ? settings.includeSameChannel : settings.includeCrossChannel;
    })
    .map((candidate) => {
      const reasons: string[] = [];
      let score = 0;
      const candidateTerms = extractTerms(candidate);
      const overlap = countOverlap(currentTerms, candidateTerms);

      if (overlap > 0) {
        score += overlap * 8;
        reasons.push("keyword similarity");
      }

      if (currentVideo.channelId && candidate.channelId === currentVideo.channelId) {
        score += settings.suggestionSourcePriority === "same_channel" ? 35 : 24;
        reasons.push("same channel");
      } else if (settings.suggestionSourcePriority === "mixed") {
        score += 4;
        reasons.push("cross-channel coverage");
      }

      const viewScore = proximityScore(currentViews, candidate.viewsCount);
      if (viewScore > 0) {
        score += settings.preferHighViewVideos ? viewScore + highViewBoost(candidate.viewsCount) : viewScore;
        reasons.push("views proximity");
      }

      const durationScore = proximityScore(currentDuration, candidate.durationSeconds);
      if (durationScore > 0) {
        score += durationScore;
        reasons.push("duration similarity");
      }

      const recencyScore = recencyBoost(candidate.publishedAt);
      if (settings.preferRecentVideos && recencyScore > 0) {
        score += recencyScore;
        reasons.push("recent upload");
      }

      return { item: candidate, score, reasons: reasons.slice(0, 3) };
    })
    .filter((suggestion) => suggestion.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, settings.suggestedVideosCount);
}

function extractTerms(item: NormalizedYouTubeDiscoveryItem) {
  return new Set(
    [item.title, item.description, item.channelTitle, item.language, ...item.tags]
      .filter((value): value is string => Boolean(value))
      .join(" ")
      .toLowerCase()
      .split(/[^a-z0-9]+/i)
      .filter((term) => term.length >= 3),
  );
}

function countOverlap(left: Set<string>, right: Set<string>) {
  let count = 0;

  for (const term of left) {
    if (right.has(term)) {
      count += 1;
    }
  }

  return count;
}

function proximityScore(left: number | null, right: number | null) {
  if (left === null || right === null) {
    return 0;
  }

  if (left === right) {
    return 12;
  }

  const spread = Math.abs(left - right);
  const base = Math.max(left, right, 1);
  return Math.max(0, 10 - Math.round((spread / base) * 10));
}

function highViewBoost(views: number | null) {
  if (views === null) {
    return 0;
  }

  return Math.min(10, Math.log10(Math.max(views, 1)) * 2);
}

function recencyBoost(publishedAt: string | null) {
  if (!publishedAt) {
    return 0;
  }

  const ageMs = Date.now() - Date.parse(publishedAt);
  const ageDays = ageMs / 86_400_000;

  if (!Number.isFinite(ageDays) || ageDays < 0) {
    return 0;
  }

  return Math.max(0, 10 - Math.floor(ageDays / 90));
}
