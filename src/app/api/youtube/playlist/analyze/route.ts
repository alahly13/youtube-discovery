import { ZodError } from "zod";
import { readJson, validationError } from "@/lib/http/api-response";
import { toPublicYouTubeError } from "@/lib/platforms/youtube/youtube-errors";
import { analyzePlaylist } from "@/lib/platforms/youtube/youtube-playlist-service";
import { YouTubePlaylistAnalyzeSchema } from "@/lib/validation/youtube-schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const payload = await readJson(request);
    const { input } = YouTubePlaylistAnalyzeSchema.parse(payload);
    return Response.json(await analyzePlaylist(input));
  } catch (error) {
    if (error instanceof ZodError) {
      return validationError(error);
    }

    const publicError = toPublicYouTubeError(error);
    return Response.json(publicError.body, { status: publicError.status });
  }
}
