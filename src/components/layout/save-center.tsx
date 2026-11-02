"use client";

import {
  Cloud,
  CloudOff,
  Download,
  HardDrive,
  Loader2,
  RefreshCw,
  AlertTriangle,
} from "lucide-react";
import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  saveCoordinator,
  type SaveCoordinatorStatus,
  type SaveSyncEvent,
} from "@/lib/storage/save-coordinator";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * YouTube Discovery — Save Center Global Control (v1.4)
 * ──────────────────────────────────────────────────────────────────────────
 * Displays live durability badges:
 *   - Saved Locally (Green indicator)
 *   - Syncing (Spinning indicator)
 *   - Cloud Synced (Cloud checkmark)
 *   - Sync Failed (Retry button)
 *   - Conflict (Conflict notification)
 * Offers "Save All" action and Offline Disaster Recovery JSON backup.
 * ═══════════════════════════════════════════════════════════════════════════
 */

export function SaveCenter() {
  const [syncEvent, setSyncEvent] = useState<SaveSyncEvent>({
    status: "SAVED_LOCALLY",
    pendingCount: 0,
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const unsubscribe = saveCoordinator.subscribe((evt) => {
      setSyncEvent(evt);
    });
    return unsubscribe;
  }, []);

  async function handleSaveAll() {
    setSaving(true);
    try {
      await saveCoordinator.saveAll();
    } finally {
      setSaving(false);
    }
  }

  async function handleExportBackup() {
    try {
      await saveCoordinator.exportOfflineBackup();
    } catch {
      // Handled
    }
  }

  function renderStatusBadge(status: SaveCoordinatorStatus) {
    switch (status) {
      case "SAVED_LOCALLY":
        return (
          <Badge tone="success" className="gap-1.5 py-1 px-2.5">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
            <HardDrive className="h-3.5 w-3.5" />
            <span>Saved Locally</span>
          </Badge>
        );
      case "SYNCING":
        return (
          <Badge tone="primary" className="gap-1.5 py-1 px-2.5">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            <span>Syncing to Cloud…</span>
          </Badge>
        );
      case "CLOUD_SYNCED":
        return (
          <Badge tone="success" className="gap-1.5 py-1 px-2.5">
            <Cloud className="h-3.5 w-3.5 text-emerald-500" />
            <span>Cloud Synced</span>
          </Badge>
        );
      case "SYNC_FAILED":
        return (
          <Badge tone="danger" className="gap-1.5 py-1 px-2.5">
            <CloudOff className="h-3.5 w-3.5" />
            <span>Sync Failed</span>
          </Badge>
        );
      case "CONFLICT":
        return (
          <Badge tone="warning" className="gap-1.5 py-1 px-2.5">
            <AlertTriangle className="h-3.5 w-3.5" />
            <span>Revision Conflict</span>
          </Badge>
        );
    }
  }

  return (
    <div className="flex items-center gap-2">
      {renderStatusBadge(syncEvent.status)}

      <Button
        variant="ghost"
        onClick={handleSaveAll}
        disabled={saving || syncEvent.status === "SYNCING"}
        className="h-8 gap-1.5 px-2.5 text-xs text-muted hover:text-foreground"
        title="Synchronize local changes to private Supabase Storage"
      >
        <RefreshCw className={`h-3.5 w-3.5 ${saving ? "animate-spin" : ""}`} />
        <span className="hidden sm:inline">Save All</span>
      </Button>

      <Button
        variant="ghost"
        onClick={handleExportBackup}
        className="h-8 w-8 p-0 text-muted hover:text-foreground"
        title="Export Offline Disaster Recovery Backup (JSON)"
      >
        <Download className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}
