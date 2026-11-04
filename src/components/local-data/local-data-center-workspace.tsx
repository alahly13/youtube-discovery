"use client";

import {
  Archive,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  Database,
  Download,
  Eye,
  FileCode,
  Layers,
  Lock,
  RefreshCw,
  Search,
  ShieldAlert,
  ShieldCheck,
  Trash2,
  User,
  X,
} from "lucide-react";
import { useEffect, useState, useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  type DiscoveredLocalEntry,
  type LocalDatasetCategory,
  type StorageOverviewMetrics,
  scanAllLocalData,
  collectFullBackupData,
  type DeletionResult,
} from "@/lib/recovery/local-data-center-service";
import { formatBytes } from "@/lib/utils/format";
import { LocalDataDeletionModal } from "./local-data-deletion-modal";
import {
  getLocalDatasetCatalog,
  getSyncJournalBatches,
  type LocalDatasetCatalogEntry,
  type SyncJournalBatch,
} from "@/lib/storage/indexeddb-store";

export function LocalDataCenterWorkspace() {
  const [metrics, setMetrics] = useState<StorageOverviewMetrics>({
    totalRecords: 0,
    totalFiles: 0,
    totalSizeBytes: 0,
    supportedMechanismsCount: 0,
    currentUserRecords: 0,
    unassignedRecords: 0,
    protectedEntries: 0,
    lastScanTimestamp: "",
    scanStatus: "Not scanned",
    authenticatedUserId: "loading...",
  });

  const [entries, setEntries] = useState<DiscoveredLocalEntry[]>([]);
  const [catalogEntries, setCatalogEntries] = useState<LocalDatasetCatalogEntry[]>([]);
  const [journalBatches, setJournalBatches] = useState<SyncJournalBatch[]>([]);
  const [isScanning, setIsScanning] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [exportMessage, setExportMessage] = useState<string | null>(null);
  const [selectedEntryForPreview, setSelectedEntryForPreview] = useState<DiscoveredLocalEntry | null>(null);
  const [isDeletionModalOpen, setIsDeletionModalOpen] = useState(false);
  const [copiedPreview, setCopiedPreview] = useState(false);

  // Filters & Search
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedMechanism, setSelectedMechanism] = useState<string>("ALL");
  const [selectedCategory, setSelectedCategory] = useState<string>("ALL");
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({
    SAVED_ITEMS: true,
    PLAYLIST: true,
    SEARCH_HISTORY: true,
    RESEARCH_QUEUE: true,
    REFERENCES: true,
  });

  // Fetch authenticated user context and trigger initial scan
  useEffect(() => {
    let isMounted = true;

    async function init() {
      setIsScanning(true);
      let userId = "authenticated_admin";

      try {
        const res = await fetch("/api/auth/status");
        if (res.ok) {
          const data = await res.json();
          if (data.userId) userId = data.userId;
          else if (data.username) userId = data.username;
        }
      } catch {
        // Fallback default
      }

      if (isMounted) {
        await executeScan(userId);
      }
    }

    void init();
    return () => {
      isMounted = false;
    };
  }, []);

  const executeScan = async (userId?: string) => {
    setIsScanning(true);
    setExportMessage(null);
    try {
      const targetUserId = userId || metrics.authenticatedUserId;
      const result = await scanAllLocalData(targetUserId);
      setMetrics(result.metrics);
      setEntries(result.entries);

      try {
        const cat = await getLocalDatasetCatalog(targetUserId);
        const jrn = await getSyncJournalBatches(targetUserId);
        setCatalogEntries(cat);
        setJournalBatches(jrn);
      } catch {
        // Fallback if IndexedDB store is empty or initializing
      }
    } catch (err) {
      console.error("[LocalDataCenter] Scan failed:", err);
      setMetrics((prev) => ({ ...prev, scanStatus: "Failed" }));
    } finally {
      setIsScanning(false);
    }
  };

  // Filtered entries
  const filteredEntries = useMemo(() => {
    return entries.filter((entry) => {
      // Mechanism filter
      if (selectedMechanism !== "ALL" && entry.mechanism !== selectedMechanism) {
        return false;
      }
      // Category filter
      if (selectedCategory !== "ALL" && entry.category !== selectedCategory) {
        return false;
      }
      // Search term
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchName = entry.name.toLowerCase().includes(q);
        const matchKey = entry.storageKey.toLowerCase().includes(q);
        const matchCat = entry.category.toLowerCase().includes(q);
        if (!matchName && !matchKey && !matchCat) return false;
      }
      return true;
    });
  }, [entries, selectedMechanism, selectedCategory, searchQuery]);

  // Group filtered entries by category
  const groupedByCategory = useMemo(() => {
    const map: Record<LocalDatasetCategory, DiscoveredLocalEntry[]> = {
      SAVED_ITEMS: [],
      PLAYLIST: [],
      SEARCH_HISTORY: [],
      RESEARCH_QUEUE: [],
      REFERENCES: [],
    };

    for (const entry of filteredEntries) {
      if (map[entry.category]) {
        map[entry.category].push(entry);
      }
    }
    return map;
  }, [filteredEntries]);

  // Handle Backup & Export
  const handleScanAndDownload = async () => {
    setIsExporting(true);
    setExportMessage("Scanning and assembling verifiable archive with full data...");

    try {
      // 1. Fresh scan before download to update UI status
      const freshScan = await scanAllLocalData(metrics.authenticatedUserId);
      setMetrics(freshScan.metrics);
      setEntries(freshScan.entries);

      // 2. Deep collection of full, untruncated browser storage records
      const fullBackupEntries = await collectFullBackupData(metrics.authenticatedUserId);
      const targetEntries = fullBackupEntries.length > 0 ? fullBackupEntries : freshScan.entries;

      // 3. Submit to backup export route
      const res = await fetch("/api/local-data/backup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: metrics.authenticatedUserId,
          capturedAt: new Date().toISOString(),
          entries: targetEntries,
        }),
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.error || `Export failed with HTTP ${res.status}`);
      }

      // 4. Trigger browser download of ZIP
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `YouTube-Discovery-Local-Data-Backup-${Date.now()}.zip`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);

      const totalRecords = targetEntries.reduce((sum, e) => sum + (e.recordCount || 1), 0);
      setExportMessage(
        `Download complete! Successfully packaged ${targetEntries.length} datasets (${totalRecords.toLocaleString()} records, ${formatBytes(blob.size)}).`
      );
    } catch (err) {
      setExportMessage(`Export error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setIsExporting(false);
    }
  };

  const handleDeletionFinished = (res: DeletionResult) => {
    // Refresh inventory
    void executeScan();
    setExportMessage(`Cleanup finished: Removed ${res.deletedRecordsCount} records, freed ${formatBytes(res.freedBytes)}.`);
  };

  const toggleGroup = (category: string) => {
    setExpandedGroups((prev) => ({
      ...prev,
      [category]: !prev[category],
    }));
  };

  const handleCopyPreview = () => {
    if (!selectedEntryForPreview?.previewData) return;
    try {
      const text =
        typeof selectedEntryForPreview.previewData === "string"
          ? selectedEntryForPreview.previewData
          : JSON.stringify(selectedEntryForPreview.previewData, null, 2);
      navigator.clipboard.writeText(text);
      setCopiedPreview(true);
      setTimeout(() => setCopiedPreview(false), 2000);
    } catch {
      // Ignore clipboard error
    }
  };

  return (
    <div className="space-y-8 p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto">
      {/* 1. Header Section */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-border/80 pb-6">
        <div>
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary border border-primary/20 shadow-xs">
              <Database className="h-6 w-6" />
            </div>
            <div>
              <div className="flex items-center gap-2.5">
                <h1 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
                  Local Data Center
                </h1>
                <Badge tone="primary" className="text-xs font-semibold">
                  2026 Core Module
                </Badge>
              </div>
              <p className="text-sm font-semibold text-primary/90 mt-0.5" dir="rtl">
                مركز إدارة البيانات المحلية
              </p>
            </div>
          </div>
          <p className="mt-2 text-xs text-muted max-w-2xl leading-relaxed">
            Independent, client-side browser storage terminal for deep inventory discovery, structured exploration,
            verifiable zero-mutation backups, and granular permanent cleanup.
          </p>
        </div>

        {/* Scan Status & Refresh Action */}
        <div className="flex items-center gap-3 shrink-0">
          <div className="flex flex-col items-end text-xs">
            <span className="text-muted/70">Scan Status</span>
            <span className="font-semibold text-foreground flex items-center gap-1.5">
              <span className={`h-2 w-2 rounded-full ${isScanning ? "bg-amber-400 animate-pulse" : "bg-emerald-400"}`} />
              {isScanning ? "Scanning..." : metrics.scanStatus}
            </span>
          </div>
          <Button
            variant="secondary"
            onClick={() => executeScan()}
            disabled={isScanning}
            className="gap-2 h-9 px-3 text-xs"
          >
            <RefreshCw className={`h-4 w-4 ${isScanning ? "animate-spin" : ""}`} />
            <span>Refresh Scan</span>
          </Button>
        </div>
      </div>

      {/* 2. AREA A: Storage Overview */}
      <div className="space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Layers className="h-4 w-4 text-primary" />
            <h2 className="text-base font-bold text-foreground">Storage Overview</h2>
            <span className="text-xs text-muted">| نظرة عامة على التخزين</span>
          </div>
          {/* Authenticated user context */}
          <div className="flex items-center gap-2 text-xs text-muted bg-surface-raised px-3 py-1.5 rounded-lg border border-border/60">
            <User className="h-3.5 w-3.5 text-primary/80" />
            <span>Authenticated User Context:</span>
            <code className="font-mono font-semibold text-foreground">{metrics.authenticatedUserId}</code>
          </div>
        </div>

        {/* Metric Cards Grid (7 Cards) */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-7 gap-3">
          <Card className="p-3.5 space-y-1 bg-surface/80 border-border/70 shadow-xs">
            <span className="text-[11px] font-medium text-muted block truncate">Discovered Records</span>
            <span className="text-2xl font-bold text-foreground block font-mono">
              {metrics.totalRecords.toLocaleString()}
            </span>
            <span className="text-[10px] text-muted block">IndexedDB items</span>
          </Card>

          <Card className="p-3.5 space-y-1 bg-surface/80 border-border/70 shadow-xs">
            <span className="text-[11px] font-medium text-muted block truncate">Discovered Files</span>
            <span className="text-2xl font-bold text-foreground block font-mono">
              {metrics.totalFiles.toLocaleString()}
            </span>
            <span className="text-[10px] text-muted block">Files &amp; storage stores</span>
          </Card>

          <Card className="p-3.5 space-y-1 bg-surface/80 border-border/70 shadow-xs">
            <span className="text-[11px] font-medium text-muted block truncate">Estimated Storage</span>
            <span className="text-2xl font-bold text-primary block font-mono">
              {formatBytes(metrics.totalSizeBytes)}
            </span>
            <span className="text-[10px] text-muted block">Actual measured volume</span>
          </Card>

          <Card className="p-3.5 space-y-1 bg-surface/80 border-border/70 shadow-xs">
            <span className="text-[11px] font-medium text-muted block truncate">Storage Mechanisms</span>
            <span className="text-2xl font-bold text-foreground block font-mono">
              {metrics.supportedMechanismsCount}
            </span>
            <span className="text-[10px] text-muted block">IDB, LS, Cache, OPFS</span>
          </Card>

          <Card className="p-3.5 space-y-1 bg-surface/80 border-border/70 shadow-xs">
            <span className="text-[11px] font-medium text-muted block truncate">User-Owned Records</span>
            <span className="text-2xl font-bold text-emerald-400 block font-mono">
              {metrics.currentUserRecords.toLocaleString()}
            </span>
            <span className="text-[10px] text-muted block">Eligible for export</span>
          </Card>

          <Card className="p-3.5 space-y-1 bg-surface/80 border-border/70 shadow-xs">
            <span className="text-[11px] font-medium text-muted block truncate">Unassigned / Other</span>
            <span className="text-2xl font-bold text-amber-400 block font-mono">
              {metrics.unassignedRecords.toLocaleString()}
            </span>
            <span className="text-[10px] text-muted block">Unclassified data</span>
          </Card>

          <Card className="p-3.5 space-y-1 bg-surface/80 border-border/70 shadow-xs">
            <span className="text-[11px] font-medium text-muted block truncate">Protected Entries</span>
            <span className="text-2xl font-bold text-sky-400 block font-mono">
              {metrics.protectedEntries.toLocaleString()}
            </span>
            <span className="text-[10px] text-muted block">Safe from deletion</span>
          </Card>
        </div>
      </div>

      {/* 3. AREA B: Browser Data Explorer */}
      <div className="space-y-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <Eye className="h-4 w-4 text-primary" />
              <h2 className="text-base font-bold text-foreground">Browser Data Explorer</h2>
              <span className="text-xs text-muted">| مستكشف بيانات المتصفح</span>
            </div>
            <p className="text-xs text-muted mt-0.5">
              Inspect granular stored records, verify schemas, filter by mechanism, and preview read-only contents safely.
            </p>
          </div>

          {/* Search & Filter Bar */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-[200px] flex-1 sm:flex-initial">
              <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search local records..."
                className="w-full rounded-lg border border-border bg-surface-raised pl-8 pr-3 py-1.5 text-xs text-foreground placeholder:text-muted focus:border-primary focus:ring-1 focus:ring-primary outline-hidden"
              />
            </div>

            {/* Storage Mechanism Pill Selector */}
            <select
              value={selectedMechanism}
              onChange={(e) => setSelectedMechanism(e.target.value)}
              className="rounded-lg border border-border bg-surface-raised px-2.5 py-1.5 text-xs text-foreground focus:border-primary outline-hidden"
            >
              <option value="ALL">All Mechanisms</option>
              <option value="IndexedDB">IndexedDB</option>
              <option value="localStorage">localStorage</option>
              <option value="Cache Storage">Cache Storage</option>
              <option value="OPFS">OPFS</option>
            </select>

            {/* Category Filter */}
            <select
              value={selectedCategory}
              onChange={(e) => setSelectedCategory(e.target.value)}
              className="rounded-lg border border-border bg-surface-raised px-2.5 py-1.5 text-xs text-foreground focus:border-primary outline-hidden"
            >
              <option value="ALL">All Categories</option>
              <option value="SAVED_ITEMS">SAVED_ITEMS</option>
              <option value="PLAYLIST">PLAYLIST</option>
              <option value="SEARCH_HISTORY">SEARCH_HISTORY</option>
              <option value="RESEARCH_QUEUE">RESEARCH_QUEUE</option>
              <option value="REFERENCES">REFERENCES</option>
            </select>
          </div>
        </div>

        {/* Dataset Categories Groups */}
        <div className="space-y-3">
          {(["SAVED_ITEMS", "PLAYLIST", "SEARCH_HISTORY", "RESEARCH_QUEUE", "REFERENCES"] as LocalDatasetCategory[]).map(
            (category) => {
              const catEntries = groupedByCategory[category];
              if (selectedCategory !== "ALL" && selectedCategory !== category) return null;
              const isExpanded = expandedGroups[category] ?? true;
              const totalItemsInGroup = catEntries.reduce((sum, e) => sum + e.recordCount, 0);
              const totalBytesInGroup = catEntries.reduce((sum, e) => sum + e.sizeBytes, 0);

              return (
                <div key={category} className="rounded-xl border border-border/80 bg-surface/90 overflow-hidden shadow-xs">
                  {/* Category Header */}
                  <button
                    type="button"
                    onClick={() => toggleGroup(category)}
                    className="w-full flex items-center justify-between p-3.5 bg-surface-raised/40 hover:bg-surface-raised transition-colors text-left"
                  >
                    <div className="flex items-center gap-2.5">
                      {isExpanded ? (
                        <ChevronDown className="h-4 w-4 text-muted" />
                      ) : (
                        <ChevronRight className="h-4 w-4 text-muted" />
                      )}
                      <span className="font-bold text-sm text-foreground">{category.replace("_", " ")}</span>
                      <Badge tone="neutral" className="text-[11px]">
                        {catEntries.length} sources ({totalItemsInGroup} records)
                      </Badge>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-xs font-mono text-muted">{formatBytes(totalBytesInGroup)}</span>
                    </div>
                  </button>

                  {/* Expandable Entries List */}
                  {isExpanded && (
                    <div className="p-3 divide-y divide-border/40">
                      {catEntries.length === 0 ? (
                        <p className="text-xs text-muted text-center py-4">No records found matching criteria in this category.</p>
                      ) : (
                        catEntries.map((entry) => (
                          <div
                            key={entry.id}
                            className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 py-2.5 px-2 hover:bg-surface-raised/50 rounded-lg transition-colors text-xs"
                          >
                            <div className="space-y-1 min-w-0 flex-1">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="font-semibold text-foreground truncate">{entry.name}</span>
                                <Badge tone="neutral" className="text-[10px]">
                                  {entry.mechanism}
                                </Badge>
                                {entry.isProtected ? (
                                  <Badge tone="warning" className="text-[10px] gap-1">
                                    <Lock className="h-2.5 w-2.5" /> Protected
                                  </Badge>
                                ) : (
                                  <Badge tone="success" className="text-[10px] gap-1">
                                    <ShieldCheck className="h-2.5 w-2.5" /> Eligible
                                  </Badge>
                                )}
                              </div>
                              <div className="flex items-center gap-3 text-[11px] text-muted flex-wrap">
                                <span className="font-mono text-muted/80">{entry.storageKey}</span>
                                <span>•</span>
                                <span>{entry.mimeType}</span>
                                <span>•</span>
                                <span className="font-mono">{formatBytes(entry.sizeBytes)}</span>
                              </div>
                            </div>

                            {/* Action Buttons */}
                            <div className="flex items-center gap-2 shrink-0">
                              <Button
                                variant="secondary"
                                onClick={() => setSelectedEntryForPreview(entry)}
                                className="h-7 px-2.5 text-xs gap-1.5"
                              >
                                <Eye className="h-3.5 w-3.5" />
                                <span>Inspect</span>
                              </Button>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  )}
                </div>
              );
            }
          )}
        </div>
      </div>

      {/* 4. AREA C: Separate Operations (Backup & Cleanup) */}
      <div className="space-y-6 pt-4 border-t border-border/80">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* OPERATION 1: Local Data Backup & Export */}
          <Card className="p-6 border-primary/30 bg-primary/5 space-y-4 flex flex-col justify-between shadow-xs">
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-primary">
                <Archive className="h-5 w-5" />
                <h3 className="text-base font-bold text-foreground">
                  Local Data Backup &amp; Export
                </h3>
              </div>
              <p className="text-xs font-semibold text-primary/80" dir="rtl">
                النسخ الاحتياطي وتصدير البيانات المحلية
              </p>
              <p className="text-xs text-muted leading-relaxed">
                Scans all local IndexedDB and LocalStorage stores, excludes protected tokens, structures items into standard
                directories, generates a verifiable PKZIP 2.0 archive with SHA-256 checksums, and provides an instant browser download.
              </p>
              <div className="rounded-lg bg-surface/80 p-2.5 border border-border/60 text-[11px] text-muted space-y-1">
                <p className="flex items-center gap-1.5 text-foreground font-semibold">
                  <ShieldCheck className="h-3.5 w-3.5 text-emerald-400" />
                  100% Read-Only Safety Guarantee
                </p>
                <p>This action never alters or removes any stored data from your browser or device.</p>
              </div>
            </div>

            <div className="space-y-3 pt-2">
              <Button
                variant="primary"
                onClick={handleScanAndDownload}
                disabled={isExporting || isScanning}
                className="w-full gap-2 font-bold py-2.5"
              >
                {isExporting ? (
                  <RefreshCw className="h-4 w-4 animate-spin" />
                ) : (
                  <Download className="h-4 w-4" />
                )}
                <span>Scan &amp; Download My Local Data (فحص وتنزيل بياناتي المحلية)</span>
              </Button>
              {exportMessage && (
                <p className="text-xs text-primary text-center font-medium animate-in fade-in">
                  {exportMessage}
                </p>
              )}
            </div>
          </Card>

          {/* OPERATION 2: Local Data Cleanup & Deletion */}
          <Card className="p-6 border-danger/30 bg-danger/5 space-y-4 flex flex-col justify-between shadow-xs">
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-danger">
                <Trash2 className="h-5 w-5" />
                <h3 className="text-base font-bold text-foreground">
                  Local Data Cleanup &amp; Permanent Deletion
                </h3>
              </div>
              <p className="text-xs font-semibold text-danger/80" dir="rtl">
                تنظيف وحذف البيانات المحلية
              </p>
              <p className="text-xs text-muted leading-relaxed">
                Permanently purge eligible browser storage records. Protected authentication sessions and core configs are
                automatically safeguarded. Requires entering the explicit Arabic confirmation phrase before deletion.
              </p>
              <div className="rounded-lg bg-surface/80 p-2.5 border border-border/60 text-[11px] text-muted space-y-1">
                <p className="flex items-center gap-1.5 text-danger font-semibold">
                  <ShieldAlert className="h-3.5 w-3.5 text-danger" />
                  Permanent Client Storage Purge
                </p>
                <p>Deletion is strictly independent of backups and must be explicitly authorized.</p>
              </div>
            </div>

            <div className="space-y-3 pt-2">
              <Button
                variant="danger"
                onClick={() => setIsDeletionModalOpen(true)}
                disabled={isScanning || isExporting}
                className="w-full gap-2 font-bold py-2.5"
              >
                <Trash2 className="h-4 w-4" />
                <span>Delete My Local Data (حذف بياناتي المحلية)</span>
              </Button>
            </div>
          </Card>
        </div>
      </div>

      {/* AREA D: Cloud Sync Journal & Local Dataset Catalog (سجل المزامنة والكتالوج السحابي) */}
      <div className="space-y-4 border-t border-border/80 pt-8">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Layers className="h-5 w-5 text-primary" />
            <h2 className="text-base font-bold text-foreground">
              Cloud Sync Journal &amp; Local Dataset Catalog
            </h2>
            <span className="text-xs text-muted" dir="rtl">
              | سجل المزامنة والكتالوج السحابي المحلي
            </span>
          </div>
          <Badge tone="primary" className="text-xs w-fit">
            IndexedDB v4 Storage
          </Badge>
        </div>
        <p className="text-xs text-muted">
          Authoritative local state of cloud-synchronized datasets, hydrated revisions, and journaled synchronization batches.
        </p>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Panel 1: Local Dataset Catalog */}
          <Card className="p-4 space-y-3 bg-surface/80 border-border/70 shadow-xs">
            <div className="flex items-center justify-between border-b border-border/60 pb-2">
              <span className="text-xs font-bold text-foreground flex items-center gap-1.5">
                <Database className="h-4 w-4 text-primary" />
                Dataset Catalog Entries
              </span>
              <span className="font-mono text-[11px] text-muted">
                {catalogEntries.length} tracked
              </span>
            </div>

            {catalogEntries.length === 0 ? (
              <p className="text-xs text-muted py-4 text-center italic">
                Catalog initializing or will populate on next sync/hydration.
              </p>
            ) : (
              <div className="space-y-2">
                {catalogEntries.map((cat) => (
                  <div
                    key={cat.datasetType}
                    className="p-2.5 rounded-lg border border-border/60 bg-surface-muted/30 text-xs space-y-1"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-foreground">
                        {cat.datasetType}
                      </span>
                      <Badge
                        tone={
                          cat.syncStatus === "SYNCED"
                            ? "success"
                            : cat.syncStatus === "SYNCING"
                            ? "primary"
                            : cat.syncStatus === "FAILED"
                            ? "danger"
                            : "neutral"
                        }
                        className="text-[10px] py-0.5"
                      >
                        {cat.syncStatus}
                      </Badge>
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-[11px] text-muted pt-1">
                      <div>
                        Local Rev: <strong className="text-foreground">{cat.localRevision}</strong>
                      </div>
                      <div>
                        Hydrated Rev: <strong className="text-foreground">{cat.lastHydratedRevision}</strong>
                      </div>
                      <div>
                        Pending Ops: <strong className="text-foreground">{cat.pendingOperationCount}</strong>
                      </div>
                      <div className="truncate">
                        Last Gen: <code className="text-primary font-mono text-[10px]">{cat.lastHydratedGenerationId || "None"}</code>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>

          {/* Panel 2: Sync Journal Batches */}
          <Card className="p-4 space-y-3 bg-surface/80 border-border/70 shadow-xs">
            <div className="flex items-center justify-between border-b border-border/60 pb-2">
              <span className="text-xs font-bold text-foreground flex items-center gap-1.5">
                <Archive className="h-4 w-4 text-primary" />
                Recent Sync Journal Batches
              </span>
              <span className="font-mono text-[11px] text-muted">
                {journalBatches.length} recorded
              </span>
            </div>

            {journalBatches.length === 0 ? (
              <p className="text-xs text-muted py-4 text-center italic">
                No recent sync batches journaled in this browser session.
              </p>
            ) : (
              <div className="space-y-2 max-h-72 overflow-y-auto">
                {journalBatches.slice(0, 8).map((batch) => (
                  <div
                    key={batch.syncBatchId}
                    className="p-2.5 rounded-lg border border-border/60 bg-surface-muted/30 text-xs space-y-1"
                  >
                    <div className="flex items-center justify-between">
                      <code className="text-primary font-mono text-[10px] font-bold">
                        {batch.syncBatchId}
                      </code>
                      <Badge
                        tone={
                          batch.batchStatus === "COMMITTED"
                            ? "success"
                            : batch.batchStatus === "UPLOADING"
                            ? "primary"
                            : batch.batchStatus === "FAILED"
                            ? "danger"
                            : "warning"
                        }
                        className="text-[10px] py-0.5"
                      >
                        {batch.batchStatus}
                      </Badge>
                    </div>
                    <div className="text-[11px] text-muted flex items-center justify-between">
                      <span>Datasets: {batch.affectedDatasets.join(", ")}</span>
                      <span>{new Date(batch.createdAt).toLocaleTimeString()}</span>
                    </div>
                    {batch.lastErrorCode && (
                      <p className="text-[10px] text-danger font-mono truncate">
                        Error: {batch.lastErrorCode}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      </div>

      {/* 5. Safe Data Preview Modal / Drawer */}
      {selectedEntryForPreview && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-xs animate-in fade-in"
        >
          <div className="relative w-full max-w-2xl rounded-2xl border border-border bg-surface shadow-2xl overflow-hidden flex flex-col max-h-[85vh]">
            <div className="flex items-center justify-between border-b border-border p-4 bg-surface-raised">
              <div className="flex items-center gap-2 min-w-0">
                <FileCode className="h-4 w-4 text-primary shrink-0" />
                <h3 className="font-bold text-sm text-foreground truncate">
                  Inspect: {selectedEntryForPreview.name}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setSelectedEntryForPreview(null)}
                className="rounded-lg p-1 text-muted hover:bg-surface-muted hover:text-foreground"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-3 text-xs">
              <div className="flex items-center justify-between text-muted text-[11px] pb-2 border-b border-border/50">
                <span>Storage: <strong>{selectedEntryForPreview.mechanism}</strong></span>
                <span>Category: <strong>{selectedEntryForPreview.category}</strong></span>
                <span>Size: <strong>{formatBytes(selectedEntryForPreview.sizeBytes)}</strong></span>
              </div>

              {selectedEntryForPreview.isProtected ? (
                <div className="p-4 rounded-xl border border-sky-400/30 bg-sky-500/10 text-sky-300 space-y-1">
                  <p className="font-semibold flex items-center gap-1.5">
                    <Lock className="h-4 w-4" /> Protected Entry
                  </p>
                  <p>{selectedEntryForPreview.protectionReason || "This entry is protected from inspection and export for security."}</p>
                </div>
              ) : (
                <div className="relative rounded-lg border border-border bg-surface-muted/50 p-3 font-mono text-[11px] max-h-96 overflow-y-auto">
                  <div className="absolute right-2 top-2">
                    <Button
                      variant="secondary"
                      onClick={handleCopyPreview}
                      className="h-6 px-2 text-[10px] gap-1"
                    >
                      {copiedPreview ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                      <span>{copiedPreview ? "Copied" : "Copy JSON"}</span>
                    </Button>
                  </div>
                  <pre className="whitespace-pre-wrap break-all text-foreground/90">
                    {typeof selectedEntryForPreview.previewData === "string"
                      ? selectedEntryForPreview.previewData
                      : JSON.stringify(selectedEntryForPreview.previewData, null, 2)}
                  </pre>
                </div>
              )}
            </div>

            <div className="flex items-center justify-end p-3 border-t border-border bg-surface-raised">
              <Button variant="secondary" onClick={() => setSelectedEntryForPreview(null)} className="h-8 px-3 text-xs">
                Close Preview
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* 6. Permanent Deletion Confirmation Modal */}
      <LocalDataDeletionModal
        isOpen={isDeletionModalOpen}
        onClose={() => setIsDeletionModalOpen(false)}
        entries={entries}
        onDeletionComplete={handleDeletionFinished}
      />
    </div>
  );
}
