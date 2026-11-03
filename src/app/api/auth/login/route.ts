import { NextResponse } from "next/server";
import { z } from "zod";
import { getBlobBackend } from "@/lib/blob/backend-factory";
import type { BlobBackend } from "@/lib/blob/blob-backend";
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

  // Configured administrator email and environment password
  const configuredAdminEmail = (process.env.ADMIN_EMAIL || "asdy@youtube.discov.com").trim();
  const configuredEnvPassword = (
    process.env.ADMIN_PASSWORD ||
    process.env.ADMIN_INITIAL_PASSWORD ||
    process.env.SUPABASE_ADMIN_PASSWORD
  )?.trim();

  // 1. Validate Supabase environment configuration
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseKey) {
    return NextResponse.json(
      { error: "Supabase Authentication is not configured on this server. Check your environment variables." },
      { status: 500 },
    );
  }

  // Target is the administrator if username is "asdy", legacy "admin", or the configured email
  const isTargetAsdy =
    username.trim().toLowerCase() === "asdy" ||
    username.trim().toLowerCase() === "admin" ||
    username.trim().toLowerCase() === configuredAdminEmail.toLowerCase();

  // Exact password check without modifying user input
  const passwordMatchesEnv = Boolean(
    configuredEnvPassword && password === configuredEnvPassword
  );

  // If password matches environment configuration, ensure Supabase Auth is synchronized
  if (passwordMatchesEnv) {
    try {
      const adminClient = createAdminClient();
      if (adminClient) {
        const { data: userData } = await adminClient.auth.admin.listUsers();
        const match = userData?.users?.find((u) => {
          const email = u.email?.toLowerCase();
          const uUsername = (
            u.user_metadata?.username ||
            u.user_metadata?.name ||
            u.app_metadata?.username
          )?.toString().toLowerCase();
          return (
            email === configuredAdminEmail.toLowerCase() ||
            uUsername === "asdy" ||
            email?.startsWith("asdy@")
          );
        });

        if (match) {
          await adminClient.auth.admin.updateUserById(match.id, {
            password: configuredEnvPassword,
            email_confirm: true,
            user_metadata: { username: "asdy", name: "asdy" },
          });
        } else if (isTargetAsdy) {
          await adminClient.auth.admin.createUser({
            email: configuredAdminEmail,
            password: configuredEnvPassword,
            email_confirm: true,
            user_metadata: { username: "asdy", name: "asdy" },
          });
        }
      }
    } catch (syncErr) {
      console.warn("[auth/login] Supabase credential sync warning:", syncErr);
    }
  }

  // Build candidate emails to try for sign-in
  const candidateEmails: string[] = [];
  if (isTargetAsdy) {
    candidateEmails.push(configuredAdminEmail);
  }
  if (username.includes("@") && !candidateEmails.includes(username.trim())) {
    candidateEmails.push(username.trim());
  }
  if (!candidateEmails.includes(username.trim())) {
    candidateEmails.push(username.trim());
  }

  // Prepare response object where @supabase/ssr binds auth cookies
  const response = NextResponse.json({
    success: true,
    username: isTargetAsdy ? "asdy" : username,
  });

  const supabase = createRouteHandlerSupabaseClient(request, response);
  if (!supabase) {
    return NextResponse.json(
      { error: "Failed to initialize Supabase server client." },
      { status: 500 },
    );
  }

  let authUser: { id: string; email?: string; user_metadata?: Record<string, unknown> } | null = null;
  let lastAuthError: { message: string; status?: number; code?: string } | null = null;

  for (const emailToTry of candidateEmails) {
    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: emailToTry,
        password, // Exact password as entered by the user
      });

      if (!error && data?.user) {
        authUser = data.user;
        break;
      }
      if (error) {
        lastAuthError = {
          message: error.message,
          status: error.status,
          code: (error as { code?: string }).code,
        };
      }
    } catch (fetchErr) {
      lastAuthError = {
        message: fetchErr instanceof Error ? fetchErr.message : "Authentication network request failed",
        status: 503,
        code: "NETWORK_ERROR",
      };
    }
  }

  if (!authUser) {
    if (backend) await recordLoginAttempt(backend, ipHash);

    // Provide specific, actionable error messages
    if (lastAuthError?.status === 503 || lastAuthError?.code === "NETWORK_ERROR") {
      return NextResponse.json(
        { error: "Supabase Authentication service is unreachable. Please verify network connectivity." },
        { status: 503 },
      );
    }
    if (lastAuthError?.message?.toLowerCase().includes("email not confirmed")) {
      return NextResponse.json(
        { error: "The administrator email is not confirmed in Supabase Auth." },
        { status: 403 },
      );
    }
    if (lastAuthError?.status === 429) {
      return NextResponse.json(
        { error: "Too many authentication attempts. Please wait a moment and try again." },
        { status: 429 },
      );
    }
    return NextResponse.json(
      { error: "Invalid username or password. Please verify your credentials." },
      { status: 401 },
    );
  }

  // Server-side confirmation of the authenticated identity
  const { data: verified, error: verifyErr } = await supabase.auth.getUser();
  if (verifyErr || !verified?.user) {
    console.error("[auth/login] Supabase getUser verification error:", verifyErr);
    return NextResponse.json(
      { error: "Session creation could not be verified with Supabase Auth." },
      { status: 500 },
    );
  }

  // Clear rate limits upon successful login
  if (backend) {
    await clearLoginAttempts(backend, ipHash);
  }

  // Synchronize local session cookie mirror if Blob backend is available (for legacy checks)
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
      console.warn("[auth/login] Non-fatal legacy session mirror warning:", sessionErr);
    }
  }

  return response;
}
