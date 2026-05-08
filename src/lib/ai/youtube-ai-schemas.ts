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

export const AiAssistantResponseSchema = z.object({
  scope: AiScopeSchema,
  answer: z.string(),
  usedItemCount: z.number().int().min(0),
  evidenceRefs: z.array(AiEvidenceRefSchema),
  confidence: z.enum(["low", "medium", "high"]),
  limitations: z.array(z.string()),
  suggestedFilters: z.array(AiSuggestedFilterSchema).default([]),
  suggestedSearchQueries: z.array(z.string()).default([]),
  requiresUserConfirmation: z.boolean().default(true),
});

export type AiAssistantRequest = z.infer<typeof AiAssistantRequestSchema>;
export type AiAssistantResponse = z.infer<typeof AiAssistantResponseSchema>;
