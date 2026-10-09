import { NextResponse } from "next/server";
import { getBlobBackend } from "@/lib/blob/backend-factory";
import { verifyBlobConnection } from "@/lib/blob/blob-verify";
import { assertSameOrigin, requireAdmin } from "@/lib/auth/require-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/admin/storage-verify — safe, non-destructive Blob diagnostics.
 * Runs config/list/write-probe/store-identity checks and reports per-check
 * pass/fail WITHOUT secret values. The write probe is a tiny object under
 * __probe__/ that is deleted afterwards; user records are never touched.
 */
export async function POST(request: Request) {
  const csrf = assertSameOrigin(request);
  if (csrf) return csrf;
  const guard = await requireAdmin(request);
  if (!guard.ok) return guard.response;
  try {
    const backend = getBlobBackend();
    const report = await verifyBlobConnection(backend);
    return NextResponse.json(report);
  } catch (err) {
    return NextResponse.json(
      {
        checks: [{ name: "configPresent", passed: false, detail: err instanceof Error ? err.message : "Storage unavailable" }],
        allPassed: false,
        authMode: null,
        storeIdConfigured: Boolean(process.env.BLOB_STORE_ID?.trim()),
        observedHost: null,
        storeIdentity: "not-checked",
        generatedAt: new Date().toISOString(),
      },
      { status: 503 },
    );
  }
}
