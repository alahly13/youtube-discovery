"use client";

import {
  Clock,
  ExternalLink,
  FolderPlus,
  Loader2,
  RefreshCw,
  Search,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import { startTransition, useEffect, useMemo, useState } from "react";
import type { YouTubeManifestSummary } from "@/types/manifest";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { formatDate } from "@/lib/utils/format";

/* ═══════════════════════════════════════════════════════════════════════════
   Collections Workspace
   ──────────────────────────────────────────────────────────────────────────
   Manages user collections of saved manifests. Collections group related
   manifests under named buckets. Currently backed by Zustand localStorage
   until durable persistence (Prisma) is applied.
   ═══════════════════════════════════════════════════════════════════════════ */

interface Collection {
  id: string;
  name: string;
  description: string;
  manifestIds: string[];
  createdAt: string;
}

const STORAGE_KEY = "youtube-discovery-collections";

function loadCollections(): Collection[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Collection[]) : [];
  } catch {
    return [];
  }
}

function saveCollections(collections: Collection[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(collections));
}

export function CollectionsWorkspace() {
  const [collections, setCollections] = useState<Collection[]>([]);
  const [manifests, setManifests] = useState<YouTubeManifestSummary[]>([]);
  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [loading, setLoading] = useState(false);

  /* Load from localStorage on mount */
  useEffect(() => {
    startTransition(() => setCollections(loadCollections()));
  }, []);

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

  /* Filtered collections */
  const filtered = useMemo(() => {
    if (!searchQuery.trim()) return collections;
    const q = searchQuery.toLowerCase();
    return collections.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.description.toLowerCase().includes(q),
    );
  }, [collections, searchQuery]);

  /* Create collection */
  function createCollection() {
    if (!newName.trim()) return;
    const next: Collection = {
      id: `col_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      name: newName.trim(),
      description: newDesc.trim(),
      manifestIds: [],
      createdAt: new Date().toISOString(),
    };
    const updated = [next, ...collections];
    setCollections(updated);
    saveCollections(updated);
    setNewName("");
    setNewDesc("");
  }

  /* Delete collection */
  function deleteCollection(id: string) {
    const updated = collections.filter((c) => c.id !== id);
    setCollections(updated);
    saveCollections(updated);
  }

  return (
    <div className="space-y-6">
      {/* Create new collection */}
      <Card>
        <CardHeader
          title="Create new collection"
          eyebrow="Group related manifests"
        />
        <div className="space-y-3">
          <input
            className="h-10 w-full rounded-lg border border-border bg-surface px-3 text-sm"
            placeholder="Collection name"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
          />
          <input
            className="h-10 w-full rounded-lg border border-border bg-surface px-3 text-sm"
            placeholder="Description (optional)"
            value={newDesc}
            onChange={(e) => setNewDesc(e.target.value)}
          />
          <Button onClick={createCollection} disabled={!newName.trim()}>
            <FolderPlus className="h-4 w-4" />
            Create collection
          </Button>
        </div>
      </Card>

      {/* Search collections */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
        <input
          className="h-10 w-full rounded-lg border border-border bg-surface pl-9 pr-3 text-sm"
          placeholder="Search collections…"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
      </div>

      {/* Collections grid */}
      {filtered.length === 0 ? (
        <Card>
          <p className="py-8 text-center text-sm text-muted">
            {collections.length === 0
              ? "No collections yet. Create one above to start organizing your research."
              : "No collections match your search."}
          </p>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {filtered.map((col) => (
            <Card key={col.id} className="flex flex-col">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <h3 className="truncate text-base font-semibold text-foreground">
                    {col.name}
                  </h3>
                  {col.description && (
                    <p className="mt-1 text-sm text-muted">{col.description}</p>
                  )}
                </div>
                <button
                  className="shrink-0 rounded-lg p-2 text-muted hover:bg-danger/10 hover:text-danger"
                  onClick={() => deleteCollection(col.id)}
                  title="Delete collection"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <Badge>{col.manifestIds.length} manifests</Badge>
                <Badge>
                  <Clock className="h-3 w-3" />
                  {formatDate(col.createdAt)}
                </Badge>
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* Available manifests */}
      <Card>
        <CardHeader
          title="Available runtime manifests"
          eyebrow="Can be added to collections"
          action={
            <Button
              variant="ghost"
              onClick={fetchManifests}
              disabled={loading}
            >
              {loading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4" />
              )}
            </Button>
          }
        />
        {manifests.length === 0 ? (
          <p className="text-sm text-muted">
            No runtime manifests available. Search or explore to create some.
          </p>
        ) : (
          <div className="space-y-2">
            {manifests.slice(0, 10).map((m) => (
              <div
                key={m.manifestId}
                className="flex items-center justify-between gap-3 rounded-lg border border-border bg-surface-muted p-3"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-foreground">
                    {m.title}
                  </p>
                  <p className="text-xs text-muted">{m.itemCount} items</p>
                </div>
                <Link
                  href={`/manifests/${m.manifestId}`}
                  className="shrink-0 text-primary hover:underline"
                >
                  <ExternalLink className="h-4 w-4" />
                </Link>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
