import { ZodError } from "zod";
import { readJson, validationError, notFound } from "@/lib/http/api-response";
import { applyYouTubeResultPipeline } from "@/lib/filters/youtube-result-filters";
import { getMemoryManifest } from "@/lib/manifests/manifest-memory-store";
import { YouTubeLocalFilterSchema } from "@/lib/validation/youtube-schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request, context: { params: Promise<{ manifestId: string }> }) {
  try {
    const { manifestId } = await context.params;
    const manifest = getMemoryManifest(manifestId);

    if (!manifest) {
      return notFound("Manifest was not found in the current runtime store.");
    }

    const payload = await readJson(request);
    const { filters } = YouTubeLocalFilterSchema.parse({
      manifest: {
        manifestId,
        normalizedItems: manifest.normalizedItems,
      },
      filters: payload?.filters ?? payload,
    });

    return Response.json({
      manifestId,
      items: applyYouTubeResultPipeline(manifest.normalizedItems, filters),
      providerCallsMade: 0,
    });
  } catch (error) {
    if (error instanceof ZodError) {
      return validationError(error);
    }

    return Response.json({ error: "manifest_filter_failed", message: "Manifest filtering failed." }, { status: 500 });
  }
}
