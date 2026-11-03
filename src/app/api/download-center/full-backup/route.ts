import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/require-auth";
import { createFullProjectBackup } from "@/lib/backup/project-backup-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * POST /api/download-center/full-backup
 * ──────────────────────────────────────────────────────────────────────────
 * Generates and streams a comprehensive, self-describing project backup package:
 * - All 19 database tables (application data + schema + migrations + SQL dump)
 * - All canonical Supabase Storage objects from youtube-discovery-private
 * - Cryptographic SHA-256 checksums and verification reports
 * - Portable restore scripts for zero-friction project migration
 * ═══════════════════════════════════════════════════════════════════════════
 */

export async function POST(request: Request) {
  const auth = await requireAdmin(request);
  if (!auth.ok) return auth.response;

  try {
    const backupPackage = await createFullProjectBackup();

    return new Response(new Uint8Array(backupPackage.zipBuffer), {
      status: 200,
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${backupPackage.filename}"`,
        "Content-Length": String(backupPackage.byteLength),
        "X-Backup-Status": backupPackage.report.status,
        "X-Backup-Tables": String(backupPackage.report.totalTables),
        "X-Backup-Rows": String(backupPackage.report.totalRows),
        "X-Backup-Objects": String(backupPackage.report.totalObjects),
        "X-Backup-SHA256": backupPackage.sha256,
        "Cache-Control": "no-store, must-revalidate",
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed generating full project backup.";
    console.error("[download-center/full-backup] Error:", err);
    return NextResponse.json(
      {
        ok: false,
        error: message,
      },
      { status: 500 }
    );
  }
}
