"use client";

import { Archive, ExternalLink, Loader2, RefreshCw } from "lucide-react";
import Link from "next/link";
import { startTransition, useEffect, useState } from "react";
import type { YouTubeManifestSummary } from "@/types/manifest";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { formatDate } from "@/lib/utils/format";

/* ═══════════════════════════════════════════════════════════════════════════
   Manifest Library Workspace
   ──────────────────────────────────────────────────────────────────────────
   Lists all runtime manifests from the memory store. Each manifest can be
   opened for detailed inspection, local filtering, and AI analysis.
   ═══════════════════════════════════════════════════════════════════════════ */

export function ManifestListWorkspace() {
  const [manifests, setManifests] = useState<YouTubeManifestSummary[]>([]);
  const [loading, setLoading] = useState(false);

  async function fetchManifests() {
    setLoading(true);
    try {
      const { listLocalTempManifests } = await import("@/lib/manifests/local-manifest-store");
      const localManifests = await listLocalTempManifests();

      // Best-effort merge with single-instance transient server cache (optional fallback).
      // Primary ownership of Class-A temporary manifests belongs to browser IndexedDB.
      let remoteManifests: YouTubeManifestSummary[] = [];
      try {
        const response = await fetch("/api/youtube/manifests");
        if (response.ok) {
          const payload = (await response.json()) as { manifests?: YouTubeManifestSummary[] };
          if (Array.isArray(payload.manifests)) {
            remoteManifests = payload.manifests;
          }
        }
      } catch {
        // Offline or cold serverless instance: IndexedDB local list remains authoritative.
      }

      const byId = new Map<string, YouTubeManifestSummary>();
      for (const m of remoteManifests) byId.set(m.manifestId, m);
      for (const m of localManifests) byId.set(m.manifestId, m);
      const merged = Array.from(byId.values()).sort((a, b) =>
        b.collectedAt.localeCompare(a.collectedAt)
      );
      startTransition(() => setManifests(merged));
    } finally {
      startTransition(() => setLoading(false));
    }
  }

  useEffect(() => { fetchManifests(); }, []);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted">
          {manifests.length} manifest(s) in runtime store
        </p>
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
          Refresh
        </Button>
      </div>

      {manifests.length === 0 && !loading && (
        <Card>
          <p className="py-8 text-center text-sm text-muted">
            No manifests in the runtime store. Search, explore a channel, or
            fetch a playlist to create manifests.
          </p>
        </Card>
      )}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {manifests.map((m) => (
          <Link
            key={m.manifestId}
            href={`/manifests/${m.manifestId}`}
            className="group"
          >
            <Card className="h-full transition group-hover:border-primary/40">
              <div className="flex items-start gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary-soft text-primary">
                  <Archive className="h-5 w-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-foreground group-hover:text-primary">
                    {m.title}
                  </p>
                  <p className="mt-1 font-mono text-xs text-muted">
                    {m.manifestId}
                  </p>
                </div>
                <ExternalLink className="h-4 w-4 shrink-0 text-muted opacity-0 transition group-hover:opacity-100" />
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
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
                <Badge>{m.manifestType}</Badge>
                <Badge>{m.itemCount} items</Badge>
                <Badge>{m.quotaCostEstimate} quota</Badge>
                {m.saved && <Badge tone="success">Saved</Badge>}
              </div>
              <p className="mt-2 text-xs text-muted">
                {formatDate(m.collectedAt)}
              </p>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
