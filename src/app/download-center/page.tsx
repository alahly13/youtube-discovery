import type { Metadata } from "next";
import { Download } from "lucide-react";
import { AppShell } from "@/components/layout/app-shell";
import { WorkspacePage } from "@/components/pages/workspace-page";
import { DownloadCenterWorkspace } from "@/components/download-center/download-center-workspace";

export const metadata: Metadata = {
  title: "مركز التحميل / Download Center | YouTube Discovery",
  description: "Centralized manifest download and export center for NEW and OLD storage.",
};

export default function DownloadCenterPage() {
  return (
    <AppShell>
      <WorkspacePage
        icon={Download}
        eyebrow="Manifest Storage & Export"
        title="Download Center (مركز التحميل)"
        description="Unified manifest download and backup center for both current active tables (NEW) and historical archives (OLD)."
      >
        <DownloadCenterWorkspace />
      </WorkspacePage>
    </AppShell>
  );
}
