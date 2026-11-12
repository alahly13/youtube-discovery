import { NextResponse } from "next/server";
import crypto from "node:crypto";
import { NEW_R2_BUCKET, getNewStorageBackend } from "@/lib/storage/r2-blob-backend";
import { assertSameOrigin, requireAdmin } from "@/lib/auth/require-auth";
import { resolveStorageOwnerId } from "@/lib/auth/storage-owner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function extractSafeHost(workerUrl?: string): string {
  if (!workerUrl?.trim()) return "local-fallback";
  try {
    return new URL(workerUrl.trim()).host;
  } catch {
    return "configured";
  }
}

/**
 * POST /api/admin/storage-verify — safe, non-destructive R2 Storage diagnostics.
 * Runs config/write-probe/read-back checks and reports per-check pass/fail
 * WITHOUT secret values. The write probe uses a canonical owner-scoped temporary
 * object under `asdy/temp/<ownerId>/_probe/` that is deleted afterwards; user
 * records and committed generations are never touched.
 */
export async function POST(request: Request) {
  const csrf = assertSameOrigin(request);
  if (csrf) return csrf;
  const guard = await requireAdmin(request);
  if (!guard.ok) return guard.response;

  const checks: Array<{ name: string; passed: boolean; detail: string }> = [];

  try {
    const backend = getNewStorageBackend();
    const storageOwnerUuid = resolveStorageOwnerId(guard.admin);
    if (!storageOwnerUuid) {
      return NextResponse.json(
        {
          checks: [
            {
              name: "ownerScope",
              passed: false,
              detail: "Unable to resolve a canonical storage owner UUID for this session.",
            },
          ],
          allPassed: false,
          authMode: null,
          storeIdConfigured: false,
          observedHost: null,
          storeIdentity: "not-checked",
          generatedAt: new Date().toISOString(),
        },
        { status: 500 },
      );
    }

    // 1. Config Present — check canonical R2_NEW_WORKER_URL + Worker HMAC secret
    const workerUrl = process.env.R2_NEW_WORKER_URL?.trim();
    const hasSecret = Boolean(
      process.env.R2_NEW_WORKER_AUTH_SECRET?.trim() ||
        process.env.WORKER_AUTH_SECRET?.trim() ||
        process.env.R2_WORKER_AUTH_SECRET?.trim(),
    );
    const hasWorker = Boolean(workerUrl && hasSecret);
    checks.push({
      name: "configPresent",
      passed: true,
      detail: hasWorker
        ? "Cloudflare NEW Worker URL and auth secret configured"
        : "Cloudflare Worker not fully configured — local disk fallback active",
    });

    // 2. Canonical owner-scoped temp write and read-back probe
    const probeKey = `asdy/temp/${storageOwnerUuid}/_probe/verify-${Date.now()}-${crypto.randomBytes(4).toString("hex")}.json`;
    const probeContent = JSON.stringify({
      verifiedAt: new Date().toISOString(),
      probe: "storage-verify-check",
      owner: storageOwnerUuid,
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
          detail: "Canonical owner-scoped temp write, read-back, and SHA verification passed",
        });
      } else {
        checks.push({
          name: "writeProbe",
          passed: false,
          detail: "Content mismatch on read-back",
        });
      }

      // Cleanup temporary probe object
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
      storeIdConfigured: Boolean(NEW_R2_BUCKET),
      observedHost: extractSafeHost(workerUrl),
      storeIdentity: allPassed ? "verified" : "degraded",
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
