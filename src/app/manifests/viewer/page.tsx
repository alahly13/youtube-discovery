import { Eye } from "lucide-react";
import { AppShell } from "@/components/layout/app-shell";
import { WorkspacePage } from "@/components/pages/workspace-page";
import { ManifestViewerWorkspace } from "@/components/manifests/manifest-viewer-workspace";

export const metadata = {
  title: "Manifest Viewer · Storage Explorer · YouTube Discovery",
  description: "Inspect manifest payloads, provenance, and individual items without modifying database or storage state.",
};

export default function ManifestViewerPage() {
  return (
    <AppShell>
      <WorkspacePage
        icon={Eye}
        eyebrow="Storage Explorer"
        title="Manifest Viewer"
        description="Inspect registered manifests and local manifest files in read-only mode."
      >
        <ManifestViewerWorkspace />
      </WorkspacePage>
    </AppShell>
  );
}
