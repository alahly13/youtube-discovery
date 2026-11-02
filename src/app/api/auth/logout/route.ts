import { NextResponse } from "next/server";
import { getBlobBackend } from "@/lib/blob/backend-factory";
import { readSessionId, revokeSession, SESSION_COOKIE_NAME } from "@/lib/auth/session";
import { assertSameOrigin } from "@/lib/auth/require-auth";
import { createRouteHandlerSupabaseClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/auth/logout
 * ─────────────────────────────────────────────────────────────────────────────
 * Complete session revocation:
 * 1. Signs out from Supabase Auth and purges all Supabase auth cookies.
 * 2. Revokes the server-side session in storage and deletes yd_admin_session.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export async function POST(request: Request) {
  const csrf = assertSameOrigin(request);
  if (csrf) return csrf;

  const response = NextResponse.json({ success: true });

  // 1. Sign out of Supabase Auth
  try {
    const supabase = createRouteHandlerSupabaseClient(request, response);
    if (supabase) {
      await supabase.auth.signOut();
    }
  } catch (err) {
    console.warn("[auth] Supabase sign out non-fatal error:", err);
  }

  // Clear any existing Supabase cookies and session cookies on response
  const cookieHeader = request.headers.get("cookie") || "";
  cookieHeader.split(";").forEach((part) => {
    const name = part.split("=")[0]?.trim();
    if (
      name &&
      (name.startsWith("sb-") ||
        name.includes("auth-token") ||
        name === SESSION_COOKIE_NAME)
    ) {
      response.cookies.set(name, "", {
        path: "/",
        maxAge: 0,
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
      });
    }
  });

  // 2. Revoke local server-side session in storage
  try {
    const backend = getBlobBackend();
    const sid = readSessionId(request.headers.get("cookie"));
    if (sid) await revokeSession(backend, sid);
  } catch {
    // Logout must succeed from the browser's perspective regardless
  }

  // Ensure local session cookie is cleared
  response.cookies.set(SESSION_COOKIE_NAME, "", {
    path: "/",
    maxAge: 0,
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
  });

  return response;
}
