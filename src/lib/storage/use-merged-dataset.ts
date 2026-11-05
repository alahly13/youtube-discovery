"use client";

import { useEffect, useState, useMemo, useCallback } from "react";
import {
  getLocalEntities,
  getPendingOperations,
  type CanonicalDatasetType,
  type PendingOperation,
} from "./indexeddb-store";
import { syncCoordinator } from "../sync/sync-coordinator";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * YouTube Discovery — Merged Read Model Hook (2026 Production)
 * ──────────────────────────────────────────────────────────────────────────
 * Scope: Seamlessly reconciles server-committed state with local IndexedDB
 *        projections and pending Outbox tombstones/upserts.
 *
 * Guarantees:
 *   1. Immediate local visibility: Local saves appear instantly without waiting
 *      for cloud sync.
 *   2. Immediate local tombstoning: Local deletes remove items from view immediately.
 *   3. Strict Deduplication: The same logical item (ownerId + platformItemId/id)
 *      NEVER appears twice in the UI across local pending and cloud committed.
 *   4. Clear Lifecycle Separation:
 *        - `localPendingItems`: Active outbox mutations or _localStatus === "LOCAL_PENDING"
 *        - `cloudCommittedItems`: Confirmed R2/PostgreSQL committed items without pending writes
 *   5. Realtime Reactivity: Subscribes to outbox changes, custom mutation events,
 *      and hydration completion.
 * ═══════════════════════════════════════════════════════════════════════════
 */

export interface MergedDatasetResult<T> {
  items: T[];
  localPendingItems: T[];
  cloudCommittedItems: T[];
  pendingCount: number;
  isLoading: boolean;
  refresh: () => void;
}

/**
 * Reads the stable identity of a dataset entity without assuming a concrete
 * record shape. Saved items use `platformItemId`; references/playlists use
 * `id`. Never falls back to title or array position.
 */
function entityIdentity(item: unknown): string {
  if (!item || typeof item !== "object") return "";
  const record = item as Record<string, unknown>;
  const platformId = typeof record.platformItemId === "string" ? record.platformItemId : "";
  const id = typeof record.id === "string" ? record.id : "";
  return (platformId || id).trim();
}

