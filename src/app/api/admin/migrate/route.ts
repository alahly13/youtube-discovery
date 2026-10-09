import { NextResponse } from "next/server";
import { z } from "zod";
import { getBlobBackend } from "@/lib/blob/backend-factory";
import { gcStaging } from "@/lib/blob/record-store";
import { migrateAllFromDisk, type FullMigrationReport } from "@/lib/blob/migration";
import { assertSameOrigin, requireAdmin } from "@/lib/auth/require-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/admin/migrate — import legacy disk data (playlists, searches,
 * encrypted keys) into Blob. Idempotent by stable IDs: safe to re-run and
 * resume. Disk originals are LEFT IN PLACE. Also accepts small browser-side
 * batches (Zustand saved-search titles) which are stored as metadata records
 * without full results when no complete record exists.
 */

const browserBatchSchema = z.object({
  savedTitles: z
    .array(
      z.object({
        id: z.string().min(1).max(160),
        title: z.string().min(1).max(300),
        query: z.string().min(1).max(500),
        resourceSelection: z.enum(["ALL", "video", "channel", "playlist"]).optional(),
        createdAt: z.string().optional(),
      }),
    )
    .max(200)
    .optional(),
});

export async function POST(request: Request) {
  const csrf = assertSameOrigin(request);
  if (csrf) return csrf;
  const guard = await requireAdmin(request);
  if (!guard.ok) return guard.response;
  let backend;
  try {
    backend = getBlobBackend();
  } catch {
    return NextResponse.json({ error: "Storage is not configured" }, { status: 503 });
  }
  let batch: z.infer<typeof browserBatchSchema> = {};
  try {
    const body: unknown = await request.json().catch(() => ({}));
    const parsed = browserBatchSchema.safeParse(body);
    if (parsed.success) batch = parsed.data;
  } catch {
    // Empty body is fine (disk-only migration).
  }
  let report: FullMigrationReport;
  try {
    report = await migrateAllFromDisk(backend);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Migration failed" },
      { status: 500 },
    );
  }
  // Browser titles: import as metadata-only records when no complete record
  // with the same id already exists (idempotent, resultsAvailable=false).
  let titlesImported = 0;
  let titlesSkipped = 0;
  if (batch.savedTitles && batch.savedTitles.length > 0) {
    const { loadRecord, saveRecord } = await import("@/lib/blob/record-store");
    for (const t of batch.savedTitles) {
      const id = `title-${t.id}`.slice(0, 160);
      const exists = await loadRecord(backend, "savedHistory", id).catch(() => null);
      if (exists) {
        titlesSkipped += 1;
        continue;
      }
      const now = new Date().toISOString();
      const record = {
        id,
        title: t.title,
        query: t.query,
        resourceSelection: t.resourceSelection ?? "ALL",
        settings: {},
        manifest: null,
        resultsAvailable: false,
        createdAt: t.createdAt ?? now,
        searchedAt: Date.now(),
        expiresAt: null,
        migratedFrom: "browser-saved-titles",
      };
      await saveRecord(backend, "savedHistory", id, record, {
        id,
        title: t.title,
        query: t.query,
        resourceSelection: t.resourceSelection ?? "ALL",
        settings: {},
        itemCount: 0,
        createdAt: record.createdAt,
        searchedAt: record.searchedAt,
        expiresAt: null,
        status: "empty",
      });
      titlesImported += 1;
    }
  }
  // Conservative staging cleanup (uncommitted uploads older than 48h only).
  const stagedCleaned = await gcStaging(backend, 48 * 60 * 60 * 1000).catch(() => 0);
  return NextResponse.json({ success: true, ...report, titlesImported, titlesSkipped, stagedCleaned });
}
