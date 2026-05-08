import { ListVideo } from "lucide-react";
import { AppShell } from "@/components/layout/app-shell";
import { WorkspacePage } from "@/components/pages/workspace-page";

export default async function PlaylistDetailPage({ params }: { params: Promise<{ playlistId: string }> }) {
  const { playlistId } = await params;

  return (
    <AppShell>
      <WorkspacePage
        icon={ListVideo}
        eyebrow="Playlist detail"
        title={`Playlist ${playlistId}`}
        description="Playlist detail pages are reserved for playlist manifests, search-inside-playlist, export/save, and scoped AI playlist analysis."
      />
    </AppShell>
  );
}
