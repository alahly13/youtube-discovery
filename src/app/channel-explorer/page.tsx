import { Compass } from "lucide-react";
import { AppShell } from "@/components/layout/app-shell";
import { WorkspacePage } from "@/components/pages/workspace-page";
import { ChannelExplorerClient } from "./channel-explorer-client";

export default function ChannelExplorerPage() {
  return (
    <AppShell>
      <WorkspacePage
        icon={Compass}
        eyebrow="Channel uploads"
        title="Channel Explorer"
        description="Resolve channel IDs or handles, read contentDetails.relatedPlaylists.uploads, page playlistItems.list, and hydrate videos with videos.list."
      >
        <ChannelExplorerClient />
      </WorkspacePage>
    </AppShell>
  );
}
