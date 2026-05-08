import { LinkIcon } from "lucide-react";
import { AppShell } from "@/components/layout/app-shell";
import { LinkExplorerClient } from "@/components/link-explorer/link-explorer-client";
import { WorkspacePage } from "@/components/pages/workspace-page";

export default function LinkExplorerPage() {
  return (
    <AppShell>
      <WorkspacePage
        icon={LinkIcon}
        eyebrow="Link Explorer"
        title="Analyze YouTube URLs without scraping"
        description="Parse video, Shorts, channel, handle, playlist, watch+list, and search URLs into official API strategies."
      >
        <LinkExplorerClient />
      </WorkspacePage>
    </AppShell>
  );
}
