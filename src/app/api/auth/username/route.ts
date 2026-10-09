import { NextResponse } from "next/server";
import { getBlobBackend } from "@/lib/blob/backend-factory";
import { getLoginUsername } from "@/lib/auth/account-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/auth/username — PUBLIC. Returns ONLY the current username so the
 * login page can prefill it. Never exposes hashes, secrets, or metadata.
 */
export async function GET() {
  try {
    const backend = getBlobBackend();
    const username = await getLoginUsername(backend);
    return NextResponse.json({ username });
  } catch {
    return NextResponse.json({ username: process.env.ADMIN_DEFAULT_USERNAME?.trim() || "admin" });
  }
}
