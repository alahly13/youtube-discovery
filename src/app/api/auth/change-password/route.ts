import "server-only";

import { NextResponse } from "next/server";
import { z } from "zod";
import { assertSameOrigin, requireAdmin } from "@/lib/auth/require-auth";
import { createServerSupabaseClient, createRouteHandlerSupabaseClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, "Current password is required.").max(256),
  newPassword: z.string().min(8, "New password must be at least 8 characters.").max(256),
  confirmPassword: z.string().min(1, "Password confirmation is required.").max(256),
});

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * POST /api/auth/change-password — Authenticated Admin Password Change
 * ──────────────────────────────────────────────────────────────────────────
 * - Requires authenticated administrator session (requireAdmin).
 * - Verifies current password against Supabase Auth.
 * - Validates new password length and confirmation match.
 * - Updates administrator password directly in Supabase Auth (sole authority).
 * - Does NOT send any email or require OTP.
 * - Refreshes session cookies on response so admin stays securely authenticated.
 * ═══════════════════════════════════════════════════════════════════════════
 */
export async function POST(request: Request) {
  const csrf = assertSameOrigin(request);
  if (csrf) return csrf;

  const guard = await requireAdmin(request);
  if (!guard.ok) return guard.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request payload." }, { status: 400 });
  }

  const parsed = changePasswordSchema.safeParse(body);
  if (!parsed.success) {
    const issue = parsed.error.issues[0]?.message || "Invalid input.";
    return NextResponse.json({ error: issue }, { status: 400 });
  }

  const { currentPassword, newPassword, confirmPassword } = parsed.data;

  if (newPassword !== confirmPassword) {
    return NextResponse.json({ error: "New passwords do not match." }, { status: 400 });
  }

  if (currentPassword === newPassword) {
    return NextResponse.json(
      { error: "New password must be different from current password." },
      { status: 400 }
    );
  }

  // 1. Get authenticated user from Supabase session
  const serverSupabase = await createServerSupabaseClient(request);
  if (!serverSupabase) {
    return NextResponse.json(
      { error: "Authentication service unavailable." },
      { status: 503 }
    );
  }

  const {
    data: { user },
    error: userErr,
  } = await serverSupabase.auth.getUser();

  if (userErr || !user || !user.email) {
    return NextResponse.json(
      { error: "Unauthorized — valid administrator session required." },
      { status: 401 }
    );
  }

  // 2. Re-authenticate: verify current password against Supabase Auth
  const adminClient = createAdminClient();
  if (!adminClient) {
    return NextResponse.json(
      { error: "Administrative service unavailable." },
      { status: 503 }
    );
  }

  try {
    const { error: signInErr } = await serverSupabase.auth.signInWithPassword({
      email: user.email,
      password: currentPassword,
    });

    if (signInErr) {
      return NextResponse.json(
        { error: "Current password is incorrect." },
        { status: 401 }
      );
    }
  } catch (verifyErr) {
    console.error("[change-password] Error verifying current password:", verifyErr);
    return NextResponse.json(
      { error: "Failed to verify current password. Please try again." },
      { status: 500 }
    );
  }

  // 3. Update password in Supabase Auth via Admin API (no email sent, no OTP)
  const { error: updateErr } = await adminClient.auth.admin.updateUserById(user.id, {
    password: newPassword,
    email_confirm: true,
  });

  if (updateErr) {
    console.error("[change-password] Supabase updateUserById error:", updateErr);
    return NextResponse.json(
      { error: updateErr.message || "Failed to update password in Supabase Auth." },
      { status: 400 }
    );
  }

  // 4. Refresh session cookies on outgoing response with new credentials
  const response = NextResponse.json({
    success: true,
    message: "Administrator password changed successfully in Supabase Auth.",
  });

  try {
    const routeSupabase = createRouteHandlerSupabaseClient(request, response);
    if (routeSupabase) {
      await routeSupabase.auth.signInWithPassword({
        email: user.email,
        password: newPassword,
      });
    }
  } catch (refreshErr) {
    console.warn("[change-password] Non-fatal session refresh warning:", refreshErr);
  }

  return response;
}
