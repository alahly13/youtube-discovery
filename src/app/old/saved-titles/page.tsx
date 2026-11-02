import { Bookmark } from "lucide-react";
import { AppShell } from "@/components/layout/app-shell";
import { WorkspacePage } from "@/components/pages/workspace-page";
import { OldCategoryWorkspace } from "@/components/old/old-category-workspace";

export const metadata = {
  title: "Archived Saved Search Titles · OLD Archive · YouTube Discovery",
  description: "Browse historical saved search titles and research queries.",
};

export default function OldSavedTitlesPage() {
  return (
    <AppShell>
      <WorkspacePage
        icon={Bookmark}
        eyebrow="OLD Archive · ASDY/OLD/"
        title="Archived Saved Titles"
        description="Historical search titles, presets, and research phrases preserved in the archive."
      >
        <OldCategoryWorkspace
          category="saved-titles"
          title="Archived Saved Search Titles"
          description="Explore historical query titles and search presets imported into the archive."
        />
      </WorkspacePage>
    </AppShell>
  );
}
