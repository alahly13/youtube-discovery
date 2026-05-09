"use client";

import { LinkIcon, Loader2 } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";

export function LinkExplorerClient() {
  const [input, setInput] = useState("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
  const [result, setResult] = useState<unknown>(null);
  const [loading, setLoading] = useState(false);

  async function analyze() {
    setLoading(true);
    try {
      const response = await fetch("/api/youtube/link/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ input }),
      });
      setResult(await response.json());
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card>
      <CardHeader title="YouTube URL analyzer" eyebrow="Official API strategy selector" />
      <div className="flex flex-col gap-3 md:flex-row">
        <input
          value={input}
          onChange={(event) => setInput(event.target.value)}
          className="h-11 min-w-0 flex-1 rounded-lg border border-border bg-surface px-3 text-sm outline-none focus:ring-2 focus:ring-[var(--ring)]"
        />
        <Button variant="primary" onClick={analyze} disabled={loading}>
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <LinkIcon className="h-4 w-4" />}
          Analyze
        </Button>
      </div>
      <div className="mt-4 rounded-lg border border-border bg-surface-muted p-4">
        <div className="mb-3 flex flex-wrap gap-2">
          <Badge tone="success">No scraping</Badge>
          <Badge>Video, Shorts, channel, handle, playlist, search URL</Badge>
        </div>

        {result && typeof result === "object" && "analyzed" in result ? (
          <div className="space-y-4">
            <div className="space-y-2">
              <p className="text-sm font-medium">Strategy:</p>
              <p className="text-sm text-muted">{(result as any).strategy}</p>
            </div>
            
            <div className="flex gap-2">
               {/* Render action based on kind */}
               {(() => {
                 const analyzed = (result as any).analyzed;
                 switch(analyzed.kind) {
                   case "video":
                   case "shorts":
                     return <Button asChild><a href={`/watch/${analyzed.videoId}`}>Watch Video</a></Button>;
                   case "channel":
                     return <Button asChild><a href={`/channels/${analyzed.channelId}`}>Explore Channel</a></Button>;
                   case "handle":
                     return <Button asChild><a href={`/channels/@${analyzed.handle}`}>Explore Channel</a></Button>;
                   case "playlist":
                     return <Button asChild><a href={`/playlists/${analyzed.playlistId}`}>Explore Playlist</a></Button>;
                   case "search":
                     // Since search is controlled by SearchWorkspace, we could just link to home with a query param if supported,
                     // but currently search is internal state. We'll just show the query.
                     return <Button asChild variant="secondary"><a href={`/?q=${encodeURIComponent(analyzed.query)}`}>Go to Search</a></Button>;
                   default:
                     return null;
                 }
               })()}
            </div>

            <details className="mt-4">
              <summary className="text-xs text-muted cursor-pointer hover:text-foreground">View raw response</summary>
              <pre className="mt-2 max-h-96 overflow-auto whitespace-pre-wrap font-mono text-xs text-muted bg-surface p-2 rounded border border-border/50">
                {JSON.stringify(result, null, 2)}
              </pre>
            </details>
          </div>
        ) : (
          <pre className="max-h-96 overflow-auto whitespace-pre-wrap font-mono text-xs text-muted">
            {result ? JSON.stringify(result, null, 2) : "Analyze a URL to see the official API strategy."}
          </pre>
        )}
      </div>
    </Card>
  );
}
