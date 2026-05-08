import { Library } from "lucide-react";
import { AppShell } from "@/components/layout/app-shell";
import { WorkspacePage } from "@/components/pages/workspace-page";

export default function SavedPage() {
  return (
    <AppShell>
      <WorkspacePage
        icon={Library}
        eyebrow="Saved Library"
        title="Saved Videos and Research Assets"
        description="Saved videos dedupe by platform item ID and canonical URL, never by title alone."
      />
    </AppShell>
  );
}
