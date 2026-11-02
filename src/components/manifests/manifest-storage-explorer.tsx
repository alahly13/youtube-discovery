"use client";

import {
  Archive,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Database,
  Download,
  FileCode,
  HardDrive,
  Layers,
  Loader2,
  Package,
  RefreshCw,
  ShieldCheck,
  AlertTriangle,
  FolderTree,
} from "lucide-react";
import { startTransition, useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { formatBytes } from "@/lib/utils/format";

export interface StoragePartItem {
  id: string;
  partNumber: number;
  storagePath: string;
  byteCount: number;
  recordCount: number;
  sha256: string;
  status: string;
}

export interface StorageGenerationItem {
  id: string;
  generationNumber: number;
  state: string;
  totalBytes: number;
  aggregateSha256: string | null;
  parts: StoragePartItem[];
}

export interface StorageDatasetItem {
  id: string;
  datasetType: string;
  displayName: string;
  currentRevision: number;
  generations: StorageGenerationItem[];
}

export interface ReconciliationSummary {
  overallHealthy: boolean;
  totalScanned: number;
  counts: {
    VERIFIED: number;
    MISSING_FROM_STORAGE: number;
    UNTRACKED_ORPHAN: number;
    METADATA_MISMATCH: number;
    UNCOMMITTED_GENERATION: number;
    INCOMPLETE_PARTS: number;
  };
  items: Array<{
    storagePath: string;
    status: string;
    details: string;
  }>;
}

export function ManifestStorageExplorer() {
  const [loading, setLoading] = useState(false);
  const [reconciling, setReconciling] = useState(false);
  const [ownerInfo, setOwnerInfo] = useState<{ username: string; storageOwnerUuid: string } | null>(null);
  const [datasets, setDatasets] = useState<StorageDatasetItem[]>([]);
  const [expandedDatasets, setExpandedDatasets] = useState<Record<string, boolean>>({});
  const [expandedGenerations, setExpandedGenerations] = useState<Record<string, boolean>>({});
  const [reconciliation, setReconciliation] = useState<ReconciliationSummary | null>(null);
  const [showReconciliationView, setShowReconciliationView] = useState(false);

  async function loadTree() {
    setLoading(true);
    try {
      const res = await fetch("/api/manifests/tree");
      if (res.ok) {
        const data = await res.json();
        startTransition(() => {
          setOwnerInfo(data.owner);
          setDatasets(data.datasets || []);
          // Expand first dataset by default
          if (data.datasets && data.datasets.length > 0) {
            setExpandedDatasets({ [data.datasets[0].id]: true });
            if (data.datasets[0].generations && data.datasets[0].generations.length > 0) {
              setExpandedGenerations({ [data.datasets[0].generations[0].id]: true });
            }
          }
        });
      }
    } catch {
      // Handled gracefully
    } finally {
      startTransition(() => setLoading(false));
    }
  }

  async function runReconciliation() {
    setReconciling(true);
    try {
      const res = await fetch("/api/manifests/reconcile");
      if (res.ok) {
        const data = await res.json();
        startTransition(() => {
          setReconciliation(data);
          setShowReconciliationView(true);
        });
      }
    } catch {
      // Handled gracefully
    } finally {
      startTransition(() => setReconciling(false));
    }
  }

  /* eslint-disable react-hooks/set-state-in-effect -- Mount data fetch; state transitions wrapped in startTransition */
  useEffect(() => {
    loadTree();
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

  function toggleDataset(id: string) {
    setExpandedDatasets((prev) => ({ ...prev, [id]: !prev[id] }));
  }

  function toggleGeneration(id: string) {
    setExpandedGenerations((prev) => ({ ...prev, [id]: !prev[id] }));
  }

  function downloadPart(path: string) {
    window.location.href = `/api/manifests/download?path=${encodeURIComponent(path)}`;
  }

  function exportGenerationZip(datasetId: string, genId: string) {
    window.location.href = `/api/manifests/export?datasetId=${encodeURIComponent(datasetId)}&generationId=${encodeURIComponent(genId)}`;
  }

  return (
    <div className="space-y-6">
      {/* Partition & Actions Header */}
      <Card className="border-border/80 bg-surface/50 backdrop-blur-xs">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <Database className="h-6 w-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-semibold text-foreground">Storage Explorer & Reconciliation</h3>
                <Badge tone="primary">v1.4 Architecture</Badge>
              </div>
              <p className="mt-0.5 font-mono text-xs text-muted">
                Partition: <span className="text-foreground/80">{ownerInfo?.storageOwnerUuid || "Resolving..."}</span>
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="secondary"
              onClick={runReconciliation}
              disabled={reconciling}
              className="gap-2 h-9 px-3 text-xs"
            >
              {reconciling ? (
                <Loader2 className="h-4 w-4 animate-spin text-primary" />
              ) : (
                <ShieldCheck className="h-4 w-4 text-emerald-500" />
              )}
              Reconcile Scan
            </Button>
            <Button
              variant="secondary"
              onClick={loadTree}
              disabled={loading}
              className="gap-2 h-9 px-3 text-xs"
            >
              {loading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4" />
              )}
              Refresh
            </Button>
          </div>
        </div>

        {/* Reconciliation Status Bar */}
        {reconciliation && (
          <div className="mt-4 border-t border-border/60 pt-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-xs">
                {reconciliation.overallHealthy ? (
                  <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                ) : (
                  <AlertTriangle className="h-4 w-4 text-amber-500" />
                )}
                <span className="font-medium text-foreground">
                  {reconciliation.overallHealthy
                    ? "Storage Registry Fully Synchronized"
                    : "Reconciliation Discrepancies Detected"}
                </span>
                <span className="text-muted">({reconciliation.totalScanned} objects scanned)</span>
              </div>
              <button
                type="button"
                onClick={() => setShowReconciliationView(!showReconciliationView)}
                className="text-xs text-primary hover:underline"
              >
                {showReconciliationView ? "Hide Details" : "Show 6-State Audit"}
              </button>
            </div>

            {showReconciliationView && (
              <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-6 text-xs">
                <div className="rounded-lg border border-border/60 bg-surface-muted/40 p-2 text-center">
                  <div className="text-[10px] uppercase font-bold text-emerald-500">Verified</div>
                  <div className="mt-1 text-base font-bold text-foreground">{reconciliation.counts.VERIFIED}</div>
                </div>
                <div className="rounded-lg border border-border/60 bg-surface-muted/40 p-2 text-center">
                  <div className="text-[10px] uppercase font-bold text-rose-500">Missing</div>
                  <div className="mt-1 text-base font-bold text-foreground">{reconciliation.counts.MISSING_FROM_STORAGE}</div>
                </div>
                <div className="rounded-lg border border-border/60 bg-surface-muted/40 p-2 text-center">
                  <div className="text-[10px] uppercase font-bold text-amber-500">Orphans</div>
                  <div className="mt-1 text-base font-bold text-foreground">{reconciliation.counts.UNTRACKED_ORPHAN}</div>
                </div>
                <div className="rounded-lg border border-border/60 bg-surface-muted/40 p-2 text-center">
                  <div className="text-[10px] uppercase font-bold text-purple-500">Mismatch</div>
                  <div className="mt-1 text-base font-bold text-foreground">{reconciliation.counts.METADATA_MISMATCH}</div>
                </div>
                <div className="rounded-lg border border-border/60 bg-surface-muted/40 p-2 text-center">
                  <div className="text-[10px] uppercase font-bold text-blue-500">In-Flight</div>
                  <div className="mt-1 text-base font-bold text-foreground">{reconciliation.counts.UNCOMMITTED_GENERATION}</div>
                </div>
                <div className="rounded-lg border border-border/60 bg-surface-muted/40 p-2 text-center">
                  <div className="text-[10px] uppercase font-bold text-orange-500">Incomplete</div>
                  <div className="mt-1 text-base font-bold text-foreground">{reconciliation.counts.INCOMPLETE_PARTS}</div>
                </div>
              </div>
            )}
          </div>
        )}
      </Card>

      {/* Hierarchical Storage Tree View */}
      <div className="space-y-3">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted">
          <FolderTree className="h-4 w-4" />
          <span>Physical Storage Hierarchy</span>
        </div>

        {datasets.length === 0 && !loading && (
          <Card className="p-8 text-center text-sm text-muted">
            <HardDrive className="mx-auto h-8 w-8 text-muted/60 mb-2" />
            No committed storage datasets found. Execute a save from the Save Center or search library to persist a generation snapshot.
          </Card>
        )}

        {datasets.map((dataset) => {
          const isExpanded = !!expandedDatasets[dataset.id];
          return (
            <Card key={dataset.id} className="overflow-hidden border-border/70 p-0 transition">
              {/* Dataset Level Node */}
              <button
                type="button"
                onClick={() => toggleDataset(dataset.id)}
                className="flex w-full items-center justify-between bg-surface-muted/30 px-4 py-3 text-left transition hover:bg-surface-muted/60"
              >
                <div className="flex items-center gap-3">
                  {isExpanded ? (
                    <ChevronDown className="h-4 w-4 text-muted" />
                  ) : (
                    <ChevronRight className="h-4 w-4 text-muted" />
                  )}
                  <Layers className="h-4 w-4 text-primary" />
                  <div>
                    <span className="font-semibold text-foreground text-sm">{dataset.displayName}</span>
                    <span className="ml-2 font-mono text-[11px] text-muted">({dataset.datasetType})</span>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Badge tone="neutral">Rev {dataset.currentRevision}</Badge>
                  <span className="text-xs text-muted">
                    {dataset.generations.length} generation(s)
                  </span>
                </div>
              </button>

              {/* Generations Children */}
              {isExpanded && (
                <div className="divide-y divide-border/40 bg-surface/20 px-4 py-2">
                  {dataset.generations.length === 0 && (
                    <p className="py-3 text-xs text-muted italic pl-7">
                      No generations committed yet for this dataset.
                    </p>
                  )}
                  {dataset.generations.map((gen) => {
                    const isGenExpanded = !!expandedGenerations[gen.id];
                    return (
                      <div key={gen.id} className="py-2.5">
                        <div className="flex items-center justify-between pl-5">
                          <button
                            type="button"
                            onClick={() => toggleGeneration(gen.id)}
                            className="flex items-center gap-2 text-left"
                          >
                            {isGenExpanded ? (
                              <ChevronDown className="h-3.5 w-3.5 text-muted" />
                            ) : (
                              <ChevronRight className="h-3.5 w-3.5 text-muted" />
                            )}
                            <Archive className="h-4 w-4 text-amber-500" />
                            <span className="font-mono text-xs font-semibold text-foreground">
                              {gen.id}
                            </span>
                            <Badge tone={gen.state === "COMMITTED" ? "success" : "warning"}>
                              {gen.state}
                            </Badge>
                          </button>

                          <div className="flex items-center gap-3">
                            <span className="text-xs text-muted">
                              {formatBytes(gen.totalBytes)} · {gen.parts.length} part(s)
                            </span>
                            <Button
                              variant="ghost"
                              onClick={() => exportGenerationZip(dataset.id, gen.id)}
                              className="h-7 gap-1 px-2 text-xs"
                              title="Export generation as validated ZIP package"
                            >
                              <Package className="h-3.5 w-3.5 text-primary" />
                              Export ZIP
                            </Button>
                          </div>
                        </div>

                        {/* Parts Level */}
                        {isGenExpanded && (
                          <div className="mt-2 space-y-1.5 pl-12">
                            {gen.parts.map((part) => (
                              <div
                                key={part.id}
                                className="flex items-center justify-between rounded-md border border-border/40 bg-surface-muted/20 px-3 py-1.5 text-xs transition hover:bg-surface-muted/50"
                              >
                                <div className="flex items-center gap-2 min-w-0">
                                  <FileCode className="h-3.5 w-3.5 text-muted shrink-0" />
                                  <span className="font-mono text-foreground/90 font-medium truncate">
                                    part-{String(part.partNumber).padStart(6, "0")}.json
                                  </span>
                                  <span className="text-muted text-[11px] shrink-0">
                                    ({formatBytes(part.byteCount)}, {part.recordCount} items)
                                  </span>
                                  <span className="hidden lg:inline font-mono text-[10px] text-muted/70 truncate max-w-[140px]" title={part.sha256}>
                                    SHA: {part.sha256.slice(0, 10)}…
                                  </span>
                                </div>

                                <div className="flex items-center gap-2 shrink-0">
                                  <Badge tone="success">
                                    VERIFIED
                                  </Badge>
                                  <Button
                                    variant="ghost"
                                    onClick={() => downloadPart(part.storagePath)}
                                    className="h-6 w-6 p-0"
                                    title="Download raw immutable part JSON"
                                  >
                                    <Download className="h-3.5 w-3.5 text-foreground/70" />
                                  </Button>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </Card>
          );
        })}
      </div>
    </div>
  );
}
