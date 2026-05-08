import { ListVideo } from "lucide-react";
import { AppShell } from "@/components/layout/app-shell";
import { WorkspacePage } from "@/components/pages/workspace-page";

export default function PlaylistsPage() {
  return (
    <AppShell>
      <WorkspacePage
        icon={ListVideo}
        eyebrow="Saved Playlists"
        title="Playlist Library"
        description="Saved playlists preserve official playlist order and show unavailable/private/deleted items honestly when provider data is limited."
      />
    </AppShell>
  );
}
