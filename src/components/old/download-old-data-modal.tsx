"use client";

import {
  AlertCircle,
  Archive,
  Bookmark,
  BookmarkCheck,
  CheckCircle2,
  Database,
  Download,
  FolderArchive,
  History,
  ListVideo,
  Loader2,
  ShieldCheck,
  Sparkles,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { scanBrowserStorage, type BrowserScanResult } from "@/lib/recovery/client-browser-scanner";
import { formatBytes } from "@/lib/utils/format";

interface DownloadOldDataModalProps {
  buttonLabel?: string;
  className?: string;
  variant?: "primary" | "secondary" | "outline";
}

export function DownloadOldDataModal({
  buttonLabel = "Download OLD Data",
  className,
  variant = "primary",
}: DownloadOldDataModalProps) {
  const [open, setOpen] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [browserData, setBrowserData] = useState<BrowserScanResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [successInfo, setSuccessInfo] = useState<{
    filename: string;
    sizeBytes: number;
    sha256?: string;
  } | null>(null);

  // Scan browser storage when dialog opens
  useEffect(() => {
    if (open) {
      void runScan();
    }
  }, [open]);

  const runScan = async () => {
    setScanning(true);
    setError(null);
    setSuccessInfo(null);
    try {
      const data = await scanBrowserStorage();
      setBrowserData(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to scan browser storage.");
    } finally {
      setScanning(false);
    }
  };

  const currentOrigin = typeof window !== "undefined" ? window.location.origin : "unknown";

  // Calculate category estimates from scanned data
  const estimatedCategories = (() => {
    if (!browserData) {
      return {
        savedItems: 0,
        savedPlaylists: 0,
        savedTitlesLinks: 0,
        savedSearchHistory: 0,
        unclassified: 0,
      };
    }
    const idb = browserData.indexeddb;
    const itemsCount = (idb.entities_saved_items?.length || 0);
    const playlistsCount =
      (idb.entities_user_playlists?.length || 0) +
      (idb.entities_playlist_groups?.length || 0) +
      (idb.entities_playlist_entries?.length || 0);
    const titlesLinksCount =
      (idb.entities_saved_searches?.length || 0) +
      (idb.entities_saved_references?.length || 0);
    const historyCount = (idb.entities_search_history?.length || 0);

    const unclassifiedCount =
      (idb.entities_research_queue?.length || 0) +
      (idb.workspace_snapshots?.length || 0) +
      (idb.pending_operations?.length || 0) +
      (idb.local_sync_metadata?.length || 0) +
      Object.keys(browserData.localStorage).length;

    return {
      savedItems: itemsCount,
      savedPlaylists: playlistsCount,
      savedTitlesLinks: titlesLinksCount,
      savedSearchHistory: historyCount,
      unclassified: unclassifiedCount,
    };
  })();

  const handleDownloadZip = async () => {
    if (!browserData) return;
    setDownloading(true);
    setError(null);
    try {
      const payload = {
        origin: currentOrigin,
        capturedAt: new Date().toISOString(),
        indexeddb: browserData.indexeddb,
        localStorage: browserData.localStorage,
      };

      const res = await fetch("/api/old/browser-backup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => null);
        throw new Error(errJson?.error || `Failed to create backup (HTTP ${res.status}).`);
      }

      const contentDisposition = res.headers.get("Content-Disposition") || "";
      let filename = "YouTube-Discovery-OLD-Data-Backup.zip";
      const match = contentDisposition.match(/filename="?([^"]+)"?/);
      if (match && match[1]) filename = match[1];

      const sha256 = res.headers.get("X-Archive-Checksum") || undefined;
      const blob = await res.blob();

      // Trigger standard browser download
      const downloadUrl = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = downloadUrl;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(downloadUrl);

      setSuccessInfo({
        filename,
        sizeBytes: blob.size,
        sha256,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error generating download package.");
    } finally {
      setDownloading(false);
    }
  };

  return (
    <>
      <Button
        variant={variant === "outline" ? "secondary" : variant}
        onClick={() => setOpen(true)}
        className={className || "gap-2 h-9 px-4 text-xs font-semibold shadow-xs"}
      >
        <Download className="h-4 w-4" />
        <span>{buttonLabel}</span>
      </Button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs animate-in fade-in"
          role="dialog"
          aria-modal="true"
        >
          <div className="relative w-full max-w-2xl rounded-2xl border border-border/80 bg-surface p-6 shadow-2xl space-y-5 max-h-[90vh] overflow-y-auto">
            {/* Modal Header */}
            <div className="flex items-start justify-between border-b border-border/60 pb-4">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <Badge tone="primary" className="text-[10px] font-bold uppercase tracking-wider">
                    BROWSER STORAGE RECOVERY
                  </Badge>
                  <Badge tone="success" className="text-[10px] font-semibold">
                    100% READ-ONLY
                  </Badge>
                </div>
                <h2 className="text-xl font-bold tracking-tight text-foreground flex items-center gap-2">
                  <Download className="h-5 w-5 text-primary" />
                  <span>Download OLD Data Backup (ZIP)</span>
                </h2>
                <p className="mt-1 text-xs text-muted">
                  Captures and structures historical application records from your Chrome browser origin
                  into an organized, offline ZIP archive.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-lg p-1 text-muted hover:bg-surface-muted hover:text-foreground transition"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Origin & Browser Requirement Alert */}
            <div className="rounded-xl border border-primary/20 bg-primary/5 p-3.5 text-xs space-y-1.5">
              <div className="flex items-center gap-2 font-semibold text-primary">
                <Database className="h-4 w-4 shrink-0" />
                <span>Current Website Origin: <code className="font-mono">{currentOrigin}</code></span>
              </div>
              <p className="text-muted leading-relaxed">
                Browser storage is strictly origin-scoped by web browsers. Data created on <code className="font-mono">localhost</code> or another domain cannot be inspected from <code className="font-mono">youtube-discovery.vercel.app</code>. Please ensure you are running this from the exact browser and origin where your old data was saved.
              </p>
            </div>

            {/* Error Message */}
            {error && (
              <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive flex items-center gap-2">
                <AlertCircle className="h-4 w-4 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            {/* Success Notice */}
            {successInfo && (
              <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4 space-y-2 text-xs">
                <div className="flex items-center gap-2 font-bold text-emerald-600 dark:text-emerald-400">
                  <CheckCircle2 className="h-4 w-4" />
                  <span>Download Completed Successfully!</span>
                </div>
                <div className="space-y-1 font-mono text-[11px] text-foreground/90">
                  <p>File: <span className="text-primary font-semibold">{successInfo.filename}</span></p>
                  <p>Size: {formatBytes(successInfo.sizeBytes)}</p>
                  {successInfo.sha256 && (
                    <p className="truncate">SHA-256: {successInfo.sha256}</p>
                  )}
                </div>
                <p className="text-[11px] text-muted pt-1">
                  ✓ Your browser storage was NOT cleared or modified. You can keep this ZIP as a permanent offline archive.
                </p>
              </div>
            )}

            {/* Category Breakdown Cards */}
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs font-semibold text-muted">
                <span>Discovered Historical Records</span>
                <span>
                  {scanning ? "Scanning browser…" : `${browserData?.totalRecords || 0} total records`}
                </span>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 text-xs">
                <Card className="p-3 bg-surface-muted/30 border-border/70 space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] uppercase font-bold text-muted">Saved Items</span>
                    <BookmarkCheck className="h-3.5 w-3.5 text-primary" />
                  </div>
                  <p className="text-lg font-bold text-foreground">
                    {estimatedCategories.savedItems}
                  </p>
                  <span className="text-[10px] text-muted block truncate">OLD-Saved-Items/</span>
                </Card>

                <Card className="p-3 bg-surface-muted/30 border-border/70 space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] uppercase font-bold text-muted">Playlists</span>
                    <ListVideo className="h-3.5 w-3.5 text-indigo-500" />
                  </div>
                  <p className="text-lg font-bold text-foreground">
                    {estimatedCategories.savedPlaylists}
                  </p>
                  <span className="text-[10px] text-muted block truncate">OLD-Saved-Playlists/</span>
                </Card>

                <Card className="p-3 bg-surface-muted/30 border-border/70 space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] uppercase font-bold text-muted">Titles & Links</span>
                    <Bookmark className="h-3.5 w-3.5 text-amber-500" />
                  </div>
                  <p className="text-lg font-bold text-foreground">
                    {estimatedCategories.savedTitlesLinks}
                  </p>
                  <span className="text-[10px] text-muted block truncate">OLD-Saved-Titles-and-Links/</span>
                </Card>

                <Card className="p-3 bg-surface-muted/30 border-border/70 space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] uppercase font-bold text-muted">History</span>
                    <History className="h-3.5 w-3.5 text-emerald-500" />
                  </div>
                  <p className="text-lg font-bold text-foreground">
                    {estimatedCategories.savedSearchHistory}
                  </p>
                  <span className="text-[10px] text-muted block truncate">OLD-Saved-Search-History/</span>
                </Card>
              </div>

              {estimatedCategories.unclassified > 0 && (
                <div className="rounded-xl border border-border/70 bg-surface-muted/40 p-3 text-xs flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <FolderArchive className="h-4 w-4 text-muted" />
                    <div>
                      <span className="font-semibold text-foreground">Operational & Unclassified Stores</span>
                      <p className="text-[11px] text-muted">Research queue, sync journal, workspace metadata</p>
                    </div>
                  </div>
                  <Badge tone="neutral" className="font-mono">
                    {estimatedCategories.unclassified} records → UNCLASSIFIED/
                  </Badge>
                </div>
              )}
            </div>

            {/* Secret Redaction & Safety Assurance */}
            <div className="rounded-xl border border-border/60 bg-surface-muted/20 p-3 text-[11px] text-muted flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-emerald-500 shrink-0" />
              <span>
                Safety Assurance: Passwords, cookies, session tokens, API keys, and service secrets are automatically redacted and will never be exported.
              </span>
            </div>

            {/* Modal Actions */}
            <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-border/60">
              <Button
                variant="ghost"
                onClick={() => setOpen(false)}
                className="h-9 px-4 text-xs"
              >
                Close
              </Button>
              <Button
                variant="secondary"
                onClick={runScan}
                disabled={scanning || downloading}
                className="h-9 px-3 text-xs"
              >
                {scanning ? "Scanning…" : "Rescan Browser"}
              </Button>
              <Button
                variant="primary"
                onClick={handleDownloadZip}
                disabled={scanning || downloading || !browserData || browserData.totalRecords === 0}
                className="h-9 gap-2 px-5 text-xs font-semibold shadow-xs"
              >
                {downloading ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    <span>Packaging & Downloading…</span>
                  </>
                ) : (
                  <>
                    <Download className="h-4 w-4" />
                    <span>Download ZIP Archive</span>
                  </>
                )}
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
