"use client";

import {
  AlertTriangle,
  CheckCircle2,
  Database,
  Lock,
  Trash2,
  X,
} from "lucide-react";
import { useState, useId } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  type DiscoveredLocalEntry,
  type LocalDatasetCategory,
  REQUIRED_DELETION_PHRASE,
  deleteConfirmedLocalEntries,
  type DeletionResult,
} from "@/lib/recovery/local-data-center-service";
import { formatBytes } from "@/lib/utils/format";

interface LocalDataDeletionModalProps {
  isOpen: boolean;
  onClose: () => void;
  entries: DiscoveredLocalEntry[];
  onDeletionComplete: (result: DeletionResult) => void;
}

export function LocalDataDeletionModal({
  isOpen,
  onClose,
  entries,
  onDeletionComplete,
}: LocalDataDeletionModalProps) {
  const [confirmedText, setConfirmedText] = useState("");
  const [selectedCategories, setSelectedCategories] = useState<Record<LocalDatasetCategory, boolean>>({
    SAVED_ITEMS: true,
    PLAYLIST: true,
    SEARCH_HISTORY: true,
    RESEARCH_QUEUE: true,
    REFERENCES: true,
  });
  const [isDeleting, setIsDeleting] = useState(false);
  const [deletionResult, setDeletionResult] = useState<DeletionResult | null>(null);

  const confirmInputId = useId();

  if (!isOpen) return null;

  // Filter out protected items: ONLY eligible items can be selected for deletion
  const eligibleEntries = entries.filter((e) => e.deletionEligible && !e.isProtected);
  const protectedEntries = entries.filter((e) => e.isProtected || !e.deletionEligible);

  // Group eligible entries by category
  const filteredEntries = eligibleEntries.filter((e) => selectedCategories[e.category]);
  const totalEligibleBytes = filteredEntries.reduce((sum, e) => sum + e.sizeBytes, 0);
  const totalEligibleRecords = filteredEntries.reduce((sum, e) => sum + e.recordCount, 0);

  const isPhraseMatched = confirmedText.trim() === REQUIRED_DELETION_PHRASE;

  const toggleCategory = (cat: LocalDatasetCategory) => {
    setSelectedCategories((prev) => ({
      ...prev,
      [cat]: !prev[cat],
    }));
  };

  const handleExecuteDeletion = async () => {
    if (!isPhraseMatched || isDeleting) return;

    setIsDeleting(true);
    setDeletionResult(null);

    try {
      const selectedIds = filteredEntries.map((e) => e.id);
      const res = await deleteConfirmedLocalEntries(selectedIds, confirmedText);
      setDeletionResult(res);
      onDeletionComplete(res);
    } catch (err) {
      setDeletionResult({
        success: false,
        deletedRecordsCount: 0,
        deletedKeysCount: 0,
        freedBytes: 0,
        errors: [err instanceof Error ? err.message : "Unknown deletion failure."],
      });
    } finally {
      setIsDeleting(false);
    }
  };

  const handleClose = () => {
    setConfirmedText("");
    setDeletionResult(null);
    onClose();
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="deletion-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-xs animate-in fade-in"
    >
      <div className="relative w-full max-w-2xl rounded-2xl border border-destructive/40 bg-surface shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-start justify-between border-b border-border/70 p-5 bg-destructive/10">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-destructive/20 text-destructive border border-destructive/30">
              <AlertTriangle className="h-5 w-5" />
            </div>
            <div>
              <h2 id="deletion-modal-title" className="text-lg font-bold text-foreground">
                Local Data Permanent Deletion
              </h2>
              <p className="text-xs font-semibold text-destructive/90" dir="rtl">
                تنظيف وحذف البيانات المحلية نهائياً
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={handleClose}
            className="rounded-lg p-1.5 text-muted hover:bg-surface-muted hover:text-foreground transition-colors"
            aria-label="Close dialog"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5 text-sm">
          {deletionResult ? (
            <div className="rounded-xl border border-border bg-surface-raised p-4 space-y-3">
              <div className="flex items-center gap-2 text-primary font-semibold">
                <CheckCircle2 className="h-5 w-5" />
                <span>Deletion Execution Completed</span>
              </div>
              <div className="text-xs space-y-1 text-muted">
                <p>Deleted Records: <strong className="text-foreground">{deletionResult.deletedRecordsCount}</strong></p>
                <p>Storage Keys Cleared: <strong className="text-foreground">{deletionResult.deletedKeysCount}</strong></p>
                <p>Freed Storage: <strong className="text-foreground">{formatBytes(deletionResult.freedBytes)}</strong></p>
              </div>
              {deletionResult.errors.length > 0 && (
                <div className="p-3 rounded-lg bg-destructive/10 text-destructive text-xs space-y-1">
                  <p className="font-semibold">Warnings / Errors:</p>
                  {deletionResult.errors.map((err, i) => (
                    <p key={i}>• {err}</p>
                  ))}
                </div>
              )}
              <Button onClick={handleClose} className="w-full mt-3">
                Done &amp; Refresh Overview
              </Button>
            </div>
          ) : (
            <>
              {/* Warning Notice */}
              <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-xs space-y-2 text-foreground/90">
                <p className="font-semibold text-destructive flex items-center gap-1.5">
                  <AlertTriangle className="h-4 w-4 shrink-0" />
                  CAUTION: This action is irreversible.
                </p>
                <p>
                  The selected data will be permanently purged from your browser storage (IndexedDB &amp; LocalStorage).
                  This will NOT affect server data, Supabase Storage, or remote backups.
                </p>
              </div>

              {/* Category Selection */}
              <div className="space-y-2">
                <label className="text-xs font-bold uppercase tracking-wider text-muted">
                  Select Categories to Delete
                </label>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {(["SAVED_ITEMS", "PLAYLIST", "SEARCH_HISTORY", "RESEARCH_QUEUE", "REFERENCES"] as LocalDatasetCategory[]).map(
                    (cat) => {
                      const count = eligibleEntries
                        .filter((e) => e.category === cat)
                        .reduce((sum, e) => sum + e.recordCount, 0);
                      const isSelected = selectedCategories[cat];

                      return (
                        <button
                          key={cat}
                          type="button"
                          onClick={() => toggleCategory(cat)}
                          className={`flex items-center justify-between p-2.5 rounded-lg border text-xs transition-all ${
                            isSelected
                              ? "border-destructive/50 bg-destructive/10 text-foreground font-semibold"
                              : "border-border bg-surface-muted/40 text-muted"
                          }`}
                        >
                          <span className="truncate">{cat.replace("_", " ")}</span>
                          <Badge tone={isSelected ? "danger" : "neutral"} className="text-[10px]">
                            {count}
                          </Badge>
                        </button>
                      );
                    }
                  )}
                </div>
              </div>

              {/* Exact Items Scheduled for Deletion */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold uppercase tracking-wider text-muted">
                    Eligible Records Scheduled ({filteredEntries.length} sources, {totalEligibleRecords} records)
                  </span>
                  <span className="text-xs font-mono font-semibold text-destructive">
                    {formatBytes(totalEligibleBytes)}
                  </span>
                </div>
                <div className="max-h-40 overflow-y-auto rounded-lg border border-border bg-surface-muted/30 p-2 space-y-1.5 text-xs">
                  {filteredEntries.length === 0 ? (
                    <p className="text-muted text-center py-3">No eligible categories selected.</p>
                  ) : (
                    filteredEntries.map((e) => (
                      <div
                        key={e.id}
                        className="flex items-center justify-between p-1.5 rounded bg-surface border border-border/50 text-[11px]"
                      >
                        <div className="flex items-center gap-2 truncate">
                          <Database className="h-3.5 w-3.5 text-muted shrink-0" />
                          <span className="font-mono font-medium truncate">{e.name}</span>
                          <span className="text-muted/70">({e.mechanism})</span>
                        </div>
                        <span className="font-mono text-muted shrink-0">{formatBytes(e.sizeBytes)}</span>
                      </div>
                    ))
                  )}
                </div>
              </div>

              {/* Protected Exclusions Banner */}
              {protectedEntries.length > 0 && (
                <div className="rounded-lg border border-border/80 bg-surface-raised p-3 flex items-center justify-between text-xs text-muted">
                  <div className="flex items-center gap-2">
                    <Lock className="h-4 w-4 text-primary shrink-0" />
                    <span>
                      <strong>{protectedEntries.length} protected entries</strong> (authentication sessions &amp; system config) are strictly excluded from deletion.
                    </span>
                  </div>
                  <Badge tone="neutral" className="text-[10px]">
                    Preserved
                  </Badge>
                </div>
              )}

              {/* Exact Confirmation Phrase Input */}
              <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 space-y-2.5">
                <label htmlFor={confirmInputId} className="block text-xs font-bold text-foreground">
                  To confirm, type the exact Arabic phrase below:
                </label>
                <div className="flex items-center justify-center p-2 rounded-lg bg-surface border border-destructive/40 text-center font-bold text-base text-destructive select-all" dir="rtl">
                  {REQUIRED_DELETION_PHRASE}
                </div>
                <input
                  id={confirmInputId}
                  type="text"
                  dir="rtl"
                  value={confirmedText}
                  onChange={(e) => setConfirmedText(e.target.value)}
                  placeholder={REQUIRED_DELETION_PHRASE}
                  className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-center font-bold text-foreground placeholder:text-muted/40 focus:border-destructive focus:ring-1 focus:ring-destructive outline-hidden"
                />
                {!isPhraseMatched && confirmedText.length > 0 && (
                  <p className="text-[11px] text-destructive text-center font-medium">
                    Phrase does not match. Please copy or type exactly: &quot;{REQUIRED_DELETION_PHRASE}&quot;
                  </p>
                )}
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        {!deletionResult && (
          <div className="flex items-center justify-end gap-3 border-t border-border/70 p-4 bg-surface-raised/40">
            <Button variant="secondary" onClick={handleClose} disabled={isDeleting}>
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={handleExecuteDeletion}
              disabled={!isPhraseMatched || filteredEntries.length === 0 || isDeleting}
              className="gap-2 font-bold"
            >
              <Trash2 className="h-4 w-4" />
              <span>Permanently Delete Selected Data (تأكيد الحذف النهائي)</span>
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
