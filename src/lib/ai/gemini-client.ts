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
      manifestSummary: {
        totalItems: context.usedItemCount,
        source: "AI unavailable due to missing GEMINI_API_KEY.",
      },
      contentPatterns: [
        "AI is unavailable because GEMINI_API_KEY is not configured. The scoped metadata contract is ready, and normal search/filter/export flows continue to work."
      ],
      evidenceRefs: context.evidenceSeed,
      confidence: "low",
      limitations: ["No Gemini request was made.", "Only supplied manifest metadata can be analyzed when AI is enabled."],
      suggestedNextQueries: [],
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
  
  if (!parsed || typeof parsed !== "object") {
    return {
      scope: request.scope,
      error: "AI response could not be parsed as valid JSON",
      rawExcerpt: rawText.slice(0, 500),
      confidence: "low",
      evidenceRefs: [],
      suggestedNextQueries: [],
      limitations: ["Model output was not valid JSON."],
      requiresUserConfirmation: true,
    };
  }

  parsed.scope = request.scope;
  
  const result = AiAssistantResponseSchema.safeParse(parsed);

  if (!result.success) {
    console.error("Gemini AI validation failed:", result.error.issues);
    console.error("Raw parsed object:", parsed);
    return {
      scope: request.scope,
      manifestSummary: {
        totalItems: context.usedItemCount,
        source: "Validation failed.",
      },
      contentPatterns: [
        "Gemini returned a response that did not match the required scoped JSON contract."
      ],
      evidenceRefs: context.evidenceSeed,
      confidence: "low",
      limitations: ["The model response was rejected by server-side validation.", "No filters or searches were applied automatically."],
      suggestedNextQueries: [],
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
      try {
        return JSON.parse(rawText.slice(start, end + 1));
      } catch {
        return null;
      }
    }

    return null;
  }
}
