import "server-only";

import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/require-auth";
import { getSafeAuthDiagnostics } from "@/lib/auth/auth-diagnostics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/admin/auth-diagnostics
 * ─────────────────────────────────────────────────────────────────────────────
 * Safe authentication diagnostics for the administrator.
 * Distinguishes authentication errors from authorization errors.
 * Returns strictly booleans, status tags, and safe labels.
 * NEVER returns secrets, passwords, tokens, or hashes.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export async function GET(request: Request) {
  const guard = await requireAdmin(request);
  if (!guard.ok) {
    return guard.response;
  }

  try {
    const diagnostics = await getSafeAuthDiagnostics();
    return NextResponse.json({
      success: true,
      diagnostics,
    });
  } catch (err) {
    return NextResponse.json(
      {
        error: "Diagnostics execution failed",
        details: err instanceof Error ? err.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
