import { FolderKanban } from "lucide-react";
import { AppShell } from "@/components/layout/app-shell";
import { WorkspacePage } from "@/components/pages/workspace-page";

export default function CollectionsPage() {
  return (
    <AppShell>
      <WorkspacePage
        icon={FolderKanban}
        eyebrow="Collections"
        title="Research Collections"
        description="Collections organize saved videos and manifests under owner-scoped durable records once persistence is enabled."
      />
    </AppShell>
  );
}
