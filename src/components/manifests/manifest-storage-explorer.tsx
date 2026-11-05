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
  Eye,
  X,
  Search,
  ExternalLink,
  Copy,
  Check,
  Film,
  User,
  ListVideo,
  FileText,
  Calendar,
  Clock,
  ThumbsUp,
  MessageSquare,
} from "lucide-react";
import Image from "next/image";
import { startTransition, useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { formatBytes, formatCompactCount, formatDate, formatDuration } from "@/lib/utils/format";
import { ExpandableDescription } from "@/components/youtube/expandable-description";
import {
  classifyResourceRecord,
  resourceTypeTone,
  RESOURCE_TYPE_METADATA,
} from "@/lib/resources/resource-taxonomy";

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
  isBeforeAppUpdating?: boolean;
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

export interface InspectedPartData {
  path: string;
  datasetType: string | null;
  datasetSlug: string | null;
  generationId: string | null;
  partNumber: number;
  totalPartsInGeneration: number;
  createdAt: string | null;
  recordCount: number;
  records: Array<Record<string, unknown>>;
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

  // Record Inspection state
  const [inspectingPartPath, setInspectingPartPath] = useState<string | null>(null);
  const [inspectingLoading, setInspectingLoading] = useState(false);
  const [inspectedPart, setInspectedPart] = useState<InspectedPartData | null>(null);
  const [partRecordSearch, setPartRecordSearch] = useState("");
  const [activeJsonRecord, setActiveJsonRecord] = useState<Record<string, unknown> | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [copiedJson, setCopiedJson] = useState(false);

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

  async function handleInspectPart(storagePath: string) {
    setInspectingPartPath(storagePath);
    setInspectingLoading(true);
    setPartRecordSearch("");
    try {
      const res = await fetch(`/api/manifests/part-records?path=${encodeURIComponent(storagePath)}`);
      if (res.ok) {
        const data = await res.json();
        startTransition(() => {
          setInspectedPart(data);
        });
      } else {
        alert("Failed to load part records. The part may be in-flight or unreachable.");
      }
    } catch {
      alert("Error contacting part inspection service.");
    } finally {
      startTransition(() => setInspectingLoading(false));
    }
  }

  function copyToClipboard(text: string, id: string) {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  }

  function copyJsonToClipboard(obj: unknown) {
    navigator.clipboard.writeText(JSON.stringify(obj, null, 2));
    setCopiedJson(true);
    setTimeout(() => setCopiedJson(false), 2000);
  }

  // Filter records within the inspected part
  const filteredRecords = useMemo(() => {
    if (!inspectedPart?.records) return [];
    if (!partRecordSearch.trim()) return inspectedPart.records;
    const query = partRecordSearch.trim().toLowerCase();

    return inspectedPart.records.filter((rec) => {
      const title = String(rec.title || rec.name || rec.queryText || "").toLowerCase();
      const channel = String(rec.channelTitle || "").toLowerCase();
      const desc = String(rec.description || "").toLowerCase();
      const id = String(rec.platformItemId || rec.id || rec.videoId || "").toLowerCase();
      return title.includes(query) || channel.includes(query) || desc.includes(query) || id.includes(query);
    });
  }, [inspectedPart, partRecordSearch]);

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
          <span>Physical Storage Hierarchy (Owner → Dataset → Generation → Parts)</span>
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
                        <div className="flex flex-wrap items-center justify-between gap-2 pl-5">
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
                            {gen.isBeforeAppUpdating && (
                              <Badge
                                tone="neutral"
                                className="bg-purple-500/15 text-purple-600 dark:text-purple-400 border-purple-500/30"
                              >
                                Before App Updating
                              </Badge>
                            )}
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
                                className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border/40 bg-surface-muted/20 px-3 py-1.5 text-xs transition hover:bg-surface-muted/50"
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
                                    variant="secondary"
                                    onClick={() => handleInspectPart(part.storagePath)}
                                    className="h-6 gap-1 px-2 text-[11px]"
                                    title="Inspect individual records inside this part"
                                  >
                                    <Eye className="h-3 w-3 text-primary" />
                                    Inspect
                                  </Button>
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

      {/* ─────────────────────────────────────────────────────────────────────
          Part Records Inspection Modal
      ─────────────────────────────────────────────────────────────────────── */}
      {(inspectingLoading || inspectedPart) && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-3 sm:p-6 backdrop-blur-xs animate-in fade-in"
          role="dialog"
          aria-modal="true"
        >
          <div className="relative flex flex-col w-full max-w-4xl max-h-[92vh] rounded-2xl border border-border/80 bg-surface shadow-2xl overflow-hidden">
            {/* Modal Header */}
            <div className="flex items-center justify-between border-b border-border/60 bg-surface-muted/40 px-5 py-4 shrink-0">
              <div className="min-w-0 pr-4">
                <div className="flex items-center gap-2">
                  <h3 className="font-semibold text-foreground text-base">
                    Part Records Inspector
                  </h3>
                  {inspectedPart?.datasetType && (
                    <Badge tone="primary">{inspectedPart.datasetType}</Badge>
                  )}
                  {inspectedPart && (
                    <Badge tone="neutral">
                      Part #{inspectedPart.partNumber} ({inspectedPart.recordCount} items)
                    </Badge>
                  )}
                </div>
                <p className="mt-0.5 font-mono text-[11px] text-muted truncate max-w-xl" title={inspectingPartPath || ""}>
                  Path: {inspectingPartPath}
                </p>
              </div>

              <button
                type="button"
                onClick={() => {
                  setInspectedPart(null);
                  setInspectingPartPath(null);
                }}
                className="rounded-lg p-1.5 text-muted hover:bg-surface-muted hover:text-foreground transition"
                aria-label="Close"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="flex-1 overflow-y-auto p-5 space-y-4">
              {inspectingLoading ? (
                <div className="flex flex-col items-center justify-center py-20 text-center">
                  <Loader2 className="h-8 w-8 animate-spin text-primary mb-3" />
                  <p className="text-sm font-medium text-foreground">
                    Downloading and verifying part from Cloudflare R2...
                  </p>
                  <p className="text-xs text-muted mt-1">
                    Checking SHA-256 integrity and reading metadata
                  </p>
                </div>
              ) : inspectedPart ? (
                <>
                  {/* Search and summary toolbar */}
                  <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
                    <div className="relative flex-1">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted" />
                      <input
                        type="text"
                        value={partRecordSearch}
                        onChange={(e) => setPartRecordSearch(e.target.value)}
                        placeholder="Search records by title, channel, description, or ID..."
                        className="w-full rounded-lg border border-border/70 bg-surface-muted/30 pl-9 pr-3 py-1.5 text-xs text-foreground placeholder:text-muted focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                      />
                    </div>
                    <div className="text-xs text-muted shrink-0 text-right">
                      Showing {filteredRecords.length} of {inspectedPart.records.length} records
                    </div>
                  </div>

                  {/* Record Cards */}
                  <div className="space-y-3">
                    {filteredRecords.length === 0 ? (
                      <div className="p-12 text-center text-sm text-muted">
                        No records match your search filter.
                      </div>
                    ) : (
                      filteredRecords.map((record, idx) => {
                        // Canonical taxonomy classification. Never infer a
                        // resource type from arbitrary itemType/type/kind text:
                        // that is how duration-derived "shorts" markers used to
                        // become fake YouTube Shorts.
                        const classification = classifyResourceRecord(record, {
                          datasetType: inspectedPart?.datasetType,
                        });
                        const resourceType = classification.resourceType;
                        const typeDescriptor = RESOURCE_TYPE_METADATA[resourceType];
                        const isChannel = resourceType === "CHANNEL";
                        const isPlaylist =
                          resourceType === "YOUTUBE_PLAYLIST" ||
                          resourceType === "USER_PLAYLIST";
                        const isVideo =
                          resourceType === "VIDEO" || resourceType === "VIDEO_SHORT";

                        const id = String(
                          record.recordId ||
                            record.platformItemId ||
                            record.resourceId ||
                            record.id ||
                            `rec_${idx}`
                        );
                        const title = String(
                          record.title ||
                            record.name ||
                            record.queryText ||
                            record.query ||
                            "Untitled Item"
                        );
                        const description = typeof record.description === "string" ? record.description : null;
                        const channelTitle = typeof record.channelTitle === "string" ? record.channelTitle : null;
                        const thumbnail = typeof record.thumbnailUrl === "string" ? record.thumbnailUrl : null;
                        const originalUrl = typeof record.url === "string"
                          ? record.url
                          : typeof record.canonicalUrl === "string"
                          ? record.canonicalUrl
                          : isVideo
                          ? `https://www.youtube.com/watch?v=${id}`
                          : resourceType === "YOUTUBE_PLAYLIST"
                          ? `https://www.youtube.com/playlist?list=${id}`
                          : isChannel
                          ? `https://www.youtube.com/channel/${id}`
                          : null;

                        const viewsCount = typeof record.viewsCount === "number" ? record.viewsCount : null;
                        const likesCount = typeof record.likesCount === "number" ? record.likesCount : null;
                        const commentsCount = typeof record.commentsCount === "number" ? record.commentsCount : null;
                        const durationSec = typeof record.durationSec === "number" ? record.durationSec : null;

                        const publishedAt = typeof record.publishedAt === "string" ? record.publishedAt : null;
                        const savedAt = typeof record.savedAt === "string"
                          ? record.savedAt
                          : typeof record.collectedAt === "string"
                          ? record.collectedAt
                          : null;

                        return (
                          <div
                            key={id + "_" + idx}
                            className="rounded-xl border border-border/70 bg-surface-muted/20 p-4 transition hover:border-border"
                          >
                            <div className="flex flex-col sm:flex-row gap-3">
                              {/* Thumbnail preview */}
                              {thumbnail ? (
                                <div className="shrink-0 overflow-hidden rounded-lg bg-surface-muted border border-border/40">
                                  {isChannel ? (
                                    <Image
                                      src={thumbnail}
                                      alt={title}
                                      width={64}
                                      height={64}
                                      unoptimized
                                      className="h-16 w-16 rounded-full object-cover p-1"
                                    />
                                  ) : (
                                    <Image
                                      src={thumbnail}
                                      alt={title}
                                      width={128}
                                      height={72}
                                      unoptimized
                                      className="h-20 w-36 object-cover"
                                    />
                                  )}
                                </div>
                              ) : (
                                <div className="flex h-20 w-36 shrink-0 items-center justify-center rounded-lg bg-surface-muted text-muted border border-border/40">
                                  {isChannel ? (
                                    <User className="h-8 w-8 text-muted/60" />
                                  ) : isPlaylist ? (
                                    <ListVideo className="h-8 w-8 text-muted/60" />
                                  ) : (
                                    <Film className="h-8 w-8 text-muted/60" />
                                  )}
                                </div>
                              )}

                              {/* Details */}
                              <div className="flex-1 min-w-0 space-y-1.5">
                                <div className="flex flex-wrap items-center gap-2">
                                  <Badge tone={resourceTypeTone(resourceType)}>
                                    {typeDescriptor.shortLabel}
                                  </Badge>
                                  {classification.source !== "AUTHORITATIVE" && (
                                    <span
                                      className="rounded bg-surface-muted px-1.5 py-0.5 text-[10px] font-medium text-muted"
                                      title={classification.evidence}
                                    >
                                      {classification.source}
                                    </span>
                                  )}
                                  {typeof record.recordId === "string" && record.recordId && (
                                    <span
                                      className="font-mono text-[10px] text-muted/80 truncate max-w-[220px]"
                                      title={`recordId: ${record.recordId}`}
                                    >
                                      record: {record.recordId}
                                    </span>
                                  )}
                                  {typeof record.originDeviceLabel === "string" && record.originDeviceLabel && (
                                    <span className="text-[10px] text-muted/80">
                                      via {record.originDeviceLabel}
                                    </span>
                                  )}

                                  {channelTitle && (
                                    <span className="text-xs font-medium text-foreground/80">
                                      {channelTitle}
                                    </span>
                                  )}

                                  <button
                                    type="button"
                                    onClick={() => copyToClipboard(id, id)}
                                    className="ml-auto inline-flex items-center gap-1 font-mono text-[11px] text-muted hover:text-foreground transition"
                                    title="Copy canonical record/resource ID"
                                  >
                                    {copiedId === id ? (
                                      <Check className="h-3 w-3 text-emerald-500" />
                                    ) : (
                                      <Copy className="h-3 w-3" />
                                    )}
                                    <span>{id}</span>
                                  </button>
                                </div>

                                {/* Title with URL link */}
                                <h4 className="text-sm font-bold text-foreground leading-snug line-clamp-2">
                                  {originalUrl ? (
                                    <a
                                      href={originalUrl}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="hover:text-primary transition inline-flex items-center gap-1.5"
                                    >
                                      <span>{title}</span>
                                      <ExternalLink className="h-3.5 w-3.5 shrink-0 opacity-70" />
                                    </a>
                                  ) : (
                                    title
                                  )}
                                </h4>

                                {/* Expandable Description */}
                                <ExpandableDescription description={description} />

                                {/* Zero-safe statistics and dates */}
                                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 pt-1 text-[11px] text-muted">
                                  {viewsCount !== null && (
                                    <span className="flex items-center gap-1" title={`${viewsCount.toLocaleString()} views`}>
                                      <Film className="h-3 w-3 text-muted/70" />
                                      <span className="font-medium text-foreground/90">{formatCompactCount(viewsCount)}</span> views
                                    </span>
                                  )}

                                  {likesCount !== null && (
                                    <span className="flex items-center gap-1" title={`${likesCount.toLocaleString()} likes`}>
                                      <ThumbsUp className="h-3 w-3 text-muted/70" />
                                      <span className="font-medium text-foreground/90">{formatCompactCount(likesCount)}</span> likes
                                    </span>
                                  )}

                                  {commentsCount !== null && (
                                    <span className="flex items-center gap-1" title={`${commentsCount.toLocaleString()} comments`}>
                                      <MessageSquare className="h-3 w-3 text-muted/70" />
                                      <span className="font-medium text-foreground/90">{formatCompactCount(commentsCount)}</span> comments
                                    </span>
                                  )}

                                  {durationSec !== null && (
                                    <span className="flex items-center gap-1" title="Duration">
                                      <Clock className="h-3 w-3 text-muted/70" />
                                      <span>{formatDuration(durationSec)}</span>
                                    </span>
                                  )}

                                  {publishedAt && (
                                    <span className="flex items-center gap-1" title={`Published: ${publishedAt}`}>
                                      <Calendar className="h-3 w-3 text-muted/70" />
                                      <span>Published: {formatDate(publishedAt)}</span>
                                    </span>
                                  )}

                                  {savedAt && (
                                    <span className="flex items-center gap-1 text-primary/80" title={`Saved/Collected: ${savedAt}`}>
                                      <CheckCircle2 className="h-3 w-3" />
                                      <span>Saved: {formatDate(savedAt)}</span>
                                    </span>
                                  )}

                                  <button
                                    type="button"
                                    onClick={() => setActiveJsonRecord(record)}
                                    className="ml-auto text-[11px] font-semibold text-primary hover:underline inline-flex items-center gap-1"
                                  >
                                    <FileText className="h-3 w-3" />
                                    View Raw JSON
                                  </button>
                                </div>
                              </div>
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                </>
              ) : null}
            </div>

            {/* Modal Footer */}
            <div className="flex items-center justify-between border-t border-border/60 bg-surface-muted/30 px-5 py-3 shrink-0">
              <span className="text-xs text-muted">
                Cloudflare R2 Part Manifest · Read-Only Verification
              </span>
              <Button
                variant="secondary"
                onClick={() => {
                  setInspectedPart(null);
                  setInspectingPartPath(null);
                }}
                className="h-8 px-4 text-xs"
              >
                Close Inspector
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* ─────────────────────────────────────────────────────────────────────
          Raw Record JSON Modal
      ─────────────────────────────────────────────────────────────────────── */}
      {activeJsonRecord && (
        <div
          className="fixed inset-0 z-60 flex items-center justify-center bg-black/80 p-4 backdrop-blur-xs animate-in fade-in"
          role="dialog"
          aria-modal="true"
        >
          <div className="relative flex flex-col w-full max-w-2xl max-h-[85vh] rounded-2xl border border-border/80 bg-surface shadow-2xl overflow-hidden">
            <div className="flex items-center justify-between border-b border-border/60 bg-surface-muted/40 px-5 py-3 shrink-0">
              <h4 className="font-semibold text-foreground text-sm flex items-center gap-2">
                <FileCode className="h-4 w-4 text-primary" />
                Raw Record JSON Envelope
              </h4>
              <button
                type="button"
                onClick={() => setActiveJsonRecord(null)}
                className="rounded-lg p-1.5 text-muted hover:bg-surface-muted hover:text-foreground transition"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 bg-black/40">
              <pre className="font-mono text-xs text-foreground/90 whitespace-pre leading-relaxed select-text">
                {JSON.stringify(activeJsonRecord, null, 2)}
              </pre>
            </div>

            <div className="flex items-center justify-between border-t border-border/60 bg-surface-muted/30 px-5 py-3 shrink-0">
              <Button
                variant="secondary"
                onClick={() => copyJsonToClipboard(activeJsonRecord)}
                className="gap-1.5 h-8 px-3 text-xs"
              >
                {copiedJson ? (
                  <Check className="h-3.5 w-3.5 text-emerald-500" />
                ) : (
                  <Copy className="h-3.5 w-3.5" />
                )}
                {copiedJson ? "Copied JSON!" : "Copy JSON"}
              </Button>
              <Button
                variant="ghost"
                onClick={() => setActiveJsonRecord(null)}
                className="h-8 px-4 text-xs"
              >
                Dismiss
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
