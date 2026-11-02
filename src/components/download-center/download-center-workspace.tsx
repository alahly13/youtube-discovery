"use client";

import {
  Archive,
  ArrowDownToLine,
  CheckSquare,
  Clock,
  Download,
  FileCode,
  HardDrive,
  Layers,
  Loader2,
  RefreshCw,
  Search,
  ShieldCheck,
  Square,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { RawJsonInspectorDialog } from "@/components/saved/raw-json-inspector-dialog";
import type {
  DownloadCenterInventory,
  ManifestSourceOrigin,
} from "@/lib/download-center/download-center-service";
import type { HistoricalManifestCategory } from "@/lib/recovery/legacy-scanner";
import { formatCompactCount, formatBytes } from "@/lib/utils/format";

const CATEGORIES: Array<{ key: "ALL" | HistoricalManifestCategory; label: string }> = [
  { key: "ALL", label: "All Categories" },
  { key: "SAVED_ITEMS", label: "Saved Items" },
  { key: "SAVED_PLAYLISTS", label: "Playlists" },
  { key: "SAVED_TITLES", label: "Saved Titles" },
  { key: "SAVED_SEARCH_HISTORY", label: "Search History" },
  { key: "RESEARCH_QUEUE", label: "Research Queue" },
  { key: "SAVED_REFERENCES", label: "References" },
  { key: "SEARCH_PRESETS", label: "Presets" },
  { key: "OTHER", label: "Other" },
];

export function DownloadCenterWorkspace() {
  const [inventory, setInventory] = useState<DownloadCenterInventory | null>(null);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Filters & Selection
  const [selectedOrigin, setSelectedOrigin] = useState<"ALL" | ManifestSourceOrigin>("ALL");
  const [selectedCategory, setSelectedCategory] = useState<"ALL" | HistoricalManifestCategory>("ALL");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Metadata inspector
  const [inspectedItem, setInspectedItem] = useState<unknown | null>(null);

  const fetchInventory = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/download-center/inventory");
      if (!res.ok) throw new Error("Failed to load Download Center inventory.");
      const data = await res.json();
      setInventory(data.inventory);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load inventory.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchInventory();
  }, []);

  // Filtered manifest list
  const filteredManifests = useMemo(() => {
    if (!inventory?.items) return [];

    return inventory.items.filter((item) => {
      if (selectedOrigin !== "ALL" && item.origin !== selectedOrigin) return false;
      if (selectedCategory !== "ALL" && item.category !== selectedCategory) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchesName = item.displayName.toLowerCase().includes(q);
        const matchesFile = item.originalFilename.toLowerCase().includes(q);
        const matchesManifest = item.manifestId.toLowerCase().includes(q);
        if (!matchesName && !matchesFile && !matchesManifest) return false;
      }
      return true;
    });
  }, [inventory, selectedOrigin, selectedCategory, searchQuery]);

  // Selection helpers
  const handleToggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleSelectAllFiltered = () => {
    const next = new Set(selectedIds);
    for (const m of filteredManifests) {
      next.add(m.id);
    }
    setSelectedIds(next);
  };

  const handleClearSelection = () => {
    setSelectedIds(new Set());
  };

  // Export action
  const handleExportSelected = async (targetIds?: string[]) => {
    const idsToExport = targetIds || Array.from(selectedIds);
    if (idsToExport.length === 0) return;

    setExporting(true);
    try {
      const res = await fetch("/api/download-center/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          manifestIds: idsToExport,
          formatAsStandardEnvelope: true,
        }),
      });

      if (!res.ok) {
        const errJson = await res.json();
        throw new Error(errJson.error || "Failed to download export package.");
      }

      const blob = await res.blob();
      const contentDisposition = res.headers.get("Content-Disposition") || "";
      let filename = "youtube-discovery-export.zip";
      const match = contentDisposition.match(/filename="?([^"]+)"?/);
      if (match && match[1]) filename = match[1];

      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to export manifests.");
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Header & Navigation Switcher */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between border-b border-border/80 pb-5">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <h1 className="text-2xl font-bold tracking-tight text-foreground flex items-center gap-2.5">
              <span>مركز التحميل</span>
              <span className="text-muted font-normal text-lg">/ Download Center</span>
            </h1>
          </div>
          <p className="text-xs text-muted max-w-2xl">
            Export and download any Manifest from both <span className="font-semibold text-emerald-500">NEW</span> (active committed data)
            and <span className="font-semibold text-amber-500">OLD</span> (historical legacy archive) storage.
          </p>
        </div>

        {/* Tab switch to Legacy Recovery */}
        <div className="flex items-center gap-2">
          <Link
            href="/download-center/legacy-recovery"
            className="flex items-center gap-2 rounded-xl border border-primary/40 bg-primary/10 px-3.5 py-2 text-xs font-semibold text-primary transition hover:bg-primary/20"
          >
            <ShieldCheck className="h-4 w-4" />
            <span>Legacy Data Recovery (إنقاذ البيانات القديمة)</span>
          </Link>
          <Button
            variant="secondary"
            onClick={fetchInventory}
            disabled={loading}
            className="h-9 gap-1.5 px-3 text-xs"
            title="Refresh inventory"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
            <span className="hidden sm:inline">Refresh</span>
          </Button>
        </div>
      </div>

      {/* Metric Cards */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="p-4 flex items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Layers className="h-5 w-5" />
          </div>
          <div>
            <p className="text-[11px] font-medium uppercase tracking-wider text-muted">Total Manifests</p>
            <p className="text-lg font-bold text-foreground">
              {inventory ? inventory.totalManifests : "—"}
            </p>
          </div>
        </Card>

        <Card className="p-4 flex items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-500">
            <HardDrive className="h-5 w-5" />
          </div>
          <div>
            <p className="text-[11px] font-medium uppercase tracking-wider text-muted">NEW (Current Data)</p>
            <p className="text-lg font-bold text-foreground">
              {inventory ? `${inventory.newCounts.manifests} files` : "—"}
            </p>
          </div>
        </Card>

        <Card className="p-4 flex items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-500/10 text-amber-500">
            <Archive className="h-5 w-5" />
          </div>
          <div>
            <p className="text-[11px] font-medium uppercase tracking-wider text-muted">OLD (Historical Archive)</p>
            <p className="text-lg font-bold text-foreground">
              {inventory ? `${inventory.oldCounts.manifests} files` : "—"}
            </p>
          </div>
        </Card>

        <Card className="p-4 flex items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-ai/10 text-ai">
            <ArrowDownToLine className="h-5 w-5" />
          </div>
          <div>
            <p className="text-[11px] font-medium uppercase tracking-wider text-muted">Total Records</p>
            <p className="text-lg font-bold text-foreground">
              {inventory ? formatCompactCount(inventory.totalRecords) : "—"}
            </p>
          </div>
        </Card>
      </div>

      {/* Error Card */}
      {error && (
        <Card className="p-4 border-danger/30 bg-danger/5 text-xs text-danger flex items-start gap-2.5">
          <p>{error}</p>
        </Card>
      )}

      {/* Filters & Actions Bar */}
      <Card className="p-4 space-y-4">
        {/* Source Origin & Search */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-1.5 p-1 bg-surface-muted rounded-xl">
            <button
              type="button"
              onClick={() => setSelectedOrigin("ALL")}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition ${
                selectedOrigin === "ALL" ? "bg-surface text-foreground shadow-xs" : "text-muted hover:text-foreground"
              }`}
            >
              All Sources ({inventory?.totalManifests || 0})
            </button>
            <button
              type="button"
              onClick={() => setSelectedOrigin("NEW")}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition ${
                selectedOrigin === "NEW" ? "bg-surface text-emerald-500 shadow-xs" : "text-muted hover:text-foreground"
              }`}
            >
              NEW Active ({inventory?.newCounts.manifests || 0})
            </button>
            <button
              type="button"
              onClick={() => setSelectedOrigin("OLD")}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition ${
                selectedOrigin === "OLD" ? "bg-surface text-amber-500 shadow-xs" : "text-muted hover:text-foreground"
              }`}
            >
              OLD Archive ({inventory?.oldCounts.manifests || 0})
            </button>
          </div>

          <div className="relative w-full sm:w-72">
            <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Filter by name or filename..."
              className="h-8.5 w-full rounded-lg border border-border bg-surface pl-9 pr-3 text-xs text-foreground placeholder:text-muted/70 focus:outline-none focus:ring-2 focus:ring-[var(--ring)]"
            />
          </div>
        </div>

        {/* Category Pills */}
        <div className="flex flex-wrap items-center gap-1.5 pt-2 border-t border-border/60">
          <span className="text-[11px] font-semibold text-muted mr-1">Categories:</span>
          {CATEGORIES.map((cat) => {
            const count =
              cat.key === "ALL"
                ? inventory?.totalManifests || 0
                : inventory?.categoryCounts[cat.key] || 0;
            const active = selectedCategory === cat.key;

            return (
              <button
                key={cat.key}
                type="button"
                onClick={() => setSelectedCategory(cat.key)}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium transition ${
                  active
                    ? "bg-primary text-white"
                    : "bg-surface-muted text-muted hover:bg-surface-raised hover:text-foreground"
                }`}
              >
                <span>{cat.label}</span>
                <span className={`text-[10px] px-1 rounded-sm ${active ? "bg-white/20 text-white" : "bg-border text-muted"}`}>
                  {count}
                </span>
              </button>
            );
          })}
        </div>

        {/* Bulk Selection Actions Bar */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pt-3 border-t border-border/60 text-xs">
          <div className="flex items-center gap-3">
            <span className="font-semibold text-foreground">
              {selectedIds.size} of {filteredManifests.length} selected
            </span>
            <Button
              variant="ghost"
              onClick={handleSelectAllFiltered}
              className="h-7 text-xs px-2 text-primary"
            >
              Select All Filtered
            </Button>
            {selectedIds.size > 0 && (
              <Button
                variant="ghost"
                onClick={handleClearSelection}
                className="h-7 text-xs px-2 text-muted hover:text-foreground"
              >
                Clear
              </Button>
            )}
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="primary"
              onClick={() => handleExportSelected()}
              disabled={selectedIds.size === 0 || exporting}
              className="h-8 gap-1.5 px-3.5 text-xs font-semibold"
            >
              {exporting ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  <span>Preparing ZIP…</span>
                </>
              ) : (
                <>
                  <Download className="h-3.5 w-3.5" />
                  <span>Download Selected ({selectedIds.size})</span>
                </>
              )}
            </Button>

            <Button
              variant="secondary"
              onClick={() => handleExportSelected(filteredManifests.map((m) => m.id))}
              disabled={filteredManifests.length === 0 || exporting}
              className="h-8 gap-1.5 px-3 text-xs"
              title="Download all manifests matching the current filter"
            >
              <ArrowDownToLine className="h-3.5 w-3.5" />
              <span>Download Filtered ({filteredManifests.length})</span>
            </Button>
          </div>
        </div>
      </Card>

      {/* Manifest Table / Cards */}
      {loading ? (
        <Card className="flex items-center justify-center p-14 text-center">
          <RefreshCw className="h-6 w-6 text-primary animate-spin mb-2" />
          <span className="text-xs text-muted">Loading Download Center inventory...</span>
        </Card>
      ) : filteredManifests.length > 0 ? (
        <Card className="overflow-hidden">
          <div className="divide-y divide-border/60">
            {filteredManifests.map((item) => {
              const isSelected = selectedIds.has(item.id);

              return (
                <div
                  key={item.id}
                  className={`flex flex-col sm:flex-row sm:items-center sm:justify-between p-4 transition gap-3 hover:bg-surface-muted/30 ${
                    isSelected ? "bg-primary/5" : ""
                  }`}
                >
                  {/* Left: Selection + Info */}
                  <div className="flex items-start gap-3">
                    <button
                      type="button"
                      onClick={() => handleToggleSelect(item.id)}
                      className="mt-0.5 text-muted hover:text-primary transition shrink-0"
                      aria-label={isSelected ? "Deselect manifest" : "Select manifest"}
                    >
                      {isSelected ? (
                        <CheckSquare className="h-4 w-4 text-primary" />
                      ) : (
                        <Square className="h-4 w-4" />
                      )}
                    </button>

                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-sm text-foreground">
                          {item.displayName}
                        </span>
                        <Badge
                          tone={item.origin === "NEW" ? "success" : "warning"}
                          className="text-[10px] uppercase font-bold"
                        >
                          {item.origin}
                        </Badge>
                        <Badge tone="neutral" className="text-[10px]">
                          {item.category}
                        </Badge>
                      </div>

                      <div className="mt-1 flex items-center gap-4 text-xs text-muted flex-wrap">
                        <span className="font-mono text-[11px]">{item.originalFilename}</span>
                        <span>•</span>
                        <span>{formatCompactCount(item.recordCount)} records</span>
                        <span>•</span>
                        <span>{formatBytes(item.byteSize)}</span>
                        {item.exportedAt && (
                          <>
                            <span>•</span>
                            <span className="flex items-center gap-1">
                              <Clock className="h-3 w-3" />
                              {new Date(item.exportedAt).toLocaleDateString()}
                            </span>
                          </>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Right: Actions */}
                  <div className="flex items-center gap-2 shrink-0 self-end sm:self-center">
                    <button
                      type="button"
                      onClick={() => setInspectedItem(item)}
                      className="flex h-8 w-8 items-center justify-center rounded-lg text-muted hover:bg-surface-muted hover:text-foreground transition"
                      title="Inspect Metadata"
                      aria-label="Inspect Metadata"
                    >
                      <FileCode className="h-4 w-4" />
                    </button>

                    <Button
                      variant="secondary"
                      onClick={() => handleExportSelected([item.id])}
                      disabled={exporting}
                      className="h-8 gap-1.5 px-3 text-xs"
                      title="Download as JSON"
                    >
                      <Download className="h-3.5 w-3.5" />
                      <span>Download</span>
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      ) : (
        <Card className="flex flex-col items-center justify-center p-14 text-center">
          <Layers className="h-10 w-10 text-muted opacity-40 mb-3" />
          <h3 className="text-sm font-semibold text-foreground">No manifests found</h3>
          <p className="mt-1 text-xs text-muted max-w-sm">
            No active or archived manifests match your filter criteria. Try clearing search or selecting All Sources.
          </p>
        </Card>
      )}

      {/* Raw Metadata Inspector Modal */}
      {inspectedItem ? (
        <RawJsonInspectorDialog
          item={inspectedItem}
          open={Boolean(inspectedItem)}
          onClose={() => setInspectedItem(null)}
          title="Manifest Inventory Details"
        />
      ) : null}
    </div>
  );
}
