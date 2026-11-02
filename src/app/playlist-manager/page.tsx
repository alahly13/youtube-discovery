import { ListVideo } from "lucide-react";
import { AppShell } from "@/components/layout/app-shell";
import { WorkspacePage } from "@/components/pages/workspace-page";
import { PlaylistManagerWorkspace } from "@/components/library/playlist-manager-workspace";

/* ═══════════════════════════════════════════════════════════════════════════
   Personal Playlist Manager — /playlist-manager
   ──────────────────────────────────────────────────────────────────────────
   Dedicated workspace for creating, reviewing, organizing, and curating
   personal YouTube playlists, manifests, sections, and video groupings.
   ═══════════════════════════════════════════════════════════════════════════ */

export default function PlaylistManagerPage() {
  return (
    <AppShell>
      <WorkspacePage
        icon={ListVideo}
        eyebrow="My Library"
        title="Personal Playlist Manager"
        description="Organize your personal YouTube video collections, research sets, and custom-ordered playlists with dedicated manifests and custom section groupings."
      >
        <PlaylistManagerWorkspace />
      </WorkspacePage>
    </AppShell>
  );
}
