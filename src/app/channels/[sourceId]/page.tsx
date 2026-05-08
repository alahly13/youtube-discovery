import { AppShell } from "@/components/layout/app-shell";
import { ChannelExplorerWorkspace } from "@/components/channels/channel-explorer-workspace";

/* ═══════════════════════════════════════════════════════════════════════════
   Channel Detail Page — /channels/[sourceId]
   ──────────────────────────────────────────────────────────────────────────
   Navigates like YouTube: user clicks a channel → arrives here → system
   fetches all uploads via official API → builds a structured manifest →
   allows local filtering, sorting, search-inside-channel, and AI analysis.
   ═══════════════════════════════════════════════════════════════════════════ */

export default async function ChannelDetailPage({
  params,
}: {
  params: Promise<{ sourceId: string }>;
}) {
  const { sourceId } = await params;

  return (
    <AppShell>
      <ChannelExplorerWorkspace channelId={sourceId} />
    </AppShell>
  );
}
