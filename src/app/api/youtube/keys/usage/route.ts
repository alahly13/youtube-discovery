import { NextResponse } from "next/server";
import { getBlobBackend } from "@/lib/blob/backend-factory";
import { getSafeApiKeysList } from "@/lib/platforms/youtube/youtube-api-keys";
import {
  nextPacificMidnightIso,
  pacificDayKey,
  poolKeyFor,
  readPools,
  readTodayUsage,
  type QuotaPoolsDoc,
  type UsageDoc,
} from "@/lib/keys/quota-pools";
import { requireAdmin } from "@/lib/auth/require-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/youtube/keys/usage — project-grouped quota dashboard (auth).
 * Every figure is a LOCAL ESTIMATE from persistent request accounting
 * (confidence: "local-estimate") unless official monitoring is configured
 * (it is not — see docs). Per-key estimates and project totals derive from
 * the SAME request events (two group-bys), never added together.
 */
export async function GET(request: Request) {
  const guard = await requireAdmin(request);
  if (!guard.ok) return guard.response;
  try {
    const backend = getBlobBackend();
    const [keysData, pools, usage]: [
      Awaited<ReturnType<typeof getSafeApiKeysList>>,
      QuotaPoolsDoc,
      UsageDoc,
    ] = await Promise.all([
      getSafeApiKeysList(),
      readPools(backend).catch((): QuotaPoolsDoc => ({ version: 1 as const, updatedAt: "", pools: {} })),
      readTodayUsage(backend).catch((): UsageDoc => ({
        version: 1 as const,
        date: pacificDayKey(),
        byKey: {},
        byProject: {},
        byProjectBucket: {},
        lastRequest: null,
      })),
    ]);
    const dailyBudget = Number(process.env.YOUTUBE_DAILY_QUOTA_BUDGET ?? 10000) || 10000;
    const now = Date.now();

    interface PoolView {
      poolKey: string;
      kind: "project" | "single-key";
      projectId: string | null;
      displayName: string | null;
      accountLabels: string[];
      association: "verified" | "declared" | "unknown";
      evidence: string | null;
      keyIds: string[];
      buckets: Record<
        "search" | "other",
        {
          usedUnits: number;
          limitUnits: number;
          percent: number;
          exhausted: boolean;
          exhaustedUntil: string | null;
          confidence: "local-estimate";
        }
      >;
    }

    const byPoolKey = new Map<string, PoolView>();
    const customKeys = keysData.keys.filter((k) => k.source === "custom");
    for (const k of customKeys) {
      const poolKey = poolKeyFor(k.projectId ?? null, k.id);
      let view = byPoolKey.get(poolKey);
      if (!view) {
        const isProject = poolKey.startsWith("project:");
        view = {
          poolKey,
          kind: isProject ? "project" : "single-key",
          projectId: k.projectId ?? null,
          displayName: k.projectDisplayName ?? null,
          accountLabels: [],
          association: k.projectAssociation ?? "unknown",
          evidence: null,
          keyIds: [],
          buckets: {
            search: { usedUnits: 0, limitUnits: dailyBudget, percent: 0, exhausted: false, exhaustedUntil: null, confidence: "local-estimate" },
            other: { usedUnits: 0, limitUnits: dailyBudget, percent: 0, exhausted: false, exhaustedUntil: null, confidence: "local-estimate" },
          },
        };
        byPoolKey.set(poolKey, view);
      }
      view.keyIds.push(k.id);
      // Strongest association wins for display; unknowns never upgrade a pool.
      if (k.projectAssociation === "verified") view.association = "verified";
      else if (k.projectAssociation === "declared" && view.association === "unknown") view.association = "declared";
      // Attach per-key account label for the pool header.
      const label = (k as { accountLabel?: string | null }).accountLabel;
      if (label && !view.accountLabels.includes(label)) view.accountLabels.push(label);
      if (!view.displayName && k.projectDisplayName) view.displayName = k.projectDisplayName;
    }

    // Usage → buckets. Bucket-split project totals are recorded at write
    // time (same events as key totals — two group-bys, never double-counted).
    for (const [poolKey, view] of byPoolKey) {
      const pool = pools.pools[poolKey];
      for (const bucket of ["search", "other"] as const) {
        const used = usage.byProjectBucket[`${poolKey}#${bucket}`]?.units ?? 0;
        const state = pool?.[bucket];
        const exhausted = Boolean(state && state.exhaustedUntil && state.exhaustedUntil > now);
        view.buckets[bucket] = {
          usedUnits: used,
          limitUnits: dailyBudget,
          percent: dailyBudget > 0 ? Math.min(100, Math.round((used / dailyBudget) * 100)) : 0,
          exhausted,
          exhaustedUntil: exhausted && state?.exhaustedUntil ? new Date(state.exhaustedUntil).toISOString() : null,
          confidence: "local-estimate",
        };
        if (!view.evidence && state?.evidence) view.evidence = state.evidence;
      }
    }

    const keys = customKeys.map((k) => {
      const today = usage.byKey[k.id] ?? { requests: 0, units: 0, errors: 0 };
      return {
        id: k.id,
        label: k.label,
        maskedKey: k.maskedKey,
        isActive: k.isActive,
        status: k.status,
        accountLabel: (k as { accountLabel?: string | null }).accountLabel ?? null,
        projectId: k.projectId ?? null,
        projectDisplayName: k.projectDisplayName ?? null,
        projectAssociation: k.projectAssociation ?? "unknown",
        order: (k as { order?: number }).order ?? 0,
        addedAt: k.addedAt,
        lastUsed: k.lastUsed,
        requestsToday: today.requests,
        unitsToday: today.units,
        errorsToday: today.errors,
        poolKey: poolKeyFor(k.projectId ?? null, k.id),
      };
    });

    return NextResponse.json({
      date: usage.date,
      resetAt: nextPacificMidnightIso(),
      dailyBudgetUnits: dailyBudget,
      officialMonitoring: null, // none configured — see docs for Service Usage API option
      pools: [...byPoolKey.values()],
      keys,
      envKey: keysData.keys.find((k) => k.id === "env") ?? null,
      lastRequest: usage.lastRequest,
      measuredAt: new Date().toISOString(),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to load quota usage";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
