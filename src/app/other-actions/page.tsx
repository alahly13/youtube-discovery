"use client";

import { Sparkles } from "lucide-react";
import { AppShell } from "@/components/layout/app-shell";
import { WorkspacePage } from "@/components/pages/workspace-page";
import { OtherActionsWorkspace } from "@/components/migration/other-actions-workspace";

export default function OtherActionsPage() {
  return (
    <AppShell>
      <WorkspacePage
        icon={Sparkles}
        eyebrow="Safe Storage Migration"
        title="Other Actions & Legacy Data Migration"
        description="Discover and reorganize previously saved local browser data, inspect legacy records with zero-loss descriptions, and safely upload them to Cloudflare R2 under the canonical 'before-app-updating' historical namespace."
      >
        <OtherActionsWorkspace />
      </WorkspacePage>
    </AppShell>
  );
}
