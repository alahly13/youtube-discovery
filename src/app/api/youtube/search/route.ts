import { ZodError } from "zod";
import { readJson, validationError } from "@/lib/http/api-response";
import { saveManifestInMemory } from "@/lib/manifests/manifest-memory-store";
import { toPublicYouTubeError } from "@/lib/platforms/youtube/youtube-errors";
import { runYouTubeSearch } from "@/lib/platforms/youtube/youtube-search-service";
import { YouTubeSearchSettingsSchema } from "@/lib/validation/youtube-schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const payload = await readJson(request);
    const settings = YouTubeSearchSettingsSchema.parse(payload);
    const manifest = await runYouTubeSearch(settings);

    return Response.json(saveManifestInMemory(manifest));
  } catch (error) {
    if (error instanceof ZodError) {
      return validationError(error);
    }

    const publicError = toPublicYouTubeError(error);
    return Response.json(publicError.body, { status: publicError.status });
  }
}
