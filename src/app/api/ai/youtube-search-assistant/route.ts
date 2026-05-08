import { ZodError } from "zod";
import { readJson, validationError } from "@/lib/http/api-response";
import { runScopedGeminiAssistant } from "@/lib/ai/gemini-client";
import { AiAssistantRequestSchema } from "@/lib/ai/youtube-ai-schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const payload = await readJson(request);
    const parsed = AiAssistantRequestSchema.parse(payload);
    return Response.json(await runScopedGeminiAssistant(parsed, "Help refine official YouTube provider search settings and local result-filter ideas."));
  } catch (error) {
    if (error instanceof ZodError) {
      return validationError(error);
    }

    return Response.json({ error: "ai_search_assistant_failed", message: "AI assistant failed safely." }, { status: 500 });
  }
}
