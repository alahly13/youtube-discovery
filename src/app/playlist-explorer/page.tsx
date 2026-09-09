import { PlaySquare } from "lucide-react";
import { AppShell } from "@/components/layout/app-shell";
import { WorkspacePage } from "@/components/pages/workspace-page";
import { PlaylistExplorerClient } from "./playlist-explorer-client";

export default function PlaylistExplorerPage() {
  return (
    <AppShell>
      <WorkspacePage
        icon={PlaySquare}
        eyebrow="Playlist manifests"
        title="Playlist Explorer"
        description="Analyze playlist IDs or URLs, fetch playlist metadata, page public playlist items, hydrate videos, and preserve playlist order."
      >
        <PlaylistExplorerClient />
      </WorkspacePage>
    </AppShell>
  );
}
