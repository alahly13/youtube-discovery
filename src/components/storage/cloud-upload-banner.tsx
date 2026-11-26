"use client";

import { CheckCircle2, Cloud, Loader2, ShieldCheck, AlertTriangle, X } from "lucide-react";
import type { CloudUploadFeedbackState } from "@/lib/sync/verified-cloud-upload";

/**
 * Shared live progress + SHA-256 verification + post-commit cleanup feedback
 * banner rendered cleanly across `/history`, `/saved-titles-links`, and `#saved-searches`.
 */
export function CloudUploadFeedbackBanner({
  feedback,
  onDismiss,
}: {
  feedback: CloudUploadFeedbackState | null;
  onDismiss?: () => void;
}) {
  if (!feedback) return null;

  const isSuccess = feedback.stage === "CLOUD_COMMITTED" && !feedback.errorMessage;
  const isError =
    Boolean(feedback.errorMessage) ||
    feedback.stage === "FAILED" ||
    feedback.stage === "NEEDS_ATTENTION";

  const wrapperTone = isError
    ? "border-destructive/40 bg-destructive/10 text-destructive"
    : isSuccess
      ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
      : "border-cyan-500/40 bg-cyan-500/10 text-cyan-700 dark:text-cyan-300";

  const stageTitle =
    feedback.stage === "CLEANING_LOCAL"
      ? "R2 & PostgreSQL Verified — Clearing Local Browser Storage…"
      : feedback.stage === "SYNCING"
        ? "Uploading Append-Only Snapshot to Cloudflare R2 & Verifying SHA-256…"
        : isSuccess
          ? "Verified in Cloudflare R2 & PostgreSQL"
          : feedback.errorCategory || "Cloud Upload Attention Required";

  return (
    <div
      className={`flex flex-col gap-2 rounded-xl border px-4 py-3 text-xs shadow-xs transition-all sm:flex-row sm:items-start sm:justify-between ${wrapperTone}`}
      role="status"
    >
      <div className="flex items-start gap-2.5 min-w-0">
        <div className="mt-0.5 shrink-0">
          {feedback.isSaving ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : isError ? (
            <AlertTriangle className="h-4 w-4" />
          ) : (
            <CheckCircle2 className="h-4 w-4" />
          )}
        </div>
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2 font-semibold">
            <span>{stageTitle}</span>
            {feedback.generationId && (
              <span className="inline-flex items-center gap-1 rounded-md border border-current/25 bg-background/40 px-1.5 py-0.5 font-mono text-[10px]">
                <Cloud className="h-2.5 w-2.5" />
                {feedback.generationId.slice(0, 12)}
              </span>
            )}
            {feedback.verifiedCount > 0 && (
              <span className="inline-flex items-center gap-1 rounded-md border border-current/25 bg-background/40 px-1.5 py-0.5 font-mono text-[10px]">
                <ShieldCheck className="h-2.5 w-2.5" />
                SHA-256 ×{feedback.verifiedCount}
              </span>
            )}
          </div>
          <p className="text-[11px] leading-relaxed opacity-90">
            {feedback.errorMessage ||
              feedback.successMessage ||
              `Processing ${feedback.totalSelected} local record(s) without overwriting existing R2 data…`}
          </p>
          {feedback.manifestPath && (
            <p className="truncate font-mono text-[10px] opacity-80" title={feedback.manifestPath}>
              R2 key: {feedback.manifestPath}
            </p>
          )}
        </div>
      </div>

      {onDismiss && !feedback.isSaving && (
        <button
          type="button"
          onClick={onDismiss}
          className="self-end rounded-md p-1 opacity-75 transition-opacity hover:bg-background/40 hover:opacity-100 sm:self-start"
          aria-label="Dismiss cloud upload status"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}
