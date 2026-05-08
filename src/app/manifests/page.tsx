import { Archive } from "lucide-react";
import { AppShell } from "@/components/layout/app-shell";
import { WorkspacePage } from "@/components/pages/workspace-page";
import { Card, CardHeader } from "@/components/ui/card";

export default function ManifestsPage() {
  return (
    <AppShell>
      <WorkspacePage
        icon={Archive}
        eyebrow="Manifest Library"
        title="Temporary and Saved Manifests"
        description="Every provider fetch produces a manifest with provenance, quota estimates, duplicate counts, warnings, and normalized items."
      >
        <Card>
          <CardHeader title="Runtime manifest API" eyebrow="Current implementation" />
          <p className="text-sm text-muted">
            Use `GET /api/youtube/manifests` to list runtime manifests created during this server process. Durable database-backed persistence is represented by the Prisma schema and migration but is not applied automatically.
          </p>
        </Card>
      </WorkspacePage>
    </AppShell>
  );
}
