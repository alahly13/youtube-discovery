import { AppShell } from "@/components/layout/app-shell";
import { Card, CardHeader } from "@/components/ui/card";
import { WatchPlayer } from "@/components/watch/watch-player";
import { WatchSidebar } from "@/components/watch/watch-sidebar";

/* ═══════════════════════════════════════════════════════════════════════════
   Watch Page — /watch/[videoId]
   ──────────────────────────────────────────────────────────────────────────
   Embedded playback via official YouTube IFrame Player API. No downloading,
   no proxy, no stream extraction. Suggested videos come from the current
   manifest in Zustand (manifest-first ranking).
   ═══════════════════════════════════════════════════════════════════════════ */

export default async function WatchPage({
  params,
}: {
  params: Promise<{ videoId: string }>;
}) {
  const { videoId } = await params;

  return (
    <AppShell>
      <div className="grid gap-4 xl:grid-cols-12">
        <section className="space-y-4 xl:col-span-8">
          <WatchPlayer videoId={videoId} />
          <Card>
            <CardHeader
              title={`Watch ${videoId}`}
              eyebrow="Scoped to current manifest when provided"
            />
            <p className="text-sm text-muted">
              Embedded playback only via official YouTube player. No download,
              no proxy, no stream extraction.
            </p>
          </Card>
        </section>
        <aside className="xl:col-span-4">
          <WatchSidebar currentVideoId={videoId} />
        </aside>
      </div>
    </AppShell>
  );
}
