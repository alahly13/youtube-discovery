import { NextResponse } from "next/server";
import { z } from "zod";
import { getBlobBackend } from "@/lib/blob/backend-factory";
import { changeCredentials } from "@/lib/auth/account-store";
import { revokeAllSessions } from "@/lib/auth/session";
import { assertSameOrigin, requireAdmin } from "@/lib/auth/require-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const accountSchema = z.object({
  currentPassword: z.string().min(1).max(256),
  newUsername: z.string().min(3).max(32).optional(),
  newPassword: z.string().min(12).max(256).optional(),
  confirmPassword: z.string().max(256).optional(),
});

/**
 * POST /api/auth/account — change username and/or password.
 * Auth + current-password verification + same-origin enforced server-side.
 * Success bumps authVersion and revokes ALL sessions (old cookies stop
 * working); the caller must sign in again.
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
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  const parsed = accountSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid account change request" }, { status: 400 });
  }
  const { currentPassword, newUsername, newPassword, confirmPassword } = parsed.data;
  if (newUsername === undefined && newPassword === undefined) {
    return NextResponse.json({ error: "Nothing to change" }, { status: 400 });
  }
  if (newPassword !== undefined && newPassword !== (confirmPassword ?? "")) {
    return NextResponse.json({ error: "New passwords do not match" }, { status: 400 });
  }
  try {
    const backend = getBlobBackend();
    const account = await changeCredentials(backend, {
      currentPassword,
      newUsername,
      newPassword,
    });
    await revokeAllSessions(backend);
    return NextResponse.json({
      success: true,
      username: account.username,
      requireRelogin: true,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Account update failed";
    const status = message.includes("incorrect") ? 401 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
