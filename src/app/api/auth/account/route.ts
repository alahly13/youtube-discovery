import "server-only";

import { NextResponse } from "next/server";
import { z } from "zod";
import { assertSameOrigin, requireAdmin } from "@/lib/auth/require-auth";
import { createServerSupabaseClient, createRouteHandlerSupabaseClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { prisma } from "@/lib/db/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const accountSchema = z.object({
  currentPassword: z.string().min(1, "Current password is required.").max(256),
  newUsername: z.string().min(3).max(32).optional(),
  newPassword: z.string().min(8, "New password must be at least 8 characters.").max(256).optional(),
  confirmPassword: z.string().max(256).optional(),
});

/**
 * POST /api/auth/account
 * ─────────────────────────────────────────────────────────────────────────────
 * Updates administrator credentials with Supabase Auth as the SOLE authority.
 * Verifies current password before applying changes.
 * Updates Supabase Auth account and PostgreSQL user_profiles record.
 * Refreshes session tokens.
 * ─────────────────────────────────────────────────────────────────────────────
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

  const parsed = accountSchema.safeParse(body);
  if (!parsed.success) {
    const msg = parsed.error.issues[0]?.message || "Invalid account change request.";
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  const { currentPassword, newUsername, newPassword, confirmPassword } = parsed.data;

  if (newUsername === undefined && newPassword === undefined) {
    return NextResponse.json({ error: "Nothing to change." }, { status: 400 });
  }

  if (newPassword !== undefined && newPassword !== (confirmPassword ?? "")) {
    return NextResponse.json({ error: "New passwords do not match." }, { status: 400 });
  }

  const serverSupabase = await createServerSupabaseClient(request);
  if (!serverSupabase) {
    return NextResponse.json({ error: "Authentication service unavailable." }, { status: 503 });
  }

  const {
    data: { user },
    error: userErr,
  } = await serverSupabase.auth.getUser();

  if (userErr || !user || !user.email) {
    return NextResponse.json({ error: "Unauthorized session." }, { status: 401 });
  }

  // Re-verify current password with Supabase Auth
  const { error: signInErr } = await serverSupabase.auth.signInWithPassword({
    email: user.email,
    password: currentPassword,
  });

  if (signInErr) {
    return NextResponse.json({ error: "Current password is incorrect." }, { status: 401 });
  }

  const adminClient = createAdminClient();
  if (!adminClient) {
    return NextResponse.json({ error: "Administrative client unavailable." }, { status: 503 });
  }

  const response = NextResponse.json({
    success: true,
    username: newUsername || guard.admin.username,
  });

  // Update password in Supabase Auth if provided
  if (newPassword) {
    const { error: updatePwErr } = await adminClient.auth.admin.updateUserById(user.id, {
      password: newPassword,
      email_confirm: true,
    });
    if (updatePwErr) {
      return NextResponse.json({ error: updatePwErr.message }, { status: 400 });
    }

    // Refresh cookies
    try {
      const routeSupabase = createRouteHandlerSupabaseClient(request, response);
      if (routeSupabase) {
        await routeSupabase.auth.signInWithPassword({
          email: user.email,
          password: newPassword,
        });
      }
    } catch {
      // Non-fatal session refresh catch
    }
  }

  // Update username in profile and user metadata if provided
  if (newUsername && newUsername !== guard.admin.username) {
    try {
      await adminClient.auth.admin.updateUserById(user.id, {
        user_metadata: {
          ...(user.user_metadata || {}),
          username: newUsername,
          name: newUsername,
        },
      });

      await prisma.userProfile.updateMany({
        where: { auth_user_id: user.id },
        data: { username: newUsername },
      });
    } catch (profileErr) {
      console.warn("[auth/account] Profile username update note:", profileErr);
    }
  }

  return response;
}
