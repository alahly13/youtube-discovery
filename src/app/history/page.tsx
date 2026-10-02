import { History } from "lucide-react";
import { AppShell } from "@/components/layout/app-shell";
import { WorkspacePage } from "@/components/pages/workspace-page";
import { HistoryWorkspace } from "@/components/history/history-workspace";

/* ═══════════════════════════════════════════════════════════════════════════
   History Page — /history
   ──────────────────────────────────────────────────────────────────────────
   Shows chronological history of all searches, channel explorations, and
   playlist fetches from the runtime manifest store. Grouped by date with
   search and navigation to manifest detail pages.
   ═══════════════════════════════════════════════════════════════════════════ */

export default function HistoryPage() {
  return (
    <AppShell>
      <WorkspacePage
        icon={History}
        eyebrow="Search & Fetch History"
        title="Search History Workspace"
        description="Browse the chronological history of every YouTube search made in this app with complete query options, results information, 1-click title copy, and forward-to-search auto-pasting."
      >
        <HistoryWorkspace />
      </WorkspacePage>
    </AppShell>
  );
}
