import { getMemoryManifest } from "@/lib/manifests/manifest-memory-store";
import { notFound } from "@/lib/http/api-response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ manifestId: string }> }) {
  const { manifestId } = await context.params;
  const manifest = getMemoryManifest(manifestId);

  if (!manifest) {
    return notFound("Manifest was not found in the current runtime store.");
  }

  return Response.json(manifest);
}
