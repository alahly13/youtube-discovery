import { Bookmark, Link2 } from "lucide-react";
import { AppShell } from "@/components/layout/app-shell";
import { WorkspacePage } from "@/components/pages/workspace-page";
import { OldCategoryWorkspace } from "@/components/old/old-category-workspace";

export const metadata = {
  title: "OLD Saved Titles & Links · OLD Archive · YouTube Discovery",
  description: "Browse historical saved search titles, query presets, and preserved external links.",
};

export default function OldSavedTitlesLinksPage() {
  return (
    <AppShell>
      <WorkspacePage
        icon={Bookmark}
        eyebrow="OLD Archive · asdy/old/saved-titles-links/"
        title="OLD Saved Titles & Links"
        description="Historical search titles, presets, research queries, and reference links preserved in the OLD archive."
      >
        <OldCategoryWorkspace
          category="saved-titles-links"
          title="OLD Saved Titles & Links"
          description="Explore historical query titles, saved search links, and presets imported into the OLD archive."
        />
      </WorkspacePage>
    </AppShell>
  );
}
