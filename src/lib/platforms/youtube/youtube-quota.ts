export const YOUTUBE_QUOTA_COSTS = {
  searchList: 100,
  videosList: 1,
  channelsList: 1,
  playlistsList: 1,
  playlistItemsList: 1,
} as const;

export type YouTubeQuotaOperation = keyof typeof YOUTUBE_QUOTA_COSTS;

export function estimateQuotaCost(operation: YouTubeQuotaOperation, requestCount = 1) {
  return YOUTUBE_QUOTA_COSTS[operation] * requestCount;
}

export function getDailyQuotaBudget() {
  const configured = Number(process.env.YOUTUBE_DAILY_QUOTA_BUDGET ?? 10000);
  return Number.isFinite(configured) && configured > 0 ? configured : 10000;
}

export function buildQuotaWarning(estimatedCost: number) {
  const budget = getDailyQuotaBudget();
  const percent = Math.round((estimatedCost / budget) * 100);

  if (percent >= 25) {
    return {
      code: "quota_estimate_high",
      message: `Estimated cost is ${estimatedCost} units (${percent}% of the configured daily budget).`,
    };
  }

  return null;
}
