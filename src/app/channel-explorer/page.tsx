import { Compass } from "lucide-react";
import { AppShell } from "@/components/layout/app-shell";
import { WorkspacePage } from "@/components/pages/workspace-page";
import { Card, CardHeader } from "@/components/ui/card";

export default function ChannelExplorerPage() {
  return (
    <AppShell>
      <WorkspacePage
        icon={Compass}
        eyebrow="Channel uploads"
        title="Channel Explorer"
        description="Resolve channel IDs or handles, read contentDetails.relatedPlaylists.uploads, page playlistItems.list, and hydrate videos with videos.list."
      >
        <Card>
          <CardHeader title="Official channel uploads flow" eyebrow="No channel page scraping" />
          <ol className="grid gap-3 text-sm text-muted md:grid-cols-3">
            <li className="rounded-lg border border-border bg-surface-muted p-3">1. Resolve channel with channels.list.</li>
            <li className="rounded-lg border border-border bg-surface-muted p-3">2. Fetch uploads playlist with playlistItems.list.</li>
            <li className="rounded-lg border border-border bg-surface-muted p-3">3. Hydrate videos with videos.list and create a manifest.</li>
          </ol>
        </Card>
      </WorkspacePage>
    </AppShell>
  );
}
