import { NextResponse } from "next/server";
import { z } from "zod";
import { getBlobBackend } from "@/lib/blob/backend-factory";
import type { BlobBackend } from "@/lib/blob/blob-backend";
import { verifyCredentials } from "@/lib/auth/account-store";
import {
  clearLoginAttempts,
  checkLoginRateLimit,
  clientIpFromHeaders,
  hashIp,
  recordLoginAttempt,
} from "@/lib/auth/rate-limit";
import {
  createSession,
  getSessionTtlSeconds,
  SESSION_COOKIE_NAME,
  isSecureCookie,
} from "@/lib/auth/session";
import { assertSameOrigin } from "@/lib/auth/require-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { createRouteHandlerSupabaseClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const loginSchema = z.object({
  username: z.string().min(1).max(64),
  password: z.string().min(1).max(256),
});

/**
 * POST /api/auth/login
 * ─────────────────────────────────────────────────────────────────────────────
 * Primary authentication via Supabase Auth with fallback to server store.
 * - Resolves admin username (e.g. "asdy") to Supabase user email via Admin Client.
 * - Signs in with Supabase Auth, establishing HTTP-only auth cookies on the response.
 * - Synchronizes with the local session cookie (yd_admin_session).
 * - Enforces configurable session TTL (default 1 week / 604800 seconds) via
 *   SESSION_TTL_SECONDS, ADMIN_SESSION_TTL_SECONDS, or SUPABASE_SESSION_TTL_SECONDS.
 * - Protects against brute-force attacks via sliding-window rate limiting.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export async function POST(request: Request) {
  const csrf = assertSameOrigin(request);
  if (csrf) return csrf;

  let backend: BlobBackend | null = null;
  try {
    backend = getBlobBackend();
  } catch {
    // Storage might not be configured if only Supabase Auth is active
  }

  const ipHash = hashIp(clientIpFromHeaders(request.headers));

  if (backend) {
    const limit = await checkLoginRateLimit(backend, ipHash);
    if (!limit.allowed) {
      return NextResponse.json(
        { error: "Too many login attempts. Please wait and try again." },
        { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
      );
    }
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const parsed = loginSchema.safeParse(body);
  if (!parsed.success) {
    if (backend) await recordLoginAttempt(backend, ipHash);
    return NextResponse.json({ error: "Invalid username or password" }, { status: 401 });
  }

  const { username, password } = parsed.data;
  const ttl = getSessionTtlSeconds(); // Defaults to 604800 (1 week / 7 days)
  let authenticated = false;
  let displayUsername = username;
  let authUserId: string | undefined;

  // 1. Attempt Supabase Auth first
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  const response = NextResponse.json({
    success: true,
    username: displayUsername,
    ...(authUserId ? { userId: authUserId } : {}),
  });

  if (supabaseUrl && supabaseKey) {
    const candidateEmails: string[] = [];

    // If username is already formatted as an email, test it directly
    if (username.includes("@")) {
      candidateEmails.push(username.trim());
    }

    // Attempt resolving username (e.g. "asdy") to user email via Supabase Admin Client
    try {
      const adminClient = createAdminClient();
      if (adminClient) {
        const { data, error } = await adminClient.auth.admin.listUsers();
        if (!error && data?.users && data.users.length > 0) {
          const target = username.trim().toLowerCase();
          const match = data.users.find((u) => {
            const email = u.email?.toLowerCase();
            const uUsername = (
              u.user_metadata?.username ||
              u.user_metadata?.name ||
              u.app_metadata?.username
            )?.toString().toLowerCase();
            return (
              email === target ||
              email?.split("@")[0] === target ||
              uUsername === target
            );
          });

          if (match && match.email) {
            candidateEmails.unshift(match.email);
            authUserId = match.id;
            displayUsername =
              (match.user_metadata?.username as string) ||
              (match.user_metadata?.name as string) ||
              match.email.split("@")[0] ||
              username;
          }
        }
      }
    } catch (adminErr) {
      console.warn("[auth] Supabase admin user discovery non-fatal error:", adminErr);
    }

    // Always ensure raw username is included in candidate emails
    if (!candidateEmails.includes(username.trim())) {
      candidateEmails.push(username.trim());
    }

    // Initialize Route Handler Supabase client bound to response cookies
    const supabase = createRouteHandlerSupabaseClient(request, response);
    if (supabase) {
      for (const emailToTry of candidateEmails) {
        try {
          const { data, error } = await supabase.auth.signInWithPassword({
            email: emailToTry,
            password,
          });

          if (!error && data?.user) {
            authenticated = true;
            authUserId = data.user.id;
            displayUsername =
              (data.user.user_metadata?.username as string) ||
              (data.user.user_metadata?.name as string) ||
              data.user.email?.split("@")[0] ||
              displayUsername;
            break;
          }
        } catch {
          // Continue to next candidate
        }
      }
    }
  }

  // 2. Fall back to legacy local storage credentials if Supabase did not authenticate
  if (!authenticated && backend) {
    try {
      const account = await verifyCredentials(backend, username, password);
      if (account) {
        authenticated = true;
        displayUsername = account.username;
      }
    } catch (err) {
      console.warn("[auth] Legacy credentials verification fallback check:", err);
    }
  }

  if (!authenticated) {
    if (backend) await recordLoginAttempt(backend, ipHash);
    return NextResponse.json({ error: "Invalid username or password" }, { status: 401 });
  }

  // Clear rate limits upon successful login
  if (backend) {
    await clearLoginAttempts(backend, ipHash);
  }

  // Synchronize local session cookie with the configured session TTL
  if (backend) {
    try {
      const { sid } = await createSession(backend, 1);
      response.cookies.set(SESSION_COOKIE_NAME, sid, {
        path: "/",
        httpOnly: true,
        sameSite: "lax",
        maxAge: ttl,
        secure: isSecureCookie(),
      });
    } catch (sessionErr) {
      console.warn("[auth] Failed to persist local session mirror:", sessionErr);
    }
  }

  return response;
}
