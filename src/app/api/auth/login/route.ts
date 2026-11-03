import "server-only";

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
import { SESSION_COOKIE_NAME } from "@/lib/auth/cookies";
import { assertSameOrigin } from "@/lib/auth/require-auth";
import { createRouteHandlerSupabaseClient } from "@/lib/supabase/server";
import { getAuthoritativeAdminProfile } from "@/lib/auth/user-profile";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const loginSchema = z.object({
  username: z.string().min(1).max(64),
  password: z.string().min(1).max(256),
});

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * POST /api/auth/login — Sole Authoritative Admin Login Handler
 * ──────────────────────────────────────────────────────────────────────────
 * Architecture Flow:
 *   Admin Login UI → Next.js Login Handler → Username Mapping →
 *   Supabase Auth (signInWithPassword) → Supabase SSR Cookies →
 *   Admin Profile Authorization
 *
 * Requirements:
 * - Supabase Auth is the SOLE authority for the administrator password.
 * - Maps normalized username (e.g. "asdy") to canonical email (asdy@youtube.discov.com).
 * - Enforces rate-limiting to prevent brute force attacks.
 * - Never reveals whether a username exists through differentiated error messages.
 * - Establishes official @supabase/ssr session cookies on NextResponse.
 * - Removes competing legacy Blob session cookies.
 * ═══════════════════════════════════════════════════════════════════════════
 */
export async function POST(request: Request) {
  const csrf = assertSameOrigin(request);
  if (csrf) return csrf;

  let backend: BlobBackend | null = null;
  try {
    backend = getBlobBackend();
  } catch {
    // Storage backend is optional if only Supabase Auth is active
  }

  const ipHash = hashIp(clientIpFromHeaders(request.headers));

  // Rate-limiting check
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
    return NextResponse.json({ error: "Invalid request payload." }, { status: 400 });
  }

  const parsed = loginSchema.safeParse(body);
  if (!parsed.success) {
    if (backend) await recordLoginAttempt(backend, ipHash);
    return NextResponse.json({ error: "Invalid username or password." }, { status: 401 });
  }

  const { username, password } = parsed.data;

  // Supabase infrastructure configuration check
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseKey) {
    return NextResponse.json(
      { error: "Authentication service unavailable. Please check system configuration." },
      { status: 503 },
    );
  }

  // Server-side canonical username-to-email mapping
  const configuredAdminUsername = (process.env.ADMIN_DEFAULT_USERNAME || "asdy").trim().toLowerCase();
  const configuredAdminEmail = (process.env.ADMIN_EMAIL || "asdy@youtube.discov.com").trim().toLowerCase();
  const normalizedInput = username.trim().toLowerCase();

  const isConfiguredAdmin =
    normalizedInput === configuredAdminUsername ||
    normalizedInput === configuredAdminEmail;

  if (!isConfiguredAdmin) {
    // Non-sensitive constant-time rejection for unrecognized administrator usernames
    if (backend) await recordLoginAttempt(backend, ipHash);
    return NextResponse.json({ error: "Invalid username or password." }, { status: 401 });
  }

  const targetAuthEmail = configuredAdminEmail;

  // Prepare response object where @supabase/ssr binds auth cookies
  const response = NextResponse.json({
    success: true,
    username: configuredAdminUsername,
  });

  const supabase = createRouteHandlerSupabaseClient(request, response);
  if (!supabase) {
    return NextResponse.json(
      { error: "Failed to initialize Supabase server client." },
      { status: 500 },
    );
  }

  // Authenticate exclusively against Supabase Auth
  let authData: Awaited<ReturnType<typeof supabase.auth.signInWithPassword>>["data"] | null = null;
  let authError: Awaited<ReturnType<typeof supabase.auth.signInWithPassword>>["error"] | null = null;

  try {
    const result = await supabase.auth.signInWithPassword({
      email: targetAuthEmail,
      password,
    });
    authData = result.data;
    authError = result.error;
  } catch (networkErr) {
    console.error("[auth/login] Supabase signInWithPassword exception:", networkErr);
    return NextResponse.json(
      { error: "Authentication service unavailable. Please try again shortly." },
      { status: 503 },
    );
  }

  if (authError || !authData?.user) {
    if (backend) await recordLoginAttempt(backend, ipHash);

    if (authError?.status === 503 || authError?.message?.includes("fetch failed")) {
      return NextResponse.json(
        { error: "Authentication service unavailable. Please verify network connectivity." },
        { status: 503 },
      );
    }
    if (authError?.message?.toLowerCase().includes("email not confirmed")) {
      return NextResponse.json(
        { error: "Account requires administrative confirmation." },
        { status: 403 },
      );
    }
    if (authError?.status === 429) {
      return NextResponse.json(
        { error: "Too many authentication attempts. Please wait a moment and try again." },
        { status: 429 },
      );
    }

    return NextResponse.json(
      { error: "Invalid username or password." },
      { status: 401 },
    );
  }

  const authUser = authData.user;

  // Verify administrator authorization in PostgreSQL user_profiles
  const profile = await getAuthoritativeAdminProfile(authUser.id, authUser.email);
  if (!profile || profile.role !== "admin" || profile.is_suspended || profile.is_deleted) {
    console.warn(`[auth/login] Authorization rejected for auth user ${authUser.id}`);
    if (backend) await recordLoginAttempt(backend, ipHash);
    return NextResponse.json(
      { error: "Administrator authorization failed." },
      { status: 403 },
    );
  }

  // Clear rate limits upon successful login
  if (backend) {
    await clearLoginAttempts(backend, ipHash);
  }

  // Cleanly retire legacy session cookie to avoid competing sessions
  response.cookies.set(SESSION_COOKIE_NAME, "", {
    path: "/",
    maxAge: 0,
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
  });

  return response;
}
