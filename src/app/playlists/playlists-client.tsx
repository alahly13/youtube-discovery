"use client";

import { useYouTubeWorkspaceStore } from "@/lib/state/youtube-workspace-store";
import { YouTubeItemCard } from "@/components/youtube/youtube-item-card";
import { Card } from "@/components/ui/card";
import { ListVideo } from "lucide-react";
import { useState } from "react";

import { ButtonLink } from "@/components/ui/button";

export function PlaylistsClient() {
  const savedItems = useYouTubeWorkspaceStore((s) => s.savedItems);
  const playlists = savedItems.filter((i) => i.itemType === "playlist");
  
  const [search, setSearch] = useState("");

  const filteredPlaylists = playlists.filter(
    (p) => 
      p.title.toLowerCase().includes(search.toLowerCase()) || 
      p.channelTitle?.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <input 
          type="text" 
          placeholder="Filter saved playlists..." 
          className="h-10 rounded-lg border border-border bg-surface px-3 text-sm flex-1 max-w-sm"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <div className="text-sm text-muted">
          {filteredPlaylists.length} playlist{filteredPlaylists.length !== 1 && "s"}
        </div>
      </div>

      {filteredPlaylists.length > 0 ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {filteredPlaylists.map((playlist) => (
            <YouTubeItemCard key={`${playlist.itemType}-${playlist.platformItemId}`} item={playlist} />
          ))}
        </div>
      ) : (
        <Card className="flex flex-col items-center justify-center p-12 text-center text-muted">
          <ListVideo className="mb-4 h-12 w-12 opacity-20" />
          <p className="text-lg font-medium text-foreground">No playlists found</p>
          <p className="mt-1 text-sm max-w-md">
            {search ? "No saved playlists match your search." : "You haven't saved any playlists yet. Use Playlist Explorer to inspect public playlists or search for playlists in the Search workspace."}
          </p>
          <div className="mt-5 flex flex-wrap justify-center gap-3">
            <ButtonLink href="/playlist-explorer" variant="primary" className="h-9 px-4 text-xs">
              Playlist Explorer
            </ButtonLink>
            <ButtonLink href="/search" variant="secondary" className="h-9 px-4 text-xs">
              Search Playlists
            </ButtonLink>
          </div>
        </Card>
      )}
    </div>
  );
}
