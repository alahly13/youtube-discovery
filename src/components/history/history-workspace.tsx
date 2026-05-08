"use client";

import {
  Archive,
  Clock,
  ExternalLink,
  Loader2,
  RefreshCw,
  Search,
  Tv,
} from "lucide-react";
import Link from "next/link";
import { startTransition, useEffect, useMemo, useState } from "react";
import type { YouTubeManifestSummary } from "@/types/manifest";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { formatDate } from "@/lib/utils/format";

/* ═══════════════════════════════════════════════════════════════════════════
   History Workspace
   ──────────────────────────────────────────────────────────────────────────
   Shows the chronological history of all manifests (searches, channel
   explorations, playlist fetches) created during the current session.
   Uses the runtime manifest store. Durable history requires database
   migration to be applied.
   ═══════════════════════════════════════════════════════════════════════════ */

export function HistoryWorkspace() {
  const [manifests, setManifests] = useState<YouTubeManifestSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  async function fetchManifests() {
    setLoading(true);
    try {
      const res = await fetch("/api/youtube/manifests");
      if (res.ok) {
        const data = (await res.json()) as { manifests: YouTubeManifestSummary[] };
        startTransition(() => setManifests(data.manifests ?? []));
      }
    } finally {
      startTransition(() => setLoading(false));
    }
  }

  /* eslint-disable react-hooks/set-state-in-effect -- Mount-only data fetch; setState is async-deferred via startTransition */
  useEffect(() => { fetchManifests(); }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

  const filtered = useMemo(() => {
    if (!searchQuery.trim()) return manifests;
    const q = searchQuery.toLowerCase();
    return manifests.filter(
      (m) =>
        m.title.toLowerCase().includes(q) ||
        m.manifestType.toLowerCase().includes(q) ||
        m.manifestId.toLowerCase().includes(q),
    );
  }, [manifests, searchQuery]);

  /* Group by date */
  const grouped = useMemo(() => {
    const groups: Record<string, YouTubeManifestSummary[]> = {};
    for (const m of filtered) {
      const dateKey = m.collectedAt
        ? new Date(m.collectedAt).toLocaleDateString("en", {
            year: "numeric",
            month: "long",
            day: "numeric",
          })
        : "Unknown date";
      if (!groups[dateKey]) groups[dateKey] = [];
      groups[dateKey].push(m);
    }
    return groups;
  }, [filtered]);

  function getTypeIcon(type: string) {
    if (type.includes("channel")) return <Tv className="h-4 w-4" />;
    if (type.includes("playlist"))
      return <Archive className="h-4 w-4" />;
    return <Search className="h-4 w-4" />;
  }

  return (
    <div className="space-y-6">
      {/* Search + refresh */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
          <input
            className="h-10 w-full rounded-lg border border-border bg-surface pl-9 pr-3 text-sm"
            placeholder="Search history…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
        <Button
          variant="secondary"
          onClick={fetchManifests}
          disabled={loading}
        >
          {loading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4" />
          )}
        </Button>
      </div>

      <Badge>{manifests.length} total activities</Badge>

      {/* Grouped history */}
      {Object.keys(grouped).length === 0 ? (
        <Card>
          <p className="py-8 text-center text-sm text-muted">
            {manifests.length === 0
              ? "No history yet. Search, explore channels, or fetch playlists to create history entries."
              : "No history matches your search."}
          </p>
        </Card>
      ) : (
        Object.entries(grouped).map(([date, items]) => (
          <div key={date} className="space-y-2">
            <div className="flex items-center gap-2 text-sm font-medium text-muted">
              <Clock className="h-4 w-4" />
              {date}
            </div>
            {items.map((m) => (
              <Link
                key={m.manifestId}
                href={`/manifests/${m.manifestId}`}
                className="group"
              >
                <div className="research-surface flex items-center gap-3 p-3 transition group-hover:border-primary/40">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-surface-muted text-muted">
                    {getTypeIcon(m.manifestType)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-foreground group-hover:text-primary">
                      {m.title}
                    </p>
                    <div className="flex flex-wrap gap-2 text-xs text-muted">
                      <Badge>{m.manifestType}</Badge>
                      <Badge>{m.itemCount} items</Badge>
                      <Badge
                        tone={
                          m.status === "complete"
                            ? "success"
                            : m.status === "failed"
                              ? "danger"
                              : "warning"
                        }
                      >
                        {m.status}
                      </Badge>
                      <span>{formatDate(m.collectedAt)}</span>
                    </div>
                  </div>
                  <ExternalLink className="h-4 w-4 shrink-0 text-muted opacity-0 transition group-hover:opacity-100" />
                </div>
              </Link>
            ))}
          </div>
        ))
      )}
    </div>
  );
}
