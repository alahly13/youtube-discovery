import { Archive } from "lucide-react";
import { AppShell } from "@/components/layout/app-shell";
import { WorkspacePage } from "@/components/pages/workspace-page";
import { OldDashboardWorkspace } from "@/components/old/old-dashboard-workspace";

export const metadata = {
  title: "OLD Legacy Manifest Archive · YouTube Discovery",
  description: "Browse and import historical manifests and generation archives into ASDY/OLD/.",
};

export default function OldArchiveDashboardPage() {
  return (
    <AppShell>
      <WorkspacePage
        icon={Archive}
        eyebrow="Historical Registry"
        title="OLD Legacy Manifest Archive"
        description="Logical storage root ASDY/OLD/ for historical manifests, generation ZIP exports, and NDJSON imports with strict isolation from active tables."
      >
        <OldDashboardWorkspace />
      </WorkspacePage>
    </AppShell>
  );
}
