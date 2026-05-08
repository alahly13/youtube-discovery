import type { NormalizedYouTubeDiscoveryItem, YouTubeResultFilters } from "@/types/youtube";
import { getPublishedYear } from "@/lib/utils/format";

export function applyYouTubeResultPipeline(
  items: NormalizedYouTubeDiscoveryItem[],
  filters: YouTubeResultFilters,
) {
  return sortItems(
    items.filter((item) => matchesKeyword(item, filters.keyword)).filter((item) => matchesFilters(item, filters)),
    filters.sort,
  );
}

function matchesKeyword(item: NormalizedYouTubeDiscoveryItem, keyword: string) {
  const query = keyword.trim().toLowerCase();

  if (!query) {
    return true;
  }

  const haystack = [
    item.title,
    item.description,
    item.channelTitle,
    item.channelId,
    item.language,
    item.publishedAt ? String(getPublishedYear(item.publishedAt)) : null,
    item.itemType,
    ...item.tags,
  ]
    .filter((value): value is string => typeof value === "string")
    .join(" ")
    .toLowerCase();

  return haystack.includes(query);
}

function matchesFilters(item: NormalizedYouTubeDiscoveryItem, filters: YouTubeResultFilters) {
  return (
    inNumericRange(item.viewsCount, filters.minViews, filters.maxViews, filters.strictMetadata) &&
    inNumericRange(item.likesCount, filters.minLikes, filters.maxLikes, filters.strictMetadata) &&
    inNumericRange(item.commentsCount, filters.minComments, filters.maxComments, filters.strictMetadata) &&
    inNumericRange(item.durationSeconds, filters.durationMinSec, filters.durationMaxSec, filters.strictMetadata) &&
    matchesTarget(item.viewsCount, filters.targetViews, filters.strictMetadata) &&
    matchesYear(item.publishedAt, filters) &&
    matchesOptionalText(item.channelId, filters.channelId) &&
    matchesOptionalText(item.channelTitle, filters.channelName) &&
    matchesOptionalText(item.language, filters.language) &&
    matchesPresence(item.thumbnailUrl, filters.hasThumbnail) &&
    matchesPresence(item.description, filters.hasDescription) &&
    (filters.itemTypes.length === 0 || filters.itemTypes.includes(item.itemType))
  );
}

// Numeric filters explicitly use nullish checks so 0 views/likes/comments remain
// valid displayable and filterable metadata instead of being mistaken as missing.
function inNumericRange(value: number | null, min: number | null, max: number | null, strictMetadata: boolean) {
  if (min === null && max === null) {
    return true;
  }

  if (value === null || value === undefined) {
    return !strictMetadata;
  }

  if (min !== null && value < min) {
    return false;
  }

  if (max !== null && value > max) {
    return false;
  }

  return true;
}

function matchesTarget(value: number | null, target: number | null, strictMetadata: boolean) {
  if (target === null) {
    return true;
  }

  if (value === null || value === undefined) {
    return !strictMetadata;
  }

  return value >= target;
}

function matchesYear(publishedAt: string | null, filters: YouTubeResultFilters) {
  if (!filters.year && !filters.yearFrom && !filters.yearTo && !filters.publishedAfter && !filters.publishedBefore) {
    return true;
  }

  if (!publishedAt) {
    return !filters.strictMetadata;
  }

  const year = getPublishedYear(publishedAt);
  const timestamp = Date.parse(publishedAt);

  if (filters.year !== null && year !== filters.year) {
    return false;
  }

  if (filters.yearFrom !== null && (year === null || year < filters.yearFrom)) {
    return false;
  }

  if (filters.yearTo !== null && (year === null || year > filters.yearTo)) {
    return false;
  }

  if (filters.publishedAfter && timestamp < Date.parse(filters.publishedAfter)) {
    return false;
  }

  if (filters.publishedBefore && timestamp > Date.parse(filters.publishedBefore)) {
    return false;
  }

  return true;
}

function matchesOptionalText(value: string | null, query: string | null) {
  if (!query) {
    return true;
  }

  return value?.toLowerCase().includes(query.toLowerCase()) ?? false;
}

function matchesPresence(value: string | null, filter: "any" | "yes" | "no") {
  if (filter === "any") {
    return true;
  }

  const present = value !== null && value.trim() !== "";
  return filter === "yes" ? present : !present;
}

function sortItems(items: NormalizedYouTubeDiscoveryItem[], sort: YouTubeResultFilters["sort"]) {
  const nextItems = [...items];

  switch (sort) {
    case "latest":
      return nextItems.sort((a, b) => compareDates(b.publishedAt, a.publishedAt));
    case "oldest":
      return nextItems.sort((a, b) => compareDates(a.publishedAt, b.publishedAt));
    case "most_views":
      return nextItems.sort((a, b) => compareNumbersDesc(a.viewsCount, b.viewsCount));
    case "least_views":
      return nextItems.sort((a, b) => compareNumbersAsc(a.viewsCount, b.viewsCount));
    case "most_likes":
      return nextItems.sort((a, b) => compareNumbersDesc(a.likesCount, b.likesCount));
    case "least_likes":
      return nextItems.sort((a, b) => compareNumbersAsc(a.likesCount, b.likesCount));
    case "most_comments":
      return nextItems.sort((a, b) => compareNumbersDesc(a.commentsCount, b.commentsCount));
    case "least_comments":
      return nextItems.sort((a, b) => compareNumbersAsc(a.commentsCount, b.commentsCount));
    case "shortest":
      return nextItems.sort((a, b) => compareNumbersAsc(a.durationSeconds, b.durationSeconds));
    case "longest":
      return nextItems.sort((a, b) => compareNumbersDesc(a.durationSeconds, b.durationSeconds));
    case "title_az":
      return nextItems.sort((a, b) => a.title.localeCompare(b.title));
    case "title_za":
      return nextItems.sort((a, b) => b.title.localeCompare(a.title));
    case "api_order":
    default:
      return nextItems;
  }
}

function compareDates(a: string | null, b: string | null) {
  const left = a ? Date.parse(a) : Number.NEGATIVE_INFINITY;
  const right = b ? Date.parse(b) : Number.NEGATIVE_INFINITY;
  return left - right;
}

function compareNumbersAsc(a: number | null, b: number | null) {
  return (a ?? Number.POSITIVE_INFINITY) - (b ?? Number.POSITIVE_INFINITY);
}

function compareNumbersDesc(a: number | null, b: number | null) {
  return (b ?? Number.NEGATIVE_INFINITY) - (a ?? Number.NEGATIVE_INFINITY);
}
