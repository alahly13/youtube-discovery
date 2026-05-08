import type { YouTubeDiscoveryItemType } from "@/types/youtube";

export function cn(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

export function formatCount(value: number | null | undefined, label: string) {
  if (value === null || value === undefined) {
    return `Unknown ${label}`;
  }

  return `${Intl.NumberFormat("en", { notation: value >= 10000 ? "compact" : "standard" }).format(value)} ${label}`;
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
