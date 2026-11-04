import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/require-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/auth/status — { authenticated, username, userId, storageOwnerUuid } for client UI gating and owner scoping. */
export async function GET(request: Request) {
  const guard = await requireAdmin(request);
  if (!guard.ok) return NextResponse.json({ authenticated: false });
  return NextResponse.json({
    authenticated: true,
    username: guard.admin.username,
    userId: guard.admin.userId,
    storageOwnerUuid: guard.admin.storageOwnerUuid,
  });
}
