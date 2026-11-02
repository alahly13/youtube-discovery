import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/require-auth";
import { parseRawBufferToEnvelope, type ArchivedManifestEnvelope, type OldArchiveCategory } from "@/lib/old/archive-envelope";
import { importArchivedManifest } from "@/lib/old/archive-store";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * POST /api/old/import
 * ──────────────────────────────────────────────────────────────────────────
 * Validates, uploads, and registers an archived manifest into ASDY/OLD/ storage
 * and the archived_manifests database table. Rejects duplicates by content SHA-256.
 * ═══════════════════════════════════════════════════════════════════════════
 */

export async function POST(request: Request) {
  const auth = await requireAdmin(request);
  if (!auth.ok) return auth.response;

  const ownerId = auth.admin.userId || "00000000-0000-0000-0000-000000000001";
  const storageOwnerUuid = auth.admin.userId || "00000000-0000-0000-0000-000000000001";

  try {
    const contentType = request.headers.get("content-type") || "";
    let envelope: ArchivedManifestEnvelope;

    if (contentType.includes("multipart/form-data")) {
      const formData = await request.formData();
      const file = formData.get("file") as File | null;
      if (!file) {
        return NextResponse.json({ ok: false, error: "No file provided in form-data." }, { status: 400 });
      }
      const filename = file.name || "archive.json";
      const catParam = formData.get("category") as string | null;
      const categoryOverride = catParam ? (catParam as OldArchiveCategory) : undefined;

      const arrayBuf = await file.arrayBuffer();
      const buffer = Buffer.from(arrayBuf);
      envelope = await parseRawBufferToEnvelope(buffer, filename, categoryOverride);
    } else {
      const body = await request.json();

      if (body.envelope) {
        envelope = body.envelope as ArchivedManifestEnvelope;
      } else if (body.content) {
        const buffer = Buffer.from(body.content, "utf8");
        envelope = await parseRawBufferToEnvelope(buffer, body.filename || "archive.json", body.categoryOverride);
      } else {
        return NextResponse.json(
          { ok: false, error: "Missing envelope or content in request body." },
          { status: 400 }
        );
      }
    }

    // Persist into ASDY/OLD/ storage and DB registry
    const record = await importArchivedManifest(ownerId, storageOwnerUuid, envelope);

    return NextResponse.json({
      ok: true,
      message: `Successfully imported "${envelope.manifest_metadata.manifest_id}" into OLD Archive (${record.category}).`,
      record,
    });
  } catch (err: unknown) {
    const errorObj = err as { code?: string; existingId?: string; message?: string };
    if (errorObj?.code === "DUPLICATE_ARCHIVE") {
      return NextResponse.json(
        {
          ok: false,
          code: "DUPLICATE_ARCHIVE",
          error: errorObj.message || "Duplicate archive.",
          existingId: errorObj.existingId,
        },
        { status: 409 }
      );
    }

    const message = err instanceof Error ? err.message : "Failed to import archived manifest.";
    return NextResponse.json(
      {
        ok: false,
        error: message,
      },
      { status: 400 }
    );
  }
}
