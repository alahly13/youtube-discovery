"use client";

import {
  Cloud,
  CloudOff,
  Download,
  HardDrive,
  Loader2,
  RefreshCw,
  ChevronDown,
  Layers,
  Database,
  CloudDownload,
} from "lucide-react";
import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  syncCoordinator,
  type SyncStatus,
  type SyncStateEvent,
} from "@/lib/sync/sync-coordinator";
import { useCloudHydration } from "@/lib/sync/use-cloud-hydration";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * YouTube Discovery — Global Cloud Sync Center Control (2026 Production)
 * ──────────────────────────────────────────────────────────────────────────
 * Features:
 *   - Prominent "Save All New Actions & Data" ("حفظ جميع التغييرات والبيانات الجديدة") button
 *   - Real-time pending operations counter and dataset breakdown
 *   - Automated 12-hour background sync status indicator
 *   - Direct Cloudflare R2 Worker batch upload trigger
 *   - Active Cloud Hydration progress and manual restore trigger
 *   - Zero data loss: Local IndexedDB outbox remains until remote confirmation
 * ═══════════════════════════════════════════════════════════════════════════
 */

export function SaveCenter() {
  const [syncEvent, setSyncEvent] = useState<SyncStateEvent>({
    status: "IDLE",
    summary: {
      totalPending: 0,
      byDataset: {
        SAVED_ITEMS: 0,
        PLAYLIST: 0,
        SEARCH_HISTORY: 0,
        RESEARCH_QUEUE: 0,
        REFERENCES: 0,
      },
      estimatedBytes: 0,
    },
    lastSuccessfulSyncAt: null,
    nextAutoSyncAt: null,
  });
  const [saving, setSaving] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);

  const ownerId = syncCoordinator.getOwnerId();
  const hydration = useCloudHydration(ownerId, false);

  useEffect(() => {
    const unsubscribe = syncCoordinator.subscribe((evt) => {
      setSyncEvent(evt);
    });
    return unsubscribe;
  }, []);

  async function handleSaveAll() {
    setSaving(true);
    try {
      await syncCoordinator.saveAll();
    } finally {
      setSaving(false);
    }
  }

  async function handleExportBackup() {
    try {
      await syncCoordinator.exportOfflineBackup();
    } catch (err) {
      console.error("[save-center] Export failed:", err);
    }
  }

  const pendingCount = syncEvent.summary.totalPending;

  function renderStatusBadge(status: SyncStatus) {
    if (hydration.isHydrating) {
      return (
        <Badge tone="primary" className="gap-1.5 py-1 px-2.5">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          <span>Restoring from Cloud ({hydration.completedDatasets}/{hydration.totalDatasets || 5})…</span>
        </Badge>
      );
    }

    if (status === "SYNCING" || saving) {
      return (
        <Badge tone="primary" className="gap-1.5 py-1 px-2.5">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          <span>Syncing to Cloudflare R2…</span>
        </Badge>
      );
    }

    if (pendingCount > 0) {
      return (
        <span
          role="button"
          tabIndex={0}
          className="cursor-pointer inline-flex"
          onClick={() => setShowDropdown((p) => !p)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") setShowDropdown((p) => !p);
          }}
        >
          <Badge tone="warning" className="gap-1.5 py-1 px-2.5">
            <span className="h-2 w-2 rounded-full bg-amber-500 animate-ping" />
            <HardDrive className="h-3.5 w-3.5" />
            <span>Saved Locally — {pendingCount} Pending Sync</span>
          </Badge>
        </span>
      );
    }

    switch (status) {
      case "SYNCED":
      case "IDLE":
        return (
          <Badge tone="success" className="gap-1.5 py-1 px-2.5">
            <Cloud className="h-3.5 w-3.5 text-emerald-500" />
            <span>Cloud Synced</span>
          </Badge>
        );
      case "FAILED":
        return (
          <Badge tone="danger" className="gap-1.5 py-1 px-2.5">
            <CloudOff className="h-3.5 w-3.5" />
            <span>Sync Failed — Retry</span>
          </Badge>
        );
      case "OFFLINE":
        return (
          <Badge tone="neutral" className="gap-1.5 py-1 px-2.5">
            <HardDrive className="h-3.5 w-3.5" />
            <span>Offline — Preserved Locally</span>
          </Badge>
        );
    }
  }

  return (
    <div className="relative flex items-center gap-2">
      {renderStatusBadge(syncEvent.status)}

      {/* Global Manual Save All Control */}
      <Button
        variant={pendingCount > 0 ? "primary" : "secondary"}
        onClick={handleSaveAll}
        disabled={saving || syncEvent.status === "SYNCING" || hydration.isHydrating}
        className={`h-9 gap-2 px-3 text-xs font-semibold shadow-xs cursor-pointer ${
          pendingCount > 0
            ? "bg-primary text-primary-foreground hover:bg-primary/90 animate-pulse"
            : "text-muted hover:text-foreground"
        }`}
        title="حفظ جميع التغييرات والبيانات الجديدة إلى Cloudflare R2 و Supabase"
        aria-label="Save All New Actions & Data"
      >
        <RefreshCw className={`h-4 w-4 ${saving ? "animate-spin" : ""}`} />
        <span className="hidden sm:inline">Save All New Actions & Data</span>
        <span className="sm:hidden">Save All</span>
        {pendingCount > 0 && (
          <span className="inline-flex items-center justify-center rounded-full bg-primary-foreground text-primary px-1.5 py-0.2 text-[10px] font-bold">
            {pendingCount}
          </span>
        )}
      </Button>

      {/* Dataset Breakdown Popover Toggle */}
      <button
        type="button"
        onClick={() => setShowDropdown((p) => !p)}
        className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-surface text-muted hover:bg-surface-muted hover:text-foreground transition-colors cursor-pointer"
        title="View pending dataset breakdown"
        aria-label="View dataset breakdown"
      >
        <ChevronDown className="h-3.5 w-3.5" />
      </button>

      {/* Offline Disaster Recovery JSON Backup */}
      <Button
        variant="ghost"
        onClick={handleExportBackup}
        className="h-8 w-8 p-0 text-muted hover:text-foreground cursor-pointer"
        title="Export Offline Disaster Recovery Backup (JSON)"
        aria-label="Export backup"
      >
        <Download className="h-4 w-4" />
      </Button>

      {/* Breakdown Dropdown Menu */}
      {showDropdown && (
        <div className="absolute right-0 top-11 z-50 w-76 rounded-xl border border-border bg-surface p-3.5 shadow-xl animate-in fade-in zoom-in-95">
          <div className="mb-2 flex items-center justify-between border-b border-border/60 pb-2">
            <div className="flex items-center gap-1.5 font-semibold text-xs text-foreground">
              <Layers className="h-4 w-4 text-primary" />
              <span>Pending Cloud Sync Queue</span>
            </div>
            <span className="font-mono text-[11px] text-muted">{pendingCount} total</span>
          </div>

          <div className="space-y-1.5 text-xs">
            <div className="flex items-center justify-between py-1 px-1.5 rounded-md bg-surface-muted/50">
              <span className="text-muted">Saved Items</span>
              <span className="font-semibold text-foreground">
                {syncEvent.summary.byDataset.SAVED_ITEMS}
              </span>
            </div>
            <div className="flex items-center justify-between py-1 px-1.5 rounded-md bg-surface-muted/50">
              <span className="text-muted">Playlists</span>
              <span className="font-semibold text-foreground">
                {syncEvent.summary.byDataset.PLAYLIST}
              </span>
            </div>
            <div className="flex items-center justify-between py-1 px-1.5 rounded-md bg-surface-muted/50">
              <span className="text-muted">Search History</span>
              <span className="font-semibold text-foreground">
                {syncEvent.summary.byDataset.SEARCH_HISTORY}
              </span>
            </div>
            <div className="flex items-center justify-between py-1 px-1.5 rounded-md bg-surface-muted/50">
              <span className="text-muted">Research Queue</span>
              <span className="font-semibold text-foreground">
                {syncEvent.summary.byDataset.RESEARCH_QUEUE}
              </span>
            </div>
            <div className="flex items-center justify-between py-1 px-1.5 rounded-md bg-surface-muted/50">
              <span className="text-muted">Saved References</span>
              <span className="font-semibold text-foreground">
                {syncEvent.summary.byDataset.REFERENCES}
              </span>
            </div>
          </div>

          <div className="mt-3 border-t border-border/60 pt-2 text-[11px] text-muted space-y-1">
            <div className="flex items-center justify-between">
              <span>Auto-Sync Schedule:</span>
              <span className="font-semibold text-foreground">Every 12h</span>
            </div>
            {syncEvent.lastSuccessfulSyncAt && (
              <div className="flex items-center justify-between">
                <span>Last Cloud Sync:</span>
                <span className="text-foreground">
                  {new Date(syncEvent.lastSuccessfulSyncAt).toLocaleTimeString()}
                </span>
              </div>
            )}
            <div className="flex items-center justify-between">
              <span>Cloud Hydration:</span>
              <span className="font-semibold text-foreground">
                {hydration.state === "READY"
                  ? "Synchronized"
                  : hydration.isHydrating
                  ? "Restoring…"
                  : hydration.state}
              </span>
            </div>
          </div>

          <div className="mt-3 flex flex-col gap-2">
            <Button
              variant="secondary"
              onClick={() => {
                setShowDropdown(false);
                handleSaveAll();
              }}
              disabled={saving || pendingCount === 0 || hydration.isHydrating}
              className="w-full h-8 text-xs font-semibold cursor-pointer"
            >
              Sync Pending Changes Now
            </Button>

            <Button
              variant="secondary"
              onClick={() => {
                setShowDropdown(false);
                hydration.retryHydration();
              }}
              disabled={hydration.isHydrating}
              className="w-full h-8 text-xs gap-1.5 text-muted hover:text-foreground cursor-pointer"
            >
              <CloudDownload className="h-3.5 w-3.5" />
              <span>Restore from Cloud R2</span>
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
