import { AppShell } from "@/components/layout/app-shell";
import { PlaylistExplorerWorkspace } from "@/components/playlists/playlist-explorer-workspace";

/* ═══════════════════════════════════════════════════════════════════════════
   Playlist Detail Page — /playlists/[playlistId]
   ──────────────────────────────────────────────────────────────────────────
   Navigates like YouTube: user clicks a playlist → arrives here → system
   fetches all playlist items via official API → builds an order-preserving
   manifest → allows local filtering, sorting, search-inside-playlist,
   play-next navigation, and AI analysis.
   ═══════════════════════════════════════════════════════════════════════════ */

export default async function PlaylistDetailPage({
  params,
}: {
  params: Promise<{ playlistId: string }>;
}) {
  const { playlistId } = await params;

  return (
    <AppShell>
      <PlaylistExplorerWorkspace playlistId={playlistId} />
    </AppShell>
  );
}
