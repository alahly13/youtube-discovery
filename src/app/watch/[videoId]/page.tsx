import { AppShell } from "@/components/layout/app-shell";
import { Card, CardHeader } from "@/components/ui/card";
import { WatchPlayer } from "@/components/watch/watch-player";

export default async function WatchPage({ params }: { params: Promise<{ videoId: string }> }) {
  const { videoId } = await params;
  return (
    <AppShell>
      <div className="grid gap-4 xl:grid-cols-12">
        <section className="space-y-4 xl:col-span-8">
          <WatchPlayer videoId={videoId} />
          <Card><CardHeader title={`Watch ${videoId}`} eyebrow="Scoped to current manifest when provided" /><p className="p-4 text-sm text-muted">Embedded playback only via official YouTube player. No download, no proxy, no stream extraction.</p></Card>
        </section>
        <aside className="xl:col-span-4"><Card><CardHeader title="Suggested videos" eyebrow="Manifest-first ranking" /><p className="p-4 text-sm text-muted">Suggestions prioritize current manifest, then same channel fallback.</p></Card></aside>
      </div>
    </AppShell>
  );
}
