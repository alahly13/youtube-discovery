import { ZodError } from "zod";
import { readJson, validationError } from "@/lib/http/api-response";
import { fetchChannelUploads } from "@/lib/platforms/youtube/youtube-channel-service";
import { toPublicYouTubeError } from "@/lib/platforms/youtube/youtube-errors";
import { YouTubeChannelUploadsSchema } from "@/lib/validation/youtube-schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const payload = await readJson(request);
    const { input, pageToken, maxPages, maxItems } = YouTubeChannelUploadsSchema.parse(payload);
    return Response.json(await fetchChannelUploads(input, { pageToken, maxPages, maxItems }));
  } catch (error) {
    if (error instanceof ZodError) {
      return validationError(error);
    }

    const publicError = toPublicYouTubeError(error);
    return Response.json(publicError.body, { status: publicError.status });
  }
}
