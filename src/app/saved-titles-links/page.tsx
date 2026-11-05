import { Bookmark } from "lucide-react";
import { AppShell } from "@/components/layout/app-shell";
import { WorkspacePage } from "@/components/pages/workspace-page";
import { SavedTitlesLinksWorkspace } from "@/components/saved/saved-titles-links-workspace";

/* ═══════════════════════════════════════════════════════════════════════════
   Saved Titles & Links — /saved-titles-links
   ──────────────────────────────────────────────────────────────────────────
   Canonical NEW-pipeline workspace for SAVED_TITLE and SAVED_LINK resources.
   These are resource types inside the REFERENCES dataset, not separate
   datasets and not saved searches. The OLD archive page at
   /old/saved-titles-links remains a read-only historical browser.
   ═══════════════════════════════════════════════════════════════════════════ */

export const metadata = {
  title: "Saved Titles & Links · YouTube Discovery",
  description:
    "Save research titles and external links locally first, then synchronize them to Cloudflare R2 and PostgreSQL.",
};

export default function SavedTitlesLinksPage() {
  return (
    <AppShell>
      <WorkspacePage
        icon={Bookmark}
        eyebrow="My Library"
        title="Saved Titles & Links"
        description="Keep research titles and external reference links in one local-first workspace. Every change is stored in IndexedDB immediately and synchronized through the canonical Save All pipeline."
      >
        <SavedTitlesLinksWorkspace />
      </WorkspacePage>
    </AppShell>
  );
}
