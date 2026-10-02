import { NextResponse } from "next/server";
import { selectActiveApiKey } from "@/lib/platforms/youtube/youtube-api-keys";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/youtube/keys/select
 * Selects which API key (either "env" or a custom key ID) is active for YouTube API requests.
 */
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { keyId?: string };
    if (!body.keyId || typeof body.keyId !== "string") {
      return NextResponse.json({ error: "Missing required keyId" }, { status: 400 });
    }

    const success = await selectActiveApiKey(body.keyId);
    if (!success) {
      return NextResponse.json({ error: "Key not found" }, { status: 404 });
    }

    return NextResponse.json({ success: true, activeKeyId: body.keyId });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to select API key";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
