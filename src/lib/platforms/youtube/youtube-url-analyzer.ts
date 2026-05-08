import type { YouTubeManifestWarning } from "@/types/manifest";

export type YouTubeAnalyzedLink =
  | { kind: "video"; videoId: string; playlistId: string | null; canonicalUrl: string; warnings: YouTubeManifestWarning[] }
  | { kind: "shorts"; videoId: string; playlistId: null; canonicalUrl: string; warnings: YouTubeManifestWarning[] }
  | { kind: "playlist"; playlistId: string; canonicalUrl: string; warnings: YouTubeManifestWarning[] }
  | { kind: "channel"; channelId: string; canonicalUrl: string; warnings: YouTubeManifestWarning[] }
  | { kind: "handle"; handle: string; canonicalUrl: string; warnings: YouTubeManifestWarning[] }
  | { kind: "search"; query: string; canonicalUrl: string; warnings: YouTubeManifestWarning[] }
  | { kind: "unsupported"; reason: string; canonicalUrl: string | null; warnings: YouTubeManifestWarning[] };

const VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;

export function analyzeYouTubeUrl(input: string): YouTubeAnalyzedLink {
  const trimmed = input.trim();
  const warnings: YouTubeManifestWarning[] = [];

  if (VIDEO_ID_PATTERN.test(trimmed)) {
    return {
      kind: "video",
      videoId: trimmed,
      playlistId: null,
      canonicalUrl: `https://www.youtube.com/watch?v=${trimmed}`,
      warnings,
    };
  }

  let url: URL;

  try {
    url = new URL(trimmed);
  } catch {
    if (trimmed.startsWith("@")) {
      return {
        kind: "handle",
        handle: trimmed.slice(1),
        canonicalUrl: `https://www.youtube.com/${trimmed}`,
        warnings,
      };
    }

    return {
      kind: "unsupported",
      reason: "Input is not a recognized YouTube URL, handle, or video ID.",
      canonicalUrl: null,
      warnings,
    };
  }

  const host = url.hostname.replace(/^www\./, "");

  if (!["youtube.com", "m.youtube.com", "music.youtube.com", "youtu.be"].includes(host)) {
    return {
      kind: "unsupported",
      reason: "Only YouTube URLs are supported.",
      canonicalUrl: url.toString(),
      warnings,
    };
  }

  if (host === "youtu.be") {
    const videoId = url.pathname.split("/").filter(Boolean)[0] ?? "";
    const playlistId = url.searchParams.get("list");

    if (VIDEO_ID_PATTERN.test(videoId)) {
      return {
        kind: "video",
        videoId,
        playlistId,
        canonicalUrl: `https://www.youtube.com/watch?v=${videoId}${playlistId ? `&list=${playlistId}` : ""}`,
        warnings,
      };
    }
  }

  const parts = url.pathname.split("/").filter(Boolean);

  if (url.pathname === "/watch") {
    const videoId = url.searchParams.get("v") ?? "";
    const playlistId = url.searchParams.get("list");

    if (VIDEO_ID_PATTERN.test(videoId)) {
      return {
        kind: "video",
        videoId,
        playlistId,
        canonicalUrl: `https://www.youtube.com/watch?v=${videoId}${playlistId ? `&list=${playlistId}` : ""}`,
        warnings,
      };
    }

    if (playlistId) {
      return {
        kind: "playlist",
        playlistId,
        canonicalUrl: `https://www.youtube.com/playlist?list=${playlistId}`,
        warnings,
      };
    }
  }

  if (parts[0] === "shorts" && VIDEO_ID_PATTERN.test(parts[1] ?? "")) {
    return {
      kind: "shorts",
      videoId: parts[1],
      playlistId: null,
      canonicalUrl: `https://www.youtube.com/shorts/${parts[1]}`,
      warnings: [
        ...warnings,
        {
          code: "shorts_like_only",
          message: "Shorts URLs are treated as videos and labeled Shorts-like after official metadata is fetched.",
        },
      ],
    };
  }

  if (url.pathname === "/playlist") {
    const playlistId = url.searchParams.get("list");

    if (playlistId) {
      return {
        kind: "playlist",
        playlistId,
        canonicalUrl: `https://www.youtube.com/playlist?list=${playlistId}`,
        warnings,
      };
    }
  }

  if (parts[0] === "channel" && parts[1]) {
    return {
      kind: "channel",
      channelId: parts[1],
      canonicalUrl: `https://www.youtube.com/channel/${parts[1]}`,
      warnings,
    };
  }

  if (parts[0]?.startsWith("@")) {
    return {
      kind: "handle",
      handle: parts[0].slice(1),
      canonicalUrl: `https://www.youtube.com/${parts[0]}`,
      warnings,
    };
  }

  if (url.pathname === "/results") {
    const query = url.searchParams.get("search_query") ?? "";

    if (query) {
      return {
        kind: "search",
        query,
        canonicalUrl: `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`,
        warnings,
      };
    }
  }

  return {
    kind: "unsupported",
    reason: "This URL shape is not resolvable through the implemented official API strategy.",
    canonicalUrl: url.toString(),
    warnings: [
      ...warnings,
      {
        code: "no_scraping",
        message: "The app does not scrape YouTube pages to resolve unsupported URL shapes.",
      },
    ],
  };
}
