"use client";

import {
  Bookmark,
  ExternalLink,
  Search,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import { startTransition, useEffect, useMemo, useState } from "react";
import type { NormalizedYouTubeDiscoveryItem } from "@/types/youtube";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { formatCount, formatDate, formatDuration } from "@/lib/utils/format";

/* ═══════════════════════════════════════════════════════════════════════════
   Saved Library Workspace
   ──────────────────────────────────────────────────────────────────────────
   Manages individually saved videos/items using localStorage. Deduplication
   is by platformItemId (never by title alone). Awaits durable Prisma
   persistence for production use.
   ═══════════════════════════════════════════════════════════════════════════ */

const STORAGE_KEY = "youtube-discovery-saved-items";

function loadSaved(): NormalizedYouTubeDiscoveryItem[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as NormalizedYouTubeDiscoveryItem[]) : [];
  } catch {
    return [];
  }
}

function persistSaved(items: NormalizedYouTubeDiscoveryItem[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
}

export function SavedLibraryWorkspace() {
  const [items, setItems] = useState<NormalizedYouTubeDiscoveryItem[]>([]);
  const [searchQuery, setSearchQuery] = useState("");

  useEffect(() => {
    startTransition(() => setItems(loadSaved()));
  }, []);

  const filteredItems = useMemo(() => {
    if (!searchQuery.trim()) return items;
    const q = searchQuery.toLowerCase();
    return items.filter(
      (item) =>
        item.title.toLowerCase().includes(q) ||
        item.channelTitle?.toLowerCase().includes(q) ||
        item.description?.toLowerCase().includes(q) ||
        item.tags.some((tag) => tag.toLowerCase().includes(q)),
    );
  }, [items, searchQuery]);

  function removeItem(platformItemId: string) {
    const updated = items.filter(
      (item) => item.platformItemId !== platformItemId,
    );
    setItems(updated);
    persistSaved(updated);
  }

  function clearAll() {
    setItems([]);
    persistSaved([]);
  }

  return (
    <div className="space-y-6">
      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
        <input
          className="h-10 w-full rounded-lg border border-border bg-surface pl-9 pr-3 text-sm"
          placeholder="Search saved items…"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
      </div>

      {/* Stats */}
      <div className="flex items-center justify-between">
        <div className="flex flex-wrap gap-2">
          <Badge tone="success">{items.length} saved items</Badge>
          <Badge>
            {items.filter((i) => i.itemType === "video" || i.itemType === "shorts_like").length} videos
          </Badge>
          <Badge>
            {items.filter((i) => i.itemType === "channel").length} channels
          </Badge>
          <Badge>
            {items.filter((i) => i.itemType === "playlist").length} playlists
          </Badge>
        </div>
        {items.length > 0 && (
          <Button variant="danger" onClick={clearAll}>
            <Trash2 className="h-4 w-4" />
            Clear all
          </Button>
        )}
      </div>

      {/* Items */}
      {filteredItems.length === 0 ? (
        <Card>
          <p className="py-8 text-center text-sm text-muted">
            {items.length === 0
              ? "No saved items yet. Use the save button on any result card to add items here."
              : "No saved items match your search."}
          </p>
        </Card>
      ) : (
        <div className="space-y-2">
          {filteredItems.map((item) => (
            <div
              key={item.platformItemId}
              className="research-surface flex items-center gap-3 p-3"
            >
              {/* Thumbnail */}
              <div className="h-14 w-24 shrink-0 overflow-hidden rounded-md bg-surface-muted">
                {item.thumbnailUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={item.thumbnailUrl}
                    alt=""
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <div className="flex h-full items-center justify-center">
                    <Bookmark className="h-4 w-4 text-muted" />
                  </div>
                )}
              </div>

              {/* Info */}
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-foreground">
                  {item.title}
                </p>
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
                  <Badge>{item.itemType}</Badge>
                  {item.channelTitle && <span>{item.channelTitle}</span>}
                  {item.durationSeconds !== null && (
                    <span>{formatDuration(item.durationSeconds)}</span>
                  )}
                  {item.viewsCount !== null && (
                    <span>{formatCount(item.viewsCount, "views")}</span>
                  )}
                  {item.publishedAt && (
                    <span>{formatDate(item.publishedAt)}</span>
                  )}
                </div>
              </div>

              {/* Actions */}
              <div className="flex shrink-0 gap-1">
                {item.itemType === "channel" ? (
                  <Link
                    href={`/channels/${item.platformItemId}`}
                    className="rounded-lg p-2 text-muted hover:bg-surface-muted hover:text-foreground"
                    title="Explore channel"
                  >
                    <ExternalLink className="h-4 w-4" />
                  </Link>
                ) : item.itemType === "playlist" ? (
                  <Link
                    href={`/playlists/${item.platformItemId}`}
                    className="rounded-lg p-2 text-muted hover:bg-surface-muted hover:text-foreground"
                    title="Explore playlist"
                  >
                    <ExternalLink className="h-4 w-4" />
                  </Link>
                ) : (
                  <Link
                    href={`/watch/${item.platformItemId}`}
                    className="rounded-lg p-2 text-muted hover:bg-surface-muted hover:text-foreground"
                    title="Watch"
                  >
                    <ExternalLink className="h-4 w-4" />
                  </Link>
                )}
                <button
                  className="rounded-lg p-2 text-muted hover:bg-danger/10 hover:text-danger"
                  onClick={() => removeItem(item.platformItemId)}
                  title="Remove from saved"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
