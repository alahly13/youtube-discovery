import { Bot, ExternalLink, Save } from "lucide-react";
import type { NormalizedYouTubeDiscoveryItem } from "@/types/youtube";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatCount, formatDuration, formatItemType, getPublishedYear } from "@/lib/utils/format";

export function YouTubeItemCard({
  item,
  onAiExplore,
}: {
  item: NormalizedYouTubeDiscoveryItem;
  onAiExplore?: (item: NormalizedYouTubeDiscoveryItem) => void;
}) {
  const year = getPublishedYear(item.publishedAt);

  return (
    <article className="research-surface flex h-full flex-col overflow-hidden">
      {/* The fixed thumbnail aspect ratio prevents card jumps when provider
          metadata arrives late or thumbnails are unavailable. */}
      <div className="relative aspect-video bg-surface-muted">
        {item.thumbnailUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={item.thumbnailUrl} alt="" className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full items-center justify-center px-6 text-center text-sm text-muted">
            Official thumbnail unavailable
          </div>
        )}
        <div className="absolute bottom-2 left-2 flex flex-wrap gap-2">
          <Badge tone={item.isShortsLike ? "primary" : item.itemType === "playlist" ? "ai" : "neutral"}>
            {item.isShortsLike ? "Shorts-like" : formatItemType(item.itemType)}
          </Badge>
          {item.durationSeconds !== null ? <Badge>{formatDuration(item.durationSeconds)}</Badge> : null}
        </div>
      </div>
      <div className="flex flex-1 flex-col gap-4 p-4">
        <div>
          <h3 className="line-clamp-2 text-base font-semibold text-foreground">{item.title}</h3>
          <p className="mt-1 text-sm text-muted">{item.channelTitle ?? item.channelId ?? "Unknown owner"}</p>
        </div>
        <div className="grid grid-cols-2 gap-2 text-xs">
          <Badge>{formatCount(item.viewsCount, "views")}</Badge>
          <Badge>{formatCount(item.likesCount, "likes")}</Badge>
          <Badge>{formatCount(item.commentsCount, "comments")}</Badge>
          <Badge>{year ?? "Unknown year"}</Badge>
        </div>
        <div className="mt-auto flex flex-wrap gap-2">
          <Button variant="ai" className="h-9 flex-1 px-3" onClick={() => onAiExplore?.(item)}>
            <Bot className="h-4 w-4" />
            AI Explore
          </Button>
          <Button variant="secondary" className="h-9 px-3" title="Save result">
            <Save className="h-4 w-4" />
          </Button>
          <a
            href={item.url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex h-9 items-center justify-center rounded-lg border border-border bg-surface px-3 text-sm text-muted transition hover:bg-surface-muted hover:text-foreground"
          >
            <ExternalLink className="h-4 w-4" />
            <span className="sr-only">Open on YouTube</span>
          </a>
        </div>
      </div>
    </article>
  );
}
