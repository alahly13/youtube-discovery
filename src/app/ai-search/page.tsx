import { Bot } from "lucide-react";
import { AppShell } from "@/components/layout/app-shell";
import { WorkspacePage } from "@/components/pages/workspace-page";
import { Card, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export default function AiSearchPage() {
  return (
    <AppShell>
      <WorkspacePage
        icon={Bot}
        eyebrow="Scoped AI Discovery"
        title="AI Search and Manifest Assistant"
        description="Generate search ideas, local filters, and evidence-backed manifest summaries. Suggestions require user confirmation before provider fetches or filter application."
      >
        <Card className="border-ai/30">
          <CardHeader title="AI safety contract" eyebrow="Gemini server-only" />
          <div className="flex flex-wrap gap-2">
            <Badge tone="ai">Current Search Manifest</Badge>
            <Badge tone="ai">Channel Uploads Manifest</Badge>
            <Badge tone="ai">Playlist Manifest</Badge>
            <Badge tone="ai">Selected Video</Badge>
          </div>
          <p className="mt-4 text-sm text-muted">
            AI routes validate scope, cap item and character context, and return evidence refs, confidence, limitations, and confirmation-only suggestions. No unrestricted database query endpoint is exposed.
          </p>
        </Card>
      </WorkspacePage>
    </AppShell>
  );
}
