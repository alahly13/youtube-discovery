import { ZodError } from "zod";
import { readJson, validationError } from "@/lib/http/api-response";
import { analyzeChannel } from "@/lib/platforms/youtube/youtube-channel-service";
import { toPublicYouTubeError } from "@/lib/platforms/youtube/youtube-errors";
import { YouTubeChannelAnalyzeSchema } from "@/lib/validation/youtube-schemas";
import { assertSameOrigin, requireAdmin } from "@/lib/auth/require-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const csrf = assertSameOrigin(request);
  if (csrf) return csrf;
  const guard = await requireAdmin(request);
  if (!guard.ok) return guard.response;
  try {
    const payload = await readJson(request);
    const { input } = YouTubeChannelAnalyzeSchema.parse(payload);
    return Response.json(await analyzeChannel(input));
  } catch (error) {
    if (error instanceof ZodError) {
      return validationError(error);
    }

    const publicError = toPublicYouTubeError(error);
    return Response.json(publicError.body, { status: publicError.status });
  }
}
