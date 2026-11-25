import { NextResponse } from "next/server";
import { z } from "zod";
import { getNewStorageBackend } from "@/lib/storage/r2-blob-backend";
import { assertSameOrigin, requireAdmin } from "@/lib/auth/require-auth";
import { prisma } from "@/lib/db/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/admin/migrate — idempotent import of browser saved-search titles
 * and status summary for StorageMigrationCard (never simulates imported items).
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

  let titlesImported = 0;
  let titlesSkipped = 0;
  const titles = batch.savedTitles ?? [];
  const ownerId = guard.admin.profileId;

  if (titles.length > 0 && ownerId) {
    try {
      for (const item of titles) {
        const existing = await prisma.savedSearchPreset.findFirst({
          where: { owner_id: ownerId, record_id: item.id },
          select: { id: true },
        });
        if (existing) {
          titlesSkipped++;
          continue;
        }
        await prisma.savedSearchPreset.create({
          data: {
            owner_id: ownerId,
            record_id: item.id,
            resource_type: "SAVED_SEARCH",
            resource_id: item.id,
            title: item.title.slice(0, 255),
            query_text: item.query.slice(0, 512),
            search_settings: {
              resourceSelection: item.resourceSelection ?? "ALL",
            },
            saved_at: item.createdAt ? new Date(item.createdAt) : new Date(),
          },
        });
        titlesImported++;
      }
    } catch (err) {
      return NextResponse.json(
        { error: err instanceof Error ? err.message : "Failed migrating saved titles" },
        { status: 500 }
      );
    }
  } else if (titles.length > 0) {
    titlesSkipped = titles.length;
  }

  const zeroBucket = { discovered: 0, imported: 0, skipped: 0, failed: 0, errors: [] as string[] };
  return NextResponse.json({
    success: true,
    message: "Storage architecture is Cloudflare R2 + Local-First IndexedDB.",
    playlists: zeroBucket,
    searches: zeroBucket,
    keys: zeroBucket,
    savedHistory: zeroBucket,
    encryptedKeys: zeroBucket,
    titlesImported,
    titlesSkipped,
    stagedCleaned: 0,
  });
}
