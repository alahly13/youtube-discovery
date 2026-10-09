import { Library } from "lucide-react";
import { AppShell } from "@/components/layout/app-shell";
import { WorkspacePage } from "@/components/pages/workspace-page";
import { SavedLibraryWorkspace } from "@/components/saved/saved-library-workspace";

/* ═══════════════════════════════════════════════════════════════════════════
   Saved Library Hub — /saved
   ──────────────────────────────────────────────────────────────────────────
   Personal library hub: user-created playlists (each with its own permanent
   manifest + dedicated page at /saved/[playlistId]), globally saved items
   with standalone detection, and the saved-search titles shelf.
   ═══════════════════════════════════════════════════════════════════════════ */

export default function SavedPage() {
  return (
    <AppShell>
      <WorkspacePage
        icon={Library}
        eyebrow="Saved Library"
        title="Saved Library and Playlists"
        description="Create personal playlists, organize videos, Shorts, YouTube playlists, channels, and custom notes into sections, then search, sort, and export each playlist. Playlists persist until you delete them."
      >
        <SavedLibraryWorkspace />
      </WorkspacePage>
    </AppShell>
  );
}
