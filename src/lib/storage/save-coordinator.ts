import { syncCoordinator, type SyncStatus, type SyncStateEvent } from "../sync/sync-coordinator";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * YouTube Discovery — Save Coordinator Bridge (Backward-Compatibility)
 * ──────────────────────────────────────────────────────────────────────────
 * Delegates to the canonical 2026 SyncCoordinator.
 * Preserves existing types and method signatures while leveraging the
 * high-reliability Cloudflare R2 + Supabase pipeline.
 * ═══════════════════════════════════════════════════════════════════════════
 */

export type SaveCoordinatorStatus =
  | "SAVED_LOCALLY"
  | "SYNCING"
  | "CLOUD_SYNCED"
  | "SYNC_FAILED"
  | "CONFLICT"
  | "OFFLINE";

export interface SaveSyncEvent {
  status: SaveCoordinatorStatus;
  pendingCount: number;
  lastSyncedAt?: string;
  errorMessage?: string;
}

type SyncListener = (event: SaveSyncEvent) => void;

function mapStatus(status: SyncStatus): SaveCoordinatorStatus {
  switch (status) {
    case "IDLE":
      return "SAVED_LOCALLY";
    case "SYNCING":
      return "SYNCING";
    case "SYNCED":
      return "CLOUD_SYNCED";
    case "FAILED":
      return "SYNC_FAILED";
    case "OFFLINE":
      return "OFFLINE";
  }
}

class SaveCoordinatorBridge {
  public subscribe(listener: SyncListener): () => void {
    return syncCoordinator.subscribe((evt: SyncStateEvent) => {
      listener({
        status: mapStatus(evt.status),
        pendingCount: evt.summary.totalPending,
        lastSyncedAt: evt.lastSuccessfulSyncAt || undefined,
        errorMessage: evt.errorMessage,
      });
    });
  }

  public getCurrentStatus(): SaveCoordinatorStatus {
    return mapStatus(syncCoordinator.getStatus());
  }

  public async saveAll(): Promise<{ ok: boolean; committedCount: number; error?: string }> {
    const res = await syncCoordinator.saveAll();
    return {
      ok: res.ok,
      committedCount: res.syncedCount,
      error: res.error,
    };
  }

  public async exportOfflineBackup(): Promise<void> {
    return syncCoordinator.exportOfflineBackup();
  }
}

export const saveCoordinator = new SaveCoordinatorBridge();
