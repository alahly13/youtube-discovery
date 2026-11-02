"use client";

import {
  AlertCircle,
  Archive,
  ArrowLeft,
  CheckCircle2,
  FileCode,
  Film,
  Flame,
  ListVideo,
  Loader2,
  Tv,
  UploadCloud,
} from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { RawJsonInspectorDialog } from "@/components/saved/raw-json-inspector-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { formatBytes, formatDate } from "@/lib/utils/format";
import type {
  ArchivedManifestEnvelope,
  FilterSummary,
  OldArchiveCategory,
} from "@/lib/old/archive-envelope";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * OLD Import & Preview Workspace
 * ──────────────────────────────────────────────────────────────────────────
 * Scope: Workstream B — Phase 1.5
 * Drag-and-drop legacy manifest importer with local preview before saving,
 * authentic timestamp preservation, zip bomb & path traversal verification,
 * and SHA-256 duplicate conflict detection.
 * ═══════════════════════════════════════════════════════════════════════════
 */

export function OldImportPreviewWorkspace() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const defaultCategory = (searchParams.get("category") as OldArchiveCategory) || "saved-items";

  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [duplicateWarning, setDuplicateWarning] = useState<{
    message: string;
    existingId: string;
  } | null>(null);

  // Preview results
  const [envelope, setEnvelope] = useState<ArchivedManifestEnvelope | null>(null);
  const [sampleItems, setSampleItems] = useState<Record<string, unknown>[]>([]);
  const [categoryOverride, setCategoryOverride] = useState<OldArchiveCategory>(defaultCategory);
  const [manifestIdOverride, setManifestIdOverride] = useState<string>("");
  const [inspectedRaw, setInspectedRaw] = useState<unknown>(null);
  const [importSuccess, setImportSuccess] = useState<string | null>(null);

  const handleFileSelect = async (file: File) => {
    setSelectedFile(file);
    setError(null);
    setDuplicateWarning(null);
    setImportSuccess(null);
    setPreviewing(true);

    try {
      const formData = new FormData();
      formData.append("file", file);
      if (categoryOverride) {
        formData.append("category", categoryOverride);
      }

      const res = await fetch("/api/old/preview", {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || `Failed to preview file (HTTP ${res.status}).`);
      }

      const data = await res.json();
      setEnvelope(data.rawEnvelope);
      setSampleItems((data.sampleItems as Record<string, unknown>[]) || []);
      setCategoryOverride(data.metadata.category);
      setManifestIdOverride(data.metadata.manifest_id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to process preview.");
      setEnvelope(null);
      setSampleItems([]);
    } finally {
      setPreviewing(false);
    }
  };

  const handleImport = async () => {
    if (!envelope) return;

    setImporting(true);
    setError(null);
    setDuplicateWarning(null);

    // Apply any user overrides
    const updatedEnvelope: ArchivedManifestEnvelope = {
      ...envelope,
      manifest_metadata: {
        ...envelope.manifest_metadata,
        manifest_id: manifestIdOverride.trim() || envelope.manifest_metadata.manifest_id,
        category: categoryOverride,
      },
    };

    try {
      const res = await fetch("/api/old/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ envelope: updatedEnvelope }),
      });

      const data = await res.json();

      if (!res.ok) {
        if (data.code === "DUPLICATE_ARCHIVE") {
          setDuplicateWarning({
            message: data.error,
            existingId: data.existingId,
          });
          return;
        }
        throw new Error(data.error || `Failed to import manifest (HTTP ${res.status}).`);
      }

      setImportSuccess(
        `Successfully imported "${updatedEnvelope.manifest_metadata.manifest_id}" into category "${categoryOverride}".`
      );

      // Redirect to the appropriate category after 1.5 seconds
      setTimeout(() => {
        if (categoryOverride === "saved-items") {
          router.push("/old/saved-items");
        } else {
          router.push(`/old/${categoryOverride}`);
        }
      }, 1500);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to import manifest.");
    } finally {
      setImporting(false);
    }
  };

  const metadata = envelope?.manifest_metadata;
  const filterSummary: FilterSummary | undefined = metadata?.filter_summary;

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <div>
        <Link
          href="/old"
          className="flex items-center gap-1 text-xs font-medium text-muted hover:text-foreground transition mb-2"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          <span>Back to OLD Archive Dashboard</span>
        </Link>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">
          Import Legacy Manifest
        </h1>
        <p className="mt-1 text-xs text-muted max-w-2xl">
          Upload and validate JSON manifests, generation ZIP archives, or NDJSON exports.
          You can inspect the contents before importing into the isolated <code className="font-mono text-primary text-[11px]">ASDY/OLD/</code> root.
        </p>
      </div>

      {/* Upload Zone */}
      <Card className="p-8 border-dashed border-2 border-border/80 hover:border-primary/50 transition text-center bg-surface-muted/20">
        <input
          type="file"
          id="archive-file-input"
          accept=".json,.zip,.ndjson,.jsonl"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void handleFileSelect(file);
          }}
          className="hidden"
        />
        <label
          htmlFor="archive-file-input"
          className="flex flex-col items-center justify-center cursor-pointer space-y-3"
        >
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            <UploadCloud className="h-6 w-6" />
          </div>
          <div>
            <span className="text-sm font-semibold text-foreground hover:text-primary">
              Click to select a file
            </span>{" "}
            <span className="text-xs text-muted">or drag and drop</span>
          </div>
          <p className="text-[11px] text-muted">
            Supports .json (manifest / export), .zip (generation backup), .ndjson, .jsonl (up to 200MB)
          </p>
        </label>
      </Card>

      {/* Loading Indicator */}
      {previewing && (
        <Card className="flex items-center justify-center p-8 text-center space-x-3">
          <Loader2 className="h-5 w-5 text-primary animate-spin" />
          <span className="text-xs text-muted">Inspecting and analyzing archive structure...</span>
        </Card>
      )}

      {/* Error Card */}
      {error && (
        <Card className="p-4 border-danger/30 bg-danger/5 text-xs text-danger flex items-start gap-2.5">
          <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold">Import Error</p>
            <p className="mt-0.5 text-danger/90">{error}</p>
          </div>
        </Card>
      )}

      {/* Duplicate Conflict Warning */}
      {duplicateWarning && (
        <Card className="p-5 border-amber-500/30 bg-amber-500/10 text-xs text-amber-500 space-y-2">
          <div className="flex items-center gap-2">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <h4 className="font-bold">Duplicate Manifest Detected</h4>
          </div>
          <p className="text-foreground text-xs leading-relaxed">
            {duplicateWarning.message}
          </p>
          <div className="pt-2 flex items-center gap-2">
            <Link
              href={`/old/saved-items`}
              className="inline-flex h-8 items-center rounded-lg bg-surface px-3 text-xs font-semibold text-foreground border border-border hover:bg-surface-muted transition"
            >
              Browse Existing Archive
            </Link>
          </div>
        </Card>
      )}

      {/* Success Notification */}
      {importSuccess && (
        <Card className="p-5 border-emerald-500/30 bg-emerald-500/10 text-xs text-emerald-500 flex items-center gap-3">
          <CheckCircle2 className="h-5 w-5 shrink-0" />
          <div>
            <h4 className="font-bold">Import Complete!</h4>
            <p className="text-foreground text-xs mt-0.5">{importSuccess}</p>
            <p className="text-[11px] text-muted mt-1">Redirecting to archive explorer...</p>
          </div>
        </Card>
      )}

      {/* Preview Section */}
      {envelope && metadata && (
        <div className="space-y-6">
          <Card className="p-6 space-y-6">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between border-b border-border/80 pb-4">
              <div>
                <h3 className="text-base font-bold text-foreground">Archive Validation Preview</h3>
                <p className="text-xs text-muted">
                  File: <code className="font-mono text-foreground font-semibold">{selectedFile?.name}</code> (
                  {formatBytes(metadata.byte_count)})
                </p>
              </div>

              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => setInspectedRaw(envelope)}
                  className="h-8.5 gap-1.5 px-3 text-xs"
                >
                  <FileCode className="h-3.5 w-3.5" />
                  <span>Inspect Envelope JSON</span>
                </Button>
                <Button
                  type="button"
                  variant="primary"
                  onClick={handleImport}
                  disabled={importing || Boolean(importSuccess)}
                  className="h-8.5 gap-1.5 px-4 text-xs font-semibold"
                >
                  {importing ? (
                    <>
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      <span>Importing to ASDY/OLD/...</span>
                    </>
                  ) : (
                    <>
                      <Archive className="h-3.5 w-3.5" />
                      <span>Confirm & Import to ASDY/OLD/</span>
                    </>
                  )}
                </Button>
              </div>
            </div>

            {/* Editable Configuration & Summary Grid */}
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 text-xs">
              <div>
                <label className="block text-[11px] font-semibold uppercase text-muted mb-1">
                  Manifest ID
                </label>
                <input
                  type="text"
                  value={manifestIdOverride}
                  onChange={(e) => setManifestIdOverride(e.target.value)}
                  className="h-8.5 w-full rounded-lg border border-border bg-surface px-3 font-mono text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-[var(--ring)]"
                />
              </div>

              <div>
                <label className="block text-[11px] font-semibold uppercase text-muted mb-1">
                  Target Category
                </label>
                <select
                  value={categoryOverride}
                  onChange={(e) => setCategoryOverride(e.target.value as OldArchiveCategory)}
                  className="h-8.5 w-full rounded-lg border border-border bg-surface px-3 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-[var(--ring)]"
                >
                  <option value="saved-items">Saved Items</option>
                  <option value="saved-titles">Saved Search Titles</option>
                  <option value="saved-playlists">Saved Playlists</option>
                  <option value="search-history">Search History</option>
                  <option value="other">Other Metadata</option>
                </select>
              </div>

              <div>
                <span className="block text-[11px] font-semibold uppercase text-muted mb-1">
                  Detected Format
                </span>
                <span className="inline-block font-mono text-xs text-foreground pt-1.5">
                  {metadata.source_format}
                </span>
              </div>

              <div>
                <span className="block text-[11px] font-semibold uppercase text-muted mb-1">
                  Total Records
                </span>
                <span className="inline-block text-xs font-bold text-foreground pt-1.5">
                  {metadata.record_count.toLocaleString()} items
                </span>
              </div>
            </div>

            {/* Preserved Timestamps (Authentic Historical Dates) */}
            <div className="rounded-xl border border-border/80 bg-surface-muted/40 p-4 space-y-2 text-xs">
              <h4 className="font-semibold text-foreground text-xs flex items-center gap-2">
                <span>Preserved Historical Provenance</span>
                <Badge tone="success" className="text-[10px]">No Fabricated Timestamps</Badge>
              </h4>
              <div className="grid gap-2 sm:grid-cols-3 text-muted">
                <div>
                  <span className="block text-[10px] uppercase font-semibold text-muted/70">
                    Source Created At:
                  </span>
                  <span className="font-mono text-foreground">
                    {metadata.source_created_at ? formatDate(metadata.source_created_at) : "None (authentic)"}
                  </span>
                </div>
                <div>
                  <span className="block text-[10px] uppercase font-semibold text-muted/70">
                    Source Exported At:
                  </span>
                  <span className="font-mono text-foreground">
                    {metadata.source_exported_at ? formatDate(metadata.source_exported_at) : "None (authentic)"}
                  </span>
                </div>
                <div>
                  <span className="block text-[10px] uppercase font-semibold text-muted/70">
                    Content SHA-256:
                  </span>
                  <span className="font-mono text-[11px] text-foreground truncate block" title={metadata.content_sha256}>
                    {metadata.content_sha256}
                  </span>
                </div>
              </div>
            </div>

            {/* Filter Breakdown (if category === 'saved-items') */}
            {filterSummary && (
              <div className="space-y-2">
                <h4 className="text-xs font-semibold text-muted uppercase tracking-wider">
                  4-Filter Content Classification
                </h4>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-5 text-xs">
                  <div className="rounded-lg border border-border/70 p-3 bg-surface">
                    <div className="flex items-center gap-1.5 text-muted">
                      <Film className="h-3.5 w-3.5 text-primary" />
                      <span>Videos</span>
                    </div>
                    <p className="mt-1 text-lg font-bold text-foreground">
                      {filterSummary.total_videos}
                    </p>
                  </div>
                  <div className="rounded-lg border border-border/70 p-3 bg-surface">
                    <div className="flex items-center gap-1.5 text-muted">
                      <Flame className="h-3.5 w-3.5 text-red-500" />
                      <span>Shorts</span>
                    </div>
                    <p className="mt-1 text-lg font-bold text-foreground">
                      {filterSummary.total_shorts}
                    </p>
                  </div>
                  <div className="rounded-lg border border-border/70 p-3 bg-surface">
                    <div className="flex items-center gap-1.5 text-muted">
                      <Tv className="h-3.5 w-3.5 text-emerald-500" />
                      <span>Channels</span>
                    </div>
                    <p className="mt-1 text-lg font-bold text-foreground">
                      {filterSummary.total_channels}
                    </p>
                  </div>
                  <div className="rounded-lg border border-border/70 p-3 bg-surface">
                    <div className="flex items-center gap-1.5 text-muted">
                      <ListVideo className="h-3.5 w-3.5 text-indigo-500" />
                      <span>Playlists</span>
                    </div>
                    <p className="mt-1 text-lg font-bold text-foreground">
                      {filterSummary.total_playlists}
                    </p>
                  </div>
                  <div className="rounded-lg border border-border/70 p-3 bg-surface">
                    <div className="flex items-center gap-1.5 text-muted">
                      <span>Other</span>
                    </div>
                    <p className="mt-1 text-lg font-bold text-muted">
                      {filterSummary.total_unknown}
                    </p>
                  </div>
                </div>
              </div>
            )}
          </Card>

          {/* Sample Items Table */}
          {sampleItems.length > 0 && (
            <Card className="overflow-hidden">
              <div className="border-b border-border px-5 py-3 bg-surface-muted/50 flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wider text-muted">
                  Sample Content Preview (Showing {sampleItems.length} of {metadata.record_count})
                </span>
                <span className="text-[11px] text-muted">Read-Only Preview</span>
              </div>
              <div className="divide-y divide-border/60 max-h-96 overflow-y-auto">
                {sampleItems.map((item, idx) => {
                  const title =
                    typeof item === "string"
                      ? item
                      : String(item.title || item.query_text || `Item #${idx + 1}`);
                  const channel =
                    typeof item === "object" && item !== null && "channelTitle" in item && item.channelTitle
                      ? String(item.channelTitle)
                      : null;

                  return (
                    <div key={idx} className="p-3.5 flex items-center justify-between text-xs hover:bg-surface-muted/20">
                      <div className="truncate pr-4">
                        <span className="font-semibold text-foreground">
                          {title}
                        </span>
                        {channel && (
                          <span className="text-muted text-[11px] ml-2">by {channel}</span>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={() => setInspectedRaw(item)}
                        className="shrink-0 text-muted hover:text-foreground p-1"
                        title="Inspect Item JSON"
                      >
                        <FileCode className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  );
                })}
              </div>
            </Card>
          )}
        </div>
      )}

      {/* Raw JSON Modal */}
      {inspectedRaw ? (
        <RawJsonInspectorDialog
          item={inspectedRaw}
          open={Boolean(inspectedRaw)}
          onClose={() => setInspectedRaw(null)}
          title="Archive Preview Metadata"
        />
      ) : null}
    </div>
  );
}
