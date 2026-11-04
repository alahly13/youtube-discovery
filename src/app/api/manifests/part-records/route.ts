import "server-only";

import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/require-auth";
import { getNewStorageBackend } from "@/lib/storage/r2-blob-backend";
import { getR2WorkerStorageClient } from "@/lib/storage/r2-worker-storage-client";
import { parseStorageKey } from "@/lib/storage/canonical-paths";

export const dynamic = "force-dynamic";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * GET /api/manifests/part-records?path=<storagePath>
 * ──────────────────────────────────────────────────────────────────────────
 * Inspects and returns records contained inside an individual manifest part.
 * Enforces admin authorization, owner partition isolation, and path traversal
 * protection.
 * ═══════════════════════════════════════════════════════════════════════════
 */
export async function GET(request: Request) {
  const auth = await requireAdmin(request);
  if (!auth.ok) return auth.response;

  const storageOwnerUuid = auth.admin.userId || "00000000-0000-0000-0000-000000000001";
  const { searchParams } = new URL(request.url);
  const targetPath = searchParams.get("path");

  if (!targetPath) {
    return NextResponse.json({ ok: false, error: "Missing required path query parameter." }, { status: 400 });
  }

  // Path traversal defense
  if (targetPath.includes("..") || targetPath.includes("\\")) {
    return NextResponse.json({ ok: false, error: "Invalid path: traversal characters forbidden." }, { status: 400 });
  }

  const clean = targetPath.replace(/^\/+/, "");
  const parsed = parseStorageKey(clean);

  // Partition check: ensure caller accesses their own partition or admin access
  const isCanonicalOwner = clean.startsWith(`asdy/persistence/${storageOwnerUuid}/`);
  const isLegacyOwner = clean.startsWith(`${storageOwnerUuid}/persistence/`);

  if (!isCanonicalOwner && !isLegacyOwner && parsed?.ownerId !== storageOwnerUuid && auth.admin.username !== "asdy") {
    return NextResponse.json(
      { ok: false, error: "Access denied: requested storage path outside caller's authorized partition." },
      { status: 403 }
    );
  }

  try {
    let rawText = "";

    // 1. Try R2 Worker client first
    try {
      const r2Client = getR2WorkerStorageClient();
      const { data } = await r2Client.getObject("NEW", clean, {
        storageOwnerUuid,
      });
      rawText = new TextDecoder("utf-8").decode(data);
    } catch {
      // 2. Fall back to Blob/Disk storage backend
      const backend = getNewStorageBackend();
      const diskData = await backend.getBytes(clean);
      if (diskData) {
        rawText = diskData.toString("utf-8");
      }
    }

    if (!rawText) {
      return NextResponse.json({ ok: false, error: "Part file not found in storage." }, { status: 404 });
    }

    const json = JSON.parse(rawText);

    let records: unknown[] = [];
    if (Array.isArray(json)) {
      records = json;
    } else if (Array.isArray(json.items)) {
      records = json.items;
    } else if (Array.isArray(json.records)) {
      records = json.records;
    }

    return NextResponse.json({
      ok: true,
      path: clean,
      datasetType: json.datasetType || parsed?.datasetType || null,
      datasetSlug: parsed?.datasetSlug || null,
      generationId: json.generationId || parsed?.generationId || null,
      partNumber: json.partNumber || parsed?.partNumber || 1,
      totalPartsInGeneration: json.totalPartsInGeneration || 1,
      createdAt: json.createdAt || null,
      recordCount: records.length,
      records,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Failed to read part records" },
      { status: 500 }
    );
  }
}
