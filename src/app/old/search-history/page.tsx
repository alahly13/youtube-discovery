import { History } from "lucide-react";
import { AppShell } from "@/components/layout/app-shell";
import { WorkspacePage } from "@/components/pages/workspace-page";
import { OldCategoryWorkspace } from "@/components/old/old-category-workspace";

export const metadata = {
  title: "Archived Search History · OLD Archive · YouTube Discovery",
  description: "Browse historical executed search queries and manifest summaries.",
};

export default function OldSearchHistoryPage() {
  return (
    <AppShell>
      <WorkspacePage
        icon={History}
        eyebrow="OLD Archive · ASDY/OLD/"
        title="Archived Search History"
        description="Historical search execution queries and manifest references preserved in the archive."
      >
        <OldCategoryWorkspace
          category="search-history"
          title="Archived Search History"
          description="Explore historical search queries, execution records, and manifest IDs."
        />
      </WorkspacePage>
    </AppShell>
  );
}
