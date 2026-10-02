import { NextResponse } from "next/server";
import { deleteCustomApiKey } from "@/lib/platforms/youtube/youtube-api-keys";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * DELETE /api/youtube/keys/[keyId]
 * Deletes a custom key. If it was active, safely falls back to "env".
 */
export async function DELETE(
  _request: Request,
  props: { params: Promise<{ keyId: string }> },
) {
  try {
    const { keyId } = await props.params;
    if (keyId === "env") {
      return NextResponse.json({ error: "Cannot delete default ENV key" }, { status: 400 });
    }

    const success = await deleteCustomApiKey(keyId);
    if (!success) {
      return NextResponse.json({ error: "Key not found" }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to delete API key";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
