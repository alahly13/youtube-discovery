import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE_NAME } from "@/lib/auth/cookies";

/**
 * Page gate (UX layer — data routes enforce auth independently via
 * requireAdmin()). Unauthenticated page visits redirect to /login;
 * authenticated visits to /login redirect home. The session cookie is only
 * checked for PRESENCE here; validity is enforced server-side per request.
 */
const PUBLIC_PATHS = new Set(["/login"]);

export default function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  // API auth endpoints + all /api/auth/* stay reachable (routes self-guard).
  if (pathname.startsWith("/api/")) {
    return NextResponse.next();
  }
  // Static assets / Next internals.
  if (
    pathname.startsWith("/_next/") ||
    pathname.startsWith("/favicon") ||
    pathname === "/icon.png" ||
    pathname.includes(".")
  ) {
    return NextResponse.next();
  }
  const sessionCookie = request.cookies.get(SESSION_COOKIE_NAME);
  const hasLocalSession = Boolean(sessionCookie?.value);
  const hasSupabaseSession = request.cookies
    .getAll()
    .some((c) => (c.name.startsWith("sb-") && c.name.includes("-auth-token")) || c.name.includes("supabase-auth-token"));
  const hasSession = hasLocalSession || hasSupabaseSession;
  if (!hasSession && !PUBLIC_PATHS.has(pathname)) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/login";
    loginUrl.searchParams.set("next", pathname);
    return NextResponse.redirect(loginUrl);
  }
  if (hasSession && PUBLIC_PATHS.has(pathname)) {
    const searchUrl = request.nextUrl.clone();
    searchUrl.pathname = "/search";
    searchUrl.search = "";
    return NextResponse.redirect(searchUrl);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
