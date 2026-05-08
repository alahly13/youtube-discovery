import { FolderKanban } from "lucide-react";
import { AppShell } from "@/components/layout/app-shell";
import { WorkspacePage } from "@/components/pages/workspace-page";
import { CollectionsWorkspace } from "@/components/collections/collections-workspace";

/* ═══════════════════════════════════════════════════════════════════════════
   Collections Page — /collections
   ──────────────────────────────────────────────────────────────────────────
   Manages research collections that group related manifests together.
   Currently backed by localStorage; awaits durable persistence.
   ═══════════════════════════════════════════════════════════════════════════ */

export default function CollectionsPage() {
  return (
    <AppShell>
      <WorkspacePage
        icon={FolderKanban}
        eyebrow="Collections"
        title="Research Collections"
        description="Collections organize saved manifests under named research groups. Create, browse, and manage your research collections."
      >
        <CollectionsWorkspace />
      </WorkspacePage>
    </AppShell>
  );
}
