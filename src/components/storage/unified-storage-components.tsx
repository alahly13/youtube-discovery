"use client";

import React, { useState } from "react";
import {
  AlertCircle,
  Archive,
  ArrowRight,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  Cloud,
  Database,
  Eye,
  HardDrive,
  Info,
  Layers,
  Loader2,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * Unified Storage Design System (2026 SaaS)
 * ──────────────────────────────────────────────────────────────────────────
 * Scope: Shared storage status badges, overview cards, reconciliation panel,
 *        status sections, and verification dialogs across:
 *          - /saved & /ssaved
 *          - /saved-titles-links
 *          - /saved-searches
 *          - /history
 *
 * Guarantees:
 *   - Semantic 3-State Consistency: LOCAL_ONLY (amber), LOCAL_AND_CLOUD (cyan),
 *     CLOUD_ONLY (emerald), HISTORICAL_ARCHIVE (purple).
 *   - Non-destructive local cleanup confirmation.
 *   - Dark/Light mode theme preservation.
 * ═══════════════════════════════════════════════════════════════════════════
 */

export type StorageStateCategory =
  | "LOCAL_ONLY"
  | "LOCAL_AND_CLOUD"
  | "CLOUD_ONLY"
  | "HISTORICAL_ARCHIVE";

export type VerificationSubstate =
  | "CLEANUP_ELIGIBLE"
  | "AUDIT_PENDING"
  | "NEEDS_REVIEW"
  | "R2_VERIFIED"
  | "SUPABASE_VERIFIED"
  | "MANIFEST_VERIFIED";

/**
 * Generation & Part Artifact Verification Data Contracts (2026 SaaS)
 * Comparison unit is Generation + Part files, NOT individual records.
 */
export interface PartReconciliationResult {
  ownerId: string;
  datasetId: string;
  datasetType: string;
  generationId: string;
  generationNumber: number;
  partId: string;
  partNumber: number;
  partKey: string;

  indexedDB: {
    batchExists: boolean;
    batchId?: string;
    snapshotMatches: boolean;
    recordCount: number;
    hasPendingMutations: boolean;
    matchingLocalRecordIds: string[];
  };

  r2: {
    manifestExists: boolean;
    partExists: boolean;
    partReadable: boolean;
    checksumMatches: boolean;
    byteSizeMatches: boolean;
    itemCountMatches: boolean;
    ownerMatches: boolean;
    generationMatches: boolean;
    actualByteCount?: number;
    actualSha256?: string;
  };

  supabase: {
    generationCommitted: boolean;
    partReceiptExists: boolean;
    ownerMatches: boolean;
    objectKeyMatches: boolean;
    checksumMatches: boolean;
    itemCountMatches: boolean;
    registeredSha256?: string;
    registeredByteCount?: number;
  };

  cleanupEligible: boolean;
  isHistorical?: boolean;
  reasons: string[];
}

export interface GenerationReconciliationSummary {
  generationId: string;
  generationNumber: number;
  state: string;
  totalParts: number;
  totalRecords: number;
  fullyVerified: boolean;
  cleanupEligible: boolean;
  isHistorical?: boolean;
  parts: PartReconciliationResult[];
}

export interface ArtifactReconciliationStats {
  generationsInspected?: number;
  manifestsInspected?: number;
  partsInspected?: number;
  partsVerified?: number;
  partsEligibleForCleanup?: number;
  partsWithConflicts?: number;
  missingOrInvalidR2Objects?: number;
  incompleteOrUncommittedSupabaseArtifacts?: number;
  localRecordsEligibleForCleanup?: number;
  totalLocalRecords?: number;
  totalCloudRecords?: number;
  localOnlyCount?: number;
  localAndCloudCount?: number;
  cloudOnlyCount?: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. StorageStatusBadge
// ─────────────────────────────────────────────────────────────────────────────

interface StorageStatusBadgeProps {
  category: StorageStateCategory | string;
  substate?: VerificationSubstate | string;
  isHistorical?: boolean;
  className?: string;
  compact?: boolean;
}

export function StorageStatusBadge({
  category,
  substate,
  isHistorical,
  className = "",
  compact = false,
}: StorageStatusBadgeProps) {
  if (isHistorical || category === "HISTORICAL_ARCHIVE") {
    return (
      <span
        className={`inline-flex items-center gap-1.5 rounded-md border border-purple-500/40 bg-purple-500/10 px-2 py-0.5 text-[11px] font-semibold text-purple-600 dark:text-purple-400 shadow-2xs ${className}`}
        title="Historical pre-update archive permanently stored in Cloudflare R2"
      >
        <Archive className="h-3 w-3 shrink-0" />
        <span>Historical Archive</span>
      </span>
    );
  }

  if (category === "LOCAL_ONLY") {
    return (
      <span
        className={`inline-flex items-center gap-1.5 rounded-md border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[11px] font-semibold text-amber-600 dark:text-amber-400 shadow-2xs ${className}`}
        title="Stored locally in browser IndexedDB. Not yet committed to Cloudflare R2."
      >
        <HardDrive className="h-3 w-3 shrink-0" />
        <span>Local Browser</span>
      </span>
    );
  }

  if (category === "LOCAL_AND_CLOUD") {
    return (
      <div className={`inline-flex flex-wrap items-center gap-1 ${className}`}>
        <span
          className="inline-flex items-center gap-1.5 rounded-md border border-cyan-500/40 bg-cyan-500/10 px-2 py-0.5 text-[11px] font-semibold text-cyan-600 dark:text-cyan-400 shadow-2xs"
          title="Stored both in local browser and committed to Cloudflare R2."
        >
          <Layers className="h-3 w-3 shrink-0" />
          <span>Local + R2 Cloud</span>
        </span>
        {substate === "CLEANUP_ELIGIBLE" && !compact && (
          <span
            className="inline-flex items-center gap-1 rounded bg-emerald-500/15 px-1.5 py-0.2 text-[10px] font-bold text-emerald-600 dark:text-emerald-400"
            title="Verified in Cloudflare R2 and Supabase. Safe to remove local copy."
          >
            <CheckCircle2 className="h-2.5 w-2.5" />
            <span>Cleanup Eligible</span>
          </span>
        )}
        {substate === "AUDIT_PENDING" && !compact && (
          <span
            className="inline-flex items-center gap-1 rounded bg-amber-500/15 px-1.5 py-0.2 text-[10px] font-bold text-amber-600 dark:text-amber-400"
            title="Present in R2; relational audit synchronization in progress."
          >
            <Clock className="h-2.5 w-2.5" />
            <span>Audit Pending</span>
          </span>
        )}
      </div>
    );
  }

  // CLOUD_ONLY
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 text-[11px] font-semibold text-emerald-600 dark:text-emerald-400 shadow-2xs ${className}`}
      title="Authoritatively preserved in Cloudflare R2. Local browser copy cleaned up."
    >
      <Cloud className="h-3 w-3 shrink-0" />
      <span>R2 Cloud</span>
    </span>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. StorageOverview
// ─────────────────────────────────────────────────────────────────────────────

interface StorageOverviewProps {
  localOnlyCount: number;
  localAndCloudCount: number;
  cloudOnlyCount: number;
  totalUniqueCount: number;
  cleanupEligibleCount?: number;
  activeView: "all" | "local" | "cloud";
  onSelectView: (view: "all" | "local" | "cloud") => void;
  isLoading?: boolean;
}

export function StorageOverview({
  localOnlyCount,
  localAndCloudCount,
  cloudOnlyCount,
  totalUniqueCount,
  cleanupEligibleCount = 0,
  activeView,
  onSelectView,
  isLoading = false,
}: StorageOverviewProps) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {/* 1. All Unique Items */}
      <button
        type="button"
        onClick={() => onSelectView("all")}
        className={`group flex flex-col items-start justify-between rounded-xl border p-3.5 text-left transition sm:p-4 ${
          activeView === "all"
            ? "border-foreground/40 bg-surface shadow-xs ring-2 ring-foreground/20"
            : "border-border/80 bg-surface/80 hover:border-border hover:bg-surface"
        }`}
      >
        <div className="flex w-full items-center justify-between">
          <span className="text-[11px] font-bold uppercase tracking-wider text-muted">
            All Storage
          </span>
          <Layers className="h-4 w-4 text-muted group-hover:text-foreground" />
        </div>
        <div className="mt-2 flex items-baseline gap-2">
          <span className="text-2xl font-extrabold tracking-tight text-foreground sm:text-3xl">
            {isLoading ? "…" : totalUniqueCount}
          </span>
          <span className="text-xs text-muted">unique</span>
        </div>
        <span className="mt-1 text-[11px] text-muted">Combined deduplicated</span>
      </button>

      {/* 2. Local Browser */}
      <button
        type="button"
        onClick={() => onSelectView("local")}
        className={`group flex flex-col items-start justify-between rounded-xl border p-3.5 text-left transition sm:p-4 ${
          activeView === "local"
            ? "border-amber-500/60 bg-amber-500/5 shadow-xs ring-2 ring-amber-500/20"
            : "border-border/80 bg-surface/80 hover:border-amber-500/40 hover:bg-surface"
        }`}
      >
        <div className="flex w-full items-center justify-between">
          <span className="text-[11px] font-bold uppercase tracking-wider text-amber-500">
            Local Browser
          </span>
          <HardDrive className="h-4 w-4 text-amber-500/80 group-hover:text-amber-500" />
        </div>
        <div className="mt-2 flex items-baseline gap-2">
          <span className="text-2xl font-extrabold tracking-tight text-amber-500 sm:text-3xl">
            {isLoading ? "…" : localOnlyCount}
          </span>
          <span className="text-xs text-muted">staged</span>
        </div>
        <span className="mt-1 text-[11px] text-muted">IndexedDB only</span>
      </button>

      {/* 3. Local + R2 Cloud */}
      <div className="flex flex-col items-start justify-between rounded-xl border border-border/80 bg-surface/80 p-3.5 text-left transition sm:p-4">
        <div className="flex w-full items-center justify-between">
          <span className="text-[11px] font-bold uppercase tracking-wider text-cyan-600 dark:text-cyan-400">
            Local + Cloud
          </span>
          <Database className="h-4 w-4 text-cyan-500" />
        </div>
        <div className="mt-2 flex items-baseline gap-2">
          <span className="text-2xl font-extrabold tracking-tight text-cyan-600 dark:text-cyan-400 sm:text-3xl">
            {isLoading ? "…" : localAndCloudCount}
          </span>
          {cleanupEligibleCount > 0 && (
            <span className="rounded bg-emerald-500/15 px-1.5 py-0.2 text-[10px] font-bold text-emerald-500">
              {cleanupEligibleCount} verified
            </span>
          )}
        </div>
        <span className="mt-1 text-[11px] text-muted">Cleanup ready</span>
      </div>

      {/* 4. R2 Cloud */}
      <button
        type="button"
        onClick={() => onSelectView("cloud")}
        className={`group flex flex-col items-start justify-between rounded-xl border p-3.5 text-left transition sm:p-4 ${
          activeView === "cloud"
            ? "border-emerald-500/60 bg-emerald-500/5 shadow-xs ring-2 ring-emerald-500/20"
            : "border-border/80 bg-surface/80 hover:border-emerald-500/40 hover:bg-surface"
        }`}
      >
        <div className="flex w-full items-center justify-between">
          <span className="text-[11px] font-bold uppercase tracking-wider text-emerald-500">
            R2 Cloud
          </span>
          <Cloud className="h-4 w-4 text-emerald-500/80 group-hover:text-emerald-500" />
        </div>
        <div className="mt-2 flex items-baseline gap-2">
          <span className="text-2xl font-extrabold tracking-tight text-emerald-500 sm:text-3xl">
            {isLoading ? "…" : cloudOnlyCount + localAndCloudCount}
          </span>
          <span className="text-xs text-muted">committed</span>
        </div>
        <span className="mt-1 text-[11px] text-muted">Authoritative R2</span>
      </button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. StorageComparisonPanel
// ─────────────────────────────────────────────────────────────────────────────

interface StorageComparisonPanelProps {
  onRunComparison: () => Promise<void>;
  isComparing: boolean;
  lastComparedAt: string | null;
  cleanupEligibleCount: number;
  onOpenCleanupDialog: () => void;
  datasetLabel: string;
  generationSummaries?: GenerationReconciliationSummary[];
  partResults?: PartReconciliationResult[];
  artifactStats?: ArtifactReconciliationStats;
}

export function StorageComparisonPanel({
  onRunComparison,
  isComparing,
  lastComparedAt,
  cleanupEligibleCount,
  onOpenCleanupDialog,
  datasetLabel,
  generationSummaries = [],
  partResults = [],
  artifactStats,
}: StorageComparisonPanelProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [showMatrix, setShowMatrix] = useState(false);

  const totalParts = artifactStats?.partsInspected ?? partResults.length;
  const verifiedParts = artifactStats?.partsVerified ?? partResults.filter((p) => p.r2.partReadable && p.r2.checksumMatches && p.supabase.partReceiptExists).length;
  const eligibleParts = artifactStats?.partsEligibleForCleanup ?? partResults.filter((p) => p.cleanupEligible).length;
  const conflictsCount = (artifactStats?.missingOrInvalidR2Objects ?? 0) + (artifactStats?.incompleteOrUncommittedSupabaseArtifacts ?? 0) + (artifactStats?.partsWithConflicts ?? 0);

  return (
    <Card className="overflow-hidden border border-border/80 bg-surface shadow-xs">
      <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 rounded-lg border border-primary/20 bg-primary/10 p-2 text-primary">
            <ShieldCheck className="h-5 w-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-bold text-foreground">
                STORAGE INTEGRITY CENTER
              </h3>
              <span className="rounded-full bg-border/60 px-2 py-0.2 text-[10px] font-semibold text-muted">
                Generation & Part Verification
              </span>
            </div>
            <p className="mt-1 text-xs text-muted">
              Artifact-level 3-way check across IndexedDB batches, Cloudflare R2 manifests/parts, and Supabase PostgreSQL for {datasetLabel}.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={onRunComparison}
            disabled={isComparing}
            className="h-8 gap-1.5 text-xs font-semibold"
            title="Perform authentic 3-way check across IndexedDB, R2, and Supabase"
          >
            {isComparing ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" />
            )}
            <span>{isComparing ? "Verifying Artifacts…" : "Verify Generations & Parts"}</span>
          </Button>

          {cleanupEligibleCount > 0 && (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={onOpenCleanupDialog}
              className="h-8 gap-1.5 border-cyan-500/40 bg-cyan-500/10 text-cyan-600 dark:text-cyan-400 hover:bg-cyan-500/20 text-xs font-semibold"
              title="Surgically remove verified local copies from browser IndexedDB"
            >
              <CheckCircle2 className="h-3.5 w-3.5" />
              <span>Clean Up Local ({cleanupEligibleCount})</span>
            </Button>
          )}

          <button
            type="button"
            onClick={() => setIsExpanded(!isExpanded)}
            className="rounded-md border border-border p-1.5 text-muted hover:text-foreground"
            aria-label={isExpanded ? "Collapse details" : "Expand details"}
          >
            {isExpanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          </button>
        </div>
      </div>

      {isExpanded && (
        <div className="border-t border-border/60 bg-surface-muted/40 p-4 text-xs text-muted sm:p-5 space-y-4">
          {/* Architecture Pillars */}
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-lg border border-border/60 bg-surface p-3">
              <div className="font-semibold text-foreground flex items-center gap-1.5">
                <HardDrive className="h-3.5 w-3.5 text-amber-500" />
                <span>1. Local IndexedDB</span>
              </div>
              <p className="mt-1 text-[11px] leading-relaxed">
                Offline durability layer. Local batches map to verified generation parts; pending outbox operations block premature cleanup.
              </p>
            </div>
            <div className="rounded-lg border border-border/60 bg-surface p-3">
              <div className="font-semibold text-foreground flex items-center gap-1.5">
                <Cloud className="h-3.5 w-3.5 text-cyan-500" />
                <span>2. Cloudflare R2</span>
              </div>
              <p className="mt-1 text-[11px] leading-relaxed">
                Authoritative immutable generations (<code className="text-[10px]">manifest.json</code> + <code className="text-[10px]">parts/part-*.json</code>). Verified by SHA-256 and byte size.
              </p>
            </div>
            <div className="rounded-lg border border-border/60 bg-surface p-3">
              <div className="font-semibold text-foreground flex items-center gap-1.5">
                <Database className="h-3.5 w-3.5 text-emerald-500" />
                <span>3. Supabase PostgreSQL</span>
              </div>
              <p className="mt-1 text-[11px] leading-relaxed">
                Canonical receipt registry (<code className="text-[10px]">storage_generations</code> &amp; <code className="text-[10px]">storage_manifest_parts</code>) guaranteeing transaction commit.
              </p>
            </div>
          </div>

          {/* Artifact Telemetry Bar */}
          {lastComparedAt && (
            <div className="rounded-lg border border-border/60 bg-surface p-3.5">
              <div className="flex items-center justify-between pb-2 mb-2 border-b border-border/40">
                <div className="font-semibold text-foreground text-xs flex items-center gap-1.5">
                  <Layers className="h-3.5 w-3.5 text-primary" />
                  <span>Artifact Verification Telemetry</span>
                </div>
                <button
                  type="button"
                  onClick={() => setShowMatrix(!showMatrix)}
                  className="text-[11px] font-semibold text-primary hover:underline flex items-center gap-1"
                >
                  <span>{showMatrix ? "Hide Artifact Matrix" : "View Artifact Matrix"}</span>
                  {showMatrix ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                </button>
              </div>

              <div className="grid grid-cols-2 gap-2 sm:grid-cols-5 text-center">
                <div className="rounded border border-border/40 bg-surface-muted/30 p-2">
                  <div className="text-[10px] uppercase font-bold text-muted">Generations</div>
                  <div className="text-base font-extrabold text-foreground mt-0.5">
                    {artifactStats?.generationsInspected ?? generationSummaries.length}
                  </div>
                </div>
                <div className="rounded border border-border/40 bg-surface-muted/30 p-2">
                  <div className="text-[10px] uppercase font-bold text-muted">Parts Inspected</div>
                  <div className="text-base font-extrabold text-foreground mt-0.5">
                    {totalParts}
                  </div>
                </div>
                <div className="rounded border border-border/40 bg-surface-muted/30 p-2">
                  <div className="text-[10px] uppercase font-bold text-emerald-500">Parts Verified</div>
                  <div className="text-base font-extrabold text-emerald-500 mt-0.5">
                    {verifiedParts}
                  </div>
                </div>
                <div className="rounded border border-border/40 bg-surface-muted/30 p-2">
                  <div className="text-[10px] uppercase font-bold text-cyan-500">Cleanup Ready Parts</div>
                  <div className="text-base font-extrabold text-cyan-500 mt-0.5">
                    {eligibleParts}
                  </div>
                </div>
                <div className="rounded border border-border/40 bg-surface-muted/30 p-2 col-span-2 sm:col-span-1">
                  <div className="text-[10px] uppercase font-bold text-muted">Conflicts / Missing</div>
                  <div className={`text-base font-extrabold mt-0.5 ${conflictsCount > 0 ? "text-rose-500" : "text-emerald-500"}`}>
                    {conflictsCount}
                  </div>
                </div>
              </div>

              {/* Expandable Generation & Part Verification Matrix Table */}
              {showMatrix && (
                <div className="mt-3 overflow-x-auto border-t border-border/40 pt-3">
                  {generationSummaries.length === 0 && partResults.length === 0 ? (
                    <p className="text-[11px] text-muted text-center py-2">
                      No cloud generation artifacts loaded yet. Click &quot;Verify Generations &amp; Parts&quot; above.
                    </p>
                  ) : (
                    <div className="space-y-3">
                      {generationSummaries.map((gen) => (
                        <div
                          key={gen.generationId}
                          className="rounded-lg border border-border/60 bg-surface-muted/20 p-2.5"
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2 pb-2 mb-2 border-b border-border/40">
                            <div className="flex items-center gap-2">
                              <span className="font-mono font-bold text-foreground text-[11px]">
                                Generation #{gen.generationNumber} ({gen.generationId.slice(0, 16)}…)
                              </span>
                              {gen.isHistorical && (
                                <span className="rounded bg-purple-500/15 px-1.5 py-0.2 text-[10px] font-bold text-purple-400">
                                  Historical Archive
                                </span>
                              )}
                              <span className="rounded bg-emerald-500/15 px-1.5 py-0.2 text-[10px] font-bold text-emerald-500">
                                {gen.state}
                              </span>
                            </div>
                            <div className="text-[11px] text-muted">
                              {gen.totalParts} part{gen.totalParts !== 1 ? "s" : ""} · {gen.totalRecords} record{gen.totalRecords !== 1 ? "s" : ""}
                            </div>
                          </div>

                          <div className="space-y-1.5">
                            {gen.parts.map((p) => (
                              <div
                                key={p.partKey}
                                className="flex flex-wrap items-center justify-between gap-2 rounded bg-surface p-2 text-[11px] border border-border/40"
                              >
                                <div className="flex items-center gap-2">
                                  <span className="font-mono text-muted text-[10px]">
                                    {p.partKey.split("/").pop()}
                                  </span>
                                  <span className="text-muted">
                                    ({p.r2.actualByteCount ? `${(p.r2.actualByteCount / 1024).toFixed(1)} KB` : "size unk"} · {p.indexedDB.recordCount} records)
                                  </span>
                                </div>

                                <div className="flex items-center gap-3">
                                  {/* R2 status */}
                                  <span
                                    className={`inline-flex items-center gap-1 ${p.r2.partReadable && p.r2.checksumMatches ? "text-emerald-500" : "text-amber-500"}`}
                                    title={`R2: ${p.r2.partReadable ? "Readable" : "Missing"}, SHA-256: ${p.r2.checksumMatches ? "Matches" : "Mismatch"}`}
                                  >
                                    <Cloud className="h-3 w-3" />
                                    <span>R2 SHA-256</span>
                                    {p.r2.checksumMatches ? <CheckCircle2 className="h-2.5 w-2.5" /> : <AlertCircle className="h-2.5 w-2.5" />}
                                  </span>

                                  {/* Supabase status */}
                                  <span
                                    className={`inline-flex items-center gap-1 ${p.supabase.partReceiptExists && p.supabase.checksumMatches ? "text-emerald-500" : "text-amber-500"}`}
                                    title={`Supabase: ${p.supabase.partReceiptExists ? "Receipt Committed" : "Receipt Missing"}`}
                                  >
                                    <Database className="h-3 w-3" />
                                    <span>Supabase Receipt</span>
                                    {p.supabase.partReceiptExists ? <CheckCircle2 className="h-2.5 w-2.5" /> : <AlertCircle className="h-2.5 w-2.5" />}
                                  </span>

                                  {/* IndexedDB status */}
                                  <span
                                    className={`inline-flex items-center gap-1 ${!p.indexedDB.hasPendingMutations ? "text-emerald-500" : "text-amber-500"}`}
                                    title={`IndexedDB: ${p.indexedDB.hasPendingMutations ? "Pending outbox mutations" : "Snapshot verified"}`}
                                  >
                                    <HardDrive className="h-3 w-3" />
                                    <span>IndexedDB</span>
                                    {!p.indexedDB.hasPendingMutations ? <CheckCircle2 className="h-2.5 w-2.5" /> : <Clock className="h-2.5 w-2.5" />}
                                  </span>

                                  {/* Status Pill */}
                                  {p.cleanupEligible ? (
                                    <span className="rounded bg-emerald-500/15 px-1.5 py-0.2 text-[10px] font-bold text-emerald-500">
                                      Cleanup Eligible
                                    </span>
                                  ) : p.isHistorical ? (
                                    <span className="rounded bg-purple-500/15 px-1.5 py-0.2 text-[10px] font-bold text-purple-400">
                                      Historical Safe
                                    </span>
                                  ) : (
                                    <span className="rounded bg-amber-500/15 px-1.5 py-0.2 text-[10px] font-bold text-amber-500" title={p.reasons.join(", ")}>
                                      Audit Pending
                                    </span>
                                  )}
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {lastComparedAt && (
            <div className="mt-3 flex items-center justify-between text-[11px] text-muted">
              <span>Last 3-way reconciliation: {new Date(lastComparedAt).toLocaleString()}</span>
              <span className="font-mono text-[10px] text-emerald-500">Zero Cloud Deletions Guaranteed · Zero Per-Item R2 Calls</span>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. StorageStatusSection
// ─────────────────────────────────────────────────────────────────────────────

interface StorageStatusSectionProps {
  category: StorageStateCategory;
  title: string;
  description: string;
  count: number;
  icon?: React.ReactNode;
  actionButton?: React.ReactNode;
  children: React.ReactNode;
  emptyMessage?: string;
}

export function StorageStatusSection({
  category,
  title,
  description,
  count,
  icon,
  actionButton,
  children,
  emptyMessage = "No items in this storage section.",
}: StorageStatusSectionProps) {
  const getAccent = () => {
    switch (category) {
      case "LOCAL_ONLY":
        return "border-amber-500/30 bg-amber-500/[0.02]";
      case "LOCAL_AND_CLOUD":
        return "border-cyan-500/30 bg-cyan-500/[0.02]";
      case "CLOUD_ONLY":
        return "border-emerald-500/30 bg-emerald-500/[0.02]";
      case "HISTORICAL_ARCHIVE":
        return "border-purple-500/30 bg-purple-500/[0.02]";
      default:
        return "border-border/80 bg-surface";
    }
  };

  const getBadgeColor = () => {
    switch (category) {
      case "LOCAL_ONLY":
        return "bg-amber-500/20 text-amber-500 border-amber-500/40";
      case "LOCAL_AND_CLOUD":
        return "bg-cyan-500/20 text-cyan-500 border-cyan-500/40";
      case "CLOUD_ONLY":
        return "bg-emerald-500/20 text-emerald-500 border-emerald-500/40";
      case "HISTORICAL_ARCHIVE":
        return "bg-purple-500/20 text-purple-400 border-purple-500/40";
      default:
        return "bg-muted/20 text-muted border-border";
    }
  };

  return (
    <section className={`rounded-xl border ${getAccent()} p-4 sm:p-5 shadow-xs transition`}>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between border-b border-border/60 pb-3 mb-4">
        <div className="flex items-center gap-2.5">
          {icon}
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-bold tracking-tight text-foreground sm:text-base">
                {title}
              </h2>
              <span
                className={`rounded-full border px-2 py-0.2 text-[11px] font-bold ${getBadgeColor()}`}
              >
                {count}
              </span>
            </div>
            <p className="mt-0.5 text-xs text-muted">{description}</p>
          </div>
        </div>
        {actionButton && <div className="self-start sm:self-auto">{actionButton}</div>}
      </div>

      {count === 0 ? (
        <div className="rounded-lg border border-dashed border-border/60 p-6 text-center text-xs text-muted">
          {emptyMessage}
        </div>
      ) : (
        children
      )}
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. StorageCleanupConfirmationDialog
// ─────────────────────────────────────────────────────────────────────────────

interface StorageCleanupConfirmationProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => Promise<void>;
  isCleaning: boolean;
  recordCount: number;
  datasetName: string;
}

export function StorageCleanupConfirmationDialog({
  isOpen,
  onClose,
  onConfirm,
  isCleaning,
  recordCount,
  datasetName,
}: StorageCleanupConfirmationProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs animate-in fade-in duration-200">
      <Card className="w-full max-w-md border border-border/80 bg-surface p-5 shadow-xl sm:p-6">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-2.5">
            <div className="rounded-lg border border-cyan-500/30 bg-cyan-500/10 p-2 text-cyan-500">
              <CheckCircle2 className="h-5 w-5" />
            </div>
            <h3 className="text-base font-bold text-foreground">
              Safe Local Cleanup
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isCleaning}
            className="rounded-md p-1 text-muted hover:text-foreground disabled:opacity-50"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-4 space-y-3 text-xs text-muted">
          <p>
            You are about to remove <strong className="text-foreground">{recordCount} verified {datasetName}</strong> from this browser’s IndexedDB storage.
          </p>

          <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-emerald-600 dark:text-emerald-400">
            <div className="font-semibold">Authoritative Cloud Persistence Guaranteed</div>
            <p className="mt-1 text-[11px] leading-relaxed">
              These records are permanently stored in Cloudflare R2 and Supabase PostgreSQL.
              They will remain visible under the <strong>R2 Cloud</strong> view and will never be deleted from the cloud.
            </p>
          </div>

          <div className="rounded-lg border border-border/60 bg-surface-muted/40 p-3 text-[11px]">
            <div className="font-semibold text-foreground">Zero Cloud DELETE Tombstones</div>
            <p className="mt-0.5">
              This operation deletes only the local cache copy in this browser. No deletion commands are sent to R2 or PostgreSQL.
            </p>
          </div>
        </div>

        <div className="mt-6 flex items-center justify-end gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onClose}
            disabled={isCleaning}
            className="h-9 px-3 text-xs font-semibold"
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="primary"
            size="sm"
            onClick={onConfirm}
            disabled={isCleaning}
            className="h-9 gap-1.5 bg-cyan-600 hover:bg-cyan-700 text-white px-4 text-xs font-semibold"
          >
            {isCleaning ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <CheckCircle2 className="h-3.5 w-3.5" />
            )}
            <span>{isCleaning ? "Cleaning Up…" : `Confirm Cleanup (${recordCount})`}</span>
          </Button>
        </div>
      </Card>
    </div>
  );
}
