import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/require-auth";
import { parseRawBufferToEnvelope, type OldArchiveCategory } from "@/lib/old/archive-envelope";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * POST /api/old/preview
 * ──────────────────────────────────────────────────────────────────────────
 * Previews any historical manifest file without saving it to storage or DB.
 * Supports JSON, ZIP (with zip bomb & path traversal protections), and NDJSON.
 * ═══════════════════════════════════════════════════════════════════════════
 */

export async function POST(request: Request) {
  const auth = await requireAdmin(request);
  if (!auth.ok) return auth.response;

  try {
    const contentType = request.headers.get("content-type") || "";
    let buffer: Buffer;
    let filename = "archive.json";
    let categoryOverride: OldArchiveCategory | undefined;

    if (contentType.includes("multipart/form-data")) {
      const formData = await request.formData();
      const file = formData.get("file") as File | null;
      if (!file) {
        return NextResponse.json({ ok: false, error: "No file provided in form-data." }, { status: 400 });
      }
      filename = file.name || "archive.json";
      const catParam = formData.get("category") as string | null;
      if (catParam) categoryOverride = catParam as OldArchiveCategory;

      const arrayBuf = await file.arrayBuffer();
      buffer = Buffer.from(arrayBuf);
    } else {
      const body = await request.json();
      if (!body.content) {
        return NextResponse.json({ ok: false, error: "Missing content in request body." }, { status: 400 });
      }
      filename = body.filename || "archive.json";
      categoryOverride = body.categoryOverride;
      buffer = Buffer.from(body.content, "utf8");
    }

    const envelope = await parseRawBufferToEnvelope(buffer, filename, categoryOverride);

    // Return preview payload with sample items (first 100) for UI speed
    const sampleItems = envelope.payload.items.slice(0, 100);

    return NextResponse.json({
      ok: true,
      metadata: envelope.manifest_metadata,
      sampleItems,
      totalItems: envelope.manifest_metadata.record_count,
      filterSummary: envelope.manifest_metadata.filter_summary,
      rawEnvelope: envelope,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to preview archive file.";
    return NextResponse.json(
      {
        ok: false,
        error: message,
      },
      { status: 400 }
    );
  }
}
