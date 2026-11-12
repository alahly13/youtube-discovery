"use client";

import { useCallback, useEffect, useState } from "react";
import { syncCoordinator } from "../sync/sync-coordinator";
import {
  UNDO_REDO_EVENT,
  undoRedoService,
  type UndoRedoExecutionResult,
  type UndoRedoScope,
  type UndoRedoStackSummary,
} from "./undo-redo-service";

/**
 * React hook subscribing to the persistent Undo/Redo command stack for the
 * active owner+device. Supports safe global keyboard shortcuts (Ctrl/Cmd+Z
 * and Ctrl+Y / Ctrl+Shift+Z) that never hijack typing inside inputs/textareas.
 */
export function useUndoRedo(options?: {
  scope?: UndoRedoScope[];
  enableKeyboardShortcuts?: boolean;
}) {
  const scopeKey = options?.scope?.join(",") || "";
  const [ownerId, setOwnerId] = useState<string>(() => syncCoordinator.getOwnerId());
  const [summary, setSummary] = useState<UndoRedoStackSummary>(() => ({
    ownerId: "",
    deviceId: "",
    canUndo: false,
    canRedo: false,
    undoCount: 0,
    redoCount: 0,
    undoLabel: null,
    redoLabel: null,
    isUndoPostCommit: false,
    isRedoPostCommit: false,
    cursorSequence: 0,
  }));
  const [busy, setBusy] = useState<"undo" | "redo" | null>(null);
  const [lastNotice, setLastNotice] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const currentOwner = syncCoordinator.getOwnerId();
    setOwnerId(currentOwner);
    const scopeArr = scopeKey ? (scopeKey.split(",") as UndoRedoScope[]) : undefined;
    const next = await undoRedoService.getSummary(currentOwner, scopeArr);
    setSummary(next);
  }, [scopeKey]);

  useEffect(() => {
    void refresh();
    const unsubCoord = syncCoordinator.subscribe(() => {
      void refresh();
    });
    const onUndoEvent = () => {
      void refresh();
    };
    if (typeof window !== "undefined") {
      window.addEventListener(UNDO_REDO_EVENT, onUndoEvent);
      window.addEventListener("yt-discovery-owner-changed", onUndoEvent);
      window.addEventListener("yt-discovery-hydration-changed", onUndoEvent);
    }
    return () => {
      unsubCoord();
      if (typeof window !== "undefined") {
        window.removeEventListener(UNDO_REDO_EVENT, onUndoEvent);
        window.removeEventListener("yt-discovery-owner-changed", onUndoEvent);
        window.removeEventListener("yt-discovery-hydration-changed", onUndoEvent);
      }
    };
  }, [refresh]);

  const undo = useCallback(async (): Promise<UndoRedoExecutionResult | null> => {
    if (busy) return null;
    const currentOwner = syncCoordinator.getOwnerId();
    const scopeArr = scopeKey ? (scopeKey.split(",") as UndoRedoScope[]) : undefined;
    setBusy("undo");
    try {
      const res = await undoRedoService.undo(currentOwner, scopeArr);
      setSummary(res.summary);
      await syncCoordinator.refreshSummary();
      if (res.ok && res.command) {
        setLastNotice(
          res.isPostCommitCompensating
            ? `Undid "${res.command.label}" locally (post-cloud compensating edit staged — press Save to Cloud R2 to create a new revision).`
            : `Undid: ${res.command.label}`
        );
      } else if (res.error) {
        setLastNotice(res.error);
      }
      return res;
    } finally {
      setBusy(null);
    }
  }, [busy, scopeKey]);

  const redo = useCallback(async (): Promise<UndoRedoExecutionResult | null> => {
    if (busy) return null;
    const currentOwner = syncCoordinator.getOwnerId();
    const scopeArr = scopeKey ? (scopeKey.split(",") as UndoRedoScope[]) : undefined;
    setBusy("redo");
    try {
      const res = await undoRedoService.redo(currentOwner, scopeArr);
      setSummary(res.summary);
      await syncCoordinator.refreshSummary();
      if (res.ok && res.command) {
        setLastNotice(
          res.isPostCommitCompensating
            ? `Redid "${res.command.label}" locally (staged for next Save to Cloud R2 revision).`
            : `Redid: ${res.command.label}`
        );
      } else if (res.error) {
        setLastNotice(res.error);
      }
      return res;
    } finally {
      setBusy(null);
    }
  }, [busy, scopeKey]);

  useEffect(() => {
    if (!options?.enableKeyboardShortcuts || typeof window === "undefined") return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      const target = e.target as HTMLElement | null;
      if (target) {
        const tag = target.tagName.toLowerCase();
        if (
          tag === "input" ||
          tag === "textarea" ||
          tag === "select" ||
          target.isContentEditable
        ) {
          return;
        }
      }

      const mod = e.ctrlKey || e.metaKey;
      if (!mod || e.altKey) return;
      const key = e.key.toLowerCase();

      if (key === "z" && !e.shiftKey) {
        if (summary.canUndo) {
          e.preventDefault();
          void undo();
        }
      } else if ((key === "z" && e.shiftKey) || (key === "y" && !e.shiftKey)) {
        if (summary.canRedo) {
          e.preventDefault();
          void redo();
        }
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [options?.enableKeyboardShortcuts, summary.canUndo, summary.canRedo, undo, redo]);

  return {
    ...summary,
    ownerId: summary.ownerId || ownerId,
    undoPending: busy === "undo",
    redoPending: busy === "redo",
    lastNotice,
    clearNotice: () => setLastNotice(null),
    undo,
    redo,
    refresh,
  };
}
