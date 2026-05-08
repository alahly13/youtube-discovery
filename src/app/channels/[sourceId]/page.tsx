import { Tv } from "lucide-react";
import { AppShell } from "@/components/layout/app-shell";
import { WorkspacePage } from "@/components/pages/workspace-page";

export default async function ChannelDetailPage({ params }: { params: Promise<{ sourceId: string }> }) {
  const { sourceId } = await params;

  return (
    <AppShell>
      <WorkspacePage
        icon={Tv}
        eyebrow="Channel detail"
        title={`Channel ${sourceId}`}
        description="Channel detail pages are reserved for uploads manifests, attempts, coverage, saved videos, and scoped AI analysis."
      />
    </AppShell>
  );
}
