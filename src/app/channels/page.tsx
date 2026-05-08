import { Tv } from "lucide-react";
import { AppShell } from "@/components/layout/app-shell";
import { WorkspacePage } from "@/components/pages/workspace-page";

export default function ChannelsPage() {
  return (
    <AppShell>
      <WorkspacePage
        icon={Tv}
        eyebrow="Saved Channels"
        title="Channel Library"
        description="Saved channel sources will use channels.list metadata and uploads playlist manifests. Durable records are ready in the Prisma schema."
      />
    </AppShell>
  );
}
