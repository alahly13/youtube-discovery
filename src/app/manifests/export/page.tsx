import { FolderOutput } from "lucide-react";
import { AppShell } from "@/components/layout/app-shell";
import { WorkspacePage } from "@/components/pages/workspace-page";
import { ManifestExportWorkspace } from "@/components/manifests/manifest-export-workspace";

export const metadata = {
  title: "Export Manifest · Storage Explorer · YouTube Discovery",
  description: "Export registered manifests and original storage bytes from dedicated OLD and NEW buckets.",
};

export default function ManifestExportPage() {
  return (
    <AppShell>
      <WorkspacePage
        icon={FolderOutput}
        eyebrow="Storage Explorer"
        title="Manifest Export"
        description="Select manifests from the OLD archive or NEW generational storage and download verified original archives."
      >
        <ManifestExportWorkspace />
      </WorkspacePage>
    </AppShell>
  );
}
