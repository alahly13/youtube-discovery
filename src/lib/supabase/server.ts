import "server-only";

import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { NextResponse } from "next/server";
import { getSessionTtlSeconds } from "@/lib/auth/session";

/**
 * Supabase client for Server Components, Server Actions, and Route Handlers.
 * Synchronizes authentication sessions via HTTP-only cookies with the configured session TTL.
 */
export async function createServerSupabaseClient() {
  const cookieStore = await cookies();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !key) {
    return null;
  }

  const ttl = getSessionTtlSeconds();

  return createServerClient(url, key, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, {
              ...options,
              maxAge: ttl,
              path: options?.path || "/",
              sameSite: options?.sameSite || "lax",
              secure: process.env.NODE_ENV === "production",
            } as CookieOptions)
          );
        } catch {
          // The `setAll` method was called from a Server Component.
          // This can be ignored if you have middleware refreshing sessions.
        }
      },
    },
  });
}

/**
 * Route-Handler specific Supabase client that guarantees auth cookies
 * are explicitly bound to the outgoing NextResponse object with the configured session TTL.
 */
export function createRouteHandlerSupabaseClient(
  request: Request,
  response: NextResponse,
) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !key) {
    return null;
  }

  const ttl = getSessionTtlSeconds();

  // Parse existing cookies from request headers
  const cookieHeader = request.headers.get("cookie") || "";
  const requestCookies = cookieHeader
    .split(";")
    .map((c) => {
      const idx = c.indexOf("=");
      if (idx < 0) return null;
      return {
        name: c.slice(0, idx).trim(),
        value: c.slice(idx + 1).trim(),
      };
    })
    .filter((c): c is { name: string; value: string } => c !== null);

  return createServerClient(url, key, {
    cookies: {
      getAll() {
        return requestCookies;
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value, options }) => {
          response.cookies.set(name, value, {
            ...options,
            maxAge: ttl,
            path: options?.path || "/",
            sameSite: options?.sameSite || "lax",
            secure: process.env.NODE_ENV === "production",
          } as CookieOptions);
        });
      },
    },
  });
}
