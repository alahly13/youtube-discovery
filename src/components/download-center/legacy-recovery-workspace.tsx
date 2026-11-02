"use client";

import {
  AlertCircle,
  Archive,
  ArrowLeft,
  CheckCircle2,
  Database,
  Download,
  HardDrive,
  Info,
  Layers,
  Loader2,
  Lock,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { RawJsonInspectorDialog } from "@/components/saved/raw-json-inspector-dialog";
import type { CompleteLegacyScanReport } from "@/lib/recovery/legacy-scanner";
import { scanBrowserStorage, type BrowserScanResult } from "@/lib/recovery/client-browser-scanner";
import { formatBytes } from "@/lib/utils/format";

export function LegacyRecoveryWorkspace() {
  const [report, setReport] = useState<CompleteLegacyScanReport | null>(null);
  const [browserData, setBrowserData] = useState<BrowserScanResult | null>(null);
  const [scanning, setScanning] = useState(false);
  const [scanningBrowser, setScanningBrowser] = useState(false);
  const [creatingBackup, setCreatingBackup] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [inspectedObject, setInspectedObject] = useState<unknown | null>(null);

  // Trigger server scan
  const handleServerScan = async () => {
    setScanning(true);
    setError(null);
    try {
      const res = await fetch("/api/download-center/legacy-recovery/scan", {
        method: "POST",
      });
      if (!res.ok) throw new Error("Failed to scan legacy data sources.");
      const data = await res.json();
      setReport(data.report);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error scanning legacy data sources.");
    } finally {
      setScanning(false);
    }
  };

  // Trigger client-side browser storage scan
  const handleBrowserScan = async () => {
    setScanningBrowser(true);
    try {
      const bData = await scanBrowserStorage();
      setBrowserData(bData);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to scan browser storage.");
    } finally {
      setScanningBrowser(false);
    }
  };

  useEffect(() => {
    void handleServerScan();
    void handleBrowserScan();
  }, []);

  // Download complete legacy backup ZIP
  const handleDownloadBackup = async () => {
    setCreatingBackup(true);
    setError(null);
    try {
      const res = await fetch("/api/download-center/legacy-recovery/backup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          browserData: browserData || undefined,
        }),
      });

      if (!res.ok) {
        const errJson = await res.json();
        throw new Error(errJson.error || "Failed to create legacy backup package.");
      }

      const blob = await res.blob();
      const contentDisposition = res.headers.get("Content-Disposition") || "";
      let filename = "youtube-discovery-legacy-backup.zip";
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
      setError(err instanceof Error ? err.message : "Failed to download backup package.");
    } finally {
      setCreatingBackup(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between border-b border-border/80 pb-5">
        <div>
          <div className="flex items-center gap-2 mb-1.5">
            <Link
              href="/download-center"
              className="flex items-center gap-1 text-xs font-medium text-muted hover:text-foreground transition"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              <span>Back to Download Center</span>
            </Link>
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground flex items-center gap-2.5">
            <ShieldCheck className="h-6 w-6 text-primary" />
            <span>Legacy Data Recovery — إنقاذ البيانات القديمة</span>
          </h1>
          <p className="mt-1 text-xs text-muted max-w-2xl">
            Discover, verify, and download all recoverable historical Manifest files and application data
            from Vercel Blob, local caches, and browser storage into an isolated offline backup package.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="secondary"
            onClick={handleServerScan}
            disabled={scanning}
            className="h-9 gap-1.5 px-3 text-xs"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${scanning ? "animate-spin" : ""}`} />
            <span>Scan Legacy Sources</span>
          </Button>

          <Button
            variant="primary"
            onClick={handleDownloadBackup}
            disabled={creatingBackup || scanning}
            className="h-9 gap-2 px-4 text-xs font-semibold"
          >
            {creatingBackup ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                <span>Creating Package…</span>
              </>
            ) : (
              <>
                <Download className="h-4 w-4" />
                <span>Create Legacy Backup (ZIP)</span>
              </>
            )}
          </Button>
        </div>
      </div>

      {/* Critical Safety Mandate Banner */}
      <Card className="p-4 border-emerald-500/30 bg-emerald-500/10 text-xs text-emerald-400 space-y-1.5">
        <div className="flex items-center gap-2 font-bold text-sm text-emerald-300">
          <Lock className="h-4 w-4" />
          <span>STRICT READ-ONLY SAFETY MANDATE — ZERO DELETIONS</span>
        </div>
        <p className="text-[11px] text-emerald-400/90 leading-relaxed">
          This recovery operation is 100% read-only with respect to all original data sources. Under NO condition are any
          Vercel Blob objects, Vercel caches, browser storage, or database records modified, purged, or deleted during this phase.
          Cleanup will be authorized separately only after you retain and personally inspect the downloaded backup.
        </p>
      </Card>

      {/* Error alert */}
      {error && (
        <Card className="p-4 border-danger/30 bg-danger/5 text-xs text-danger flex items-start gap-2.5">
          <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
          <p>{error}</p>
        </Card>
      )}

      {/* Summary Status Cards */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="p-4 flex items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Layers className="h-5 w-5" />
          </div>
          <div>
            <p className="text-[11px] font-medium uppercase tracking-wider text-muted">Total Discovered</p>
            <p className="text-lg font-bold text-foreground">
              {report ? report.totalDiscovered : "—"}
            </p>
          </div>
        </Card>

        <Card className="p-4 flex items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-500">
            <CheckCircle2 className="h-5 w-5" />
          </div>
          <div>
            <p className="text-[11px] font-medium uppercase tracking-wider text-muted">Verified Readable</p>
            <p className="text-lg font-bold text-foreground">
              {report ? report.totalReadable : "—"}
            </p>
          </div>
        </Card>

        <Card className="p-4 flex items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-ai/10 text-ai">
            <HardDrive className="h-5 w-5" />
          </div>
          <div>
            <p className="text-[11px] font-medium uppercase tracking-wider text-muted">Recoverable Size</p>
            <p className="text-lg font-bold text-foreground">
              {report ? formatBytes(report.totalRecoverableBytes) : "—"}
            </p>
          </div>
        </Card>

        <Card className="p-4 flex items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-500/10 text-amber-500">
            <Database className="h-5 w-5" />
          </div>
          <div>
            <p className="text-[11px] font-medium uppercase tracking-wider text-muted">Browser Storage</p>
            <p className="text-lg font-bold text-foreground">
              {browserData ? `${browserData.totalRecords} records` : "Scanning…"}
            </p>
          </div>
        </Card>
      </div>

      {/* Discovered Sources Matrix */}
      <div className="space-y-4">
        <h2 className="text-base font-bold text-foreground flex items-center gap-2">
          <Database className="h-4 w-4 text-primary" />
          <span>Discovered Legacy Data Sources & Recovery Capability</span>
        </h2>

        {report && (
          <div className="grid gap-4 md:grid-cols-2">
            {/* Vercel Blob */}
            <Card className="p-5 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <Archive className="h-4 w-4" />
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-foreground">Vercel Blob Storage</h3>
                    <p className="text-[11px] text-muted">Remote object store (`youtube-discovery/v1/*`)</p>
                  </div>
                </div>
                <Badge
                  tone={report.sources.vercel_blob.status === "AVAILABLE" ? "success" : "warning"}
                  className="text-[10px] uppercase font-bold"
                >
                  {report.sources.vercel_blob.status}
                </Badge>
              </div>

              <div className="grid grid-cols-3 gap-2 text-center text-xs py-2 bg-surface-muted/50 rounded-lg">
                <div>
                  <span className="text-muted text-[10px] block">Discovered</span>
                  <span className="font-bold text-foreground">{report.sources.vercel_blob.discoveredCount}</span>
                </div>
                <div>
                  <span className="text-muted text-[10px] block">Recoverable</span>
                  <span className="font-bold text-emerald-500">{report.sources.vercel_blob.readableCount}</span>
                </div>
                <div>
                  <span className="text-muted text-[10px] block">Size</span>
                  <span className="font-bold text-foreground">
                    {formatBytes(report.sources.vercel_blob.totalRecoverableBytes)}
                  </span>
                </div>
              </div>

              {report.sources.vercel_blob.accessRequirements && (
                <p className="text-xs text-amber-500 flex items-center gap-1.5">
                  <Info className="h-3.5 w-3.5 shrink-0" />
                  <span>{report.sources.vercel_blob.accessRequirements}</span>
                </p>
              )}

              {report.sources.vercel_blob.excludedCount > 0 && (
                <p className="text-[11px] text-muted">
                  Note: {report.sources.vercel_blob.excludedCount} private auth/session objects safely excluded from recovery catalog.
                </p>
              )}
            </Card>

            {/* Local Disk Storage */}
            <Card className="p-5 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-500">
                    <HardDrive className="h-4 w-4" />
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-foreground">Local Disk Cache & File Archives</h3>
                    <p className="text-[11px] text-muted">`data/playlists/`, `data/storage/`</p>
                  </div>
                </div>
                <Badge tone="success" className="text-[10px] uppercase font-bold">
                  {report.sources.disk_cache.status}
                </Badge>
              </div>

              <div className="grid grid-cols-3 gap-2 text-center text-xs py-2 bg-surface-muted/50 rounded-lg">
                <div>
                  <span className="text-muted text-[10px] block">Discovered</span>
                  <span className="font-bold text-foreground">{report.sources.disk_cache.discoveredCount}</span>
                </div>
                <div>
                  <span className="text-muted text-[10px] block">Recoverable</span>
                  <span className="font-bold text-emerald-500">{report.sources.disk_cache.readableCount}</span>
                </div>
                <div>
                  <span className="text-muted text-[10px] block">Size</span>
                  <span className="font-bold text-foreground">
                    {formatBytes(report.sources.disk_cache.totalRecoverableBytes)}
                  </span>
                </div>
              </div>

              <p className="text-[11px] text-muted">
                Safe read-only access to historical local JSON manifests and playlist backups.
              </p>
            </Card>

            {/* Browser Storage (IndexedDB + LocalStorage) */}
            <Card className="p-5 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-ai/10 text-ai">
                    <Database className="h-4 w-4" />
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-foreground">Browser Storage (Client-Side)</h3>
                    <p className="text-[11px] text-muted">`youtube_discovery_local_v1` & LocalStorage</p>
                  </div>
                </div>
                <Badge tone="primary" className="text-[10px] uppercase font-bold">
                  CLIENT ONLY
                </Badge>
              </div>

              <div className="grid grid-cols-3 gap-2 text-center text-xs py-2 bg-surface-muted/50 rounded-lg">
                <div>
                  <span className="text-muted text-[10px] block">IDB Stores</span>
                  <span className="font-bold text-foreground">
                    {browserData ? Object.keys(browserData.indexeddb).length : "0"}
                  </span>
                </div>
                <div>
                  <span className="text-muted text-[10px] block">Records</span>
                  <span className="font-bold text-ai">{browserData ? browserData.totalRecords : "0"}</span>
                </div>
                <div>
                  <span className="text-muted text-[10px] block">Est. Size</span>
                  <span className="font-bold text-foreground">
                    {browserData ? formatBytes(browserData.totalBytes) : "0 B"}
                  </span>
                </div>
              </div>

              <div className="flex items-center justify-between">
                <span className="text-[11px] text-muted">Included in backup package upon creation</span>
                <Button
                  variant="ghost"
                  onClick={handleBrowserScan}
                  disabled={scanningBrowser}
                  className="h-6 text-[11px] px-2"
                >
                  {scanningBrowser ? "Scanning…" : "Rescan Browser"}
                </Button>
              </div>
            </Card>

            {/* Vercel Runtime & Next.js Caches */}
            <Card className="p-5 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-surface-raised text-muted">
                    <ShieldAlert className="h-4 w-4" />
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-foreground">Vercel Caches & Next.js Data Cache</h3>
                    <p className="text-[11px] text-muted">Runtime Cache, Turbopack, CDN/ISR</p>
                  </div>
                </div>
                <Badge tone="neutral" className="text-[10px] uppercase font-bold">
                  NOT ENUMERABLE
                </Badge>
              </div>

              <p className="text-xs text-muted leading-relaxed">
                Vercel Runtime Cache is an ephemeral key-value cache without catalog enumeration APIs. Next.js Data Cache and `.next/cache`
                hold pre-compiled route bytecode, not standalone user manifests. They are safely excluded from the Manifest backup.
              </p>
            </Card>
          </div>
        )}
      </div>

      {/* Category Breakdown Table */}
      {report && (
        <Card className="p-5 space-y-3">
          <h3 className="text-sm font-semibold text-foreground">Discovered Records by Category</h3>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4 text-xs">
            {Object.entries(report.categoryBreakdown).map(([category, stats]) => (
              <div
                key={category}
                className="flex items-center justify-between p-3 rounded-xl bg-surface-muted/40 border border-border/60"
              >
                <div>
                  <span className="font-semibold text-foreground">{category}</span>
                  <span className="text-[11px] text-muted block">{formatBytes(stats.byteCount)}</span>
                </div>
                <Badge tone="neutral" className="font-mono text-xs">
                  {stats.fileCount} files
                </Badge>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Inspection Modal */}
      {inspectedObject ? (
        <RawJsonInspectorDialog
          item={inspectedObject}
          open={Boolean(inspectedObject)}
          onClose={() => setInspectedObject(null)}
          title="Discovered Legacy Object Metadata"
        />
      ) : null}
    </div>
  );
}
