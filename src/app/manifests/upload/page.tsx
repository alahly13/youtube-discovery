import { Upload } from "lucide-react";
import { AppShell } from "@/components/layout/app-shell";
import { WorkspacePage } from "@/components/pages/workspace-page";
import { ManifestUploadWorkspace } from "@/components/manifests/manifest-upload-workspace";

export const metadata = {
  title: "Upload Manifest · Storage Explorer · YouTube Discovery",
  description: "Upload and verify manifest archives to dedicated OLD and NEW private storage buckets.",
};

export default function ManifestUploadPage() {
  return (
    <AppShell>
      <WorkspacePage
        icon={Upload}
        eyebrow="Storage Router"
        title="Upload Manifest"
        description="Select destination bucket (OLD vs NEW), choose archive category or dataset, and upload manifests securely."
      >
        <ManifestUploadWorkspace />
      </WorkspacePage>
    </AppShell>
  );
}
