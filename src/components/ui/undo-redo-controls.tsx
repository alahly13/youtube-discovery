"use client";

import { Redo2, Undo2, CloudAlert } from "lucide-react";
import { useUndoRedo } from "@/lib/undo-redo/use-undo-redo";
import type { UndoRedoScope } from "@/lib/undo-redo/undo-redo-service";
import { Button } from "./button";

interface UndoRedoControlsProps {
  /** Optional scope filter; omit for global cross-workspace history. */
  scope?: UndoRedoScope[];
  enableKeyboardShortcuts?: boolean;
  compact?: boolean;
  className?: string;
}

/**
 * Shared persistent Undo / Redo toolbar.
 * Works across Saved Items, User Playlists, Playlist Details, Saved Titles & Links,
 * and Saved Searches before AND after `Save to Cloud R2` (emitting compensating
 * local changes rather than modifying immutable committed R2 generations).
 */
export function UndoRedoControls({
  scope,
  enableKeyboardShortcuts = false,
  compact = false,
  className = "",
}: UndoRedoControlsProps) {
  const {
    canUndo,
    canRedo,
    undoCount,
    redoCount,
    undoLabel,
    redoLabel,
    isUndoPostCommit,
    undoPending,
    redoPending,
    lastNotice,
    clearNotice,
    undo,
    redo,
  } = useUndoRedo({ scope, enableKeyboardShortcuts });

  return (
    <div className={`inline-flex flex-col gap-1 ${className}`}>
      <div className="inline-flex items-center gap-1.5" role="group" aria-label="Undo and Redo history">
        <Button
          type="button"
          variant="secondary"
          disabled={!canUndo || undoPending || redoPending}
          onClick={() => void undo()}
          title={
            canUndo
              ? `Undo: ${undoLabel || "last edit"}${isUndoPostCommit ? " (post-cloud compensating edit)" : ""} (Ctrl+Z)`
              : "Nothing to undo"
          }
          aria-label={canUndo ? `Undo ${undoLabel || ""}` : "Undo unavailable"}
          className={compact ? "h-8 gap-1 px-2 text-xs" : "h-9 gap-1.5 px-2.5 text-xs"}
        >
          <Undo2 className="h-3.5 w-3.5 shrink-0" />
          <span className={compact ? "hidden sm:inline" : "inline"}>Undo</span>
          {undoCount > 0 && (
            <span className="rounded bg-surface-muted px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-muted">
              {undoCount}
            </span>
          )}
          {isUndoPostCommit && canUndo && (
            <CloudAlert className="h-3 w-3 text-warning shrink-0" aria-hidden="true" />
          )}
        </Button>

        <Button
          type="button"
          variant="secondary"
          disabled={!canRedo || undoPending || redoPending}
          onClick={() => void redo()}
          title={
            canRedo
              ? `Redo: ${redoLabel || "next edit"} (Ctrl+Y / Ctrl+Shift+Z)`
              : "Nothing to redo"
          }
          aria-label={canRedo ? `Redo ${redoLabel || ""}` : "Redo unavailable"}
          className={compact ? "h-8 gap-1 px-2 text-xs" : "h-9 gap-1.5 px-2.5 text-xs"}
        >
          <Redo2 className="h-3.5 w-3.5 shrink-0" />
          <span className={compact ? "hidden sm:inline" : "inline"}>Redo</span>
          {redoCount > 0 && (
            <span className="rounded bg-surface-muted px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-muted">
              {redoCount}
            </span>
          )}
        </Button>
      </div>

      {lastNotice && (
        <div
          className="flex items-center justify-between gap-2 rounded-md border border-border/80 bg-surface-muted/80 px-2.5 py-1 text-[11px] text-foreground"
          role="status"
        >
          <span className="truncate max-w-[320px]">{lastNotice}</span>
          <button
            type="button"
            onClick={clearNotice}
            className="text-[10px] font-medium text-muted hover:text-foreground shrink-0"
          >
            Dismiss
          </button>
        </div>
      )}
    </div>
  );
}
