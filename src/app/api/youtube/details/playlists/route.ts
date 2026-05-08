import { ZodError } from "zod";
import { readJson, validationError } from "@/lib/http/api-response";
import { getYouTubeClient } from "@/lib/platforms/youtube/youtube-client";
import { toPublicYouTubeError } from "@/lib/platforms/youtube/youtube-errors";
import { estimateQuotaCost } from "@/lib/platforms/youtube/youtube-quota";
import { normalizePlaylistDetail } from "@/lib/platforms/youtube/youtube-normalize";
import { YouTubeDetailsRequestSchema } from "@/lib/validation/youtube-schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const payload = await readJson(request);
    const { ids } = YouTubeDetailsRequestSchema.parse(payload);
    const response = await getYouTubeClient().playlistsList<{ items?: Array<Parameters<typeof normalizePlaylistDetail>[0]> }>({
      part: "snippet,contentDetails,status",
      id: ids.join(","),
    });

    return Response.json({
      items: (response.items ?? []).map(normalizePlaylistDetail),
      quotaCostEstimate: estimateQuotaCost("playlistsList"),
    });
  } catch (error) {
    if (error instanceof ZodError) {
      return validationError(error);
    }

    const publicError = toPublicYouTubeError(error);
    return Response.json(publicError.body, { status: publicError.status });
  }
}
