"use client";

import { getOriginDeviceMeta } from "../device/device-identity";
import {
  applyAtomicDatasetMutations,
  createReadWriteTransaction,
  getLocalEntityById,
  IDB_STORES,
  openLocalDatabase,
  type CanonicalDatasetType,
  type UndoRedoCommandRecord,
  type UndoRedoRecordMutation,
  type UndoRedoStateRecord,
} from "../storage/indexeddb-store";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * YouTube Discovery 2026 — Persistent IndexedDB Undo / Redo Command Engine
 * ──────────────────────────────────────────────────────────────────────────
 * Architecture:
 *   - Durable client-side command log stored in IndexedDB (`undo_redo_commands`
 *     and `undo_redo_state`), strictly partitioned by `ownerId` + `deviceId`.
 *   - Supports grouped batch operations, text-edit coalescing (2.5s window),
 *     redo-branch truncation on new mutations, and reload persistence.
 *   - Checkpoints cleanly with `Save to Cloud R2`: pre-commit commands transition
 *     to `SYNCED_CLOUD` without discarding reversibility.
 *   - Post-commit Undo/Redo applies a NEW compensating local mutation and queues
 *     a NEW pending operation in the Outbox (`pending_operations`). Immutable
 *     committed Cloudflare R2 generations are NEVER rewritten or deleted.
 *   - Explicitly excluded from `local_research_reminders` (100% client-only).
 * ═══════════════════════════════════════════════════════════════════════════
 */

export type UndoRedoScope = UndoRedoCommandRecord["scope"];

export interface RecordUndoCommandInput {
  ownerId: string;
  scope: UndoRedoScope;
  datasetType: CanonicalDatasetType;
  commandType: string;
  label: string;
  coalesceKey?: string;
  changes: UndoRedoRecordMutation[];
}

export interface UndoRedoStackSummary {
  ownerId: string;
  deviceId: string;
  canUndo: boolean;
  canRedo: boolean;
  undoCount: number;
  redoCount: number;
  undoLabel: string | null;
  redoLabel: string | null;
  isUndoPostCommit: boolean;
  isRedoPostCommit: boolean;
  cursorSequence: number;
}

export interface UndoRedoExecutionResult {
  ok: boolean;
  action: "undo" | "redo";
  command?: UndoRedoCommandRecord;
  isPostCommitCompensating?: boolean;
  error?: string;
  summary: UndoRedoStackSummary;
}

const MAX_UNDO_HISTORY_ENTRIES = 100;
const COALESCE_WINDOW_MS = 2500;
export const UNDO_REDO_EVENT = "yt-discovery-undo-redo-changed";

function cloneRecord<T>(value: T): T {
  if (value === null || value === undefined) return value;
  return JSON.parse(JSON.stringify(value)) as T;
}

function emptySummary(ownerId: string, deviceId: string): UndoRedoStackSummary {
  return {
    ownerId,
    deviceId,
    canUndo: false,
    canRedo: false,
    undoCount: 0,
    redoCount: 0,
    undoLabel: null,
    redoLabel: null,
    isUndoPostCommit: false,
    isRedoPostCommit: false,
    cursorSequence: 0,
  };
}

class UndoRedoService {
  private queue: Promise<unknown> = Promise.resolve();
  private postCommitSyncCallbacks = new Set<
    (result: {
      action: "undo" | "redo" | "record" | "checkpoint";
      ownerId: string;
      command?: UndoRedoCommandRecord;
    }) => void
  >();

