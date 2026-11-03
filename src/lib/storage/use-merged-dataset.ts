"use client";

import { useEffect, useState, useMemo } from "react";
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
 *   3. Re-renders automatically when local outbox or sync coordinator changes.
 * ═══════════════════════════════════════════════════════════════════════════
 */

export interface MergedDatasetResult<T> {
  items: T[];
  pendingCount: number;
  isLoading: boolean;
  refresh: () => void;
}

export function useMergedDataset<T extends Record<string, unknown>>(
  datasetType: CanonicalDatasetType,
  serverItems: T[] = [],
  ownerId = "asdy-admin"
): MergedDatasetResult<T> {
  const [localItems, setLocalItems] = useState<T[]>([]);
  const [pendingOps, setPendingOps] = useState<PendingOperation[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [tick, setTick] = useState(0);

  const refresh = () => setTick((prev) => prev + 1);

  // Load local IndexedDB state
  useEffect(() => {
    let cancelled = false;

    async function load() {
      setIsLoading(true);
      try {
        const [entities, ops] = await Promise.all([
          getLocalEntities<T>(ownerId, datasetType),
          getPendingOperations(ownerId),
        ]);

        if (!cancelled) {
          setLocalItems(entities);
          setPendingOps(ops.filter((o) => o.datasetType === datasetType));
          setIsLoading(false);
        }
      } catch (err) {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }

    load();

    const unsubscribe = syncCoordinator.subscribe(() => {
      load();
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [datasetType, ownerId, tick]);

  // Reconcile serverItems + localItems + pendingOps
  const items = useMemo(() => {
    // 1. Identify tombstones from pending DELETE operations
    const deletedIds = new Set<string>();
    const pendingUpserts = new Map<string, T>();

    for (const op of pendingOps) {
      if (op.operationType === "DELETE") {
        deletedIds.add(op.entityId);
      } else if (op.payload) {
        pendingUpserts.set(op.entityId, op.payload as T);
      }
    }

    // 2. Start with local items (which already include offline saves)
    const mergedMap = new Map<string, T>();

    // Add server items first if not deleted locally
    for (const s of serverItems) {
      const id = (s.platformItemId as string) || (s.id as string);
      if (id && !deletedIds.has(id)) {
        mergedMap.set(id, s);
      }
    }

    // Overlay local IndexedDB items
    for (const l of localItems) {
      const id = (l.platformItemId as string) || (l.id as string);
      if (id && !deletedIds.has(id)) {
        mergedMap.set(id, l);
      }
    }

    // Overlay pending uncommitted upserts
    for (const [id, up] of pendingUpserts.entries()) {
      if (!deletedIds.has(id)) {
        mergedMap.set(id, { ...mergedMap.get(id), ...up });
      }
    }

    return Array.from(mergedMap.values());
  }, [serverItems, localItems, pendingOps]);

  return {
    items,
    pendingCount: pendingOps.length,
    isLoading,
    refresh,
  };
}
