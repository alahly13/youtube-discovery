import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { SESSION_COOKIE_NAME } from "@/lib/auth/cookies";
import { sanitizeRedirectPath } from "@/lib/navigation/safe-path";

/**
 * Page gate (UX layer — data routes enforce auth independently via
 * requireAdmin()). Unauthenticated page visits redirect to /login;
 * authenticated visits to /login redirect home only after verifying a valid
 * Supabase session when Supabase cookies are present (preventing stale-cookie
 * `/login <-> /search` redirect loops).
 */
const PUBLIC_PATHS = new Set(["/login"]);

export default async function proxy(request: NextRequest) {
  const { pathname, searchParams } = request.nextUrl;
  // API auth endpoints + all /api/auth/* stay reachable (routes self-guard).
  if (pathname.startsWith("/api/")) {
    return NextResponse.next();
  }
  // Static assets / Next internals / Public branding assets.
  if (
    pathname.startsWith("/_next/") ||
    pathname.startsWith("/favicon") ||
    pathname.startsWith("/icons/") ||
    pathname.startsWith("/icon") ||
    pathname.startsWith("/apple-icon") ||
    pathname === "/app-icon.svg" ||
    pathname === "/manifest.webmanifest" ||
    pathname === "/manifest.json" ||
    pathname === "/sw.js" ||
    pathname.includes(".")
  ) {
    return NextResponse.next();
  }

  const sessionCookie = request.cookies.get(SESSION_COOKIE_NAME);
  const hasLocalSession = Boolean(sessionCookie?.value);
  const supabaseCookies = request.cookies
    .getAll()
    .filter(
      (c) =>
        (c.name.startsWith("sb-") && c.name.includes("auth-token")) ||
        c.name.includes("supabase-auth-token")
    );
  const hasSupabaseSession = supabaseCookies.length > 0;
  const hasSession = hasLocalSession || hasSupabaseSession;

  if (!hasSession && !PUBLIC_PATHS.has(pathname)) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/login";
    const targetPath = `${pathname}${request.nextUrl.search}`;
    loginUrl.searchParams.set("next", sanitizeRedirectPath(targetPath));
    return NextResponse.redirect(loginUrl);
  }
  if (hasSession && PUBLIC_PATHS.has(pathname)) {
    // Allow explicit session recovery links (`?reauth=1` or `?expired=1`) without bouncing.
    if (searchParams.has("reauth") || searchParams.has("expired")) {
      return NextResponse.next();
    }

    // Verify Supabase cookie validity before redirecting away from /login so an expired
    // or revoked cookie never causes a `/login <-> /search` redirect loop.
    if (hasSupabaseSession) {
      const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
      const supabaseKey =
        process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

      if (supabaseUrl && supabaseKey) {
        const res = NextResponse.next();
        const supabase = createServerClient(supabaseUrl, supabaseKey, {
          cookies: {
            getAll() {
              return request.cookies.getAll();
            },
            setAll(cookiesToSet) {
              cookiesToSet.forEach(({ name, value, options }) => {
                res.cookies.set(name, value, {
                  ...options,
                  maxAge: value === "" ? 0 : options?.maxAge,
                });
              });
            },
          },
        });
        const { data, error } = await supabase.auth.getUser().catch(() => ({
          data: { user: null },
          error: new Error("auth_check_failed"),
        }));
        if (error || !data?.user) {
          for (const c of supabaseCookies) {
            res.cookies.set(c.name, "", { path: "/", maxAge: 0 });
          }
          if (hasLocalSession) {
            res.cookies.set(SESSION_COOKIE_NAME, "", { path: "/", maxAge: 0 });
          }
          return res;
        }
      }
    }

    const searchUrl = request.nextUrl.clone();
    searchUrl.pathname = "/search";
    searchUrl.search = "";
    return NextResponse.redirect(searchUrl);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|app-icon\\.svg|icons/|manifest\\.webmanifest|sw\\.js).*)"],
};
