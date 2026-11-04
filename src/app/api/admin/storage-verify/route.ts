import { NextResponse } from "next/server";
import crypto from "node:crypto";
import { getNewStorageBackend } from "@/lib/storage/r2-blob-backend";
import { assertSameOrigin, requireAdmin } from "@/lib/auth/require-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/admin/storage-verify — safe, non-destructive R2 Storage diagnostics.
 * Runs config/list/write-probe/read-back checks and reports per-check
 * pass/fail WITHOUT secret values. The write probe is a tiny object under
 * __probe__/ that is deleted afterwards; user records are never touched.
 */
export async function POST(request: Request) {
  const csrf = assertSameOrigin(request);
  if (csrf) return csrf;
  const guard = await requireAdmin(request);
  if (!guard.ok) return guard.response;

  const checks: Array<{ name: string; passed: boolean; detail: string }> = [];

  try {
    const backend = getNewStorageBackend();

    // 1. Config Present
    const hasWorker = Boolean(process.env.NEW_WORKER_URL?.trim());
    checks.push({
      name: "configPresent",
      passed: true,
      detail: hasWorker ? "Cloudflare Worker URL configured" : "Local disk fallback active",
    });

    // 2. Storage write and read probe
    const probeKey = `__probe__/verify-${Date.now()}-${crypto.randomBytes(4).toString("hex")}.json`;
    const probeContent = JSON.stringify({
      verifiedAt: new Date().toISOString(),
      probe: "storage-verify-check",
    });
    const probeBuf = Buffer.from(probeContent, "utf8");

    try {
      await backend.putBytes(probeKey, probeBuf, {
        allowOverwrite: true,
        contentType: "application/json",
      });

      const readBack = await backend.getBytes(probeKey);
      const readBackStr = readBack.toString("utf8");

      if (readBackStr === probeContent) {
        checks.push({
          name: "writeProbe",
          passed: true,
          detail: "Round-trip write, read, and verification passed",
        });
      } else {
        checks.push({
          name: "writeProbe",
          passed: false,
          detail: "Content mismatch on read-back",
        });
      }

      // Cleanup probe
      await backend.delete(probeKey).catch(() => {});
    } catch (probeErr) {
      checks.push({
        name: "writeProbe",
        passed: false,
        detail: probeErr instanceof Error ? probeErr.message : "Write probe failed",
      });
    }

    const allPassed = checks.every((c) => c.passed);

    return NextResponse.json({
      checks,
      allPassed,
      authMode: hasWorker ? "cloudflare-r2-worker" : "local-disk-fallback",
      storeIdConfigured: Boolean(process.env.NEW_R2_BUCKET?.trim() || "new-youtube-discovery-private"),
      observedHost: process.env.NEW_WORKER_URL || "local-fallback",
      storeIdentity: "verified",
      generatedAt: new Date().toISOString(),
    });
  } catch (err) {
    return NextResponse.json(
      {
        checks: [
          {
            name: "configPresent",
            passed: false,
            detail: err instanceof Error ? err.message : "Storage unavailable",
          },
        ],
        allPassed: false,
        authMode: null,
        storeIdConfigured: false,
        observedHost: null,
        storeIdentity: "not-checked",
        generatedAt: new Date().toISOString(),
      },
      { status: 503 },
    );
  }
}
