"use client";

import { ListVideo, Search, ArrowRight } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";

const SAMPLE_PLAYLISTS = [
  { label: "CrashCourse Astronomy", value: "PL8dPuuaLjXtPAJr1ysd5yGIyiSFuh0mIL", desc: "Science & Physics" },
  { label: "MIT 6.0001 Computer Science", value: "PLUl4u3cNGP63WbdFxL8giv4yhgdMGaZPB", desc: "Python & Algorithms" },
  { label: "CS50 Computer Science 2024", value: "PLhQjrBD2T382_R182iC2gNZI9HzWFMC_8", desc: "Harvard CS50" },
  { label: "TED-Ed Best of the Web", value: "PLJicmE8fK0Ei5683_3kdC9wZ-2p_l2sR2", desc: "Animations & Lessons" },
];

export function PlaylistExplorerClient() {
  const router = useRouter();
  const [input, setInput] = useState("");

  const handleExplore = (target?: string) => {
    const raw = (target ?? input).trim();
    if (!raw) return;

    // Clean up playlist input: extract list= query param if full URL pasted
    let clean = raw;
    try {
      if (raw.startsWith("http://") || raw.startsWith("https://")) {
        const url = new URL(raw);
        const listParam = url.searchParams.get("list");
        if (listParam) {
          clean = listParam;
        }
      }
    } catch {
      // Keep as-is if URL parsing fails
    }

    router.push(`/playlists/${encodeURIComponent(clean)}`);
  };

  return (
    <div className="space-y-6">
      {/* ── Exploration Search Card ──────────────────────────────────── */}
      <Card className="p-6">
        <div className="max-w-2xl">
          <Badge tone="primary">Order-Preserving Playlist Pipeline</Badge>
          <h2 className="mt-3 text-2xl font-semibold text-foreground md:text-3xl">
            Explore YouTube Public Playlists
          </h2>
          <p className="mt-2 text-sm text-muted">
            Enter a YouTube Playlist ID (e.g. <code className="text-primary font-mono font-medium">PL8dPuuaLjXt...</code>) or paste a playlist URL to inspect its ordered items, run local filters, and analyze with AI.
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
            <ListVideo className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="e.g. PL8dPuuaLjXt... or https://www.youtube.com/playlist?list=PL..."
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
            Explore Playlist
          </Button>
        </form>

        {/* ── Quick-pick Suggestions ─────────────────────────────────── */}
        <div className="mt-5 border-t border-border/60 pt-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted">
            Sample Public Playlists:
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {SAMPLE_PLAYLISTS.map((pl) => (
              <button
                key={pl.value}
                type="button"
                onClick={() => handleExplore(pl.value)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface-muted/60 px-3 py-1.5 text-xs font-medium text-foreground transition hover:border-primary/40 hover:bg-surface hover:text-primary"
              >
                <span>{pl.label}</span>
                <span className="text-[11px] text-muted">({pl.desc})</span>
                <ArrowRight className="h-3 w-3 text-muted/60" />
              </button>
            ))}
          </div>
        </div>
      </Card>

      {/* ── Known Public Appearances Contract ────────────────────────── */}
      <Card>
        <CardHeader title="Known public playlist appearances" eyebrow="Honest relationship language" />
        <p className="text-sm text-muted">
          The application preserves the exact playlist sequence as ordered by the author, handles deleted or private video placeholders gracefully, and maintains explicit manifest provenance without claiming all playlists on YouTube containing a video.
        </p>
      </Card>
    </div>
  );
}
