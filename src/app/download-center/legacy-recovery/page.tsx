import type { Metadata } from "next";
import { ShieldCheck } from "lucide-react";
import { AppShell } from "@/components/layout/app-shell";
import { WorkspacePage } from "@/components/pages/workspace-page";
import { LegacyRecoveryWorkspace } from "@/components/download-center/legacy-recovery-workspace";

export const metadata: Metadata = {
  title: "Legacy Data Recovery — إنقاذ البيانات القديمة | YouTube Discovery",
  description: "Discover, verify, and download all recoverable historical Manifest files into an isolated offline backup package.",
};

export default function LegacyRecoveryPage() {
  return (
    <AppShell>
      <WorkspacePage
        icon={ShieldCheck}
        eyebrow="Historical Data Preservation"
        title="Legacy Data Recovery & Backup"
        description="Discover, verify, and export all historical Manifest files from Vercel Blob, application caches, and browser storage into an isolated offline backup package."
      >
        <LegacyRecoveryWorkspace />
      </WorkspacePage>
    </AppShell>
  );
}
