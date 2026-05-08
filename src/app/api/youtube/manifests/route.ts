import { listMemoryManifests } from "@/lib/manifests/manifest-memory-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json({
    manifests: listMemoryManifests(),
    persistence: {
      durableDatabaseEnabled: process.env.ENABLE_YOUTUBE_MANIFEST_PERSISTENCE === "true",
      note: "Runtime memory manifests are non-durable until Prisma migrations are applied and persistence repositories are enabled.",
    },
  });
}
