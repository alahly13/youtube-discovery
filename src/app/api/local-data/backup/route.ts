import "server-only";

import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { assertSameOrigin, requireAdmin } from "@/lib/auth/require-auth";
import { createZipArchive, type ZipFileEntry } from "@/lib/storage/zip-builder";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const backupPayloadSchema = z.object({
  userId: z.string().optional(),
  capturedAt: z.string().optional(),
  entries: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      category: z.enum([
        "SAVED_ITEMS",
        "PLAYLIST",
        "SEARCH_HISTORY",
        "RESEARCH_QUEUE",
        "REFERENCES",
      ]),
      mechanism: z.string(),
      storageKey: z.string(),
      mimeType: z.string(),
      recordCount: z.number(),
      sizeBytes: z.number(),
      previewData: z.unknown().optional(),
      /**
       * Complete raw data for backup export — full depth, full array length.
       * Used preferentially over previewData when available to ensure the
       * backup archive contains untruncated content.
       */
      fullBackupData: z.unknown().optional(),
      isProtected: z.boolean().optional(),
    })
  ),
});

/**
 * Redacts secrets and sensitive fields from raw objects before writing to ZIP.
 * Preserves full array lengths and full strings up to depth 25.
 */
function redactObjectSecrets(obj: unknown, depth = 0): unknown {
  if (depth > 25 || obj === null || obj === undefined) return obj;
  if (typeof obj === "string") {
    if (/^[A-Za-z0-9-_=]+\.[A-Za-z0-9-_=]+\.?[A-Za-z0-9-_.+/=]*$/.test(obj) && obj.length > 30) {
      return "[REDACTED_TOKEN]";
    }
    return obj;
  }
  if (typeof obj !== "object") return obj;
  if (Array.isArray(obj)) {
    return obj.map((item) => redactObjectSecrets(item, depth + 1));
  }

  const result: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(obj as Record<string, unknown>)) {
    if (/(token|secret|password|key|auth|session|credential)/i.test(key)) {
      result[key] = "[REDACTED_SECRET]";
    } else {
      result[key] = redactObjectSecrets(val, depth + 1);
    }
  }
  return result;
}

/**
 * POST /api/local-data/backup — Generates and streams a verifiable ZIP backup archive of local browser data.
 */
export async function POST(request: Request) {
  const csrf = assertSameOrigin(request);
  if (csrf) return csrf;

  const guard = await requireAdmin(request);
  if (!guard.ok) return guard.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON payload" }, { status: 400 });
  }

  const parsed = backupPayloadSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Validation failed", details: parsed.error.issues }, { status: 400 });
  }

  const { entries, userId, capturedAt } = parsed.data;
  const timestamp = capturedAt || new Date().toISOString();
  const fileEntries: ZipFileEntry[] = [];
  const checksums: string[] = [];

  const categoryStats = {
    SAVED_ITEMS: 0,
    PLAYLIST: 0,
    SEARCH_HISTORY: 0,
    RESEARCH_QUEUE: 0,
    REFERENCES: 0,
  };

  const categoryFolderMap: Record<string, string> = {
    SAVED_ITEMS: "Saved-Items",
    PLAYLIST: "Playlists",
    SEARCH_HISTORY: "Search-History",
    RESEARCH_QUEUE: "Research-Queue",
    REFERENCES: "References",
  };

  // 1. Process and package eligible entries
  for (const entry of entries) {
    if (entry.isProtected) continue; // Exclude protected items

    const folder = categoryFolderMap[entry.category] || "Saved-Items";
    
    // Create clean, descriptive standard filenames (e.g. Saved-Items/saved-items.json)
    let baseFilename: string;
    if (entry.storageKey.includes("::")) {
      const parts = entry.storageKey.split("::");
      const field = parts[1];
      const safeField = field.replace(/([a-z])([A-Z])/g, "$1-$2").toLowerCase();
      baseFilename = `${folder}/${safeField}.json`;
    } else {
      const safeKey = entry.storageKey.replace(/[^a-zA-Z0-9._-]/g, "_");
      baseFilename = `${folder}/${safeKey}.json`;
    }

    let filename = baseFilename;
    let counter = 1;
    while (fileEntries.some((f) => f.filename === filename)) {
      filename = baseFilename.replace(/\.json$/, `_${counter++}.json`);
    }

    // Prioritize untruncated fullBackupData over previewData
    const rawData = entry.fullBackupData !== undefined ? entry.fullBackupData : (entry.previewData ?? {});
    const sanitizedData = redactObjectSecrets(rawData);
    const contentStr = JSON.stringify(
      {
        id: entry.id,
        name: entry.name,
        category: entry.category,
        mechanism: entry.mechanism,
        storageKey: entry.storageKey,
        recordCount: entry.recordCount,
        exportedAt: timestamp,
        data: sanitizedData,
      },
      null,
      2
    );

    const hash = crypto.createHash("sha256").update(contentStr, "utf8").digest("hex");
    checksums.push(`${hash}  ${filename}`);

    fileEntries.push({
      filename,
      data: contentStr,
    });

    categoryStats[entry.category] += entry.recordCount || 1;
  }

  // 2. Build backup manifest
  const manifest = {
    archiveTitle: "YouTube Discovery — Local Browser Data Backup",
    archiveTitleArabic: "النسخ الاحتياطي لبيانات المتصفح المحلية",
    version: "2026.1",
    capturedAt: timestamp,
    exportedBy: guard.admin.username,
    storageOwnerId: userId || guard.admin.userId || "authenticated_admin",
    totalFiles: fileEntries.length,
    categoryStats,
    notes: "Authentic client-side browser storage snapshot with strict secret redaction. Zero storage mutation occurred.",
  };

  const manifestStr = JSON.stringify(manifest, null, 2);
  const manifestHash = crypto.createHash("sha256").update(manifestStr, "utf8").digest("hex");
  checksums.push(`${manifestHash}  backup-manifest.json`);

  fileEntries.unshift({
    filename: "backup-manifest.json",
    data: manifestStr,
  });

  // 3. Add SHA256SUMS.txt
  fileEntries.push({
    filename: "SHA256SUMS.txt",
    data: checksums.join("\n") + "\n",
  });

  // 4. Generate PKZIP 2.0 archive
  const zipBuffer = createZipArchive(fileEntries);
  const downloadFilename = `YouTube-Discovery-Local-Data-Backup-${Date.now()}.zip`;

  return new NextResponse(zipBuffer as unknown as BodyInit, {
    status: 200,
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${downloadFilename}"`,
      "Content-Length": String(zipBuffer.length),
      "Cache-Control": "no-store, no-cache, must-revalidate",
    },
  });
}
