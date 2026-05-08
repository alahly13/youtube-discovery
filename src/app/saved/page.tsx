import { Library } from "lucide-react";
import { AppShell } from "@/components/layout/app-shell";
import { WorkspacePage } from "@/components/pages/workspace-page";
import { SavedLibraryWorkspace } from "@/components/saved/saved-library-workspace";

/* ═══════════════════════════════════════════════════════════════════════════
   Saved Library Page — /saved
   ──────────────────────────────────────────────────────────────────────────
   Manages individually saved videos, channels, and playlists. Deduplication
   by platformItemId (never by title alone). Currently backed by localStorage.
   ═══════════════════════════════════════════════════════════════════════════ */

export default function SavedPage() {
  return (
    <AppShell>
      <WorkspacePage
        icon={Library}
        eyebrow="Saved Library"
        title="Saved Videos and Research Assets"
        description="Saved videos dedupe by platform item ID and canonical URL, never by title alone. Search, browse, and manage your saved items."
      >
        <SavedLibraryWorkspace />
      </WorkspacePage>
    </AppShell>
  );
}
