import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/require-auth";
import { buildOldBrowserBackupZip, type BrowserExportInput } from "@/lib/recovery/old-browser-backup-builder";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * POST /api/old/browser-backup
 * ──────────────────────────────────────────────────────────────────────────
 * Accepts browser-side IndexedDB and LocalStorage payloads, classifies records
 * into the 4 OLD categories, and streams an offline ZIP archive directly to the client.
 * ═══════════════════════════════════════════════════════════════════════════
 */

export async function POST(request: Request) {
  const auth = await requireAdmin(request);
  if (!auth.ok) return auth.response;

  try {
    const body = (await request.json()) as BrowserExportInput;

    if (!body || (!body.indexeddb && !body.localStorage)) {
      return NextResponse.json(
        { ok: false, error: "Empty or invalid browser storage payload." },
        { status: 400 }
      );
    }

    const { filename, zipBuffer, sha256, totalRecords, categoryCounts } = buildOldBrowserBackupZip(body);

    return new Response(new Uint8Array(zipBuffer), {
      status: 200,
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Content-Length": String(zipBuffer.byteLength),
        "X-Archive-Checksum": sha256,
        "X-Archive-Records": String(totalRecords),
        "X-Category-Summary": JSON.stringify(categoryCounts),
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to generate OLD browser backup.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
