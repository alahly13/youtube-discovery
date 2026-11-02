import { Archive } from "lucide-react";
import { AppShell } from "@/components/layout/app-shell";
import { WorkspacePage } from "@/components/pages/workspace-page";
import { OldCategoryWorkspace } from "@/components/old/old-category-workspace";

export const metadata = {
  title: "Archived Metadata · OLD Archive · YouTube Discovery",
  description: "Browse miscellaneous historical metadata and custom imports.",
};

export default function OldOtherPage() {
  return (
    <AppShell>
      <WorkspacePage
        icon={Archive}
        eyebrow="OLD Archive · ASDY/OLD/"
        title="Other Archived Metadata"
        description="Miscellaneous historical exports, diagnostics, and raw NDJSON."
      >
        <OldCategoryWorkspace
          category="other"
          title="Other Archived Metadata"
          description="Explore uncategorized historical metadata files imported into the archive."
        />
      </WorkspacePage>
    </AppShell>
  );
}
