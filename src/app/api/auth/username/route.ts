import "server-only";

import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/auth/username — PUBLIC
 * Returns ONLY the configured default administrator username so the login UI
 * can prefill it (defaulting to "asdy"). Never exposes hashes, secrets, or metadata.
 */
export async function GET() {
  const username = (process.env.ADMIN_DEFAULT_USERNAME || "asdy").trim();
  return NextResponse.json({ username });
}
