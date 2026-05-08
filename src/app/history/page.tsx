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
        eyebrow="Fetch history"
        title="Search and Fetch History"
        description="Browse the chronological history of your YouTube research activities. Every search, channel exploration, and playlist fetch creates a manifest entry."
      >
        <HistoryWorkspace />
      </WorkspacePage>
    </AppShell>
  );
}
