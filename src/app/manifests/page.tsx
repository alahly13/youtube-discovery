import { Archive } from "lucide-react";
import { AppShell } from "@/components/layout/app-shell";
import { WorkspacePage } from "@/components/pages/workspace-page";
import { ManifestListWorkspace } from "@/components/manifests/manifest-list-workspace";

/* ═══════════════════════════════════════════════════════════════════════════
   Manifests Library Page — /manifests
   ──────────────────────────────────────────────────────────────────────────
   Lists all runtime manifests (temporary and saved) from the memory store.
   Clicking a manifest navigates to the manifest detail page for full
   local search, filter, sort, export, and AI analysis.
   ═══════════════════════════════════════════════════════════════════════════ */

export default function ManifestsPage() {
  return (
    <AppShell>
      <WorkspacePage
        icon={Archive}
        eyebrow="Manifest Library"
        title="Temporary and Saved Manifests"
        description="Every provider fetch produces a manifest with provenance, quota estimates, duplicate counts, warnings, and normalized items. Click any manifest to explore its contents."
      >
        <ManifestListWorkspace />
      </WorkspacePage>
    </AppShell>
  );
}
