import { NextResponse } from "next/server";
import { deleteSearchFromArchive, getSearchFromArchive } from "@/lib/search-storage/search-storage-archive";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/search-storage/[id]
 * Loads the complete historical search record from disk without triggering any YouTube API call.
 */
export async function GET(
  _request: Request,
  props: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await props.params;
    const record = await getSearchFromArchive(id);

    if (!record) {
      return NextResponse.json({ error: "Search record not found or expired" }, { status: 404 });
    }

    return NextResponse.json({ record });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to get search record";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

/**
 * DELETE /api/search-storage/[id]
 * Deletes a specific historical search record from the archive.
 */
export async function DELETE(
  _request: Request,
  props: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await props.params;
    const success = await deleteSearchFromArchive(id);

    if (!success) {
      return NextResponse.json({ error: "Record not found" }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to delete search record";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
