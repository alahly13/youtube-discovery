"use client";

import { ExternalLink, ListVideo } from "lucide-react";
import Link from "next/link";
import { useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader } from "@/components/ui/card";
import { useYouTubeWorkspaceStore } from "@/lib/state/youtube-workspace-store";
import { formatCount, formatDuration } from "@/lib/utils/format";

/* ═══════════════════════════════════════════════════════════════════════════
   Watch Sidebar — Manifest-first suggested videos
   ──────────────────────────────────────────────────────────────────────────
   Ranks and displays suggested videos from the current manifest in Zustand.
   Uses watch experience settings for prioritization. Zero additional API
   calls — all suggestions come from already-collected manifest data.
   ═══════════════════════════════════════════════════════════════════════════ */

export function WatchSidebar({
  currentVideoId,
}: {
  currentVideoId: string;
}) {
  const manifest = useYouTubeWorkspaceStore((s) => s.currentManifest);
  const watchSettings = useYouTubeWorkspaceStore((s) => s.watchSettings);

  const suggestions = useMemo(() => {
    if (!manifest) return [];

    const items = manifest.normalizedItems.filter(
      (item) =>
        item.platformItemId !== currentVideoId &&
        (item.itemType === "video" ||
          item.itemType === "shorts_like" ||
          item.itemType === "live" ||
          item.itemType === "completed_live"),
    );

    /* Filter out Shorts-like if settings say so */
    const filteredItems = watchSettings.showShortsLikeVideos
      ? items
      : items.filter((item) => !item.isShortsLike);

    /* Simple ranking based on watch settings */
    const ranked = [...filteredItems].sort((a, b) => {
      if (watchSettings.preferRecentVideos) {
        const aTime = a.publishedAt ? Date.parse(a.publishedAt) : 0;
        const bTime = b.publishedAt ? Date.parse(b.publishedAt) : 0;
        if (aTime !== bTime) return bTime - aTime;
      }
      if (watchSettings.preferHighViewVideos) {
        const aViews = a.viewsCount ?? 0;
        const bViews = b.viewsCount ?? 0;
        if (aViews !== bViews) return bViews - aViews;
      }
      return 0;
    });

    return ranked.slice(0, watchSettings.suggestedVideosCount);
  }, [manifest, currentVideoId, watchSettings]);

  return (
    <Card>
      <CardHeader
        title="Suggested videos"
        eyebrow="Manifest-first ranking"
        action={
          <Badge tone="ai">
            <ListVideo className="h-3 w-3" />
            {suggestions.length}
          </Badge>
        }
      />
      {suggestions.length === 0 ? (
        <p className="py-4 text-sm text-muted">
          {manifest
            ? "No other videos in the current manifest."
            : "No manifest loaded. Search or explore a channel/playlist first."}
        </p>
      ) : (
        <div className="space-y-2">
          {suggestions.map((item) => (
            <Link
              key={item.platformItemId}
              href={`/watch/${item.platformItemId}`}
              className="group flex items-start gap-3 rounded-lg p-2 transition hover:bg-surface-muted"
            >
              {/* Thumbnail */}
              <div className="h-16 w-28 shrink-0 overflow-hidden rounded-md bg-surface-muted">
                {item.thumbnailUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={item.thumbnailUrl}
                    alt=""
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <div className="flex h-full items-center justify-center text-xs text-muted">
                    No thumb
                  </div>
                )}
              </div>
              <div className="min-w-0 flex-1">
                <p className="line-clamp-2 text-sm font-medium text-foreground group-hover:text-primary">
                  {item.title}
                </p>
                <p className="mt-1 truncate text-xs text-muted">
                  {item.channelTitle ?? "Unknown channel"}
                </p>
                <div className="mt-1 flex flex-wrap gap-1">
                  {item.durationSeconds !== null && (
                    <Badge>{formatDuration(item.durationSeconds)}</Badge>
                  )}
                  {item.viewsCount !== null && (
                    <Badge>{formatCount(item.viewsCount, "views")}</Badge>
                  )}
                </div>
              </div>
            </Link>
          ))}
          {manifest && (
            <div className="mt-2 border-t border-border pt-2">
              <Link
                href={`/manifests/${manifest.manifestId}`}
                className="flex items-center gap-2 text-xs text-primary hover:underline"
              >
                <ExternalLink className="h-3 w-3" />
                View full manifest ({manifest.uniqueItemCount} items)
              </Link>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
