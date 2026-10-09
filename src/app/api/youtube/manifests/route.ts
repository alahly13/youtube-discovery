import { listMemoryManifests } from "@/lib/manifests/manifest-memory-store";
import { requireAdmin } from "@/lib/auth/require-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const guard = await requireAdmin(request);
  if (!guard.ok) return guard.response;
  return Response.json({
    manifests: listMemoryManifests(),
    persistence: {
      durableDatabaseEnabled: process.env.ENABLE_YOUTUBE_MANIFEST_PERSISTENCE === "true",
      note: "Runtime memory manifests are non-durable until Prisma migrations are applied and persistence repositories are enabled.",
    },
  });
}
