"use client";

import { Activity, AlertTriangle, CheckCircle2, Loader2, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { authFetch } from "@/lib/client/auth-fetch";

/**
 * Quota Dashboard — project-grouped, backend-connected, honestly labeled.
 * Every figure is a LOCAL ESTIMATE from persistent request accounting unless
 * official monitoring is configured (it is not). Per-key estimates and
 * project totals come from the SAME request events — overlapping views, not
 * separate amounts. Associations marked unknown/declared are labeled as such.
 */

interface BucketView {
  usedUnits: number;
  limitUnits: number;
  percent: number;
  exhausted: boolean;
  exhaustedUntil: string | null;
  confidence: "local-estimate";
}

interface PoolView {
  poolKey: string;
  kind: "project" | "single-key";
  projectId: string | null;
  displayName: string | null;
  accountLabels: string[];
  association: "verified" | "declared" | "unknown";
  evidence: string | null;
  keyIds: string[];
  buckets: Record<"search" | "other", BucketView>;
}

interface KeyView {
  id: string;
  label: string;
  maskedKey: string;
  isActive: boolean;
  status: string;
  accountLabel: string | null;
  projectId: string | null;
  projectDisplayName: string | null;
  projectAssociation: "verified" | "declared" | "unknown";
  lastUsed?: string;
  requestsToday: number;
  unitsToday: number;
  errorsToday: number;
  poolKey: string;
}

interface UsageResponse {
  date: string;
  resetAt: string;
  dailyBudgetUnits: number;
  officialMonitoring: null;
  pools: PoolView[];
  keys: KeyView[];
  lastRequest: {
    at: string;
    keyId: string;
    poolKey: string;
    projectId: string | null;
    operation: string;
    bucket: string;
    units: number;
    ok: boolean;
    errorReason: string | null;
  } | null;
  measuredAt: string;
}

function ProgressBar({ percent, exhausted }: { percent: number; exhausted: boolean }) {
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-surface-muted" role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}>
      <div
        className={`h-full rounded-full transition-all ${exhausted ? "bg-danger" : percent >= 80 ? "bg-warning" : "bg-success"}`}
        style={{ width: `${Math.min(100, percent)}%` }}
      />
    </div>
  );
}

function AssociationBadge({ value }: { value: "verified" | "declared" | "unknown" }) {
  if (value === "verified") return <Badge tone="success">Verified pool</Badge>;
  if (value === "declared") return <Badge tone="warning">Admin-declared (unverified)</Badge>;
  return <Badge tone="neutral">Unknown project</Badge>;
}

