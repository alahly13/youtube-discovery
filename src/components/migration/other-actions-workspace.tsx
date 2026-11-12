"use client";

import {
  AlertCircle,
  Archive,
  ArrowRight,
  CheckCircle2,
  Clock,
  Database,
  Download,
  ExternalLink,
  Eye,
  FileCode,
  FileText,
  Film,
  HardDrive,
  Layers,
  ListVideo,
  Loader2,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
  ThumbsUp,
  Tv,
  Upload,
  User,
  X,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { startTransition, useId, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { formatBytes, formatCompactCount, formatDate, formatDuration } from "@/lib/utils/format";
import { ExpandableDescription } from "@/components/youtube/expandable-description";
import { syncCoordinator } from "@/lib/sync/sync-coordinator";
import { saveLegacyStagingBatch } from "@/lib/storage/indexeddb-store";
import {
  scanBrowserAllLegacySources,
  parseLegacyBackupJson,
  normalizeLegacyData,
  prepareLegacyMigrationPlan,
  type LegacyScanSummary,
  type PreparedMigrationPlan,
  type NormalizedLegacyItem,
} from "@/lib/migration/legacy-migration-service";

export function OtherActionsWorkspace() {
  const [scanning, setScanning] = useState(false);
  const [loadingSample, setLoadingSample] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [scanSummary, setScanSummary] = useState<LegacyScanSummary | null>(null);
  const [migrationReceipt, setMigrationReceipt] = useState<{
    ok: boolean;
    planId: string;
    totalUploadedGenerations: number;
    totalUploadedRecords: number;
    totalUploadedBytes: number;
    uploadedGenerations: Array<{
      datasetType: string;
      generationId: string;
      manifestPath: string;
      partsCount: number;
      totalBytes: number;
      aggregateSha256: string;
    }>;
  } | null>(null);
  const [activeTab, setActiveTab] = useState<"SAVED_ITEMS" | "PLAYLIST" | "SEARCH_HISTORY" | "REFERENCES" | "RESEARCH_QUEUE">("SAVED_ITEMS");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [previewQuery, setPreviewQuery] = useState("");

  const fileInputId = useId();

  // Scan local storage + IndexedDB read-only (never deletes originals).
  // Always resolves authoritative `storageOwnerUuid` from `/api/auth/status` first
  // so legacy migration paths match server-enforced R2 owner prefixes.
  async function resolveCanonicalOwner(): Promise<string> {
    try {
      const res = await fetch("/api/auth/status", { headers: { "Cache-Control": "no-cache" } });
      if (res.ok) {
        const data = await res.json();
        if (data?.authenticated === false) {
          throw new Error("Sign in to resolve your canonical owner ID before migrating data.");
        }
        const canonical = String(data?.storageOwnerUuid || data?.userId || "").trim();
        if (canonical) {
          syncCoordinator.setOwnerId(canonical);
          return canonical;
        }
      }
    } catch (err) {
      if (err instanceof Error && err.message.startsWith("Sign in")) {
        throw err;
      }
    }
    const existing = syncCoordinator.getOwnerId()?.trim();
    if (existing && existing !== "asdy-admin") return existing;
    throw new Error("Sign in to resolve your canonical owner ID before migrating data.");
  }

  async function stageNormalizedSummaryLocally(ownerId: string, summary: LegacyScanSummary) {
    const datasetTypes = ["SAVED_ITEMS", "PLAYLIST", "SEARCH_HISTORY", "REFERENCES", "RESEARCH_QUEUE"] as const;
    for (const dt of datasetTypes) {
      const ds = summary.datasets[dt];
      if (!ds || ds.items.length === 0) continue;
      await saveLegacyStagingBatch({
        stagingId: `stage_${ownerId}_${dt}`,
        ownerId,
        datasetType: dt,
        sourceKind: "localstorage",
        sourceName: summary.scannedSources.join(", ") || "browser",
        itemCount: ds.count,
        duplicateCount: ds.duplicatesCount,
        errorCount: summary.totalUnrecognized,
        stagedAt: new Date().toISOString(),
        status: "STAGED_LOCAL",
        items: ds.items as Record<string, unknown>[],
      }).catch(() => {});
    }
  }

  async function handleScanLocalStorage() {
    setScanning(true);
    setErrorMsg(null);
    setMigrationReceipt(null);
    try {
      const ownerId = syncCoordinator.getOwnerId()?.trim() || undefined;
      const sourceMap = await scanBrowserAllLegacySources(ownerId);
      const summary = normalizeLegacyData(sourceMap);
      if (ownerId && summary.totalNormalized > 0) {
        await stageNormalizedSummaryLocally(ownerId, summary);
      }
      startTransition(() => {
        setScanSummary(summary);
      });
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Failed to scan local storage");
    } finally {
      startTransition(() => setScanning(false));
    }
  }

  // Load sample authentic files from public/manifest-example/
  async function handleLoadSampleFiles() {
    setLoadingSample(true);
    setErrorMsg(null);
    setMigrationReceipt(null);
    try {
      const sourceMap: Record<string, unknown> = {};

      const files = [
        { key: "Saved-Items/saved-items.json", path: "/manifest-example/Saved-Items/saved-items.json" },
        { key: "Playlists/youtube-discovery-user-playlists.json", path: "/manifest-example/Playlists/youtube-discovery-user-playlists.json" },
        { key: "References/saved-searches.json", path: "/manifest-example/References/saved-searches.json" },
        { key: "Search-History/search-history.json", path: "/manifest-example/Search-History/search-history.json" },
      ];

      for (const f of files) {
        try {
          const res = await fetch(f.path);
          if (res.ok) {
            const json = await res.json();
            sourceMap[f.key] = json;
          }
        } catch {
          // Best effort per file
        }
      }

      const summary = normalizeLegacyData(sourceMap);
      startTransition(() => {
        setScanSummary(summary);
      });
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Failed to load sample files");
    } finally {
      startTransition(() => setLoadingSample(false));
    }
  }

  // Handle uploaded JSON backup file
  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setErrorMsg(null);
    setMigrationReceipt(null);

    try {
      const text = await file.text();
      const parsed = parseLegacyBackupJson(text, file.name);
      const summary = normalizeLegacyData(parsed);
      startTransition(() => {
        setScanSummary(summary);
      });
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Failed to parse uploaded backup file");
    }
  }

  // Upload prepared migration to Cloudflare R2 (after resolving real owner & local staging)
  async function handleUploadToR2() {
    if (!scanSummary || scanSummary.totalNormalized === 0) return;

    setUploading(true);
    setErrorMsg(null);

    try {
      const ownerId = await resolveCanonicalOwner();
      await stageNormalizedSummaryLocally(ownerId, scanSummary);

      // 1. Prepare canonical historical migration plan (`before-app-updating`)
      const plan: PreparedMigrationPlan = prepareLegacyMigrationPlan({
        summary: scanSummary,
        ownerId,
      });

      // 2. Post to migration upload route (chunk by generation if payload exceeds 2.5 MiB
      //    to stay safely below Vercel serverless body limits on large archives)
      const fullPayload = JSON.stringify(plan);
      const generationBatches: PreparedMigrationPlan[] =
        fullPayload.length > 2_500_000 && plan.generations.length > 1
          ? plan.generations.map((gen) => ({
              ...plan,
              generations: [gen],
              totalRecords: gen.totalRecords,
              totalBytes: gen.totalBytes,
            }))
          : [plan];

      let totalUploadedGenerations = 0;
      let totalUploadedRecords = 0;
      let totalUploadedBytes = 0;
      const uploadedGenerations: Array<{
        datasetType: string;
        generationId: string;
        manifestPath: string;
        partsCount: number;
        totalBytes: number;
        aggregateSha256: string;
      }> = [];

      for (const batchPlan of generationBatches) {
        const res = await fetch("/api/migration/upload", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(batchPlan),
        });

        if (!res.ok) {
          const errorData = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(errorData.error || `Upload failed with HTTP ${res.status}`);
        }

        const batchReceipt = await res.json();
        totalUploadedGenerations += Number(batchReceipt.totalUploadedGenerations || 0);
        totalUploadedRecords += Number(batchReceipt.totalUploadedRecords || 0);
        totalUploadedBytes += Number(batchReceipt.totalUploadedBytes || 0);
        if (Array.isArray(batchReceipt.uploadedGenerations)) {
          uploadedGenerations.push(...batchReceipt.uploadedGenerations);
        }
      }

      const receipt = {
        ok: true,
        planId: plan.planId,
        totalUploadedGenerations,
        totalUploadedRecords,
        totalUploadedBytes,
        uploadedGenerations,
      };
      const { updateLegacyStagingBatchStatus } = await import("@/lib/storage/indexeddb-store");
      for (const ds of ["SAVED_ITEMS", "PLAYLIST", "SEARCH_HISTORY", "REFERENCES", "RESEARCH_QUEUE"]) {
        await updateLegacyStagingBatchStatus(`stage_${ownerId}_${ds}`, "COMMITTED", receipt).catch(() => {});
      }

      startTransition(() => {
        setMigrationReceipt(receipt);
      });
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Upload to Cloudflare R2 failed");
    } finally {
      startTransition(() => setUploading(false));
    }
  }

  // Filter items in active dataset preview
  const currentDatasetItems = scanSummary?.datasets[activeTab]?.items || [];
  const filteredPreviewItems = currentDatasetItems.filter((rawItem: unknown) => {
    const item = rawItem as Record<string, unknown>;
    if (!previewQuery.trim()) return true;
    const q = previewQuery.toLowerCase();
    const title = String(item.title || item.name || item.query || "").toLowerCase();
    const channel = String(item.channelTitle || "").toLowerCase();
    const id = String(item.platformItemId || item.id || "").toLowerCase();
    return title.includes(q) || channel.includes(q) || id.includes(q);
  });

  return (
    <div className="space-y-6">
      {/* Header Banner */}
      <Card className="border-border/80 bg-surface/50 backdrop-blur-xs p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-purple-500/10 text-purple-600 dark:text-purple-400">
              <Sparkles className="h-6 w-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-bold text-foreground">
                  Other Actions & Safe Legacy Data Migration
                </h2>
                <Badge tone="neutral" className="bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/30">
                  Before App Updating
                </Badge>
              </div>
              <p className="mt-1 text-xs text-muted max-w-2xl">
                Reorganize previously saved local browser data, inspect legacy records with zero-loss descriptions,
                and safely upload them to Cloudflare R2 under the canonical historical namespace.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Link href="/manifests">
              <Button variant="secondary" className="gap-1.5 h-9 px-3 text-xs">
                <HardDrive className="h-4 w-4" />
                Storage Explorer
              </Button>
            </Link>
            <Link href="/saved">
              <Button variant="secondary" className="gap-1.5 h-9 px-3 text-xs">
                <Film className="h-4 w-4 text-primary" />
                Saved Items
              </Button>
            </Link>
          </div>
        </div>

        {/* Safety Guarantee Notice */}
        <div className="mt-5 flex items-start gap-3 rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-4 text-xs text-foreground/90">
          <ShieldCheck className="h-5 w-5 text-emerald-500 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <span className="font-semibold text-emerald-600 dark:text-emerald-400">
              Strict Non-Destructive Storage Guarantee:
            </span>
            <p className="text-muted leading-relaxed">
              Your existing local data in browser <code className="text-foreground">localStorage</code> is never wiped, cleared, or deleted automatically.
              All migrated records are uploaded to Cloudflare R2 under <code className="text-foreground">asdy/persistence/&lt;ownerId&gt;/&lt;datasetSlug&gt;/before-app-updating/...</code>, preserving historical archives permanently.
            </p>
          </div>
        </div>
      </Card>

      {/* Action 1: Scan and Discover Local Data */}
      <Card className="border-border/80 bg-surface/50 backdrop-blur-xs p-6 space-y-4">
        <div>
          <h3 className="font-semibold text-foreground text-base flex items-center gap-2">
            <Search className="h-4 w-4 text-primary" />
            Action 1: Scan & Prepare Legacy Data
          </h3>
          <p className="mt-1 text-xs text-muted">
            Choose a data discovery method: scan the current browser&apos;s localStorage, upload a legacy backup JSON file, or load the authentic repository manifest examples.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3 pt-2">
          <Button
            variant="primary"
            onClick={handleScanLocalStorage}
            disabled={scanning || uploading}
            className="gap-2 h-9 px-4 text-xs"
          >
            {scanning ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            Scan Browser Storage
          </Button>

          <Button
            variant="secondary"
            onClick={handleLoadSampleFiles}
            disabled={loadingSample || uploading}
            className="gap-2 h-9 px-4 text-xs"
          >
            {loadingSample ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileCode className="h-4 w-4 text-amber-500" />}
            Load Manifest Example Files
          </Button>

          <label
            htmlFor={fileInputId}
            className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-border/70 bg-surface-muted/50 px-4 py-2 text-xs font-semibold text-foreground transition hover:bg-surface-muted"
          >
            <Upload className="h-4 w-4 text-muted" />
            <span>Upload Backup JSON</span>
            <input
              id={fileInputId}
              type="file"
              accept=".json"
              onChange={handleFileUpload}
              className="sr-only"
            />
          </label>
        </div>

        {errorMsg && (
          <div className="flex items-center gap-2 rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-xs text-rose-500">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span>{errorMsg}</span>
          </div>
        )}
      </Card>

      {/* Structured Preview & Inspection Dashboard */}
      {scanSummary && (
        <div className="space-y-4 animate-in fade-in">
          {/* Summary KPI Cards */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Card className="p-4 border-border/70 bg-surface-muted/20">
              <span className="text-[11px] font-bold uppercase tracking-wider text-muted">Raw Records Found</span>
              <div className="mt-1 text-2xl font-bold text-foreground">{scanSummary.totalRawFound}</div>
              <span className="text-[11px] text-muted">from {scanSummary.scannedSources.length} source(s)</span>
            </Card>

            <Card className="p-4 border-border/70 bg-surface-muted/20">
              <span className="text-[11px] font-bold uppercase tracking-wider text-emerald-500">Normalized & Deduplicated</span>
              <div className="mt-1 text-2xl font-bold text-emerald-500">{scanSummary.totalNormalized}</div>
              <span className="text-[11px] text-muted">ready for migration</span>
            </Card>

            <Card className="p-4 border-border/70 bg-surface-muted/20">
              <span className="text-[11px] font-bold uppercase tracking-wider text-amber-500">Duplicates Skipped</span>
              <div className="mt-1 text-2xl font-bold text-amber-500">{scanSummary.totalDuplicatesSkipped}</div>
              <span className="text-[11px] text-muted">zero duplicate entries</span>
            </Card>

            <Card className="p-4 border-border/70 bg-surface-muted/20">
              <span className="text-[11px] font-bold uppercase tracking-wider text-muted">Unrecognized / Filtered</span>
              <div className="mt-1 text-2xl font-bold text-foreground">{scanSummary.totalUnrecognized}</div>
              <span className="text-[11px] text-muted">missing title/id</span>
            </Card>
          </div>

          {/* Action 2: Upload to Cloudflare R2 Banner */}
          <Card className="border-border/80 bg-surface-muted/30 p-5">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              <div>
                <h4 className="font-semibold text-foreground text-sm flex items-center gap-2">
                  <Upload className="h-4 w-4 text-primary" />
                  Action 2: Upload to Cloudflare R2
                </h4>
                <p className="mt-0.5 text-xs text-muted">
                  Commits {scanSummary.totalNormalized} records across 5 datasets to Cloudflare R2 under <code className="text-foreground">before-app-updating</code>.
                </p>
              </div>

              <Button
                variant="primary"
                onClick={handleUploadToR2}
                disabled={uploading || scanSummary.totalNormalized === 0}
                className="gap-2 h-10 px-5 text-xs font-semibold shadow-md"
              >
                {uploading ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    <span>Uploading to Cloudflare R2...</span>
                  </>
                ) : (
                  <>
                    <Upload className="h-4 w-4" />
                    <span>Upload to Cloudflare R2</span>
                  </>
                )}
              </Button>
            </div>
          </Card>

          {/* Migration Receipt / Report */}
          {migrationReceipt && (
            <Card className="border-emerald-500/40 bg-emerald-500/5 p-5 space-y-3">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-5 w-5 text-emerald-500 shrink-0" />
                <h4 className="font-bold text-foreground text-sm">
                  Migration Successfully Uploaded & Committed!
                </h4>
                <Badge tone="success">Verified R2 Persistence</Badge>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs pt-1">
                <div className="rounded-lg bg-surface/60 p-2.5 border border-border/50">
                  <div className="text-muted">Generations Uploaded</div>
                  <div className="text-base font-bold text-foreground">{migrationReceipt.totalUploadedGenerations}</div>
                </div>
                <div className="rounded-lg bg-surface/60 p-2.5 border border-border/50">
                  <div className="text-muted">Records Committed</div>
                  <div className="text-base font-bold text-foreground">{migrationReceipt.totalUploadedRecords}</div>
                </div>
                <div className="rounded-lg bg-surface/60 p-2.5 border border-border/50">
                  <div className="text-muted">Total Size</div>
                  <div className="text-base font-bold text-foreground">{formatBytes(migrationReceipt.totalUploadedBytes)}</div>
                </div>
              </div>

              <div className="space-y-1.5 pt-2">
                <div className="text-[11px] font-bold uppercase tracking-wider text-muted">Canonical Storage Paths Created:</div>
                <div className="space-y-1 font-mono text-[11px] text-foreground/90 bg-black/40 p-3 rounded-lg border border-border/50 select-text overflow-x-auto">
                  {migrationReceipt.uploadedGenerations.map((g) => (
                    <div key={g.generationId} className="flex flex-col gap-0.5">
                      <span className="text-emerald-400 font-semibold">{g.manifestPath}</span>
                      <span className="text-muted/80 text-[10px] pl-3">↳ SHA-256: {g.aggregateSha256.slice(0, 24)}… ({g.partsCount} part, {formatBytes(g.totalBytes)})</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="flex items-center gap-3 pt-2">
                <Link href="/saved">
                  <Button variant="secondary" className="gap-1.5 h-8 px-3 text-xs">
                    <Film className="h-3.5 w-3.5 text-primary" />
                    View &quot;Before App Updating&quot; in Saved Items
                  </Button>
                </Link>
                <Link href="/manifests">
                  <Button variant="ghost" className="gap-1.5 h-8 px-3 text-xs">
                    <HardDrive className="h-3.5 w-3.5" />
                    Inspect in Storage Explorer
                  </Button>
                </Link>
              </div>
            </Card>
          )}

          {/* Dataset Tabs and Record Preview */}
          <Card className="border-border/80 bg-surface/50 backdrop-blur-xs p-5 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-b border-border/60 pb-3">
              <div className="flex flex-wrap items-center gap-2">
                {(["SAVED_ITEMS", "PLAYLIST", "SEARCH_HISTORY", "REFERENCES", "RESEARCH_QUEUE"] as const).map((type) => {
                  const count = scanSummary.datasets[type]?.count || 0;
                  const active = activeTab === type;
                  return (
                    <button
                      key={type}
                      type="button"
                      onClick={() => setActiveTab(type)}
                      className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                        active
                          ? "bg-primary text-primary-foreground shadow-xs"
                          : "bg-surface-muted/40 text-muted hover:bg-surface-muted hover:text-foreground"
                      }`}
                    >
                      <span>{type.replace(/_/g, " ")}</span>
                      <span className="rounded-full bg-black/20 px-1.5 py-0.2 text-[10px]">{count}</span>
                    </button>
                  );
                })}
              </div>

              <div className="relative w-full sm:w-64">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted" />
                <input
                  type="text"
                  value={previewQuery}
                  onChange={(e) => setPreviewQuery(e.target.value)}
                  placeholder={`Search ${activeTab.replace(/_/g, " ")}...`}
                  className="w-full rounded-lg border border-border/70 bg-surface-muted/30 pl-8 pr-3 py-1 text-xs text-foreground placeholder:text-muted focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>
            </div>

            {/* Records List for Active Tab */}
            <div className="space-y-3">
              {filteredPreviewItems.length === 0 ? (
                <div className="p-8 text-center text-xs text-muted">
                  No records in this dataset.
                </div>
              ) : activeTab === "SAVED_ITEMS" ? (
                (filteredPreviewItems as NormalizedLegacyItem[]).map((item) => (
                  <div
                    key={item.platformItemId}
                    className="flex flex-col sm:flex-row gap-3 rounded-xl border border-border/60 bg-surface-muted/20 p-3.5 transition hover:border-border"
                  >
                    {item.thumbnailUrl ? (
                      <div className="shrink-0 overflow-hidden rounded-lg bg-surface-muted border border-border/40">
                        {item.itemType === "channel" ? (
                          <Image
                            src={item.thumbnailUrl}
                            alt={item.title}
                            width={56}
                            height={56}
                            unoptimized
                            className="h-14 w-14 rounded-full object-cover p-1"
                          />
                        ) : (
                          <Image
                            src={item.thumbnailUrl}
                            alt={item.title}
                            width={112}
                            height={64}
                            unoptimized
                            className="h-16 w-28 object-cover"
                          />
                        )}
                      </div>
                    ) : (
                      <div className="flex h-16 w-28 shrink-0 items-center justify-center rounded-lg bg-surface-muted text-muted border border-border/40">
                        <Film className="h-6 w-6 text-muted/60" />
                      </div>
                    )}

                    <div className="flex-1 min-w-0 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge tone="neutral" className="bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/30">
                          Before App Updating
                        </Badge>
                        <Badge tone={item.itemType === "channel" ? "warning" : item.itemType === "playlist" ? "primary" : "success"}>
                          {item.itemType.toUpperCase()}
                        </Badge>
                        {item.channelTitle && (
                          <span className="text-xs font-medium text-foreground/80">{item.channelTitle}</span>
                        )}
                        <span className="ml-auto font-mono text-[10px] text-muted">{item.platformItemId}</span>
                      </div>

                      <h4 className="text-sm font-bold text-foreground leading-snug line-clamp-2">
                        <a
                          href={item.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="hover:text-primary transition inline-flex items-center gap-1.5"
                        >
                          <span>{item.title}</span>
                          <ExternalLink className="h-3 w-3 shrink-0 opacity-70" />
                        </a>
                      </h4>

                      {/* Expandable Description */}
                      <ExpandableDescription description={item.description} />

                      {/* Zero-safe statistics */}
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 pt-1 text-[11px] text-muted">
                        {item.viewsCount !== null && (
                          <span>
                            <span className="font-semibold text-foreground/90">{formatCompactCount(item.viewsCount)}</span> views
                          </span>
                        )}
                        {item.likesCount !== null && (
                          <span>
                            <span className="font-semibold text-foreground/90">{formatCompactCount(item.likesCount)}</span> likes
                          </span>
                        )}
                        {item.commentsCount !== null && (
                          <span>
                            <span className="font-semibold text-foreground/90">{formatCompactCount(item.commentsCount)}</span> comments
                          </span>
                        )}
                        {item.durationSeconds !== null && (
                          <span>{formatDuration(item.durationSeconds)}</span>
                        )}
                        {item.publishedAt && (
                          <span>Published: {formatDate(item.publishedAt)}</span>
                        )}
                        {item.savedAt && (
                          <span className="text-primary/80">Saved: {formatDate(item.savedAt)}</span>
                        )}
                      </div>
                    </div>
                  </div>
                ))
              ) : (
                filteredPreviewItems.map((rawItem: unknown, idx: number) => {
                  const item = rawItem as Record<string, unknown>;
                  const itemTitle = String(item.title || item.name || item.query || "Record #" + (idx + 1));
                  const itemId = String(item.id || idx);
                  const itemQuery = typeof item.query === "string" ? item.query : null;
                  const itemCreatedAt = typeof item.createdAt === "string" ? item.createdAt : null;
                  return (
                  <div
                    key={itemId}
                    className="rounded-lg border border-border/60 bg-surface-muted/20 p-3 text-xs space-y-1"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-foreground">{itemTitle}</span>
                      <span className="font-mono text-[10px] text-muted">{itemId}</span>
                    </div>
                    {itemQuery && <div className="text-muted">Query: {itemQuery}</div>}
                    {itemCreatedAt && <div className="text-muted text-[10px]">Created: {formatDate(itemCreatedAt)}</div>}
                  </div>
                  );
                })
              )}
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
