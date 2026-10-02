import { NextResponse } from "next/server";
import { addCustomApiKey, getSafeApiKeysList } from "@/lib/platforms/youtube/youtube-api-keys";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/youtube/keys
 * Returns the list of available keys with safe masked values and active key indicator.
 * Plaintext secrets are never returned to the browser.
 */
export async function GET() {
  try {
    const data = await getSafeApiKeysList();
    return NextResponse.json(data);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to load API keys";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

/**
 * POST /api/youtube/keys
 * Adds a new custom YouTube API key server-side.
 */
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { label?: string; apiKey?: string };
    if (!body.apiKey || typeof body.apiKey !== "string") {
      return NextResponse.json({ error: "Missing required apiKey" }, { status: 400 });
    }

    const added = await addCustomApiKey(body.label || "", body.apiKey);
    return NextResponse.json({ success: true, key: added });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to add API key";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
