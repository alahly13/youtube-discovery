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
  const hasSession = Boolean(sessionCookie?.value);
  if (!hasSession && !PUBLIC_PATHS.has(pathname)) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/login";
    loginUrl.searchParams.set("next", pathname);
    return NextResponse.redirect(loginUrl);
  }
  if (hasSession && PUBLIC_PATHS.has(pathname)) {
    const homeUrl = request.nextUrl.clone();
    homeUrl.pathname = "/";
    homeUrl.search = "";
    return NextResponse.redirect(homeUrl);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
