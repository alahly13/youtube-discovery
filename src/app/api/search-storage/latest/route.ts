import { NextResponse } from "next/server";
import { getArchiveTtlInfo, getLatestSearchFromArchive } from "@/lib/search-storage/search-storage-archive";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/search-storage/latest
 * Returns the most recent non-expired complete search record with all rawJson preserved.
 */
export async function GET() {
  try {
    const record = await getLatestSearchFromArchive();
    const ttlInfo = getArchiveTtlInfo();

    if (!record) {
      return NextResponse.json({ record: null, ttl: ttlInfo });
    }

    return NextResponse.json({
      record,
      ttl: ttlInfo,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to get latest search";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
