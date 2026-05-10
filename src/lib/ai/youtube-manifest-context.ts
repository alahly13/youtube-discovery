import "server-only";

import type { AiAssistantRequest } from "./youtube-ai-schemas";
import type { NormalizedYouTubeDiscoveryItem } from "@/types/youtube";

export interface BuiltManifestContext {
  prompt: string;
  usedItemCount: number;
  charCount: number;
  evidenceSeed: string[];
}

export function buildManifestContext(request: AiAssistantRequest, task: string): BuiltManifestContext {
  // Removed strict truncation limits; relying on Gemini's token limits.
  const maxItems = readPositiveInt(process.env.AI_MANIFEST_MAX_ITEMS, 200);
  const maxChars = readPositiveInt(process.env.AI_MANIFEST_MAX_CHARS, 120000);
  const items = normalizeItems(request.manifestSnapshot?.normalizedItems ?? []).slice(0, maxItems);
  const lines: string[] = [];

  for (const item of items) {
    const nextLine = [
      `id=${item.platformItemId}`,
      `type=${item.itemType}`,
      `title=${item.title}`,
      `channel=${item.channelTitle ?? "unknown"}`,
      `views=${item.viewsCount ?? "unknown"}`,
      `likes=${item.likesCount ?? "unknown"}`,
      `comments=${item.commentsCount ?? "unknown"}`,
      `durationSeconds=${item.durationSeconds ?? "unknown"}`,
      `publishedAt=${item.publishedAt ?? "unknown"}`,
    ].join(" | ");

    if (lines.join("\n").length + nextLine.length > maxChars) {
      break;
    }

    lines.push(nextLine);
  }

  return {
    prompt: [
      "You are the YouTube Discovery metadata assistant.",
      "Use only the supplied metadata context. Do not invent videos, IDs, URLs, counts, playlist relationships, or private data.",
      "Return strict JSON matching this exact structure: { manifestSummary: { totalItems: number, source: string, dateRange: string, languages: string[], contentTypes: record, engagementExtremes: record, zeroMetadataItems: string[] }, topEntities: { channels: string[], topics: string[], playlists: string[] }, contentPatterns: string[], suggestedNextQueries: [{ query: string, reasoning: string }], evidenceRefs: string[], confidence: 'low'|'medium'|'high', limitations: string[] }.",
      `Task: ${task}`,
      `Scope: ${request.scope}`,
      `Manifest: ${request.manifestSnapshot?.manifestId ?? "none"} - ${request.manifestSnapshot?.title ?? "none"}`,
      `Selected video ID: ${request.selectedVideoId ?? "none"}`,
      `User prompt: ${request.prompt}`,
      "Metadata context:",
      lines.join("\n") || "No metadata items were supplied.",
    ].join("\n"),
    usedItemCount: lines.length,
    charCount: lines.join("\n").length,
    evidenceSeed: items.slice(0, 5).map((item) => item.platformItemId),
  };
}

function normalizeItems(items: unknown[]): NormalizedYouTubeDiscoveryItem[] {
  return items.filter((item): item is NormalizedYouTubeDiscoveryItem => {
    if (!item || typeof item !== "object") {
      return false;
    }

    const candidate = item as Partial<NormalizedYouTubeDiscoveryItem>;
    return typeof candidate.platformItemId === "string" && typeof candidate.title === "string" && typeof candidate.itemType === "string";
  });
}

function readPositiveInt(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
