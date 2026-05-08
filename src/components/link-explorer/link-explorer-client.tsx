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
        <pre className="max-h-96 overflow-auto whitespace-pre-wrap font-mono text-xs text-muted">
          {result ? JSON.stringify(result, null, 2) : "Analyze a URL to see the official API strategy."}
        </pre>
      </div>
    </Card>
  );
}
