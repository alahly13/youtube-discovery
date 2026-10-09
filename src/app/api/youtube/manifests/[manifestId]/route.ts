import { getMemoryManifest } from "@/lib/manifests/manifest-memory-store";
import { notFound } from "@/lib/http/api-response";
import { requireAdmin } from "@/lib/auth/require-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ manifestId: string }> }) {
  const guard = await requireAdmin(request);
  if (!guard.ok) return guard.response;
  const { manifestId } = await context.params;
  const manifest = getMemoryManifest(manifestId);

  if (!manifest) {
    return notFound("Manifest was not found in the current runtime store.");
  }

  return Response.json(manifest);
}
