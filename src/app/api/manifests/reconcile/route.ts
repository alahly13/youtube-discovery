import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/require-auth";
import { syncReconciliationService } from "@/lib/sync/sync-reconciliation-service";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * GET /api/manifests/reconcile
 * ──────────────────────────────────────────────────────────────────────────
 * Executes an automated reconciliation check between Supabase PostgreSQL
 * and Cloudflare R2 for the authenticated administrator.
 * ═══════════════════════════════════════════════════════════════════════════
 */

export async function GET(request: Request) {
  const auth = await requireAdmin(request);
  if (!auth.ok) return auth.response;

  const storageOwnerUuid = auth.admin.userId || "00000000-0000-0000-0000-000000000001";

  try {
    const report = await syncReconciliationService.reconcileOwnerStorage(storageOwnerUuid);
    return NextResponse.json({
      ok: true,
      report,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Reconciliation failed.",
      },
      { status: 500 }
    );
  }
}
