import { PlaySquare } from "lucide-react";
import { AppShell } from "@/components/layout/app-shell";
import { WorkspacePage } from "@/components/pages/workspace-page";
import { Card, CardHeader } from "@/components/ui/card";

export default function PlaylistExplorerPage() {
  return (
    <AppShell>
      <WorkspacePage
        icon={PlaySquare}
        eyebrow="Playlist manifests"
        title="Playlist Explorer"
        description="Analyze playlist IDs or URLs, fetch playlist metadata, page public playlist items, hydrate videos, and preserve playlist order."
      >
        <Card>
          <CardHeader title="Known public playlist appearances" eyebrow="Honest relationship language" />
          <p className="text-sm text-muted">
            The app only shows playlist appearances discovered from playlists it fetched. It never claims all playlists containing a video.
          </p>
        </Card>
      </WorkspacePage>
    </AppShell>
  );
}
