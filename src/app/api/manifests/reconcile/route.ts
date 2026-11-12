import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/require-auth";
import { resolveStorageOwnerId } from "@/lib/auth/storage-owner";
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

  const storageOwnerUuid = resolveStorageOwnerId(auth.admin);
  if (!storageOwnerUuid) {
    return NextResponse.json(
      { ok: false, error: "Unable to resolve a canonical storage owner for this session." },
      { status: 500 }
    );
  }

  try {
    const report = await syncReconciliationService.reconcileOwnerStorage(storageOwnerUuid);
    // Return top-level summary fields expected by ManifestStorageExplorer
    // while keeping the nested `report` object for existing API consumers.
    return NextResponse.json({
      ok: true,
      overallHealthy: report.overallHealthy,
      totalScanned: report.totalScanned,
      counts: report.counts,
      items: report.items,
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
