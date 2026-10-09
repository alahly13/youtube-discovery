import { NextResponse } from "next/server";
import { addCustomApiKey, getSafeApiKeysList } from "@/lib/platforms/youtube/youtube-api-keys";
import { assertSameOrigin, requireAdmin } from "@/lib/auth/require-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/youtube/keys
 * Returns the list of available keys with safe masked values and active key indicator.
 * Plaintext secrets are never returned to the browser.
 */
export async function GET(request: Request) {
  const guard = await requireAdmin(request);
  if (!guard.ok) return guard.response;
  try {
    const data = await getSafeApiKeysList();
    const active = data.keys.find((k) => k.id === data.activeKeyId) ?? null;
    return NextResponse.json({
      ...data,
      activeKey: active
        ? {
            id: active.id,
            label: active.label,
            masked: active.maskedKey,
            source: active.source,
            isActive: true,
            createdAt: active.addedAt ?? "",
          }
        : null,
    });
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
  const csrf = assertSameOrigin(request);
  if (csrf) return csrf;
  const guard = await requireAdmin(request);
  if (!guard.ok) return guard.response;
  try {
    const body = (await request.json()) as {
      label?: string;
      apiKey?: string;
      accountLabel?: string;
      projectId?: string;
      projectDisplayName?: string;
    };
    if (!body.apiKey || typeof body.apiKey !== "string") {
      return NextResponse.json({ error: "Missing required apiKey" }, { status: 400 });
    }

    const added = await addCustomApiKey(body.label || "", body.apiKey, {
      accountLabel: typeof body.accountLabel === "string" ? body.accountLabel : null,
      projectId: typeof body.projectId === "string" ? body.projectId : null,
      projectDisplayName: typeof body.projectDisplayName === "string" ? body.projectDisplayName : null,
    });
    return NextResponse.json({ success: true, key: added });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to add API key";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
