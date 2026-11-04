import { NextResponse } from "next/server";
import { z } from "zod";
import { getNewStorageBackend } from "@/lib/storage/r2-blob-backend";
import { assertSameOrigin, requireAdmin } from "@/lib/auth/require-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/admin/migrate — legacy storage migration endpoint.
 * Now safe and decoupled from legacy Vercel blob.
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

  try {
    getNewStorageBackend();
  } catch {
    return NextResponse.json({ error: "Storage is not configured" }, { status: 503 });
  }

  let batch: z.infer<typeof browserBatchSchema> = {};
  try {
    const body: unknown = await request.json().catch(() => ({}));
    const parsed = browserBatchSchema.safeParse(body);
    if (parsed.success) batch = parsed.data;
  } catch {
    // Empty body is fine.
  }

  const titlesCount = batch.savedTitles?.length ?? 0;

  return NextResponse.json({
    success: true,
    message: "Storage architecture is Cloudflare R2 + Local-First IndexedDB.",
    playlists: { discovered: 0, imported: 0, skipped: 0, errors: [] },
    savedHistory: { discovered: 0, imported: 0, skipped: 0, errors: [] },
    encryptedKeys: { discovered: 0, imported: 0, skipped: 0, errors: [] },
    titlesImported: titlesCount,
    titlesSkipped: 0,
    stagedCleaned: 0,
  });
}
