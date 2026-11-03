import { History } from "lucide-react";
import { AppShell } from "@/components/layout/app-shell";
import { WorkspacePage } from "@/components/pages/workspace-page";
import { OldCategoryWorkspace } from "@/components/old/old-category-workspace";

export const metadata = {
  title: "OLD Saved Search History · OLD Archive · YouTube Discovery",
  description: "Browse historical executed search queries and manifest summaries.",
};

export default function OldSavedSearchHistoryPage() {
  return (
    <AppShell>
      <WorkspacePage
        icon={History}
        eyebrow="OLD Archive · asdy/old/saved-search-history/"
        title="OLD Saved Search History"
        description="Historical search execution queries and manifest references preserved in the OLD archive."
      >
        <OldCategoryWorkspace
          category="saved-search-history"
          title="OLD Saved Search History"
          description="Explore historical search queries, execution records, and manifest IDs in the OLD archive."
        />
      </WorkspacePage>
    </AppShell>
  );
}