export function QuotaDashboardCard({ refreshToken }: { refreshToken: number }) {
  const [data, setData] = useState<UsageResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchUsage = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await authFetch("/api/youtube/keys/usage");
      if (!res.ok) throw new Error("Failed to load quota usage");
      setData(await res.json());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load quota usage");
    } finally {
      setLoading(false);
    }
  };

  /* eslint-disable react-hooks/set-state-in-effect -- Refresh-token-triggered usage fetch */
  useEffect(() => {
    void fetchUsage();
  }, [refreshToken]);
  /* eslint-enable react-hooks/set-state-in-effect */

  return (
    <Card>
      <CardHeader
        title="Quota Pools & Usage"
        eyebrow="Per-project monitoring"
        action={
          <Button type="button" variant="ghost" className="h-8 w-8 p-0" onClick={fetchUsage} title="Refresh usage">
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          </Button>
        }
      />
      <div className="space-y-4 p-4">
        <p className="text-xs leading-relaxed text-muted">
          Keys sharing a Google Cloud project share one quota pool — rotating within an exhausted pool is not new
          quota. Figures below are <strong>local estimates</strong> from persistent request accounting
          (search.list ≈ 100 units/call, other calls ≈ 1 unit/call). No official Google Cloud monitoring is
          connected; exact remaining quota cannot be known without it.
        </p>
        {loading && !data && <p className="flex items-center gap-2 text-xs text-muted"><Loader2 className="h-4 w-4 animate-spin" /> Loading usage…</p>}
        {error && <p role="alert" className="rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger">{error}</p>}
        {data && (
          <>
            <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted">
              <Badge>Day {data.date} (Pacific)</Badge>
              <Badge>Reset {new Date(data.resetAt).toLocaleString()}</Badge>
              <Badge>Budget {data.dailyBudgetUnits.toLocaleString()} u/day (assumed)</Badge>
              <Badge tone="warning">Confidence: local estimate</Badge>
            </div>
            {data.lastRequest && (
              <p className="flex items-start gap-2 rounded-lg border border-border bg-surface-muted/30 px-3 py-2 text-[11px] text-muted">
                <Activity className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>
                  Last request: <strong>{data.lastRequest.operation}</strong> via key{" "}
                  <code className="font-mono">{data.lastRequest.keyId}</code>
                  {data.lastRequest.projectId ? (
                    <> (project <code className="font-mono">{data.lastRequest.projectId}</code>)</>
                  ) : (
                    <> (project unknown)</>
                  )}{" "}
                  — {data.lastRequest.ok ? "succeeded" : `failed (${data.lastRequest.errorReason ?? "error"})`} ·{" "}
                  {new Date(data.lastRequest.at).toLocaleString()}
                </span>
              </p>
            )}
            {data.pools.length === 0 && (
              <p className="rounded-lg border border-dashed border-border p-4 text-center text-xs text-muted">
                No managed keys yet. Add API keys below to form quota pools.
              </p>
            )}
            {data.pools.map((pool) => (
              <div key={pool.poolKey} className="rounded-lg border border-border/80 p-3.5">
                <div className="mb-1 flex flex-wrap items-center gap-2">
                  <h4 className="text-sm font-semibold text-foreground">
                    {pool.kind === "project"
                      ? (pool.displayName || pool.projectId || "Project pool")
                      : "Single key (project unknown)"}
                  </h4>
                  <AssociationBadge value={pool.association} />
                </div>
                <p className="mb-3 font-mono text-[11px] text-muted">
                  {pool.projectId ? `project: ${pool.projectId}` : pool.poolKey}
                  {pool.accountLabels.length > 0 && <> · {pool.accountLabels.join(", ")}</>}
                  {" "}· {pool.keyIds.length} key{pool.keyIds.length === 1 ? "" : "s"}
                </p>
                {(["search", "other"] as const).map((bucket) => {
                  const b = pool.buckets[bucket];
                  return (
                    <div key={bucket} className="mb-2.5">
                      <div className="mb-1 flex items-center justify-between text-[11px]">
                        <span className="font-medium text-foreground">
                          {bucket === "search" ? "Search bucket (search.list)" : "Other bucket (all other calls)"}
                        </span>
                        <span className="text-muted">
                          {b.usedUnits.toLocaleString()} / {b.limitUnits.toLocaleString()} u ({b.percent}%)
                          {b.exhausted ? " · exhausted until reset" : ` · ~${Math.max(0, b.limitUnits - b.usedUnits).toLocaleString()} u left (est.)`}
                        </span>
                      </div>
                      <ProgressBar percent={b.percent} exhausted={b.exhausted} />
                    </div>
                  );
                })}
                {pool.evidence && (
                  <p className="mt-1 flex items-start gap-1.5 text-[11px] text-muted">
                    <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" /> {pool.evidence}
                  </p>
                )}
                <div className="mt-3 space-y-1.5">
                  {data.keys
                    .filter((k) => k.poolKey === pool.poolKey)
                    .map((k) => (
                      <div key={k.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-surface-muted/40 px-2.5 py-1.5 text-[11px]">
                        <span className="min-w-0">
                          <strong className="text-foreground">{k.label}</strong>{" "}
                          <code className="font-mono text-muted">{k.maskedKey}</code>
                          {k.isActive && <Badge tone="success" className="ml-1.5 text-[10px]">Active</Badge>}
                          {k.status === "disabled" && <Badge tone="danger" className="ml-1.5 text-[10px]">Disabled</Badge>}
                          {k.status === "cooling-down" && <Badge tone="warning" className="ml-1.5 text-[10px]">Cooling down</Badge>}
                        </span>
                        <span className="text-muted">
                          {k.requestsToday} req · ~{k.unitsToday.toLocaleString()} u today
                          {k.errorsToday > 0 && <> · {k.errorsToday} err</>}
                          {k.lastUsed ? <> · used {new Date(k.lastUsed).toLocaleString()}</> : " · never used"}
                        </span>
                      </div>
                    ))}
                </div>
              </div>
            ))}
            <p className="flex items-start gap-1.5 text-[11px] text-muted">
              <CheckCircle2 className="mt-0.5 h-3 w-3 shrink-0 text-success" />
              Project totals and per-key figures derive from the same recorded request events — overlapping views, never added together. Rotation across your own projects uses the allocation of each project; it does not bypass Google quotas.
            </p>
          </>
        )}
      </div>
    </Card>
  );
}
