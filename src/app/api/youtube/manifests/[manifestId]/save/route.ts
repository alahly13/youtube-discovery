import { getMemoryManifest, saveManifestInMemory } from "@/lib/manifests/manifest-memory-store";
import { notFound } from "@/lib/http/api-response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(_request: Request, context: { params: Promise<{ manifestId: string }> }) {
  const { manifestId } = await context.params;
  const manifest = getMemoryManifest(manifestId);

  if (!manifest) {
    return notFound("Manifest was not found in the current runtime store.");
  }

  return Response.json({
    manifest: saveManifestInMemory(manifest, true),
    persistence: {
      durableDatabaseEnabled: process.env.ENABLE_YOUTUBE_MANIFEST_PERSISTENCE === "true",
      note: "Saved in the runtime manifest store. Apply Prisma migrations and enable persistence for durable saves.",
    },
  });
}
