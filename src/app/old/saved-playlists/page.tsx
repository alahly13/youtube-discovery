import { ListVideo } from "lucide-react";
import { AppShell } from "@/components/layout/app-shell";
import { WorkspacePage } from "@/components/pages/workspace-page";
import { OldCategoryWorkspace } from "@/components/old/old-category-workspace";

export const metadata = {
  title: "Archived Saved Playlists · OLD Archive · YouTube Discovery",
  description: "Browse historical playlists and curated playlist entries.",
};

export default function OldSavedPlaylistsPage() {
  return (
    <AppShell>
      <WorkspacePage
        icon={ListVideo}
        eyebrow="OLD Archive · ASDY/OLD/"
        title="Archived Saved Playlists"
        description="Historical user playlists, curated groups, and entries preserved in the archive."
      >
        <OldCategoryWorkspace
          category="saved-playlists"
          title="Archived Saved Playlists"
          description="Explore historical playlists and entries imported into the archive."
        />
      </WorkspacePage>
    </AppShell>
  );
}
