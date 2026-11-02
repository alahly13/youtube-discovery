"use client";

import {
  Bookmark,
  Check,
  Copy,
  Play,
  Search,
  Star,
  Trash2,
  X,
} from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { useYouTubeWorkspaceStore } from "@/lib/state/youtube-workspace-store";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { formatDate } from "@/lib/utils/format";

export function SavedSearchesWorkspace() {
  const savedSearches = useYouTubeWorkspaceStore((s) => s.savedSearches);
  const deleteSavedSearch = useYouTubeWorkspaceStore((s) => s.deleteSavedSearch);
  const togglePinSavedSearch = useYouTubeWorkspaceStore((s) => s.togglePinSavedSearch);

  const [query, setQuery] = useState("");
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const handleCopyTitle = async (title: string, id: string) => {
    try {
      await navigator.clipboard.writeText(title);
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2000);
    } catch {
      // ignore clipboard failures
    }
  };

  const filteredSearches = useMemo(() => {
    const list = [...savedSearches];
    list.sort((a, b) => {
      if (a.isPinned && !b.isPinned) return -1;
      if (!a.isPinned && b.isPinned) return 1;
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });

    if (!query.trim()) return list;
    const q = query.toLowerCase();
    return list.filter(
      (s) =>
        s.title.toLowerCase().includes(q) ||
        s.query.toLowerCase().includes(q) ||
        (s.notes && s.notes.toLowerCase().includes(q))
    );
  }, [savedSearches, query]);

  return (
    <div className="space-y-6">
      {/* Search and Stats Bar */}
      <Card className="p-4 sm:p-5 shadow-sm border border-border/80">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted" />
            <input
              type="text"
              placeholder="Filter saved search titles & queries..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="h-10 w-full rounded-lg border border-border bg-surface pl-10 pr-9 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--ring)] transition"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery("")}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted hover:text-foreground"
                aria-label="Clear filter"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>

          <div className="text-xs text-muted">
            <span>
              <strong>{savedSearches.length}</strong> saved {savedSearches.length === 1 ? "query" : "queries"}
            </span>
          </div>
        </div>
      </Card>

      {/* Grid or Empty State */}
      {filteredSearches.length === 0 ? (
        <Card className="flex flex-col items-center justify-center p-14 text-center">
          <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-surface-muted text-muted">
            <Bookmark className="h-7 w-7 text-primary opacity-60" />
          </div>
          <h3 className="text-base font-semibold text-foreground">
            {savedSearches.length === 0 ? "No saved searches yet" : "No searches match your query"}
          </h3>
          <p className="mt-1 text-xs text-muted max-w-md">
            {savedSearches.length === 0
              ? "From the Search page, run queries and click 'Save Search Title' to bookmark queries, parameters, and research topics here."
              : "Try adjusting your search terms to find your saved search parameters."}
          </p>
          <div className="mt-6">
            <ButtonLink href="/search" variant="primary" className="h-9 px-4 text-xs font-semibold">
              Go to Search
            </ButtonLink>
          </div>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filteredSearches.map((s) => {
            const isCopied = copiedId === s.id;
            return (
              <Card
                key={s.id}
                className={`flex flex-col justify-between rounded-xl border p-4.5 transition hover:shadow-md ${
                  s.isPinned ? "border-primary/50 bg-primary/5" : "border-border/80 bg-surface"
                }`}
              >
                <div>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <h4
                        className="line-clamp-2 text-base font-bold text-foreground cursor-pointer hover:text-primary transition leading-snug tracking-tight"
                        title={`${s.title} (click to copy)`}
                        onClick={() => handleCopyTitle(s.title, s.id)}
                      >
                        {s.title}
                      </h4>
                      <p className="mt-1 font-mono text-xs text-muted truncate" title={s.query}>
                        q: {s.query}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => togglePinSavedSearch(s.id)}
                      className="text-muted hover:text-amber-500 transition p-1"
                      title={s.isPinned ? "Unpin search" : "Pin to top"}
                    >
                      <Star
                        className={`h-4 w-4 ${
                          s.isPinned ? "fill-amber-500 text-amber-500" : ""
                        }`}
                      />
                    </button>
                  </div>

                  {s.notes && (
                    <p className="mt-2 text-xs text-muted line-clamp-2 italic bg-surface-muted/60 p-2 rounded-md">
                      {s.notes}
                    </p>
                  )}

                  <div className="mt-3 flex flex-wrap items-center gap-1.5 text-[10px] text-muted">
                    <Badge className="text-[10px] uppercase">{s.resourceSelection}</Badge>
                    {s.settings?.safeSearch === "none" && (
                      <span className="rounded bg-emerald-500/10 px-1.5 py-0.5 text-emerald-600 dark:text-emerald-400 font-medium">
                        Unrestricted Mode
                      </span>
                    )}
                    <span>Saved {formatDate(s.createdAt)}</span>
                  </div>
                </div>

                <div className="mt-4 flex items-center justify-between border-t border-border/50 pt-3">
                  <button
                    type="button"
                    onClick={() => handleCopyTitle(s.title, s.id)}
                    className="inline-flex items-center gap-1 text-xs text-muted hover:text-foreground transition"
                    title="Copy search title"
                  >
                    {isCopied ? (
                      <Check className="h-3.5 w-3.5 text-success" />
                    ) : (
                      <Copy className="h-3.5 w-3.5" />
                    )}
                    <span>{isCopied ? "Copied" : "Copy Title"}</span>
                  </button>

                  <div className="flex items-center gap-1.5">
                    <Link
                      href={`/search?q=${encodeURIComponent(s.query)}`}
                      className="inline-flex items-center gap-1 rounded-md bg-primary-soft px-3 py-1 text-xs font-semibold text-primary hover:bg-primary/20 transition"
                    >
                      <Play className="h-3 w-3 fill-current" />
                      <span>Run</span>
                    </Link>
                    <button
                      type="button"
                      onClick={() => deleteSavedSearch(s.id)}
                      className="rounded-md p-1.5 text-muted hover:bg-danger/10 hover:text-danger transition"
                      title="Delete saved search"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
