import { z } from "zod";
import { YOUTUBE_ITEM_TYPES } from "@/types/youtube";

const optionalIsoDate = z
  .string()
  .trim()
  .min(4)
  .optional()
  .refine((value) => !value || !Number.isNaN(Date.parse(value)), "Must be a valid date string");

export const YouTubeSearchSettingsSchema = z
  .object({
    query: z.string().trim().min(1).max(200),
    types: z.array(z.enum(["video", "channel", "playlist"])).min(1).max(3).default(["video"]),
    pageSize: z.coerce.number().int().min(1).max(50).default(25),
    maxPages: z.coerce.number().int().min(1).max(10).default(3),
    maxItems: z.coerce.number().int().min(1).max(500).default(150),
    order: z.enum(["relevance", "date", "rating", "viewCount", "title", "videoCount"]).default("relevance"),
    publishedAfter: optionalIsoDate,
    publishedBefore: optionalIsoDate,
    regionCode: z.string().trim().length(2).optional(),
    relevanceLanguage: z.string().trim().min(2).max(12).optional(),
    safeSearch: z.enum(["none", "moderate", "strict"]).default("moderate"),
    videoDuration: z.enum(["any", "short", "medium", "long"]).default("any"),
    videoDefinition: z.enum(["any", "high", "standard"]).default("any"),
    videoCaption: z.enum(["any", "closedCaption", "none"]).default("any"),
    videoEmbeddable: z.enum(["any", "true"]).default("any"),
    eventType: z.enum(["live", "completed", "upcoming"]).optional(),
    topicId: z.string().trim().max(100).optional(),
    pageToken: z.string().trim().max(300).optional(),
  })
  .superRefine((settings, context) => {
    const videoOnlyKeys = [
      settings.videoDuration !== "any",
      settings.videoDefinition !== "any",
      settings.videoCaption !== "any",
      settings.videoEmbeddable !== "any",
      Boolean(settings.eventType),
    ];

    if (videoOnlyKeys.some(Boolean) && (settings.types.length !== 1 || settings.types[0] !== "video")) {
      context.addIssue({
        code: "custom",
        message: "Video-only provider settings require the resource type to be video.",
        path: ["types"],
      });
    }
  });

export const YouTubeDetailsRequestSchema = z.object({
  ids: z.array(z.string().trim().min(1).max(128)).min(1).max(50),
});

export const YouTubeLocalFilterSchema = z.object({
  manifest: z.object({
    manifestId: z.string().min(1),
    normalizedItems: z.array(z.unknown()),
  }),
  filters: z.object({
    keyword: z.string().default(""),
    minViews: z.number().nullable().default(null),
    maxViews: z.number().nullable().default(null),
    targetViews: z.number().nullable().default(null),
    minLikes: z.number().nullable().default(null),
    maxLikes: z.number().nullable().default(null),
    minComments: z.number().nullable().default(null),
    maxComments: z.number().nullable().default(null),
    durationMinSec: z.number().nullable().default(null),
    durationMaxSec: z.number().nullable().default(null),
    year: z.number().nullable().default(null),
    yearFrom: z.number().nullable().default(null),
    yearTo: z.number().nullable().default(null),
    /** Month filter (1-12), can be combined with year or used independently */
    month: z.number().int().min(1).max(12).nullable().default(null),
    publishedAfter: z.string().nullable().default(null),
    publishedBefore: z.string().nullable().default(null),
    itemTypes: z.array(z.enum(YOUTUBE_ITEM_TYPES)).default([]),
    channelId: z.string().nullable().default(null),
    channelName: z.string().nullable().default(null),
    language: z.string().nullable().default(null),
    hasThumbnail: z.enum(["any", "yes", "no"]).default("any"),
    hasDescription: z.enum(["any", "yes", "no"]).default("any"),
    /** Presence filter for language metadata */
    hasLanguage: z.enum(["any", "yes", "no"]).default("any"),
    shortsLikeOnly: z.boolean().default(false),
    sort: z
      .enum([
        "api_order",
        "latest",
        "oldest",
        "most_views",
        "least_views",
        "most_likes",
        "least_likes",
        "most_comments",
        "least_comments",
        "shortest",
        "longest",
        "title_az",
        "title_za",
        "engagement_desc",
        "engagement_asc",
      ])
      .default("api_order"),
    strictMetadata: z.boolean().default(false),
  }),
});


export const YouTubeLinkAnalyzeSchema = z.object({
  input: z.string().trim().min(3).max(500),
});

export const YouTubeChannelAnalyzeSchema = z.object({
  input: z.string().trim().min(1).max(500),
});

export const YouTubeChannelUploadsSchema = YouTubeChannelAnalyzeSchema.extend({
  pageToken: z.string().trim().max(300).optional(),
  maxPages: z.coerce.number().int().min(1).max(10).default(3),
  maxItems: z.coerce.number().int().min(1).max(500).default(150),
});

export const YouTubePlaylistAnalyzeSchema = z.object({
  input: z.string().trim().min(1).max(500),
});

export const YouTubePlaylistItemsSchema = YouTubePlaylistAnalyzeSchema.extend({
  pageToken: z.string().trim().max(300).optional(),
  maxPages: z.coerce.number().int().min(1).max(10).default(3),
  maxItems: z.coerce.number().int().min(1).max(500).default(150),
});

export type ParsedYouTubeSearchSettings = z.infer<typeof YouTubeSearchSettingsSchema>;
