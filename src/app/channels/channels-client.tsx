"use client";

import { useYouTubeWorkspaceStore } from "@/lib/state/youtube-workspace-store";
import { YouTubeItemCard } from "@/components/youtube/youtube-item-card";
import { Card } from "@/components/ui/card";
import { Tv } from "lucide-react";
import { useState } from "react";

export function ChannelsClient() {
  const savedItems = useYouTubeWorkspaceStore((s) => s.savedItems);
  const channels = savedItems.filter((i) => i.itemType === "channel");
  
  const [search, setSearch] = useState("");

  const filteredChannels = channels.filter(
    (c) => 
      c.title.toLowerCase().includes(search.toLowerCase()) || 
      c.channelId?.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <input 
          type="text" 
          placeholder="Filter saved channels..." 
          className="h-10 rounded-lg border border-border bg-surface px-3 text-sm flex-1 max-w-sm"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <div className="text-sm text-muted">
          {filteredChannels.length} channel{filteredChannels.length !== 1 && "s"}
        </div>
      </div>

      {filteredChannels.length > 0 ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {filteredChannels.map((channel) => (
            <YouTubeItemCard key={`${channel.itemType}-${channel.platformItemId}`} item={channel} />
          ))}
        </div>
      ) : (
        <Card className="flex flex-col items-center justify-center p-12 text-center text-muted">
          <Tv className="mb-4 h-12 w-12 opacity-20" />
          <p className="text-lg font-medium text-foreground">No channels found</p>
          <p className="mt-1 text-sm">
            {search ? "No saved channels match your search." : "You haven't saved any channels yet. Search for channels and click the save button."}
          </p>
        </Card>
      )}
    </div>
  );
}
