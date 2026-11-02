"use client";

import {
  Archive,
  ArrowLeft,
  Download,
  FileCode,
  Layers,
  RefreshCw,
  Search,
  ShieldCheck,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { RawJsonInspectorDialog } from "@/components/saved/raw-json-inspector-dialog";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { formatDate } from "@/lib/utils/format";
import type { ArchivedManifestRecord } from "@/lib/old/archive-store";
import type { OldArchiveCategory } from "@/lib/old/archive-envelope";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * OLD Category Workspace
 * ──────────────────────────────────────────────────────────────────────────
 * Scope: Workstream B — Phase 1.5
 * Reusable explorer for categories:
 * - Saved Titles
 * - Saved Playlists
 * - Search History
 * - Other
 * ═══════════════════════════════════════════════════════════════════════════
 */

interface OldCategoryWorkspaceProps {
  category: OldArchiveCategory;
  title: string;
  description: string;
}

export function OldCategoryWorkspace({
  category,
  title,
  description,
}: OldCategoryWorkspaceProps) {
  const [manifests, setManifests] = useState<ArchivedManifestRecord[]>([]);
  const [selectedManifestId, setSelectedManifestId] = useState<string>("ALL");
  const [items, setItems] = useState<unknown[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingItems, setLoadingItems] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [inspectedItem, setInspectedItem] = useState<unknown | null>(null);

  // 1. Fetch category archives
  useEffect(() => {
    async function loadCategoryManifests() {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/old/list?category=${category}`);
        if (!res.ok) throw new Error(`Failed to load ${category} archives.`);
        const data = await res.json();
        const list: ArchivedManifestRecord[] = data.manifests || [];
        setManifests(list);
        if (list.length > 0) {
          setSelectedManifestId(list[0].id);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load archives.");
      } finally {
        setLoading(false);
      }
    }
    void loadCategoryManifests();
  }, [category]);

  // 2. Fetch items for selected manifest
  useEffect(() => {
    async function loadItems() {
      if (manifests.length === 0) {
        setItems([]);
        return;
      }
      setLoadingItems(true);
      setError(null);
      try {
        if (selectedManifestId === "ALL") {
          const allItems: Record<string, unknown>[] = [];
          for (const m of manifests.slice(0, 5)) {
            const res = await fetch(`/api/old/${m.id}`);
            if (res.ok) {
              const data = await res.json();
              if (data.envelope?.payload?.items) {
                allItems.push(...(data.envelope.payload.items as Record<string, unknown>[]));
              }
            }
          }
          setItems(allItems);
        } else {
          const res = await fetch(`/api/old/${selectedManifestId}`);
          if (!res.ok) throw new Error("Failed to load archive items.");
          const data = await res.json();
          setItems((data.envelope?.payload?.items as Record<string, unknown>[]) || []);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load items.");
      } finally {
        setLoadingItems(false);
      }
    }

    if (selectedManifestId) {
      void loadItems();
    }
  }, [selectedManifestId, manifests]);

  // Filter items matching search
  const filteredItems = useMemo(() => {
    if (!searchQuery.trim()) return items;
    const q = searchQuery.toLowerCase();
    return items.filter((item) => {
      if (typeof item === "string") return item.toLowerCase().includes(q);
      const str = JSON.stringify(item).toLowerCase();
      return str.includes(q);
    });
  }, [items, searchQuery]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2 mb-1.5">
            <Link
              href="/old"
              className="flex items-center gap-1 text-xs font-medium text-muted hover:text-foreground transition"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              <span>Back to OLD Archive</span>
            </Link>
            <span className="text-muted/60">•</span>
            <Badge tone="neutral" className="text-[10px] uppercase font-semibold">
              Category: {category}
            </Badge>
            <Badge tone="success" className="text-[10px] font-semibold">
              <ShieldCheck className="h-3 w-3 mr-1 inline" />
              Read-Only
            </Badge>
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">{title}</h1>
          <p className="mt-1 text-xs text-muted max-w-2xl">{description}</p>
        </div>

        <div className="flex items-center gap-2">
          {selectedManifestId !== "ALL" && (
            <a
              href={`/api/old/${selectedManifestId}/download`}
              download
              className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border bg-surface px-3 text-xs font-medium text-foreground hover:bg-surface-muted transition"
            >
              <Download className="h-3.5 w-3.5" />
              <span>Download JSON</span>
            </a>
          )}
          <ButtonLink href={`/old/import?category=${category}`} variant="primary" className="h-9 gap-1.5 px-3.5 text-xs">
            <span>Import Another File</span>
          </ButtonLink>
        </div>
      </div>

      {/* Manifest Selector Shelf */}
      {manifests.length > 0 && (
        <Card className="p-4 bg-surface-muted/30">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-2">
              <Archive className="h-4 w-4 text-primary" />
              <span className="text-xs font-semibold text-foreground">Archived File:</span>
              <select
                value={selectedManifestId}
                onChange={(e) => setSelectedManifestId(e.target.value)}
                className="h-8.5 rounded-lg border border-border bg-surface px-3 font-mono text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-[var(--ring)]"
              >
                {manifests.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.manifest_id} ({m.record_count.toLocaleString()} items • {formatDate(m.imported_at)})
                  </option>
                ))}
                {manifests.length > 1 && <option value="ALL">All Manifests Combined ({items.length} items)</option>}
              </select>
            </div>

            <div className="text-[11px] text-muted">
              Preserved in <code className="font-mono text-primary">ASDY/OLD/</code>
            </div>
          </div>
        </Card>
      )}

      {error && (
        <Card className="p-4 border-danger/30 bg-danger/5 text-xs text-danger">
          {error}
        </Card>
      )}

      {/* Search Bar */}
      <div className="flex items-center justify-between gap-4">
        <div className="relative w-full max-w-md">
          <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={`Search in ${title.toLowerCase()}...`}
            className="h-9 w-full rounded-lg border border-border bg-surface pl-9 pr-3 text-xs text-foreground placeholder:text-muted/70 focus:outline-none focus:ring-2 focus:ring-[var(--ring)]"
          />
        </div>

        <Badge tone="neutral" className="text-xs">
          {filteredItems.length} {filteredItems.length === 1 ? "record" : "records"}
        </Badge>
      </div>

      {/* Item Display List */}
      {loading || loadingItems ? (
        <Card className="flex items-center justify-center p-14 text-center">
          <RefreshCw className="h-6 w-6 text-primary animate-spin mb-2" />
          <span className="text-xs text-muted">Loading archive records...</span>
        </Card>
      ) : filteredItems.length > 0 ? (
        <div className="space-y-3">
          {filteredItems.map((rawItem, idx) => {
            const isSimpleString = typeof rawItem === "string";
            const itemObj =
              typeof rawItem === "object" && rawItem !== null
                ? (rawItem as Record<string, unknown>)
                : null;
            const itemTitle = isSimpleString
              ? rawItem
              : String(
                  itemObj?.title ||
                    itemObj?.query_text ||
                    itemObj?.queryText ||
                    itemObj?.name ||
                    `Record #${idx + 1}`
                );
            const itemSubtitle = isSimpleString
              ? null
              : itemObj?.description
              ? String(itemObj.description)
              : itemObj?.search_settings
              ? "Search execution record"
              : itemObj?.notes
              ? String(itemObj.notes)
              : null;

            return (
              <Card
                key={idx}
                className="flex items-center justify-between p-4 transition hover:border-border hover:shadow-xs"
              >
                <div className="flex items-center gap-3 overflow-hidden">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-surface-muted text-muted font-mono text-xs">
                    {idx + 1}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="line-clamp-2 text-sm font-bold text-foreground leading-snug tracking-tight">
                      {itemTitle}
                    </p>
                    {itemSubtitle && (
                      <p className="mt-1 line-clamp-1 text-xs text-muted">
                        {itemSubtitle}
                      </p>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => setInspectedItem(rawItem)}
                    className="flex h-8 w-8 items-center justify-center rounded-lg text-muted hover:bg-surface-muted hover:text-foreground transition"
                    title="Inspect Raw JSON"
                    aria-label="Inspect JSON"
                  >
                    <FileCode className="h-4 w-4" />
                  </button>
                </div>
              </Card>
            );
          })}
        </div>
      ) : (
        <Card className="flex flex-col items-center justify-center p-14 text-center">
          <Layers className="h-10 w-10 text-muted opacity-40 mb-3" />
          <h3 className="text-sm font-semibold text-foreground">No records found</h3>
          <p className="mt-1 text-xs text-muted max-w-sm">
            {manifests.length === 0
              ? `You haven't imported any ${title} files into the OLD Archive yet.`
              : "No records match your search filter."}
          </p>
          {manifests.length === 0 && (
            <ButtonLink href={`/old/import?category=${category}`} variant="primary" className="mt-4 h-8 gap-1.5 px-3 text-xs">
              <span>Import {title}</span>
            </ButtonLink>
          )}
        </Card>
      )}

      {/* Raw JSON Inspector Modal */}
      {inspectedItem ? (
        <RawJsonInspectorDialog
          item={inspectedItem}
          open={Boolean(inspectedItem)}
          onClose={() => setInspectedItem(null)}
          title={`Archive Record: ${category}`}
        />
      ) : null}
    </div>
  );
}
