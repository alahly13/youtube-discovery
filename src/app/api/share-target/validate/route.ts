import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/require-auth";
import { prisma } from "@/lib/db/prisma";
import {
  parseSharedFields,
  buildSharedLinkRecordId,
  type ShareTargetValidationData,
  type ShareTargetDuplicateSummary,
} from "@/lib/pwa/share-target";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * POST /api/share-target/validate
 * ──────────────────────────────────────────────────────────────────────────
 * Scope: Server-side validation, sanitization, and duplicate detection for
 *        the PWA Web Share Target review page.
 *
 * Why this route exists:
 *   Client-side validation alone is never trusted. This endpoint verifies
 *   that the shared URL is an absolute HTTP/HTTPS link, normalizes the text
 *   and suggested title according to the canonical contracts, and checks the
 *   authenticated administrator's saved references for duplicates.
 *
 * Security:
 *   - Protected by requireAdmin() session check.
 *   - Strips control characters and enforces length limits.
 *   - Rejects non-HTTP/HTTPS schemes (javascript:, data:, file:, etc.).
 *   - Never fetches external URLs on the server.
 * ═══════════════════════════════════════════════════════════════════════════
 */
export async function POST(request: Request) {
  const guard = await requireAdmin(request);
  if (!guard.ok) return guard.response;

  try {
    const body = await request.json().catch(() => ({}));
    const parseResult = parseSharedFields({
      title: body.title,
      text: body.text,
      url: body.url,
    });

    if (!parseResult.ok) {
      return NextResponse.json(
        {
          ok: false,
          code: parseResult.code,
          error: parseResult.message,
        },
        { status: 400 }
      );
    }

    const { url, suggestedTitle, suggestedNotes, sharedText, warnings } =
      parseResult.value;

    let duplicateSummary: ShareTargetDuplicateSummary | null = null;
    const profileId = guard.admin.profileId;

    if (profileId) {
      try {
        const recordId = buildSharedLinkRecordId(url);
        const existing = await prisma.savedReference.findFirst({
          where: {
            owner_id: profileId,
            OR: [{ record_id: recordId }, { url: url }],
          },
          select: {
            record_id: true,
            title: true,
            url: true,
          },
        });

        if (existing) {
          duplicateSummary = {
            recordId: existing.record_id,
            title: existing.title,
            url: existing.url || url,
          };
        }
      } catch (dbError) {
        // Database check failure should not prevent reviewing the shared link;
        // warn in console without breaking the validation response.
        console.warn("[share-target] Duplicate check error:", dbError);
      }
    }

    const data: ShareTargetValidationData = {
      url,
      suggestedTitle,
      suggestedNotes,
      sharedText,
      warnings,
    };

    return NextResponse.json({
      ok: true,
      data,
      duplicate: duplicateSummary,
    });
  } catch (error) {
    console.error("[share-target] Server validation error:", error);
    return NextResponse.json(
      {
        ok: false,
        code: "SERVER_ERROR",
        error: "An unexpected error occurred while validating the shared link.",
      },
      { status: 500 }
    );
  }
}