export function useMergedDataset<T extends object>(
  datasetType: CanonicalDatasetType,
  serverItems: T[] = [],
  ownerId?: string
): MergedDatasetResult<T> {
  const [activeOwnerId, setActiveOwnerId] = useState<string>(() =>
    ownerId?.trim() || syncCoordinator.getOwnerId()
  );
  const [localItems, setLocalItems] = useState<T[]>([]);
  const [pendingOps, setPendingOps] = useState<PendingOperation[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [tick, setTick] = useState(0);

  const refresh = useCallback(() => setTick((prev) => prev + 1), []);

  // Track the canonical owner. Components that pass an explicit owner keep
  // their behavior; otherwise the coordinator is the single source of truth.
  useEffect(() => {
    if (ownerId?.trim()) {
      setActiveOwnerId(ownerId.trim());
      return;
    }

    const update = () => setActiveOwnerId(syncCoordinator.getOwnerId());
    update();

    const unsubscribe = syncCoordinator.subscribe(update);
    const handleOwnerChanged = () => update();

    if (typeof window !== "undefined") {
      window.addEventListener("yt-discovery-owner-changed", handleOwnerChanged);
    }

    return () => {
      unsubscribe();
      if (typeof window !== "undefined") {
        window.removeEventListener("yt-discovery-owner-changed", handleOwnerChanged);
      }
    };
  }, [ownerId]);

  // Load local IndexedDB state
  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (!activeOwnerId) {
        // No canonical owner yet. Never read or display another partition's
        // data; the owner-changed event will trigger a real load.
        if (!cancelled) {
          setLocalItems([]);
          setPendingOps([]);
          setIsLoading(false);
        }
        return;
      }

      setIsLoading(true);
      try {
        const [entities, ops] = await Promise.all([
          getLocalEntities<T>(activeOwnerId, datasetType),
          getPendingOperations(activeOwnerId),
        ]);

        if (!cancelled) {
          setLocalItems(entities);
          setPendingOps(ops.filter((o) => o.datasetType === datasetType));
          setIsLoading(false);
        }
      } catch {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }

    load();

    const unsubscribe = syncCoordinator.subscribe(() => {
      load();
    });

    const handleDataEvent = () => {
      load();
    };

    if (typeof window !== "undefined") {
      window.addEventListener("yt-discovery-hydration-changed", handleDataEvent);
      window.addEventListener("yt-discovery-local-mutation", handleDataEvent);
      window.addEventListener("yt-discovery-local-committed", handleDataEvent);
    }

    return () => {
      cancelled = true;
      unsubscribe();
      if (typeof window !== "undefined") {
        window.removeEventListener("yt-discovery-hydration-changed", handleDataEvent);
        window.removeEventListener("yt-discovery-local-mutation", handleDataEvent);
        window.removeEventListener("yt-discovery-local-committed", handleDataEvent);
      }
    };
  }, [datasetType, activeOwnerId, tick]);

  // Reconcile and partition into local pending vs cloud committed
  const { items, localPendingItems, cloudCommittedItems } = useMemo(() => {
    const deletedIds = new Set<string>();
    const pendingEntityIds = new Set<string>();
    const pendingUpserts = new Map<string, T>();

    for (const op of pendingOps) {
      if (op.operationType === "DELETE") {
        deletedIds.add(op.entityId);
      } else {
        pendingEntityIds.add(op.entityId);
        if (op.payload) {
          pendingUpserts.set(op.entityId, op.payload as T);
        }
      }
    }

    // Map of all items keyed by canonical item ID
    const allItemsMap = new Map<string, T>();

    // 1. Add server items first if not deleted locally
    for (const s of serverItems) {
      const id = entityIdentity(s);
      if (id && !deletedIds.has(id)) {
        allItemsMap.set(id, s);
      }
    }

    // 2. Overlay local IndexedDB items (if not deleted locally)
    for (const l of localItems) {
      const id = entityIdentity(l);
      if (id && !deletedIds.has(id)) {
        allItemsMap.set(id, { ...allItemsMap.get(id), ...l });
      }
    }

    // 3. Overlay pending uncommitted upserts from outbox
    for (const [id, up] of pendingUpserts.entries()) {
      if (!deletedIds.has(id)) {
        allItemsMap.set(id, { ...allItemsMap.get(id), ...up });
      }
    }

    // 4. Strict Deduplication & Categorization
    const localPending: T[] = [];
    const cloudCommitted: T[] = [];
    const totalList: T[] = [];

    for (const [id, item] of allItemsMap.entries()) {
      totalList.push(item);
      const rawItem = item as Record<string, unknown>;

      // Determine if local pending:
      // Either explicit outbox pending op, or _localStatus is LOCAL_PENDING / PENDING_SYNC,
      // or _syncStatus is LOCAL and not marked COMMITTED
      const isPending =
        pendingEntityIds.has(id) ||
        rawItem._localStatus === "LOCAL_PENDING" ||
        rawItem._localStatus === "PENDING_SYNC" ||
        (rawItem._syncStatus === "LOCAL" && rawItem._localStatus !== "COMMITTED");

      if (isPending) {
        // Must appear ONLY in local pending
        localPending.push(item);
      } else {
        // Confirmed cloud committed
        cloudCommitted.push(item);
      }
    }

    return {
      items: totalList,
      localPendingItems: localPending,
      cloudCommittedItems: cloudCommitted,
    };
  }, [serverItems, localItems, pendingOps]);

  return {
    items,
    localPendingItems,
    cloudCommittedItems,
    pendingCount: pendingOps.length,
    isLoading,
    refresh,
  };
}
