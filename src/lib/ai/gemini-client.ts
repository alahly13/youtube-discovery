import "server-only";

import { GoogleGenAI } from "@google/genai";
import type { AiAssistantRequest, AiAssistantResponse } from "./youtube-ai-schemas";
import { AiAssistantResponseSchema } from "./youtube-ai-schemas";
import { buildManifestContext } from "./youtube-manifest-context";

export async function runScopedGeminiAssistant(request: AiAssistantRequest, task: string): Promise<AiAssistantResponse> {
  const context = buildManifestContext(request, task);
  const model = process.env.GEMINI_MODEL || "gemini-2.5-flash";
  const apiKey = process.env.GEMINI_API_KEY?.trim();

  if (!apiKey) {
    return {
      scope: request.scope,
      answer: "AI is unavailable because GEMINI_API_KEY is not configured. The scoped metadata contract is ready, and normal search/filter/export flows continue to work.",
      usedItemCount: context.usedItemCount,
      evidenceRefs: context.evidenceSeed,
      confidence: "low",
      limitations: ["No Gemini request was made.", "Only supplied manifest metadata can be analyzed when AI is enabled."],
      suggestedFilters: [],
      suggestedSearchQueries: [],
      requiresUserConfirmation: true,
    };
  }

  const ai = new GoogleGenAI({ apiKey });
  const response = await ai.models.generateContent({
    model,
    contents: context.prompt,
    config: {
      responseMimeType: "application/json",
    },
  });

  const rawText = response.text ?? "{}";
  const parsed = parseJsonObject(rawText);
  const result = AiAssistantResponseSchema.safeParse(parsed);

  if (!result.success) {
    return {
      scope: request.scope,
      answer: "Gemini returned a response that did not match the required scoped JSON contract.",
      usedItemCount: context.usedItemCount,
      evidenceRefs: context.evidenceSeed,
      confidence: "low",
      limitations: ["The model response was rejected by server-side validation.", "No filters or searches were applied automatically."],
      suggestedFilters: [],
      suggestedSearchQueries: [],
      requiresUserConfirmation: true,
    };
  }

  return result.data;
}

function parseJsonObject(rawText: string) {
  try {
    return JSON.parse(rawText);
  } catch {
    const start = rawText.indexOf("{");
    const end = rawText.lastIndexOf("}");

    if (start >= 0 && end > start) {
      return JSON.parse(rawText.slice(start, end + 1));
    }

    return {};
  }
}
