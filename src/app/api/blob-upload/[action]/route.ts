import { NextResponse } from "next/server";
import { z } from "zod";
import { getBlobBackend } from "@/lib/blob/backend-factory";
import { abortUpload, commitUpload, initUpload, putUploadChunk, UploadError } from "@/lib/blob/chunked-upload";
import { assertSameOrigin, requireAdmin } from "@/lib/auth/require-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Staged chunked-upload endpoints — the browser NEVER submits an oversized
 * record in one request. Each request stays far under function body limits.
 * All endpoints are admin-authenticated + same-origin enforced.
 */

const initSchema = z.object({
  uploadId: z.string().min(8).max(128),
  namespace: z.enum(["playlists", "savedHistory"]),
  recordId: z.string().min(1).max(160),
  chunkCount: z.number().int().min(1).max(512),
  totalBytes: z.number().int().min(1),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  meta: z.record(z.string(), z.unknown()).optional(),
});

export async function POST(request: Request, { params }: { params: Promise<{ action: string }> }) {
  const csrf = assertSameOrigin(request);
  if (csrf) return csrf;
  const guard = await requireAdmin(request);
  if (!guard.ok) return guard.response;
  const { action } = await params;
  let backend;
  try {
    backend = getBlobBackend();
  } catch {
    return NextResponse.json({ error: "Storage is not configured" }, { status: 503 });
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  try {
    if (action === "init") {
      const parsed = initSchema.safeParse(body);
      if (!parsed.success) return NextResponse.json({ error: "Invalid upload init" }, { status: 400 });
      const result = await initUpload(backend, {
        ...parsed.data,
        meta: parsed.data.meta as Record<string, unknown> | undefined,
      });
      return NextResponse.json({ success: true, ...result });
    }
    if (action === "chunk") {
      const parsed = z
        .object({ uploadId: z.string().min(1), index: z.number().int().min(0), data: z.string().min(1) })
        .safeParse(body);
      if (!parsed.success) return NextResponse.json({ error: "Invalid chunk payload" }, { status: 400 });
      const result = await putUploadChunk(backend, parsed.data.uploadId, parsed.data.index, parsed.data.data);
      return NextResponse.json({ success: true, ...result });
    }
    if (action === "commit") {
      const parsed = z.object({ uploadId: z.string().min(1) }).safeParse(body);
      if (!parsed.success) return NextResponse.json({ error: "Invalid commit request" }, { status: 400 });
      const result = await commitUpload(backend, parsed.data.uploadId);
      return NextResponse.json({ success: true, ...result });
    }
    if (action === "abort") {
      const parsed = z.object({ uploadId: z.string().min(1) }).safeParse(body);
      if (!parsed.success) return NextResponse.json({ error: "Invalid abort request" }, { status: 400 });
      await abortUpload(backend, parsed.data.uploadId);
      return NextResponse.json({ success: true });
    }
    return NextResponse.json({ error: "Unknown upload action" }, { status: 404 });
  } catch (err) {
    if (err instanceof UploadError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json({ error: "Upload operation failed" }, { status: 500 });
  }
}
