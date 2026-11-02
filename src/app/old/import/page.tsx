import { Suspense } from "react";
import { UploadCloud } from "lucide-react";
import { AppShell } from "@/components/layout/app-shell";
import { WorkspacePage } from "@/components/pages/workspace-page";
import { OldImportPreviewWorkspace } from "@/components/old/old-import-preview-workspace";

export const metadata = {
  title: "Import Legacy Manifest · OLD Archive · YouTube Discovery",
  description: "Preview and import historical manifest files and generation archives into ASDY/OLD/.",
};

export default function OldImportPage() {
  return (
    <AppShell>
      <WorkspacePage
        icon={UploadCloud}
        eyebrow="OLD Archive · ASDY/OLD/"
        title="Import Legacy Manifest"
        description="Inspect, validate, and preview historical manifest JSON or ZIP files locally before importing into ASDY/OLD/."
      >
        <Suspense fallback={<div className="p-12 text-center text-xs text-muted">Loading import workspace...</div>}>
          <OldImportPreviewWorkspace />
        </Suspense>
      </WorkspacePage>
    </AppShell>
  );
}
