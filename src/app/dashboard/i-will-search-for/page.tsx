import { Bookmark } from "lucide-react";
import { AppShell } from "@/components/layout/app-shell";
import { WorkspacePage } from "@/components/pages/workspace-page";
import { ResearchRemindersWorkspace } from "@/components/research-reminders/research-reminders-workspace";

/* ═══════════════════════════════════════════════════════════════════════════
   I Will Search For — /dashboard/i-will-search-for
   ──────────────────────────────────────────────────────────────────────────
   Dedicated personal research reminder notebook.
   Strictly browser-local (IndexedDB) with ZERO cloud synchronization.
   Arabic: عناصر لفتت انتباهي وأريد البحث عنها لاحقًا.
   ═══════════════════════════════════════════════════════════════════════════ */

export default function IWillSearchForPage() {
  return (
    <AppShell>
      <WorkspacePage
        icon={Bookmark}
        eyebrow="Personal Research Notebook (مفكرة بحثية محلية)"
        title="I Will Search For (سأبحث عنه)"
        description="عناصر لفتت انتباهي أثناء تصفح نتائج بحث يوتيوب وأريد البحث عنها لاحقًا. هذه القائمة محفوظة محليًا داخل متصفحك الحالي فقط ولا تُرفع إلى السحابة."
      >
        <ResearchRemindersWorkspace />
      </WorkspacePage>
    </AppShell>
  );
}
