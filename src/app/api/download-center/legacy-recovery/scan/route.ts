import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/require-auth";
import { runServerLegacyScan } from "@/lib/recovery/legacy-scanner";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * POST /api/download-center/legacy-recovery/scan
 * ──────────────────────────────────────────────────────────────────────────
 * Initiates a 100% read-only scan of all historical legacy data sources:
 * Vercel Blob, disk caches, and previous database registrations.
 * Under NO condition does this route mutate or purge any source.
 * ═══════════════════════════════════════════════════════════════════════════
 */

export async function POST(request: Request) {
  const auth = await requireAdmin(request);
  if (!auth.ok) return auth.response;

  const ownerId = auth.admin.userId || "00000000-0000-0000-0000-000000000001";

  try {
    const report = await runServerLegacyScan(ownerId);
    return NextResponse.json({
      ok: true,
      report,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to scan legacy data sources.";
    return NextResponse.json(
      {
        ok: false,
        error: message,
      },
      { status: 500 }
    );
  }
}
