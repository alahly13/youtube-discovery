import { NextResponse } from "next/server";
import { getBlobBackend } from "@/lib/blob/backend-factory";
import { clearSessionCookie, readSessionId, revokeSession } from "@/lib/auth/session";
import { assertSameOrigin } from "@/lib/auth/require-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/auth/logout — revokes the server-side session, clears the cookie. */
export async function POST(request: Request) {
  const csrf = assertSameOrigin(request);
  if (csrf) return csrf;
  try {
    const backend = getBlobBackend();
    const sid = readSessionId(request.headers.get("cookie"));
    if (sid) await revokeSession(backend, sid);
  } catch {
    // Logout must succeed from the browser's perspective regardless.
  }
  const response = NextResponse.json({ success: true });
  response.headers.set("Set-Cookie", clearSessionCookie());
  return response;
}
