import { AppShell } from "@/components/layout/app-shell";
import { ManifestDetailWorkspace } from "@/components/manifests/manifest-detail-workspace";

/* ═══════════════════════════════════════════════════════════════════════════
   Manifest Detail Page — /manifests/[manifestId]
   ──────────────────────────────────────────────────────────────────────────
   Fetches a specific manifest from the runtime memory store and provides
   full local search, filter, sort, export, and scoped AI analysis.
   ═══════════════════════════════════════════════════════════════════════════ */

export default async function ManifestDetailPage({
  params,
}: {
  params: Promise<{ manifestId: string }>;
}) {
  const { manifestId } = await params;

  return (
    <AppShell>
      <ManifestDetailWorkspace manifestId={manifestId} />
    </AppShell>
  );
}
