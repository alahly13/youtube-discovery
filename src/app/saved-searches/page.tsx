import { Bookmark } from "lucide-react";
import { AppShell } from "@/components/layout/app-shell";
import { WorkspacePage } from "@/components/pages/workspace-page";
import { SavedSearchesWorkspace } from "@/components/saved/saved-searches-workspace";

/* ═══════════════════════════════════════════════════════════════════════════
   Saved Searches Workspace — /saved-searches
   ──────────────────────────────────────────────────────────────────────────
   Quick access to bookmarked search queries, parameters, notes, and topics.
   ═══════════════════════════════════════════════════════════════════════════ */

export default function SavedSearchesPage() {
  return (
    <AppShell>
      <WorkspacePage
        icon={Bookmark}
        eyebrow="My Library"
        title="Saved Searches"
        description="Quick access to your pinned search queries, search title bookmarks, parameter filters, and research notes."
      >
        <SavedSearchesWorkspace />
      </WorkspacePage>
    </AppShell>
  );
}
