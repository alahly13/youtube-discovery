import { ZodError } from "zod";
import { readJson, validationError } from "@/lib/http/api-response";
import { analyzeYouTubeUrl } from "@/lib/platforms/youtube/youtube-url-analyzer";
import { YouTubeLinkAnalyzeSchema } from "@/lib/validation/youtube-schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const payload = await readJson(request);
    const { input } = YouTubeLinkAnalyzeSchema.parse(payload);
    const analyzed = analyzeYouTubeUrl(input);

    return Response.json({
      analyzed,
      officialOnly: true,
      strategy: describeStrategy(analyzed.kind),
    });
  } catch (error) {
    if (error instanceof ZodError) {
      return validationError(error);
    }

    return Response.json(
      {
        error: "link_analyze_failed",
        message: "The link could not be analyzed.",
      },
      { status: 500 },
    );
  }
}

function describeStrategy(kind: string) {
  switch (kind) {
    case "video":
    case "shorts":
      return "Fetch video metadata with videos.list after user confirmation.";
    case "playlist":
      return "Fetch playlist metadata with playlists.list, then playlistItems.list and videos.list.";
    case "channel":
    case "handle":
      return "Resolve channel metadata with channels.list, then use the uploads playlist for uploads exploration.";
    case "search":
      return "Convert the safe search query into provider search settings for search.list.";
    default:
      return "Unsupported without scraping; no provider call will be made.";
  }
}
