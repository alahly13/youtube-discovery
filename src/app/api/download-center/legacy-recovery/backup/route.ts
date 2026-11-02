import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/require-auth";
import { createLegacyBackupPackage, type BrowserStorageSnapshot } from "@/lib/recovery/legacy-backup-builder";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * POST /api/download-center/legacy-recovery/backup
 * ──────────────────────────────────────────────────────────────────────────
 * Generates and streams the complete YouTube-Discovery-Legacy-Backup ZIP package
 * including all recoverable files from Vercel Blob, disk caches, and optional
 * browser-supplied storage snapshots.
 *
 * ABSOLUTE SAFETY RULE:
 * 100% read-only. No source files, caches, or blob objects are deleted.
 * ═══════════════════════════════════════════════════════════════════════════
 */

export async function POST(request: Request) {
  const auth = await requireAdmin(request);
  if (!auth.ok) return auth.response;

  const ownerId = auth.admin.userId || "00000000-0000-0000-0000-000000000001";

  try {
    let browserData: BrowserStorageSnapshot | undefined;
    try {
      const body = (await request.json()) as { browserData?: BrowserStorageSnapshot };
      browserData = body.browserData;
    } catch {
      // Body was empty or non-JSON
    }

    const backupResult = await createLegacyBackupPackage(ownerId, browserData);

    return new Response(new Uint8Array(backupResult.zipBuffer), {
      status: 200,
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${backupResult.filename}"`,
        "Content-Length": String(backupResult.byteLength),
        "X-Backup-Id": backupResult.backupId,
        "X-Backup-Status": backupResult.manifest.overall_status,
        "Cache-Control": "no-store, must-revalidate",
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to generate legacy backup package.";
    return NextResponse.json(
      {
        ok: false,
        error: message,
      },
      { status: 500 }
    );
  }
}
