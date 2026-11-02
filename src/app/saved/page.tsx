import { BookmarkCheck } from "lucide-react";
import { AppShell } from "@/components/layout/app-shell";
import { WorkspacePage } from "@/components/pages/workspace-page";
import { SavedItemsWorkspace } from "@/components/saved/saved-items-workspace";

/* ═══════════════════════════════════════════════════════════════════════════
   Dedicated Saved Items Workspace — /saved
   ──────────────────────────────────────────────────────────────────────────
   Unified repository for all saved YouTube entities (Videos, Channels, and
   Playlists) grouped by actual calendar date with daily chronological
   delimiters, live type filters, fast query search, and playlist actions.
   ═══════════════════════════════════════════════════════════════════════════ */

export default function SavedPage() {
  return (
    <AppShell>
      <WorkspacePage
        icon={BookmarkCheck}
        eyebrow="My Library"
        title="Saved Items"
        description="Unified workspace for your saved YouTube videos, channels, and playlists. Every item is grouped by the actual calendar date it was saved with clear daily separators."
      >
        <SavedItemsWorkspace />
      </WorkspacePage>
    </AppShell>
  );
}
