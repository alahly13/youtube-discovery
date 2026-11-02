import { BookmarkCheck } from "lucide-react";
import { AppShell } from "@/components/layout/app-shell";
import { WorkspacePage } from "@/components/pages/workspace-page";
import { OldSavedItemsWorkspace } from "@/components/old/old-saved-items-workspace";

export const metadata = {
  title: "Archived Saved Items · OLD Archive · YouTube Discovery",
  description: "Browse historical saved items with VIDEO, SHORTS, CHANNELS, and PLAYLISTS filters.",
};

export default function OldSavedItemsPage() {
  return (
    <AppShell>
      <WorkspacePage
        icon={BookmarkCheck}
        eyebrow="OLD Archive · ASDY/OLD/"
        title="Archived Saved Items"
        description="Browse historical saved videos, shorts, channels, and playlists preserved in the OLD archive."
      >
        <OldSavedItemsWorkspace />
      </WorkspacePage>
    </AppShell>
  );
}
