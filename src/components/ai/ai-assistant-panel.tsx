"use client";

import { Bot, Loader2, ShieldCheck } from "lucide-react";
import { useState } from "react";
import type { YouTubeManifest } from "@/types/manifest";
import type { NormalizedYouTubeDiscoveryItem } from "@/types/youtube";
import type { AiAssistantRequest, AiAssistantResponse } from "@/lib/ai/youtube-ai-schemas";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";

export function AiAssistantPanel({
  manifest,
  selectedItem,
}: {
  manifest: YouTubeManifest;
  selectedItem: NormalizedYouTubeDiscoveryItem | null;
}) {
  const [prompt, setPrompt] = useState("Summarize patterns and suggest local filters.");
  const [response, setResponse] = useState<AiAssistantResponse | null>(null);
  const [loading, setLoading] = useState(false);

  async function askAssistant() {
    setLoading(true);
    setResponse(null);

    try {
      const endpoint = selectedItem ? "/api/ai/youtube-video-explorer" : "/api/ai/youtube-manifest-assistant";
      const scope = selectedItem ? "selected_video" : getManifestAiScope(manifest.manifestType);
      const result = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scope,
          prompt,
          selectedVideoId: selectedItem?.platformItemId,
          manifestSnapshot: {
            manifestId: manifest.manifestId,
            title: manifest.title,
            manifestType: manifest.manifestType,
            normalizedItems: selectedItem ? [selectedItem] : manifest.normalizedItems,
          },
        }),
      });
      const payload = (await result.json()) as AiAssistantResponse;
      setResponse(payload);
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card className="border-ai/30">
      <CardHeader
        title="Scoped AI assistant"
        eyebrow={selectedItem ? `Selected video: ${selectedItem.platformItemId}` : getManifestScopeLabel(manifest.manifestType)}
        action={<Badge tone="ai">Grounded only</Badge>}
      />
      <div className="space-y-3">
        <textarea
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          className="min-h-24 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[var(--ring)]"
        />
        <Button variant="ai" onClick={askAssistant} disabled={loading}>
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Bot className="h-4 w-4" />}
          Ask AI
        </Button>
        <div className="rounded-lg border border-ai/25 bg-ai-soft/20 p-3 text-sm text-muted">
          <div className="mb-2 flex items-center gap-2 text-ai">
            <ShieldCheck className="h-4 w-4" />
            <span className="font-medium">Safety boundary</span>
          </div>
          AI may summarize, suggest filters, and cite known manifest items. It may not invent videos, IDs, counts, private data, or playlist relationships.
        </div>
        {response ? (
          <div className="rounded-lg border border-border bg-surface-muted p-4 text-sm">
            <p className="mb-3 text-foreground">{response.answer}</p>
            <div className="flex flex-wrap gap-2">
              <Badge tone="ai">Scope: {response.scope}</Badge>
              <Badge>Items used: {response.usedItemCount}</Badge>
              <Badge>Confidence: {response.confidence}</Badge>
            </div>
            {response.evidenceRefs?.length ? (
              <ul className="mt-3 space-y-1">
                {response.evidenceRefs.map((ref) => (
                  <li key={`${ref.platformItemId}-${ref.title}`} className="text-muted">
                    <span className="font-mono text-foreground">{ref.platformItemId}</span> - {ref.title}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
      </div>
    </Card>
  );
}

function getManifestAiScope(manifestType: YouTubeManifest["manifestType"]): AiAssistantRequest["scope"] {
  // AI scope follows the active manifest type so Search, Channel, and Playlist
  // pages cannot accidentally ask the model to reason beyond the current
  // normalized metadata set.
  if (manifestType === "youtube_channel_uploads") {
    return "current_channel_uploads_manifest";
  }

  if (manifestType === "youtube_playlist") {
    return "current_playlist_manifest";
  }

  if (manifestType === "youtube_link_explorer") {
    return "current_link_explorer_manifest";
  }

  return "current_search_manifest";
}

function getManifestScopeLabel(manifestType: YouTubeManifest["manifestType"]) {
  if (manifestType === "youtube_channel_uploads") {
    return "Scoped to current channel manifest";
  }

  if (manifestType === "youtube_playlist") {
    return "Scoped to current playlist manifest";
  }

  return "Scoped to current search manifest";
}
