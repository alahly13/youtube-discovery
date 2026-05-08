import "server-only";

import { MissingYouTubeApiKeyError, YouTubeProviderError } from "./youtube-errors";

type QueryValue = string | number | boolean | null | undefined;

export class YouTubeApiClient {
  private readonly apiBaseUrl = process.env.YOUTUBE_API_BASE_URL ?? "https://www.googleapis.com/youtube/v3";
  private readonly apiKey = process.env.YOUTUBE_API_KEY?.trim();

  async request<T>(path: string, params: Record<string, QueryValue>): Promise<T> {
    if (!this.apiKey) {
      throw new MissingYouTubeApiKeyError();
    }

    const url = new URL(`${this.apiBaseUrl.replace(/\/$/, "")}/${path}`);

    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null && value !== "" && value !== "any") {
        url.searchParams.set(key, String(value));
      }
    }

    url.searchParams.set("key", this.apiKey);

    const response = await fetch(url, {
      headers: {
        Accept: "application/json",
      },
      cache: "no-store",
    });

    const payload = (await response.json().catch(() => null)) as unknown;

    if (!response.ok) {
      throw new YouTubeProviderError(
        extractProviderMessage(payload) ?? "YouTube Data API request failed.",
        response.status,
        extractProviderReason(payload) ?? "youtube_provider_error",
        sanitizeProviderDetails(payload),
      );
    }

    return payload as T;
  }

  searchList<T>(params: Record<string, QueryValue>) {
    return this.request<T>("search", params);
  }

  videosList<T>(params: Record<string, QueryValue>) {
    return this.request<T>("videos", params);
  }

  channelsList<T>(params: Record<string, QueryValue>) {
    return this.request<T>("channels", params);
  }

  playlistsList<T>(params: Record<string, QueryValue>) {
    return this.request<T>("playlists", params);
  }

  playlistItemsList<T>(params: Record<string, QueryValue>) {
    return this.request<T>("playlistItems", params);
  }
}

export function getYouTubeClient() {
  return new YouTubeApiClient();
}

function extractProviderMessage(payload: unknown) {
  if (!payload || typeof payload !== "object" || !("error" in payload)) {
    return null;
  }

  const error = (payload as { error?: { message?: unknown } }).error;
  return typeof error?.message === "string" ? error.message : null;
}

function extractProviderReason(payload: unknown) {
  if (!payload || typeof payload !== "object" || !("error" in payload)) {
    return null;
  }

  const errors = (payload as { error?: { errors?: Array<{ reason?: unknown }> } }).error?.errors;
  const reason = errors?.[0]?.reason;
  return typeof reason === "string" ? reason : null;
}

function sanitizeProviderDetails(payload: unknown) {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const error = (payload as { error?: unknown }).error;
  return error && typeof error === "object" ? error : null;
}
