import { Bot, ExternalLink, ListVideo, Play, Save, Tv, User } from "lucide-react";
import Link from "next/link";
import type { NormalizedYouTubeDiscoveryItem } from "@/types/youtube";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  formatCompactCount,
  formatCount,
  formatDuration,
  formatItemType,
  formatRelativeDate,
} from "@/lib/utils/format";

/* ═══════════════════════════════════════════════════════════════════════════
   YouTube Item Card — premium, type-aware result card
   ──────────────────────────────────────────────────────────────────────────
   Renders differently for videos (standard + shorts-like), channels, and
   playlists. Uses the .yt-card CSS class for consistent hover/shadow effects.
   All numeric displays (views, likes, comments) are zero-safe: 0 is always
   shown as "0 views", never hidden or replaced with a fallback.
   ═══════════════════════════════════════════════════════════════════════════ */

export function YouTubeItemCard({
  item,
  onAiExplore,
}: {
  item: NormalizedYouTubeDiscoveryItem;
  onAiExplore?: (item: NormalizedYouTubeDiscoveryItem) => void;
}) {
  /* Route to the correct type-specific card */
  switch (item.itemType) {
    case "channel":
      return <ChannelCard item={item} onAiExplore={onAiExplore} />;
    case "playlist":
      return <PlaylistCard item={item} onAiExplore={onAiExplore} />;
    default:
      return <VideoCard item={item} onAiExplore={onAiExplore} />;
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   Video Card — standard and shorts-like videos
   ──────────────────────────────────────────────────────────────────────────
   Prominent thumbnail with stable 16:9 aspect ratio, duration badge overlay,
   shorts badge if applicable, title, channel name, views (including 0),
   relative date, and action buttons.
   ═══════════════════════════════════════════════════════════════════════════ */
function VideoCard({
  item,
  onAiExplore,
}: {
  item: NormalizedYouTubeDiscoveryItem;
  onAiExplore?: (item: NormalizedYouTubeDiscoveryItem) => void;
}) {
  const isShortsLike = item.isShortsLike || item.itemType === "shorts_like";

  return (
    <article className="yt-card flex h-full flex-col">
      {/* ── Thumbnail with overlays ──────────────────────────────────── */}
      <div className="relative aspect-video bg-surface-muted">
        {item.thumbnailUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={item.thumbnailUrl}
            alt=""
            className="h-full w-full object-cover"
            loading="lazy"
          />
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-muted">
            <Play className="mr-2 h-5 w-5 opacity-40" />
            No thumbnail
          </div>
        )}

        {/* Duration badge — bottom right */}
        {item.durationSeconds !== null && (
          <span className="duration-badge">{formatDuration(item.durationSeconds)}</span>
        )}

        {/* Type badge — bottom left */}
        <div className="type-badge-overlay">
          {isShortsLike ? (
            <Badge tone="primary" className="shadow-sm">⚡ Shorts-like</Badge>
          ) : item.itemType !== "video" ? (
            <Badge tone="neutral" className="shadow-sm">{formatItemType(item.itemType)}</Badge>
          ) : null}
        </div>
      </div>

      {/* ── Content ──────────────────────────────────────────────────── */}
      <div className="flex flex-1 flex-col gap-3 p-4">
        {/* Title and channel */}
        <div className="min-w-0">
          <h3 className="line-clamp-2 text-sm font-semibold leading-snug text-foreground">
            {item.title}
          </h3>
          <p className="mt-1 truncate text-xs text-muted">
            {item.channelTitle ?? item.channelId ?? "Unknown channel"}
          </p>
        </div>

        {/* Stats row — views, likes, comments, date */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
          <span>{formatCompactCount(item.viewsCount)} views</span>
          <span className="opacity-40">·</span>
          <span>{formatRelativeDate(item.publishedAt)}</span>
        </div>

        {/* Detailed stats grid */}
        <div className="grid grid-cols-3 gap-1.5">
          <StatBadge
            icon={<span className="text-[10px]">👁</span>}
            value={item.viewsCount}
            label="views"
          />
          <StatBadge
            icon={<span className="text-[10px]">👍</span>}
            value={item.likesCount}
            label="likes"
          />
          <StatBadge
            icon={<span className="text-[10px]">💬</span>}
            value={item.commentsCount}
            label="comments"
          />
        </div>

        {/* Actions — pushed to bottom */}
        <div className="mt-auto flex flex-wrap gap-1.5 pt-1">
          <Button
            variant="ai"
            className="h-8 flex-1 px-2 text-xs"
            onClick={() => onAiExplore?.(item)}
          >
            <Bot className="h-3.5 w-3.5" />
            AI
          </Button>
          <Button variant="secondary" className="h-8 px-2" title="Save result">
            <Save className="h-3.5 w-3.5" />
          </Button>
          {item.itemType === "video" || item.itemType === "shorts_like" ? (
            <Link
              href={`/watch/${item.platformItemId}`}
              className="inline-flex h-8 items-center justify-center rounded-lg border border-border bg-surface px-2 text-xs text-muted transition hover:bg-surface-muted hover:text-foreground"
              title="Watch"
            >
              <Play className="h-3.5 w-3.5" />
            </Link>
          ) : null}
          <a
            href={item.url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex h-8 items-center justify-center rounded-lg border border-border bg-surface px-2 text-xs text-muted transition hover:bg-surface-muted hover:text-foreground"
            title="Open on YouTube"
          >
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        </div>
      </div>
    </article>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   Channel Card — distinct avatar layout with channel badge
   ──────────────────────────────────────────────────────────────────────────
   Channel avatar/thumbnail, channel handle, subscriber/video count where
   available, and a prominent "Channel" badge for immediate visual distinction.
   ═══════════════════════════════════════════════════════════════════════════ */
function ChannelCard({
  item,
  onAiExplore,
}: {
  item: NormalizedYouTubeDiscoveryItem;
  onAiExplore?: (item: NormalizedYouTubeDiscoveryItem) => void;
}) {
  return (
    <article className="yt-card flex h-full flex-col">
      {/* ── Header with gradient banner + avatar ─────────────────────── */}
      <div className="relative h-20 bg-gradient-to-br from-primary/15 via-primary/5 to-ai/10">
        {/* Channel type badge */}
        <div className="absolute right-2 top-2">
          <Badge tone="primary" className="shadow-sm">
            <Tv className="h-3 w-3" />
            Channel
          </Badge>
        </div>
      </div>

      <div className="flex flex-1 flex-col gap-3 px-4 pb-4">
        {/* Avatar — overlaps banner */}
        <div className="-mt-8 flex items-end gap-3">
          <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-full border-3 border-surface bg-surface-muted shadow-md">
            {item.thumbnailUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={item.thumbnailUrl}
                alt=""
                className="h-full w-full object-cover"
                loading="lazy"
              />
            ) : (
              <User className="h-7 w-7 text-muted" />
            )}
          </div>
          <div className="min-w-0 pb-0.5">
            <h3 className="truncate text-sm font-semibold text-foreground">
              {item.title}
            </h3>
            {item.channelId && (
              <p className="truncate font-mono text-[10px] text-muted">
                {item.channelId}
              </p>
            )}
          </div>
        </div>

        {/* Description excerpt */}
        {item.description && (
          <p className="line-clamp-2 text-xs leading-relaxed text-muted">
            {item.description}
          </p>
        )}

        {/* Channel stats */}
        <div className="flex flex-wrap gap-1.5">
          {item.viewsCount !== null && item.viewsCount !== undefined && (
            <Badge tone="neutral">
              {formatCount(item.viewsCount, "total views")}
            </Badge>
          )}
          {item.publishedAt && (
            <Badge tone="neutral">
              Joined {formatRelativeDate(item.publishedAt)}
            </Badge>
          )}
        </div>

        {/* Actions */}
        <div className="mt-auto flex flex-wrap gap-1.5 pt-1">
          <Link
            href={`/channels/${item.platformItemId}`}
            className="inline-flex h-8 flex-1 items-center justify-center gap-1.5 rounded-lg border border-primary/30 bg-primary-soft px-2 text-xs font-medium text-primary transition hover:bg-primary/10"
          >
            <Tv className="h-3.5 w-3.5" />
            Explore
          </Link>
          <Button
            variant="ai"
            className="h-8 px-2 text-xs"
            onClick={() => onAiExplore?.(item)}
          >
            <Bot className="h-3.5 w-3.5" />
          </Button>
          <a
            href={item.url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex h-8 items-center justify-center rounded-lg border border-border bg-surface px-2 text-xs text-muted transition hover:bg-surface-muted hover:text-foreground"
            title="Open on YouTube"
          >
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        </div>
      </div>
    </article>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   Playlist Card — thumbnail with video count overlay
   ──────────────────────────────────────────────────────────────────────────
   Playlist thumbnail with a semi-transparent video count overlay on the right,
   playlist title, channel owner, item count, and a "Playlist" badge.
   ═══════════════════════════════════════════════════════════════════════════ */
function PlaylistCard({
  item,
  onAiExplore,
}: {
  item: NormalizedYouTubeDiscoveryItem;
  onAiExplore?: (item: NormalizedYouTubeDiscoveryItem) => void;
}) {
  return (
    <article className="yt-card flex h-full flex-col">
      {/* ── Thumbnail with playlist overlay ──────────────────────────── */}
      <div className="relative aspect-video bg-surface-muted">
        {item.thumbnailUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={item.thumbnailUrl}
            alt=""
            className="h-full w-full object-cover"
            loading="lazy"
          />
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-muted">
            <ListVideo className="mr-2 h-5 w-5 opacity-40" />
            No thumbnail
          </div>
        )}

        {/* Playlist overlay on right side */}
        <div className="absolute inset-y-0 right-0 flex w-24 flex-col items-center justify-center gap-1 bg-black/60 text-white backdrop-blur-sm">
          <ListVideo className="h-5 w-5" />
          <span className="text-xs font-semibold">Playlist</span>
        </div>

        {/* Type badge */}
        <div className="type-badge-overlay">
          <Badge tone="ai" className="shadow-sm">
            <ListVideo className="h-3 w-3" />
            Playlist
          </Badge>
        </div>
      </div>

      {/* ── Content ──────────────────────────────────────────────────── */}
      <div className="flex flex-1 flex-col gap-3 p-4">
        <div className="min-w-0">
          <h3 className="line-clamp-2 text-sm font-semibold leading-snug text-foreground">
            {item.title}
          </h3>
          <p className="mt-1 truncate text-xs text-muted">
            {item.channelTitle ?? item.channelId ?? "Unknown owner"}
          </p>
        </div>

        {/* Description */}
        {item.description && (
          <p className="line-clamp-2 text-xs leading-relaxed text-muted">
            {item.description}
          </p>
        )}

        {/* Stats */}
        <div className="flex flex-wrap gap-1.5">
          {item.viewsCount !== null && item.viewsCount !== undefined && (
            <Badge tone="neutral">{formatCount(item.viewsCount, "views")}</Badge>
          )}
          {item.publishedAt && (
            <Badge tone="neutral">{formatRelativeDate(item.publishedAt)}</Badge>
          )}
        </div>

        {/* Actions */}
        <div className="mt-auto flex flex-wrap gap-1.5 pt-1">
          <Link
            href={`/playlists/${item.platformItemId}`}
            className="inline-flex h-8 flex-1 items-center justify-center gap-1.5 rounded-lg border border-ai/30 bg-ai-soft px-2 text-xs font-medium text-ai transition hover:bg-ai/10"
          >
            <ListVideo className="h-3.5 w-3.5" />
            Explore
          </Link>
          <Button
            variant="ai"
            className="h-8 px-2 text-xs"
            onClick={() => onAiExplore?.(item)}
          >
            <Bot className="h-3.5 w-3.5" />
          </Button>
          <a
            href={item.url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex h-8 items-center justify-center rounded-lg border border-border bg-surface px-2 text-xs text-muted transition hover:bg-surface-muted hover:text-foreground"
            title="Open on YouTube"
          >
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        </div>
      </div>
    </article>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   Stat Badge — compact stat display with icon
   ──────────────────────────────────────────────────────────────────────────
   Zero-safe: null/undefined shows "–", 0 shows "0".
   ═══════════════════════════════════════════════════════════════════════════ */
function StatBadge({
  icon,
  value,
  label,
}: {
  icon: React.ReactNode;
  value: number | null | undefined;
  label: string;
}) {
  const display =
    value === null || value === undefined
      ? "–"
      : Intl.NumberFormat("en", {
          notation: value >= 10000 ? "compact" : "standard",
        }).format(value);

  return (
    <div
      className="flex items-center justify-center gap-1 rounded-md border border-border/60 bg-surface-muted/50 py-1 text-[10px] text-muted"
      title={`${value ?? "Unknown"} ${label}`}
    >
      {icon}
      <span className="font-medium">{display}</span>
    </div>
  );
}
