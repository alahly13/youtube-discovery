import { NextResponse } from "next/server";
import { z } from "zod";
import { deleteCustomApiKey, updateKeyMetadata } from "@/lib/platforms/youtube/youtube-api-keys";
import { assertSameOrigin, requireAdmin } from "@/lib/auth/require-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const metadataSchema = z.object({
  label: z.string().min(1).max(120).optional(),
  accountLabel: z.string().max(80).nullable().optional(),
  projectId: z.string().max(80).nullable().optional(),
  projectDisplayName: z.string().max(120).nullable().optional(),
  enabled: z.boolean().optional(),
  order: z.number().int().min(0).max(1000).optional(),
});

/**
 * PATCH /api/youtube/keys/[keyId]
 * Updates admin-editable metadata: label, Gmail/account label, Google Cloud
 * project association, display name, enabled state, rotation priority.
 * Never accepts or returns key values.
 */
export async function PATCH(request: Request, props: { params: Promise<{ keyId: string }> }) {
  const csrf = assertSameOrigin(request);
  if (csrf) return csrf;
  const guard = await requireAdmin(request);
  if (!guard.ok) return guard.response;
  try {
    const { keyId } = await props.params;
    if (keyId === "env") {
      return NextResponse.json({ error: "ENV key metadata is not editable" }, { status: 400 });
    }
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid request" }, { status: 400 });
    }
    const parsed = metadataSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid key metadata" }, { status: 400 });
    }
    const ok = await updateKeyMetadata(keyId, parsed.data);
    if (!ok) {
      return NextResponse.json({ error: "Key not found" }, { status: 404 });
    }
    return NextResponse.json({ success: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to update key metadata";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

/**
 * DELETE /api/youtube/keys/[keyId]
 * Deletes a custom key. If it was active, safely falls back to "env".
 */
export async function DELETE(request: Request, props: { params: Promise<{ keyId: string }> }) {
  const csrf = assertSameOrigin(request);
  if (csrf) return csrf;
  const guard = await requireAdmin(request);
  if (!guard.ok) return guard.response;
  try {
    const { keyId } = await props.params;
    if (keyId === "env") {
      return NextResponse.json({ error: "Cannot delete default ENV key" }, { status: 400 });
    }

    const success = await deleteCustomApiKey(keyId);
    if (!success) {
      return NextResponse.json({ error: "Key not found" }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to delete API key";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