  /** Serialize all read-modify-write command stack updates per tab to avoid race conditions. */
  private enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(fn, fn);
    this.queue = run.catch(() => {});
    return run;
  }

  public onCommandApplied(
    listener: (event: {
      action: "undo" | "redo" | "record" | "checkpoint";
      ownerId: string;
      command?: UndoRedoCommandRecord;
    }) => void
  ): () => void {
    this.postCommitSyncCallbacks.add(listener);
    return () => this.postCommitSyncCallbacks.delete(listener);
  }

  private emitChanged(
    action: "undo" | "redo" | "record" | "checkpoint",
    ownerId: string,
    command?: UndoRedoCommandRecord
  ) {
    for (const cb of this.postCommitSyncCallbacks) {
      try {
        cb({ action, ownerId, command });
      } catch {
        // Isolate subscriber errors
      }
    }
    if (typeof window !== "undefined") {
      window.dispatchEvent(
        new CustomEvent(UNDO_REDO_EVENT, {
          detail: { action, ownerId, commandId: command?.commandId },
        })
      );
    }
  }

  private async readOwnerDeviceCommandsAndState(
    ownerId: string,
    deviceId: string
  ): Promise<{ commands: UndoRedoCommandRecord[]; state: UndoRedoStateRecord }> {
    const db = await openLocalDatabase();

    return new Promise((resolve, reject) => {
      const tx = db.transaction(
        [IDB_STORES.UNDO_REDO_COMMANDS, IDB_STORES.UNDO_REDO_STATE],
        "readonly"
      );
      const cmdStore = tx.objectStore(IDB_STORES.UNDO_REDO_COMMANDS);
      const stateStore = tx.objectStore(IDB_STORES.UNDO_REDO_STATE);

      const cmdReq = cmdStore.index("ownerId").getAll(ownerId);
      const stateReq = stateStore.get([ownerId, deviceId]);

      cmdReq.onerror = () => reject(cmdReq.error || new Error("Failed to read undo/redo commands"));
      stateReq.onerror = () => reject(stateReq.error || new Error("Failed to read undo/redo state"));

      tx.oncomplete = () => {
        const allCmds = ((cmdReq.result as UndoRedoCommandRecord[]) || [])
          .filter((c) => c.ownerId === ownerId && c.deviceId === deviceId)
          .sort((a, b) => a.sequenceNumber - b.sequenceNumber);

        const maxSeq = allCmds.length > 0 ? allCmds[allCmds.length - 1].sequenceNumber : 0;
        const existingState = stateReq.result as UndoRedoStateRecord | undefined;
        const state: UndoRedoStateRecord = existingState || {
          ownerId,
          deviceId,
          cursorSequence: maxSeq,
          nextSequence: maxSeq + 1,
          maxHistoryEntries: MAX_UNDO_HISTORY_ENTRIES,
          updatedAt: new Date().toISOString(),
        };

        resolve({ commands: allCmds, state });
      };
    });
  }

  public async getSummary(
    ownerId: string,
    scopeFilter?: UndoRedoScope[]
  ): Promise<UndoRedoStackSummary> {
    if (typeof window === "undefined" || !ownerId?.trim()) {
      return emptySummary(ownerId || "", "");
    }
    const { originDeviceId } = getOriginDeviceMeta();
    try {
      const { commands, state } = await this.readOwnerDeviceCommandsAndState(
        ownerId.trim(),
        originDeviceId
      );

      const relevant = scopeFilter?.length
        ? commands.filter((c) => scopeFilter.includes(c.scope))
        : commands;

      const applied = relevant.filter((c) => c.sequenceNumber <= state.cursorSequence);
      const undone = relevant.filter((c) => c.sequenceNumber > state.cursorSequence);
      const topUndo = applied[applied.length - 1] ?? null;
      const topRedo = undone[0] ?? null;

      return {
        ownerId: ownerId.trim(),
        deviceId: originDeviceId,
        canUndo: Boolean(topUndo),
        canRedo: Boolean(topRedo),
        undoCount: applied.length,
        redoCount: undone.length,
        undoLabel: topUndo?.label ?? null,
        redoLabel: topRedo?.label ?? null,
        isUndoPostCommit: topUndo?.lifecycleState === "SYNCED_CLOUD",
        isRedoPostCommit: topRedo?.lifecycleState === "SYNCED_CLOUD",
        cursorSequence: state.cursorSequence,
      };
    } catch {
      return emptySummary(ownerId.trim(), originDeviceId);
    }
  }

  /**
   * Captures current local entity state before mutation, writes the mutation +
   * outbox op, AND records an authentic persistent Undo/Redo command atomically.
   */
  public async executeMutation(input: RecordUndoCommandInput): Promise<{
    ok: boolean;
    command: UndoRedoCommandRecord;
    summary: UndoRedoStackSummary;
  }> {
    return this.enqueue(async () => {
      const cleanOwner = input.ownerId.trim();
      const { originDeviceId, originDeviceLabel } = getOriginDeviceMeta();
      const nowIso = new Date().toISOString();
      const nowMs = Date.now();

      // Step 1: Apply entity mutation(s) + outbox entry first in strict IDB transaction
      const clonedChanges: UndoRedoRecordMutation[] = input.changes.map((c) => ({
        datasetType: c.datasetType,
        entityId: c.entityId,
        beforeState: cloneRecord(c.beforeState),
        afterState: cloneRecord(c.afterState),
      }));

      await applyAtomicDatasetMutations(
        cleanOwner,
        clonedChanges.map((c) => ({
          datasetType: c.datasetType,
          entityId: c.entityId,
          state: c.afterState,
        }))
      );

      // Step 2: Update command stack & cursor in IndexedDB
      const { commands, state } = await this.readOwnerDeviceCommandsAndState(
        cleanOwner,
        originDeviceId
      );

      // Truncate redo branch (any commands above cursorSequence)
      const activeBranch = commands.filter((c) => c.sequenceNumber <= state.cursorSequence);
      const redoBranchToDelete = commands.filter((c) => c.sequenceNumber > state.cursorSequence);

      const topActive = activeBranch[activeBranch.length - 1];
      const canCoalesce =
        Boolean(input.coalesceKey) &&
        topActive &&
        topActive.lifecycleState === "STAGED_LOCAL" &&
        topActive.coalesceKey === input.coalesceKey &&
        nowMs - new Date(topActive.updatedAt).getTime() <= COALESCE_WINDOW_MS &&
        redoBranchToDelete.length === 0;

      let resultingCommand: UndoRedoCommandRecord;
      let nextCursor = state.cursorSequence;
      let nextSequence = state.nextSequence;
      const toDeleteIds = redoBranchToDelete.map((c) => c.commandId);

      if (canCoalesce && topActive) {
        // Merge updated `afterState` while preserving earliest `beforeState`
        const mergedByKey = new Map<string, UndoRedoRecordMutation>();
        for (const ch of topActive.changes) {
          mergedByKey.set(`${ch.datasetType}::${ch.entityId}`, ch);
        }
        for (const ch of clonedChanges) {
          const k = `${ch.datasetType}::${ch.entityId}`;
          const prev = mergedByKey.get(k);
          if (prev) {
            mergedByKey.set(k, {
              datasetType: ch.datasetType,
              entityId: ch.entityId,
              beforeState: prev.beforeState,
              afterState: ch.afterState,
            });
          } else {
            mergedByKey.set(k, ch);
          }
        }
        resultingCommand = {
          ...topActive,
          label: input.label,
          updatedAt: nowIso,
          changes: Array.from(mergedByKey.values()),
        };
      } else {
        const seq = Math.max(state.nextSequence, (topActive?.sequenceNumber ?? 0) + 1);
        resultingCommand = {
          commandId: `cmd_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
          ownerId: cleanOwner,
          deviceId: originDeviceId,
          deviceLabel: originDeviceLabel,
          sequenceNumber: seq,
          scope: input.scope,
          datasetType: input.datasetType,
          commandType: input.commandType,
          label: input.label,
          coalesceKey: input.coalesceKey,
          createdAt: nowIso,
          updatedAt: nowIso,
          lifecycleState: "STAGED_LOCAL",
          changes: clonedChanges,
        };
        nextCursor = seq;
        nextSequence = seq + 1;

        // Bound command history while preserving oldest entries up to cap
        const totalAfterInsert = activeBranch.length + 1;
        if (totalAfterInsert > MAX_UNDO_HISTORY_ENTRIES) {
          const overflowCount = totalAfterInsert - MAX_UNDO_HISTORY_ENTRIES;
          for (let i = 0; i < overflowCount; i++) {
            toDeleteIds.push(activeBranch[i].commandId);
          }
        }
      }

      const db = await openLocalDatabase();
      await new Promise<void>((resolve, reject) => {
        const tx = createReadWriteTransaction(db, [
          IDB_STORES.UNDO_REDO_COMMANDS,
          IDB_STORES.UNDO_REDO_STATE,
        ]);
        const cmdStore = tx.objectStore(IDB_STORES.UNDO_REDO_COMMANDS);
        const stateStore = tx.objectStore(IDB_STORES.UNDO_REDO_STATE);

        for (const delId of toDeleteIds) {
          cmdStore.delete(delId);
        }
        cmdStore.put(resultingCommand);

        const nextState: UndoRedoStateRecord = {
          ownerId: cleanOwner,
          deviceId: originDeviceId,
          cursorSequence: nextCursor,
          nextSequence,
          maxHistoryEntries: MAX_UNDO_HISTORY_ENTRIES,
          updatedAt: nowIso,
        };
        stateStore.put(nextState);

        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error || new Error("Failed to persist undo/redo command"));
      });

      this.emitChanged("record", cleanOwner, resultingCommand);
      const summary = await this.getSummary(cleanOwner);
      return { ok: true, command: resultingCommand, summary };
    });
  }

  /** Helper to capture beforeState from IndexedDB when caller only passes entityId + nextState. */
  public async captureBeforeState(
    ownerId: string,
    datasetType: CanonicalDatasetType,
    entityId: string
  ): Promise<Record<string, unknown> | null> {
    try {
      return await getLocalEntityById(ownerId, datasetType, entityId);
    } catch {
      return null;
    }
  }

  public async undo(
    ownerId: string,
    scopeFilter?: UndoRedoScope[]
  ): Promise<UndoRedoExecutionResult> {
    return this.enqueue(async () => {
      const cleanOwner = ownerId.trim();
      const { originDeviceId } = getOriginDeviceMeta();
      const { commands, state } = await this.readOwnerDeviceCommandsAndState(
        cleanOwner,
        originDeviceId
      );

      const applied = commands.filter(
        (c) =>
          c.sequenceNumber <= state.cursorSequence &&
          (!scopeFilter?.length || scopeFilter.includes(c.scope))
      );

      const target = applied[applied.length - 1];
      if (!target) {
        return {
          ok: false,
          action: "undo",
          error: "Nothing left to undo.",
          summary: await this.getSummary(cleanOwner, scopeFilter),
        };
      }

      // Restore beforeStates in reverse change order atomically in IndexedDB + Outbox
      const inverseMutations = [...target.changes].reverse().map((ch) => ({
        datasetType: ch.datasetType,
        entityId: ch.entityId,
        state: cloneRecord(ch.beforeState),
      }));

      await applyAtomicDatasetMutations(cleanOwner, inverseMutations);

      // Advance cursor just before target.sequenceNumber
      const prevApplied = commands
        .filter((c) => c.sequenceNumber < target.sequenceNumber)
        .pop();
      const nextCursor = prevApplied ? prevApplied.sequenceNumber : 0;

      const db = await openLocalDatabase();
      await new Promise<void>((resolve, reject) => {
        const tx = createReadWriteTransaction(db, [IDB_STORES.UNDO_REDO_STATE]);
        tx.objectStore(IDB_STORES.UNDO_REDO_STATE).put({
          ...state,
          cursorSequence: nextCursor,
          updatedAt: new Date().toISOString(),
        } satisfies UndoRedoStateRecord);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error || new Error("Failed to move undo cursor"));
      });

      this.emitChanged("undo", cleanOwner, target);
      const summary = await this.getSummary(cleanOwner, scopeFilter);
      return {
        ok: true,
        action: "undo",
        command: target,
        isPostCommitCompensating: target.lifecycleState === "SYNCED_CLOUD",
        summary,
      };
    });
  }

  public async redo(
    ownerId: string,
    scopeFilter?: UndoRedoScope[]
  ): Promise<UndoRedoExecutionResult> {
    return this.enqueue(async () => {
      const cleanOwner = ownerId.trim();
      const { originDeviceId } = getOriginDeviceMeta();
      const { commands, state } = await this.readOwnerDeviceCommandsAndState(
        cleanOwner,
        originDeviceId
      );

      const undone = commands.filter(
        (c) =>
          c.sequenceNumber > state.cursorSequence &&
          (!scopeFilter?.length || scopeFilter.includes(c.scope))
      );

      const target = undone[0];
      if (!target) {
        return {
          ok: false,
          action: "redo",
          error: "Nothing left to redo.",
          summary: await this.getSummary(cleanOwner, scopeFilter),
        };
      }

      const forwardMutations = target.changes.map((ch) => ({
        datasetType: ch.datasetType,
        entityId: ch.entityId,
        state: cloneRecord(ch.afterState),
      }));

      await applyAtomicDatasetMutations(cleanOwner, forwardMutations);

      const db = await openLocalDatabase();
      await new Promise<void>((resolve, reject) => {
        const tx = createReadWriteTransaction(db, [IDB_STORES.UNDO_REDO_STATE]);
        tx.objectStore(IDB_STORES.UNDO_REDO_STATE).put({
          ...state,
          cursorSequence: target.sequenceNumber,
          updatedAt: new Date().toISOString(),
        } satisfies UndoRedoStateRecord);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error || new Error("Failed to move redo cursor"));
      });

      this.emitChanged("redo", cleanOwner, target);
      const summary = await this.getSummary(cleanOwner, scopeFilter);
      return {
        ok: true,
        action: "redo",
        command: target,
        isPostCommitCompensating: target.lifecycleState === "SYNCED_CLOUD",
        summary,
      };
    });
  }

  /**
   * Called after a verified `Save to Cloud R2` commit. Transitions staged commands
   * to `SYNCED_CLOUD` without discarding undo/redo history: future Undos will
   * produce a new pending compensating operation for the next cloud revision.
   */
  public async markCloudCheckpoint(
    ownerId: string,
    batchId: string,
    committedDatasets: Array<{
      datasetType: string;
      generationId: string;
      revision: number;
    }>
  ): Promise<void> {
    if (typeof window === "undefined" || !ownerId?.trim()) return;
    await this.enqueue(async () => {
      const cleanOwner = ownerId.trim();
      const { originDeviceId } = getOriginDeviceMeta();
      const { commands } = await this.readOwnerDeviceCommandsAndState(cleanOwner, originDeviceId);

      const dsMap = new Map(
        committedDatasets.map((d) => [d.datasetType, d])
      );
      const toUpdate = commands.filter(
        (c) => c.lifecycleState === "STAGED_LOCAL" && dsMap.has(c.datasetType)
      );
      if (toUpdate.length === 0) return;

      const db = await openLocalDatabase();
      await new Promise<void>((resolve, reject) => {
        const tx = createReadWriteTransaction(db, [IDB_STORES.UNDO_REDO_COMMANDS]);
        const store = tx.objectStore(IDB_STORES.UNDO_REDO_COMMANDS);
        for (const cmd of toUpdate) {
          const meta = dsMap.get(cmd.datasetType);
          store.put({
            ...cmd,
            lifecycleState: "SYNCED_CLOUD",
            syncBatchId: batchId,
            committedGenerationId: meta?.generationId,
            committedRevision: meta?.revision,
          } satisfies UndoRedoCommandRecord);
        }
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error || new Error("Failed to checkpoint undo/redo history"));
      });

      this.emitChanged("checkpoint", cleanOwner);
    });
  }
}

export const undoRedoService = new UndoRedoService();
