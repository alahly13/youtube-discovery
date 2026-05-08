import { Archive } from "lucide-react";
import { AppShell } from "@/components/layout/app-shell";
import { WorkspacePage } from "@/components/pages/workspace-page";

export default async function ManifestDetailPage({ params }: { params: Promise<{ manifestId: string }> }) {
  const { manifestId } = await params;

  return (
    <AppShell>
      <WorkspacePage
        icon={Archive}
        eyebrow="Manifest detail"
        title={`Manifest ${manifestId}`}
        description="Manifest detail pages expose normalized item provenance, local search/filter/sort, export actions, and scoped AI analysis."
      />
    </AppShell>
  );
}
