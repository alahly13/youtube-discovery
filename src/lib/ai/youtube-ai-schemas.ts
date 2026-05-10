import { z } from "zod";

export const AiScopeSchema = z.enum([
  "current_search_manifest",
  "current_channel_uploads_manifest",
  "current_playlist_manifest",
  "current_link_explorer_manifest",
  "saved_library",
  "collection",
  "selected_video",
]);

export const AiEvidenceRefSchema = z.object({
  platformItemId: z.string(),
  title: z.string(),
  reason: z.string(),
});

export const AiSuggestedFilterSchema = z.object({
  field: z.string(),
  operator: z.string(),
  value: z.union([z.string(), z.number(), z.boolean(), z.null()]),
  reason: z.string(),
});

export const AiAssistantRequestSchema = z.object({
  scope: AiScopeSchema,
  prompt: z.string().trim().min(1).max(2000),
  manifestSnapshot: z
    .object({
      manifestId: z.string(),
      title: z.string(),
      manifestType: z.string(),
      normalizedItems: z.array(z.unknown()).default([]),
    })
    .optional(),
  selectedVideoId: z.string().optional(),
});

export const AiSuggestedQuerySchema = z.object({
  query: z.string(),
  reasoning: z.string().optional(),
});

export const AiAssistantResponseSchema = z.object({
  scope: AiScopeSchema,
  manifestSummary: z.object({
    totalItems: z.number().optional(),
    source: z.string().optional(),
    dateRange: z.string().optional(),
    languages: z.array(z.string()).optional(),
    contentTypes: z.record(z.string(), z.number()).optional(),
    engagementExtremes: z.record(z.string(), z.any()).optional(),
    zeroMetadataItems: z.array(z.string()).optional(),
  }).optional(),
  topEntities: z.object({
    channels: z.array(z.string()).optional(),
    topics: z.array(z.string()).optional(),
    playlists: z.array(z.string()).optional(),
  }).optional(),
  contentPatterns: z.array(z.string()).optional(),
  suggestedNextQueries: z.array(AiSuggestedQuerySchema).default([]),
  evidenceRefs: z.array(z.string()).default([]),
  confidence: z.enum(["low", "medium", "high"]).default("medium"),
  limitations: z.array(z.string()).default([]),
  requiresUserConfirmation: z.boolean().default(true),
  error: z.string().optional(),
  rawExcerpt: z.string().optional(),
});

export type AiAssistantRequest = z.infer<typeof AiAssistantRequestSchema>;
export type AiAssistantResponse = z.infer<typeof AiAssistantResponseSchema>;
export type AiSuggestedQuery = z.infer<typeof AiSuggestedQuerySchema>;
