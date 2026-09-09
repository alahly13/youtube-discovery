"use client";

import { Search, Tv, ArrowRight } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";

const SAMPLE_CHANNELS = [
  { label: "@veritasium", value: "@veritasium", desc: "Science & Education" },
  { label: "@mkbhd", value: "@mkbhd", desc: "Technology & Reviews" },
  { label: "@TED", value: "@TED", desc: "Ideas Worth Spreading" },
  { label: "@hubermanlab", value: "@hubermanlab", desc: "Neuroscience & Health" },
  { label: "@NASA", value: "@NASA", desc: "Space Exploration" },
  { label: "@Computerphile", value: "@Computerphile", desc: "Computer Science" },
];

export function ChannelExplorerClient() {
  const router = useRouter();
  const [input, setInput] = useState("");

  const handleExplore = (target?: string) => {
    const raw = (target ?? input).trim();
    if (!raw) return;

    // Clean up channel input: strip leading URL if full YouTube URL was pasted
    let clean = raw;
    try {
      if (raw.startsWith("http://") || raw.startsWith("https://")) {
        const url = new URL(raw);
        const path = url.pathname;
        if (path.includes("/@")) {
          clean = `@${path.split("/@")[1].split("/")[0]}`;
        } else if (path.includes("/channel/")) {
          clean = path.split("/channel/")[1].split("/")[0];
        }
      }
    } catch {
      // Keep as-is if URL parsing fails
    }

    router.push(`/channels/${encodeURIComponent(clean)}`);
  };

  return (
    <div className="space-y-6">
      {/* ── Exploration Search Card ──────────────────────────────────── */}
      <Card className="p-6">
        <div className="max-w-2xl">
          <Badge tone="primary">Uploads Playlist Pipeline</Badge>
          <h2 className="mt-3 text-2xl font-semibold text-foreground md:text-3xl">
            Explore YouTube Channel Uploads
          </h2>
          <p className="mt-2 text-sm text-muted">
            Enter a channel handle (e.g. <code className="text-primary font-mono font-medium">@veritasium</code>), a channel ID (<code className="text-primary font-mono font-medium">UC...</code>), or paste a YouTube channel link to fetch its complete upload manifest.
          </p>
        </div>

        <form
          className="mt-6 flex flex-col gap-3 sm:flex-row"
          onSubmit={(e) => {
            e.preventDefault();
            handleExplore();
          }}
        >
          <div className="relative min-w-0 flex-1">
            <Tv className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="e.g. @veritasium, @mkbhd, UC123... or channel URL"
              className="h-11 w-full rounded-lg border border-border bg-surface pl-10 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--ring)]"
            />
          </div>
          <Button
            type="submit"
            variant="primary"
            className="h-11 shrink-0 px-6 font-medium gap-2"
            disabled={!input.trim()}
          >
            <Search className="h-4 w-4" />
            Explore Channel
          </Button>
        </form>

        {/* ── Quick-pick Suggestions ─────────────────────────────────── */}
        <div className="mt-5 border-t border-border/60 pt-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted">
            Quick Discovery Channels:
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {SAMPLE_CHANNELS.map((ch) => (
              <button
                key={ch.value}
                type="button"
                onClick={() => handleExplore(ch.value)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface-muted/60 px-3 py-1.5 text-xs font-medium text-foreground transition hover:border-primary/40 hover:bg-surface hover:text-primary"
              >
                <span>{ch.label}</span>
                <span className="text-[11px] text-muted">({ch.desc})</span>
                <ArrowRight className="h-3 w-3 text-muted/60" />
              </button>
            ))}
          </div>
        </div>
      </Card>

      {/* ── Workflow Architecture Posture ───────────────────────────── */}
      <Card>
        <CardHeader title="Official channel uploads flow" eyebrow="No scraping or private data" />
        <ol className="grid gap-3 text-sm text-muted md:grid-cols-3">
          <li className="rounded-lg border border-border bg-surface-muted p-3">
            <span className="font-semibold text-foreground block mb-1">1. Channel Resolution</span>
            Resolves channel handles or IDs via official YouTube <code className="text-xs font-mono">channels.list</code> endpoint.
          </li>
          <li className="rounded-lg border border-border bg-surface-muted p-3">
            <span className="font-semibold text-foreground block mb-1">2. Uploads Playlist</span>
            Reads <code className="text-xs font-mono">relatedPlaylists.uploads</code> and pages items through <code className="text-xs font-mono">playlistItems.list</code>.
          </li>
          <li className="rounded-lg border border-border bg-surface-muted p-3">
            <span className="font-semibold text-foreground block mb-1">3. Local Manifest & AI</span>
            Hydrates full video details, content ratings (18+), builds a manifest for local filtering and scoped AI synthesis.
          </li>
        </ol>
      </Card>
    </div>
  );
}
