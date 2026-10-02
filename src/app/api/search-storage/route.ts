import { NextResponse } from "next/server";
import {
  clearSearchArchive,
  getArchiveTtlInfo,
  listSearchArchiveIndex,
  saveSearchToArchive,
} from "@/lib/search-storage/search-storage-archive";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/search-storage
 * Returns the lightweight search archive index and TTL metadata for fast history filtering.
 */
export async function GET() {
  try {
    const items = await listSearchArchiveIndex();
    const ttlInfo = getArchiveTtlInfo();

    return NextResponse.json({
      items,
      ttl: ttlInfo,
      totalCount: items.length,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to list search archive";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

/**
 * POST /api/search-storage
 * Saves a COMPLETE search record including full rawJson to its dedicated file on disk.
 */
export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as {
      id?: string;
      query: string;
      resourceSelection: "ALL" | "video" | "channel" | "playlist";
      settings: any;
      filters?: any;
      manifest: any;
    };

    if (!payload.query || !payload.manifest) {
      return NextResponse.json({ error: "Missing query or manifest" }, { status: 400 });
    }

    const saved = await saveSearchToArchive(payload);
    return NextResponse.json({
      success: true,
      id: saved.id,
      expiresAt: saved.expiresAt,
      createdAt: saved.createdAt,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to save search archive";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

/**
 * DELETE /api/search-storage
 * Clears the entire search archive.
 */
export async function DELETE() {
  try {
    await clearSearchArchive();
    return NextResponse.json({ success: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to clear search archive";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
