"use client";

import {
  AlertCircle,
  Archive,
  ArrowRight,
  Bookmark,
  BookmarkCheck,
  CheckCircle2,
  Database,
  Download,
  FileCode,
  FolderOutput,
  HardDrive,
  History,
  Layers,
  ListVideo,
  Loader2,
  RefreshCw,
  Search,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button, ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { formatBytes, formatDate } from "@/lib/utils/format";
import type { ArchivedManifestRecord } from "@/lib/old/archive-store";

type ExportSource = "OLD" | "NEW";
type ExportFormat = "ZIP" | "ORIGINAL";

export function ManifestExportWorkspace() {
  const [source, setSource] = useState<ExportSource>("OLD");
  const [format, setFormat] = useState<ExportFormat>("ZIP");
  const [categoryFilter, setCategoryFilter] = useState<string>("ALL");
  const [manifests, setManifests] = useState<ArchivedManifestRecord[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successFilename, setSuccessFilename] = useState<string | null>(null);

  // Load registered manifests for OLD source
  const loadManifests = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/old/list");
      if (!res.ok) throw new Error("Failed to load manifests.");
      const data = await res.json();
      const list: ArchivedManifestRecord[] = data.manifests || [];
      setManifests(list);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error loading archives.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (source === "OLD") {
      void loadManifests();
    }
  }, [source]);

  // Filtered manifests by category
  const filteredManifests = useMemo(() => {
    if (categoryFilter === "ALL") return manifests;
    return manifests.filter((m) => m.category === categoryFilter);
  }, [manifests, categoryFilter]);

  // Handle multi-select
  const toggleSelect = (manifestId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(manifestId)) {
        next.delete(manifestId);
      } else {
        next.add(manifestId);
      }
      return next;
    });
  };

  const selectAll = () => {
    setSelectedIds(new Set(filteredManifests.map((m) => m.manifest_id)));
  };

  const clearSelection = () => {
    setSelectedIds(new Set());
  };

  // Preview totals
  const selectedManifests = useMemo(() => {
    return manifests.filter((m) => selectedIds.has(m.manifest_id));
  }, [manifests, selectedIds]);

  const totalRecords = selectedManifests.reduce((acc, m) => acc + m.record_count, 0);
  const totalBytes = selectedManifests.reduce((acc, m) => acc + m.byte_count, 0);

  const handleExport = async () => {
    if (selectedIds.size === 0) {
      setError("Please select at least one manifest to export.");
      return;
    }

    setExporting(true);
    setError(null);
    setSuccessFilename(null);

    try {
      const payload = {
        source,
        format: selectedIds.size === 1 && format === "ORIGINAL" ? "ORIGINAL" : "ZIP",
        manifestIds: Array.from(selectedIds),
      };

      const res = await fetch("/api/manifests/export-selected", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => null);
        throw new Error(errJson?.error || `Export failed with HTTP ${res.status}.`);
      }

      const contentDisposition = res.headers.get("Content-Disposition") || "";
      let filename = `export-${source.toLowerCase()}-${Date.now()}.zip`;
      const match = contentDisposition.match(/filename="?([^"]+)"?/);
      if (match && match[1]) filename = match[1];

      const blob = await res.blob();
      const downloadUrl = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = downloadUrl;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(downloadUrl);

      setSuccessFilename(filename);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Manifest export failed.");
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="space-y-8 max-w-4xl mx-auto">
      {/* Header */}
      <div className="border-b border-border/80 pb-5">
        <div className="flex items-center gap-2 mb-2">
          <Badge tone="primary" className="text-[10px] uppercase font-bold tracking-wider">
            STORAGE EXPORTER
          </Badge>
          <Badge tone="success" className="text-[10px] font-semibold">
            Authentic Storage Bytes
          </Badge>
        </div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground flex items-center gap-2.5">
          <FolderOutput className="h-6 w-6 text-primary" />
          <span>Manifest Export & Download</span>
        </h1>
        <p className="mt-1 text-xs text-muted leading-relaxed">
          Export registered manifests from PostgreSQL and stream original bytes directly from the dedicated
          OLD or NEW private Supabase Storage buckets.
        </p>
      </div>

      {/* 1. Source Choice: OLD or NEW */}
      <div className="space-y-3">
        <label className="text-xs font-bold uppercase tracking-wider text-muted">
          1. Choose Storage Source
        </label>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <button
            type="button"
            onClick={() => {
              setSource("OLD");
              setSelectedIds(new Set());
              setError(null);
            }}
            className={`text-left p-5 rounded-2xl border transition-all ${
              source === "OLD"
                ? "border-primary bg-primary-soft/40 shadow-xs ring-1 ring-primary"
                : "border-border/80 bg-surface hover:bg-surface-muted/50"
            }`}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  <Archive className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-foreground">OLD Archive Bucket</h3>
                  <code className="text-[11px] font-mono text-primary">old-youtube-discovery-private</code>
                </div>
              </div>
              <Badge tone="ai" className="font-mono text-[10px]">asdy/old/</Badge>
            </div>
            <p className="mt-3 text-xs text-muted leading-relaxed">
              Export historical manifests and recovered browser data preserved under the 4 OLD categories.
            </p>
          </button>

          <button
            type="button"
            onClick={() => {
              setSource("NEW");
              setSelectedIds(new Set());
              setError(null);
            }}
            className={`text-left p-5 rounded-2xl border transition-all ${
              source === "NEW"
                ? "border-primary bg-primary-soft/40 shadow-xs ring-1 ring-primary"
                : "border-border/80 bg-surface hover:bg-surface-muted/50"
            }`}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                  <HardDrive className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-foreground">NEW Generational Bucket</h3>
                  <code className="text-[11px] font-mono text-emerald-600 dark:text-emerald-400">new-youtube-discovery-private</code>
                </div>
              </div>
              <Badge tone="success" className="font-mono text-[10px]">persistence/</Badge>
            </div>
            <p className="mt-3 text-xs text-muted leading-relaxed">
              Export active dataset generations and immutable manifest parts with verified checksums.
            </p>
          </button>
        </div>
      </div>

      {/* 2. Category Filter & Selection Table */}
      {source === "OLD" && (
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <label className="text-xs font-bold uppercase tracking-wider text-muted">
              2. Select Category & Manifests to Export
            </label>

            <div className="flex items-center gap-2">
              <select
                value={categoryFilter}
                onChange={(e) => setCategoryFilter(e.target.value)}
                className="h-8 rounded-lg border border-border bg-surface px-2.5 text-xs text-foreground focus:outline-hidden"
              >
                <option value="ALL">All Categories</option>
                <option value="saved-items">OLD Saved Items</option>
                <option value="saved-playlists">OLD Saved Playlists</option>
                <option value="saved-titles-links">OLD Saved Titles & Links</option>
                <option value="saved-search-history">OLD Saved Search History</option>
              </select>

              <Button
                variant="ghost"
                onClick={selectAll}
                className="h-8 px-2 text-xs text-primary"
              >
                Select All
              </Button>
              <Button
                variant="ghost"
                onClick={clearSelection}
                className="h-8 px-2 text-xs text-muted"
              >
                Clear
              </Button>
            </div>
          </div>

          {/* Table */}
          {loading ? (
            <div className="flex items-center justify-center p-12 text-xs text-muted">
              <Loader2 className="h-5 w-5 animate-spin text-primary mr-2" />
              <span>Loading registered manifests…</span>
            </div>
          ) : filteredManifests.length === 0 ? (
            <Card className="p-8 text-center text-xs text-muted space-y-1">
              <p className="font-semibold text-foreground">No manifests found</p>
              <p>Upload a manifest first using the Upload Manifest page.</p>
            </Card>
          ) : (
            <div className="border border-border/80 rounded-2xl overflow-hidden bg-surface">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-surface-muted/60 border-b border-border/80 text-[10px] font-bold uppercase tracking-wider text-muted">
                    <tr>
                      <th className="p-3 w-10 text-center">Select</th>
                      <th className="p-3">Manifest ID</th>
                      <th className="p-3">Category</th>
                      <th className="p-3">Records</th>
                      <th className="p-3">Size</th>
                      <th className="p-3">Imported</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/60">
                    {filteredManifests.map((m) => {
                      const isChecked = selectedIds.has(m.manifest_id);
                      return (
                        <tr
                          key={m.id}
                          onClick={() => toggleSelect(m.manifest_id)}
                          className={`cursor-pointer transition hover:bg-surface-muted/40 ${
                            isChecked ? "bg-primary-soft/30" : ""
                          }`}
                        >
                          <td className="p-3 text-center" onClick={(e) => e.stopPropagation()}>
                            <input
                              type="checkbox"
                              checked={isChecked}
                              onChange={() => toggleSelect(m.manifest_id)}
                              className="rounded border-border text-primary focus:ring-primary"
                            />
                          </td>
                          <td className="p-3 font-mono font-semibold text-foreground">
                            {m.manifest_id}
                          </td>
                          <td className="p-3">
                            <Badge tone="ai" className="font-mono text-[10px]">
                              {m.category}
                            </Badge>
                          </td>
                          <td className="p-3 font-mono">
                            {m.record_count.toLocaleString()}
                          </td>
                          <td className="p-3 font-mono text-muted">
                            {formatBytes(m.byte_count)}
                          </td>
                          <td className="p-3 text-muted text-[11px]">
                            {m.imported_at ? String(m.imported_at).slice(0, 10) : "N/A"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* 3. Export Format Choice */}
      <div className="space-y-3">
        <label className="text-xs font-bold uppercase tracking-wider text-muted">
          3. Choose Export Packaging Format
        </label>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <button
            type="button"
            onClick={() => setFormat("ZIP")}
            className={`text-left p-4 rounded-xl border transition-all ${
              format === "ZIP"
                ? "border-primary bg-primary-soft/30 ring-1 ring-primary"
                : "border-border/70 bg-surface hover:bg-surface-muted/40"
            }`}
          >
            <span className="text-xs font-bold text-foreground block mb-1">
              Standard ZIP Package (Recommended)
            </span>
            <p className="text-[11px] text-muted">
              Packages manifests into a structured ZIP archive with SHA256 checksums and export catalog.
            </p>
          </button>

          <button
            type="button"
            onClick={() => setFormat("ORIGINAL")}
            disabled={selectedIds.size > 1}
            className={`text-left p-4 rounded-xl border transition-all ${
              selectedIds.size > 1
                ? "opacity-50 cursor-not-allowed border-border/40 bg-surface-muted/20"
                : format === "ORIGINAL"
                ? "border-primary bg-primary-soft/30 ring-1 ring-primary"
                : "border-border/70 bg-surface hover:bg-surface-muted/40"
            }`}
          >
            <span className="text-xs font-bold text-foreground block mb-1">
              Original JSON File
            </span>
            <p className="text-[11px] text-muted">
              Downloads raw uncompressed JSON directly (available when a single manifest is selected).
            </p>
          </button>
        </div>
      </div>

      {/* 4. Preview & Export Summary Card */}
      <Card className="p-5 space-y-3 bg-surface-muted/30 border-border/80">
        <h3 className="text-xs font-bold uppercase tracking-wider text-muted">
          Export Summary Preview
        </h3>
        <div className="grid grid-cols-3 gap-4 text-center text-xs">
          <div className="p-3 bg-surface rounded-xl border border-border/60">
            <span className="text-[10px] text-muted block">Selected Manifests</span>
            <span className="text-lg font-bold text-foreground">{selectedIds.size}</span>
          </div>
          <div className="p-3 bg-surface rounded-xl border border-border/60">
            <span className="text-[10px] text-muted block">Estimated Records</span>
            <span className="text-lg font-bold text-primary">{totalRecords.toLocaleString()}</span>
          </div>
          <div className="p-3 bg-surface rounded-xl border border-border/60">
            <span className="text-[10px] text-muted block">Estimated File Size</span>
            <span className="text-lg font-bold text-foreground">{formatBytes(totalBytes)}</span>
          </div>
        </div>
      </Card>

      {/* Error / Success Notices */}
      {error && (
        <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-xs text-destructive flex items-center gap-2">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {successFilename && (
        <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-xs text-emerald-600 dark:text-emerald-400 flex items-center gap-2">
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          <span>Downloaded: <strong>{successFilename}</strong></span>
        </div>
      )}

      {/* Export Action */}
      <div className="flex items-center justify-end gap-3 pt-4 border-t border-border/80">
        <ButtonLink href="/manifests" variant="ghost" className="h-9 px-4 text-xs">
          Cancel
        </ButtonLink>

        <Button
          type="button"
          variant="primary"
          onClick={handleExport}
          disabled={exporting || selectedIds.size === 0}
          className="h-9 gap-2 px-6 text-xs font-semibold shadow-xs"
        >
          {exporting ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              <span>Fetching & Exporting…</span>
            </>
          ) : (
            <>
              <Download className="h-4 w-4" />
              <span>Export {selectedIds.size} Manifest(s)</span>
            </>
          )}
        </Button>
      </div>
    </div>
  );
}
