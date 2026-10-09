import { Library } from "lucide-react";
import Link from "next/link";
import { AppShell } from "@/components/layout/app-shell";
import { WorkspacePage } from "@/components/pages/workspace-page";
import { PlaylistDetailWorkspace } from "@/components/library/playlist-detail-workspace";

/* ═══════════════════════════════════════════════════════════════════════════
   Individual User Playlist Page — /saved/[playlistId]
   ──────────────────────────────────────────────────────────────────────────
   Dedicated page for ONE user-created playlist (personal collection). This
   is distinct from /playlists/[playlistId], which explores a YouTube
   playlist via the official API. All controls here operate on the stored
   manifest with zero YouTube quota.
   ═══════════════════════════════════════════════════════════════════════════ */

export default async function SavedPlaylistPage({
  params,
}: {
  params: Promise<{ playlistId: string }>;
}) {
  const { playlistId } = await params;
  return (
    <AppShell>
      <WorkspacePage
        icon={Library}
        eyebrow="Saved Library / Playlist"
        title="Playlist Workspace"
        description="Search, filter, order, group, annotate, and export this personal playlist. Everything here is local — no YouTube requests."
      >
        <p className="mb-4 text-xs text-muted">
          <Link href="/saved" className="text-primary hover:underline">
            ← Back to Saved Library
          </Link>
        </p>
        <PlaylistDetailWorkspace playlistId={playlistId} />
      </WorkspacePage>
    </AppShell>
  );
}
