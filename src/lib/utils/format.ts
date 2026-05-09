import type { YouTubeDiscoveryItemType } from "@/types/youtube";

export function cn(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

/**
 * Format a numeric count with a label. Explicitly handles 0 as a valid value —
 * only null/undefined produces "Unknown {label}".
 */
export function formatCount(value: number | null | undefined, label: string) {
  if (value === null || value === undefined) {
    return `Unknown ${label}`;
  }

  return `${Intl.NumberFormat("en", { notation: value >= 10000 ? "compact" : "standard" }).format(value)} ${label}`;
}

/**
 * Format a numeric count without a label for compact display. Handles 0 correctly.
 */
export function formatCompactCount(value: number | null | undefined) {
  if (value === null || value === undefined) {
    return "–";
  }

  return Intl.NumberFormat("en", { notation: value >= 10000 ? "compact" : "standard" }).format(value);
}

export function formatDuration(seconds: number | null | undefined) {
  if (seconds === null || seconds === undefined) {
    return "Unknown";
  }

  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainingSeconds = seconds % 60;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(remainingSeconds).padStart(2, "0")}`;
  }

  return `${minutes}:${String(remainingSeconds).padStart(2, "0")}`;
}

export function formatDate(value: string | null | undefined) {
  if (!value) {
    return "Unknown date";
  }

  const timestamp = Date.parse(value);

  if (!Number.isFinite(timestamp)) {
    return "Unknown date";
  }

  return Intl.DateTimeFormat("en", { dateStyle: "medium", timeZone: "UTC" }).format(timestamp);
}

/**
 * Relative date string for display (e.g. "3 days ago", "2 months ago").
 * Falls back to absolute date if more than 1 year old.
 */
export function formatRelativeDate(value: string | null | undefined) {
  if (!value) {
    return "Unknown date";
  }

  const timestamp = Date.parse(value);

  if (!Number.isFinite(timestamp)) {
    return "Unknown date";
  }

  const now = Date.now();
  const diffMs = now - timestamp;
  const diffSeconds = Math.floor(diffMs / 1000);
  const diffMinutes = Math.floor(diffSeconds / 60);
  const diffHours = Math.floor(diffMinutes / 60);
  const diffDays = Math.floor(diffHours / 24);
  const diffMonths = Math.floor(diffDays / 30);
  const diffYears = Math.floor(diffDays / 365);

  if (diffSeconds < 60) return "just now";
  if (diffMinutes < 60) return `${diffMinutes} min ago`;
  if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? "s" : ""} ago`;
  if (diffDays < 7) return `${diffDays} day${diffDays > 1 ? "s" : ""} ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)} week${Math.floor(diffDays / 7) > 1 ? "s" : ""} ago`;
  if (diffMonths < 12) return `${diffMonths} month${diffMonths > 1 ? "s" : ""} ago`;
  if (diffYears === 1) return "1 year ago";
  if (diffYears < 5) return `${diffYears} years ago`;

  return formatDate(value);
}

export function formatItemType(type: YouTubeDiscoveryItemType) {
  return type
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function getPublishedYear(publishedAt: string | null | undefined) {
  if (!publishedAt) {
    return null;
  }

  const year = new Date(publishedAt).getUTCFullYear();
  return Number.isFinite(year) ? year : null;
}

/** Extract month (1-12) from a publishedAt ISO string, UTC-based. */
export function getPublishedMonth(publishedAt: string | null | undefined) {
  if (!publishedAt) {
    return null;
  }

  const month = new Date(publishedAt).getUTCMonth() + 1; // getUTCMonth is 0-indexed
  return Number.isFinite(month) ? month : null;
}
