"use client";

import {
  Bookmark,
  Check,
  CloudUpload,
  Copy,
  Loader2,
  Pencil,
  Play,
  Search,
  Star,
  Trash2,
  X,
} from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { useYouTubeWorkspaceStore } from "@/lib/state/youtube-workspace-store";
import { useMergedDataset } from "@/lib/storage/use-merged-dataset";
import { classifyResourceRecord } from "@/lib/resources/resource-taxonomy";
import { syncCoordinator } from "@/lib/sync/sync-coordinator";
import { Badge } from "@/components/ui/badge";
import { Button, ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { UndoRedoControls } from "@/components/ui/undo-redo-controls";
import { formatDate } from "@/lib/utils/format";
import type { SavedSearch } from "@/types/youtube";

function isSavedSearchRecord(record: Record<string, unknown>): boolean {
  const cls = classifyResourceRecord(record, { datasetType: "REFERENCES" });
  if (cls.resourceType === "SAVED_SEARCH") return true;
  return (
    cls.resourceType === "UNKNOWN" &&
    typeof record.query === "string" &&
    typeof record.url !== "string"
  );
}

export function SavedSearchesWorkspace() {
  const storeSavedSearches = useYouTubeWorkspaceStore((s) => s.savedSearches);
  const updateSavedSearch = useYouTubeWorkspaceStore((s) => s.updateSavedSearch);
  const deleteSavedSearch = useYouTubeWorkspaceStore((s) => s.deleteSavedSearch);
  const togglePinSavedSearch = useYouTubeWorkspaceStore((s) => s.togglePinSavedSearch);

  const serverFallback = useMemo(
    () =>
      storeSavedSearches.map((s) => ({
        ...s,
        recordId: s.id,
        resourceType: "SAVED_SEARCH",
        resourceId: s.id,
      })),
    [storeSavedSearches]
  );

  const { items: mergedRefs, pendingCount, refresh } = useMergedDataset<
    SavedSearch & Record<string, unknown>
  >("REFERENCES", serverFallback);

  const savedSearches = useMemo(() => {
    return mergedRefs.filter((item) =>
      isSavedSearchRecord(item as unknown as Record<string, unknown>)
    );
  }, [mergedRefs]);

  const [query, setQuery] = useState("");
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [editing, setEditing] = useState<{
    id: string;
    title: string;
    query: string;
    notes: string;
  } | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncNotice, setSyncNotice] = useState<string | null>(null);

  const handleCopyTitle = async (title: string, id: string) => {
    try {
      await navigator.clipboard.writeText(title);
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2000);
    } catch {
      // ignore clipboard failures
    }
  };

  const handleSaveEdit = () => {
    if (!editing || !editing.title.trim() || !editing.query.trim()) return;
    updateSavedSearch(editing.id, {
      title: editing.title.trim(),
      query: editing.query.trim(),
      notes: editing.notes.trim() || undefined,
    });
    setEditing(null);
    refresh();
  };

  const handleSaveToCloud = async () => {
    setSyncing(true);
    setSyncNotice(null);
    try {
      const res = await syncCoordinator.saveAll();
      setSyncNotice(
        res.ok
          ? `Cloud R2 & PostgreSQL committed (${res.syncedCount} operation(s)).`
          : res.error || "Cloud sync did not complete; edits remain safe locally."
      );
      refresh();
    } finally {
      setSyncing(false);
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
        String(s.title || "").toLowerCase().includes(q) ||
        String(s.query || "").toLowerCase().includes(q) ||
        (s.notes && String(s.notes).toLowerCase().includes(q))
    );
  }, [savedSearches, query]);

  return (
    <div className="space-y-6">
      {/* Search, Undo/Redo, Sync and Stats Bar */}
      <Card className="p-4 sm:p-5 shadow-sm border border-border/80">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
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

          <div className="flex flex-wrap items-center gap-2.5">
            <UndoRedoControls scope={["SAVED_SEARCHES", "REFERENCES"]} enableKeyboardShortcuts compact />
            <Button
              type="button"
              variant={pendingCount > 0 ? "primary" : "secondary"}
              disabled={syncing || pendingCount === 0}
              onClick={() => void handleSaveToCloud()}
              className="h-9 gap-1.5 px-3 text-xs font-semibold"
              title="Commit local Saved Search changes to Cloudflare R2 & PostgreSQL"
            >
              {syncing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CloudUpload className="h-3.5 w-3.5" />}
              <span>Save to Cloud R2</span>
              {pendingCount > 0 && (
                <span className="rounded-full bg-surface px-1.5 text-[10px] font-bold text-foreground">
                  {pendingCount}
                </span>
              )}
            </Button>
            <div className="text-xs text-muted">
              <strong>{savedSearches.length}</strong> saved {savedSearches.length === 1 ? "query" : "queries"}
            </div>
          </div>
        </div>
        {syncNotice && (
          <p className="mt-3 rounded-lg border border-border bg-surface-muted px-3 py-2 text-xs text-foreground">
            {syncNotice}
          </p>
        )}
      </Card>

      {/* Edit Saved Search Panel */}
      {editing && (
        <Card className="border-primary/40 bg-primary/5 p-4 sm:p-5 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-foreground">Edit Saved Search</h3>
            <button
              type="button"
              onClick={() => setEditing(null)}
              className="text-muted hover:text-foreground"
              aria-label="Close edit panel"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-medium text-muted">Title</label>
              <input
                type="text"
                value={editing.title}
                onChange={(e) => setEditing({ ...editing, title: e.target.value })}
                className="h-9 w-full rounded-lg border border-border bg-surface px-3 text-sm"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-muted">Query</label>
              <input
                type="text"
                value={editing.query}
                onChange={(e) => setEditing({ ...editing, query: e.target.value })}
                className="h-9 w-full rounded-lg border border-border bg-surface px-3 text-sm font-mono"
              />
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-muted">Notes</label>
            <textarea
              rows={2}
              value={editing.notes}
              onChange={(e) => setEditing({ ...editing, notes: e.target.value })}
              className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-xs"
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" className="h-8 px-3 text-xs" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button type="button" variant="primary" className="h-8 px-3 text-xs" onClick={handleSaveEdit}>
              Save Edit Locally
            </Button>
          </div>
        </Card>
      )}

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
                    <Badge className="text-[10px] uppercase">{s.resourceSelection || "ALL"}</Badge>
                    {s.settings?.safeSearch === "none" && (
                      <span className="rounded bg-emerald-500/10 px-1.5 py-0.5 text-emerald-600 dark:text-emerald-400 font-medium">
                        Unrestricted Mode
                      </span>
                    )}
                    {s._localStatus === "LOCAL_PENDING" && (
                      <Badge tone="warning" className="text-[10px]">Pending Sync</Badge>
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
                    <span>{isCopied ? "Copied" : "Copy"}</span>
                  </button>

                  <div className="flex items-center gap-1">
                    <Link
                      href={`/search?q=${encodeURIComponent(s.query)}`}
                      className="inline-flex items-center gap-1 rounded-md bg-primary-soft px-2.5 py-1 text-xs font-semibold text-primary hover:bg-primary/20 transition"
                    >
                      <Play className="h-3 w-3 fill-current" />
                      <span>Run</span>
                    </Link>
                    <button
                      type="button"
                      onClick={() =>
                        setEditing({
                          id: s.id,
                          title: s.title || "",
                          query: s.query || "",
                          notes: s.notes || "",
                        })
                      }
                      className="rounded-md p-1.5 text-muted hover:bg-surface-muted hover:text-foreground transition"
                      title="Edit saved search"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
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
