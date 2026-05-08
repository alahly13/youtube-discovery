export class YouTubeProviderError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "YouTubeProviderError";
  }
}

export class MissingYouTubeApiKeyError extends Error {
  constructor() {
    super("YOUTUBE_API_KEY is not configured. Live YouTube provider calls are disabled.");
    this.name = "MissingYouTubeApiKeyError";
  }
}

export function toPublicYouTubeError(error: unknown) {
  if (error instanceof MissingYouTubeApiKeyError) {
    return {
      status: 503,
      body: {
        error: "youtube_api_unavailable",
        message: error.message,
      },
    };
  }

  if (error instanceof YouTubeProviderError) {
    return {
      status: error.status >= 400 && error.status < 600 ? error.status : 502,
      body: {
        error: error.code,
        message: error.message,
      },
    };
  }

  return {
    status: 500,
    body: {
      error: "youtube_unexpected_error",
      message: "The YouTube request failed unexpectedly.",
    },
  };
}
