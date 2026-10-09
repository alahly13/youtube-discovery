"use client";

/**
 * Authenticated fetch for protected API routes. Cookies (HttpOnly session)
 * are same-origin by default; on 401 the administrator is sent to /login
 * (preserving the current path) instead of seeing silent failures.
 */
export async function authFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const res = await fetch(input, { credentials: "same-origin", ...init });
  if (res.status === 401 && typeof window !== "undefined") {
    const current = window.location.pathname + window.location.search;
    if (!window.location.pathname.startsWith("/login")) {
      window.location.href = `/login?next=${encodeURIComponent(current)}`;
    }
    throw new Error("Session expired — redirecting to sign in.");
  }
  return res;
}
