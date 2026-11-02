"use client";

import {
  Archive,
  ArrowRight,
  Bookmark,
  BookmarkCheck,
  Download,
  FileCode,
  FolderArchive,
  HardDrive,
  History,
  ListVideo,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { RawJsonInspectorDialog } from "@/components/saved/raw-json-inspector-dialog";
import { Badge } from "@/components/ui/badge";
import { Button, ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { formatBytes, formatDate } from "@/lib/utils/format";
import type { ArchivedManifestRecord } from "@/lib/old/archive-store";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * OLD Dashboard Workspace
 * ──────────────────────────────────────────────────────────────────────────
 * Scope: Workstream B — Phase 1.5
 * Displays total archive statistics, category navigation cards, recent imports,
 * and direct links to import historical manifests into ASDY/OLD/.
 * ═══════════════════════════════════════════════════════════════════════════
 */

export function OldDashboardWorkspace() {
  const [manifests, setManifests] = useState<ArchivedManifestRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [inspectedRecord, setInspectedRecord] = useState<ArchivedManifestRecord | null>(null);
  const [searchFilter, setSearchFilter] = useState("");

  const fetchManifests = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/old/list");
      if (!res.ok) {
        throw new Error(`Failed to load archived manifests (HTTP ${res.status}).`);
      }
      const data = await res.json();
      setManifests(data.manifests || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load archive registry.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchManifests();
  }, []);

  // Aggregate Metrics
  const metrics = useMemo(() => {
    let totalRecords = 0;
    let totalBytes = 0;
    const catCounts: Record<string, { archives: number; records: number }> = {
      "saved-items": { archives: 0, records: 0 },
      "saved-titles": { archives: 0, records: 0 },
      "saved-playlists": { archives: 0, records: 0 },
      "search-history": { archives: 0, records: 0 },
      other: { archives: 0, records: 0 },
    };

    for (const m of manifests) {
      totalRecords += m.record_count;
      totalBytes += m.byte_count;
      const cat = m.category in catCounts ? m.category : "other";
      catCounts[cat].archives++;
      catCounts[cat].records += m.record_count;
    }

    return { totalRecords, totalBytes, catCounts };
  }, [manifests]);

  const filteredManifests = useMemo(() => {
    if (!searchFilter.trim()) return manifests;
    const q = searchFilter.toLowerCase();
    return manifests.filter(
      (m) =>
        m.manifest_id.toLowerCase().includes(q) ||
        m.category.toLowerCase().includes(q) ||
        m.source_format.toLowerCase().includes(q)
    );
  }, [manifests, searchFilter]);

  const categoryCards = [
    {
      id: "saved-items",
      title: "Saved Items",
      description: "Historical saved videos, shorts, channels, and playlists.",
      href: "/old/saved-items",
      icon: BookmarkCheck,
      color: "text-primary",
      bg: "bg-primary-soft",
      stats: metrics.catCounts["saved-items"],
    },
    {
      id: "saved-titles",
      title: "Saved Search Titles",
      description: "Historical query titles, presets, and research phrases.",
      href: "/old/saved-titles",
      icon: Bookmark,
      color: "text-amber-500",
      bg: "bg-amber-500/10",
      stats: metrics.catCounts["saved-titles"],
    },
    {
      id: "saved-playlists",
      title: "Saved Playlists",
      description: "Historical user playlists, curated groups, and entries.",
      href: "/old/saved-playlists",
      icon: ListVideo,
      color: "text-indigo-500",
      bg: "bg-indigo-500/10",
      stats: metrics.catCounts["saved-playlists"],
    },
    {
      id: "search-history",
      title: "Search History",
      description: "Historical executed queries, quota records, and result caches.",
      href: "/old/search-history",
      icon: History,
      color: "text-emerald-500",
      bg: "bg-emerald-500/10",
      stats: metrics.catCounts["search-history"],
    },
    {
      id: "other",
      title: "Other Metadata",
      description: "Miscellaneous historical exports, diagnostics, and raw NDJSON.",
      href: "/old/other",
      icon: FolderArchive,
      color: "text-rose-500",
      bg: "bg-rose-500/10",
      stats: metrics.catCounts.other,
    },
  ];

  return (
    <div className="space-y-8">
      {/* Header Banner */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2 mb-1.5">
            <Badge tone="ai" className="font-mono text-[10px] uppercase tracking-wider">
              ASDY/OLD/ Archive Root
            </Badge>
            <Badge tone="success" className="text-[10px] font-semibold">
              <ShieldCheck className="h-3 w-3 mr-1 inline" />
              Strictly Isolated from Active Tables
            </Badge>
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">
            OLD Legacy Manifest Archive
          </h1>
          <p className="mt-1 text-xs text-muted max-w-2xl">
            Import and inspect historical manifest files, generation ZIP exports, and NDJSON from
            previous Supabase accounts or offline backups. Archived records are preserved under{" "}
            <code className="text-primary font-mono text-[11px]">ASDY/OLD/</code> and never mutate active application tables.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="secondary"
            onClick={fetchManifests}
            className="h-9 gap-1.5 px-3 text-xs"
            disabled={loading}
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
            <span>Refresh</span>
          </Button>
          <ButtonLink href="/old/import" variant="primary" className="h-9 gap-1.5 px-3.5 text-xs">
            <Plus className="h-4 w-4" />
            <span>Import Manifest</span>
          </ButtonLink>
        </div>
      </div>

      {/* Aggregate Statistics Cards */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Card className="p-5">
          <div className="flex items-center justify-between text-muted">
            <span className="text-xs font-medium">Archived Manifests</span>
            <Archive className="h-4 w-4 text-primary" />
          </div>
          <p className="mt-2 text-2xl font-bold text-foreground">{manifests.length}</p>
          <span className="text-[11px] text-muted">Across 5 logical categories</span>
        </Card>

        <Card className="p-5">
          <div className="flex items-center justify-between text-muted">
            <span className="text-xs font-medium">Historical Records</span>
            <Sparkles className="h-4 w-4 text-emerald-500" />
          </div>
          <p className="mt-2 text-2xl font-bold text-foreground">
            {metrics.totalRecords.toLocaleString()}
          </p>
          <span className="text-[11px] text-muted">Authentic preserved records</span>
        </Card>

        <Card className="p-5">
          <div className="flex items-center justify-between text-muted">
            <span className="text-xs font-medium">Total Storage Size</span>
            <HardDrive className="h-4 w-4 text-indigo-500" />
          </div>
          <p className="mt-2 text-2xl font-bold text-foreground">{formatBytes(metrics.totalBytes)}</p>
          <span className="text-[11px] text-muted">Private Supabase Storage</span>
        </Card>

        <Card className="p-5">
          <div className="flex items-center justify-between text-muted">
            <span className="text-xs font-medium">Storage Root</span>
            <ShieldCheck className="h-4 w-4 text-amber-500" />
          </div>
          <p className="mt-2 text-sm font-mono font-bold text-foreground truncate">
            ASDY/OLD/
          </p>
          <span className="text-[11px] text-muted">Immutable storage partition</span>
        </Card>
      </div>

      {/* Category Explorer Grid */}
      <div className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted">
          Archive Categories
        </h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
          {categoryCards.map((cat) => {
            const Icon = cat.icon;
            return (
              <Card
                key={cat.id}
                className="group flex flex-col justify-between p-5 transition hover:border-border hover:shadow-md"
              >
                <div>
                  <div className={`mb-3 flex h-10 w-10 items-center justify-center rounded-xl ${cat.bg}`}>
                    <Icon className={`h-5 w-5 ${cat.color}`} />
                  </div>
                  <h3 className="text-sm font-bold text-foreground group-hover:text-primary transition-colors">
                    {cat.title}
                  </h3>
                  <p className="mt-1 text-xs text-muted line-clamp-2 leading-relaxed">
                    {cat.description}
                  </p>
                </div>

                <div className="mt-4 pt-3 border-t border-border/60 flex items-center justify-between text-xs">
                  <div className="space-y-0.5">
                    <span className="block font-semibold text-foreground">
                      {cat.stats.records.toLocaleString()} items
                    </span>
                    <span className="text-[10px] text-muted">
                      {cat.stats.archives} {cat.stats.archives === 1 ? "manifest" : "manifests"}
                    </span>
                  </div>
                  <Link
                    href={cat.href}
                    className="flex h-7 w-7 items-center justify-center rounded-lg text-muted group-hover:bg-primary group-hover:text-white transition"
                    title={`Browse ${cat.title}`}
                  >
                    <ArrowRight className="h-3.5 w-3.5" />
                  </Link>
                </div>
              </Card>
            );
          })}
        </div>
      </div>

      {/* Recent Archived Manifests Section */}
      <div className="space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted">
            All Archived Manifests ({manifests.length})
          </h2>
          <div className="relative w-full max-w-xs">
            <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted" />
            <input
              type="text"
              value={searchFilter}
              onChange={(e) => setSearchFilter(e.target.value)}
              placeholder="Filter by manifest ID or format..."
              className="h-8.5 w-full rounded-lg border border-border bg-surface pl-9 pr-3 text-xs text-foreground placeholder:text-muted/70 focus:outline-none focus:ring-2 focus:ring-[var(--ring)]"
            />
          </div>
        </div>

        {error && (
          <Card className="p-4 border-danger/30 bg-danger/5 text-xs text-danger">
            {error}
          </Card>
        )}

        {filteredManifests.length > 0 ? (
          <Card className="overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-border bg-surface-muted/50 text-[11px] font-semibold uppercase tracking-wider text-muted">
                  <tr>
                    <th className="px-4 py-3">Manifest ID</th>
                    <th className="px-4 py-3">Category</th>
                    <th className="px-4 py-3">Format</th>
                    <th className="px-4 py-3 text-right">Records</th>
                    <th className="px-4 py-3 text-right">Size</th>
                    <th className="px-4 py-3">Preserved Dates</th>
                    <th className="px-4 py-3">Imported At</th>
                    <th className="px-4 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/60">
                  {filteredManifests.map((m) => (
                    <tr key={m.id} className="hover:bg-surface-muted/30 transition-colors">
                      <td className="px-4 py-3 font-mono font-medium text-foreground">
                        <Link
                          href={m.category === "saved-items" ? "/old/saved-items" : `/old/${m.category}`}
                          className="hover:text-primary transition-colors hover:underline"
                        >
                          {m.manifest_id}
                        </Link>
                      </td>
                      <td className="px-4 py-3">
                        <Badge tone="neutral" className="text-[10px] uppercase font-semibold">
                          {m.category}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 font-mono text-[11px] text-muted">
                        {m.source_format}
                      </td>
                      <td className="px-4 py-3 text-right font-medium text-foreground">
                        {m.record_count.toLocaleString()}
                      </td>
                      <td className="px-4 py-3 text-right text-muted">
                        {formatBytes(m.byte_count)}
                      </td>
                      <td className="px-4 py-3 text-[11px] text-muted">
                        {m.source_created_at ? (
                          <span title={`Exported: ${m.source_exported_at || "N/A"}`}>
                            {formatDate(m.source_created_at)}
                          </span>
                        ) : (
                          <span className="italic text-muted/60">Not in source</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-[11px] text-muted">
                        {formatDate(m.imported_at)}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            type="button"
                            onClick={() => setInspectedRecord(m)}
                            className="flex h-7 w-7 items-center justify-center rounded-md text-muted hover:bg-surface-muted hover:text-foreground transition"
                            title="Inspect Archive Registry Record"
                            aria-label="Inspect JSON"
                          >
                            <FileCode className="h-3.5 w-3.5" />
                          </button>
                          <a
                            href={`/api/old/${m.id}/download`}
                            download
                            className="flex h-7 w-7 items-center justify-center rounded-md text-muted hover:bg-surface-muted hover:text-foreground transition"
                            title="Download Archived Manifest JSON"
                            aria-label="Download"
                          >
                            <Download className="h-3.5 w-3.5" />
                          </a>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        ) : !loading ? (
          <Card className="flex flex-col items-center justify-center p-12 text-center">
            <Archive className="h-10 w-10 text-muted opacity-40 mb-3" />
            <h3 className="text-sm font-semibold text-foreground">No archived manifests found</h3>
            <p className="mt-1 text-xs text-muted max-w-sm">
              Your OLD Archive is currently empty. You can import historical manifests, ZIP exports,
              or NDJSON from older installations.
            </p>
            <ButtonLink href="/old/import" variant="primary" className="mt-4 h-8 gap-1.5 px-3 text-xs">
              <Plus className="h-3.5 w-3.5" />
              <span>Import First Manifest</span>
            </ButtonLink>
          </Card>
        ) : null}
      </div>

      {/* Raw JSON Modal */}
      {inspectedRecord && (
        <RawJsonInspectorDialog
          item={inspectedRecord}
          open={Boolean(inspectedRecord)}
          onClose={() => setInspectedRecord(null)}
          title={`Archived Manifest: ${inspectedRecord.manifest_id}`}
        />
      )}
    </div>
  );
}
