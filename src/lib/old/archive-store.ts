import "server-only";

import { Prisma } from "@prisma/client";
import { getOldStorageBackend, getStorageBackendForBucket } from "@/lib/storage/supabase-storage-backend";
import { OLD_STORAGE_BUCKET } from "@/lib/supabase/storage";
import { prisma } from "@/lib/db/prisma";
import {
  type ArchivedManifestEnvelope,
  type OldArchiveCategory,
  getArchivedManifestStoragePath,
  normalizeOldCategory,
} from "./archive-envelope";

export { getArchivedManifestStoragePath };

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * OLD Legacy Manifest Archive Store Service
 * ──────────────────────────────────────────────────────────────────────────
 * Scope: Workstream B — Phase 1.5 & Phase A-D Addendum
 * - Dedicated OLD bucket: 'old-youtube-discovery-private'
 * - Exact logical prefixes:
 *     asdy/old/saved-items/
 *     asdy/old/saved-playlists/
 *     asdy/old/saved-titles-links/
 *     asdy/old/saved-search-history/
 * - Database registry: archived_manifests (with bucket_id, status, filename)
 * - Deduplication by content SHA-256: rejects duplicate imports with clear error.
 * ═══════════════════════════════════════════════════════════════════════════
 */

export interface ArchivedManifestRecord {
  id: string;
  owner_id: string;
  manifest_id: string;
  category: OldArchiveCategory;
  source_format: string;
  storage_path: string;
  bucket_id?: string;
  original_filename?: string | null;
  mime_type?: string | null;
  status?: string;
  byte_count: number;
  record_count: number;
  content_sha256: string;
  source_created_at: string | null;
  source_exported_at: string | null;
  imported_at: string;
  provenance_metadata?: Prisma.JsonValue;
  filter_summary?: Prisma.JsonValue;
}


/**
 * Checks if a manifest with this exact SHA-256 already exists for the owner.
 */
export async function checkArchiveExistsBySha256(
  ownerId: string,
  contentSha256: string
): Promise<ArchivedManifestRecord | null> {
  try {
    const existing = await prisma.archivedManifest.findFirst({
      where: {
        owner_id: ownerId,
        content_sha256: contentSha256,
      },
    });

    if (existing) {
      return {
        id: existing.id,
        owner_id: existing.owner_id,
        manifest_id: existing.manifest_id,
        category: existing.category as OldArchiveCategory,
        source_format: existing.source_format,
        storage_path: existing.storage_path,
        byte_count: Number(existing.byte_count),
        record_count: existing.record_count,
        content_sha256: existing.content_sha256,
        source_created_at: existing.source_created_at ? existing.source_created_at.toISOString() : null,
        source_exported_at: existing.source_exported_at ? existing.source_exported_at.toISOString() : null,
        imported_at: existing.imported_at.toISOString(),
        provenance_metadata: existing.provenance_metadata,
        filter_summary: existing.filter_summary,
      };
    }
  } catch {
    // If DB table not yet created in local environment, gracefully proceed
  }

  return null;
}

/**
 * Imports and persists a legacy manifest envelope into ASDY/OLD/ storage
 * and the archived_manifests database registry.
 */
export async function importArchivedManifest(
  ownerId: string,
  storageOwnerUuid: string,
  envelope: ArchivedManifestEnvelope
): Promise<ArchivedManifestRecord> {
  const meta = envelope.manifest_metadata;

  // 1. Check for SHA-256 duplicate
  const duplicate = await checkArchiveExistsBySha256(ownerId, meta.content_sha256);
  if (duplicate) {
    const err = Object.assign(
      new Error(
        `Duplicate Manifest Conflict: This file has already been imported (Manifest ID: "${duplicate.manifest_id}", Category: "${duplicate.category}", Imported: ${duplicate.imported_at}). SHA-256: ${meta.content_sha256}`
      ),
      { code: "DUPLICATE_ARCHIVE", existingId: duplicate.id }
    );
    throw err;
  }

  // 2. Upload JSON to Dedicated OLD Storage Bucket
  const storagePath = getArchivedManifestStoragePath(meta.category, meta.manifest_id);
  const backend = getOldStorageBackend();
  const serialized = Buffer.from(JSON.stringify(envelope, null, 2), "utf8");

  await backend.putBytes(storagePath, serialized, {
    contentType: "application/json",
  });

  // 3. Persist record in database registry
  let recordId = `old_${meta.content_sha256.slice(0, 24)}`;
  try {
    const created = await prisma.archivedManifest.create({
      data: {
        owner_id: ownerId,
        manifest_id: meta.manifest_id,
        category: meta.category,
        source_format: meta.source_format,
        storage_path: storagePath,
        bucket_id: OLD_STORAGE_BUCKET,
        original_filename: meta.provenance?.original_filename || "manifest.json",
        mime_type: "application/json",
        status: "COMMITTED",
        byte_count: BigInt(meta.byte_count),
        record_count: meta.record_count,
        content_sha256: meta.content_sha256,
        source_created_at: meta.source_created_at ? new Date(meta.source_created_at) : null,
        source_exported_at: meta.source_exported_at ? new Date(meta.source_exported_at) : null,
        imported_at: new Date(meta.imported_at),
        provenance_metadata: (meta.provenance ?? {}) as unknown as Prisma.InputJsonValue,
        filter_summary: (meta.filter_summary ?? {}) as unknown as Prisma.InputJsonValue,
      },
    });
    recordId = created.id;
  } catch {
    // If database table is not yet migrated locally, record remains available through storage
  }

  return {
    id: recordId,
    owner_id: ownerId,
    manifest_id: meta.manifest_id,
    category: meta.category,
    source_format: meta.source_format,
    storage_path: storagePath,
    bucket_id: OLD_STORAGE_BUCKET,
    original_filename: meta.provenance?.original_filename || "manifest.json",
    mime_type: "application/json",
    status: "COMMITTED",
    byte_count: meta.byte_count,
    record_count: meta.record_count,
    content_sha256: meta.content_sha256,
    source_created_at: meta.source_created_at,
    source_exported_at: meta.source_exported_at,
    imported_at: meta.imported_at,
    provenance_metadata: (meta.provenance ?? {}) as unknown as Prisma.JsonValue,
    filter_summary: (meta.filter_summary ?? {}) as unknown as Prisma.JsonValue,
  };
}

/**
 * Lists archived manifests for an owner with optional category filtering.
 */
export async function listArchivedManifests(
  ownerId: string,
  storageOwnerUuid: string,
  category?: OldArchiveCategory
): Promise<ArchivedManifestRecord[]> {
  try {
    const categoryCondition = category
      ? category === "saved-titles-links" || category === "saved-titles"
        ? { in: ["saved-titles-links", "saved-titles"] }
        : category === "saved-search-history" || category === "search-history"
        ? { in: ["saved-search-history", "search-history"] }
        : { equals: category }
      : undefined;

    const records = await prisma.archivedManifest.findMany({
      where: {
        owner_id: ownerId,
        ...(categoryCondition ? { category: categoryCondition } : {}),
      },
      orderBy: {
        imported_at: "desc",
      },
    });

    if (records.length > 0) {
      return records.map((r) => ({
        id: r.id,
        owner_id: r.owner_id,
        manifest_id: r.manifest_id,
        category: r.category as OldArchiveCategory,
        source_format: r.source_format,
        storage_path: r.storage_path,
        bucket_id: r.bucket_id,
        original_filename: r.original_filename,
        mime_type: r.mime_type,
        status: r.status,
        byte_count: Number(r.byte_count),
        record_count: r.record_count,
        content_sha256: r.content_sha256,
        source_created_at: r.source_created_at ? r.source_created_at.toISOString() : null,
        source_exported_at: r.source_exported_at ? r.source_exported_at.toISOString() : null,
        imported_at: r.imported_at.toISOString(),
        provenance_metadata: r.provenance_metadata,
        filter_summary: r.filter_summary,
      }));
    }
  } catch {
    // Fall back to scanning Storage objects
  }

  // Storage fallback scanner
  const backend = getOldStorageBackend();
  const prefixes = [
    category ? `asdy/old/${category}/` : `asdy/old/`,
    category ? `ASDY/OLD/${storageOwnerUuid}/${category}/` : `ASDY/OLD/${storageOwnerUuid}/`,
  ];

  try {
    const manifests: ArchivedManifestRecord[] = [];

    for (const prefix of prefixes) {
      const listResult = await backend.list(prefix);
      for (const obj of listResult) {
        if (!obj.pathname.endsWith("/manifest.json")) continue;
        try {
          const bytes = await backend.getBytes(obj.pathname);
          const parsed = JSON.parse(bytes.toString("utf8")) as ArchivedManifestEnvelope;
          if (parsed.schema_version === "1.0.0" && parsed.manifest_metadata) {
            const m = parsed.manifest_metadata;
            manifests.push({
              id: `storage_${m.content_sha256.slice(0, 16)}`,
              owner_id: ownerId,
              manifest_id: m.manifest_id,
              category: m.category,
              source_format: m.source_format,
              storage_path: obj.pathname,
              bucket_id: OLD_STORAGE_BUCKET,
              byte_count: m.byte_count || obj.size,
              record_count: m.record_count,
              content_sha256: m.content_sha256,
              source_created_at: m.source_created_at,
              source_exported_at: m.source_exported_at,
              imported_at: m.imported_at,
              provenance_metadata: (m.provenance ?? {}) as unknown as Prisma.JsonValue,
              filter_summary: (m.filter_summary ?? {}) as unknown as Prisma.JsonValue,
            });
          }
        } catch {
          // Skip unreadable files
        }
      }
    }

    manifests.sort((a, b) => new Date(b.imported_at).getTime() - new Date(a.imported_at).getTime());
    return manifests;
  } catch {
    return [];
  }
}

/**
 * Retrieves a full archived manifest envelope along with its record.
 */
export async function getArchivedManifestById(
  ownerId: string,
  storageOwnerUuid: string,
  archiveId: string
): Promise<{ record: ArchivedManifestRecord; envelope: ArchivedManifestEnvelope }> {
  let record: ArchivedManifestRecord | null = null;

  try {
    const found = await prisma.archivedManifest.findFirst({
      where: {
        owner_id: ownerId,
        OR: [{ id: archiveId }, { manifest_id: archiveId }],
      },
    });

    if (found) {
      record = {
        id: found.id,
        owner_id: found.owner_id,
        manifest_id: found.manifest_id,
        category: found.category as OldArchiveCategory,
        source_format: found.source_format,
        storage_path: found.storage_path,
        bucket_id: found.bucket_id,
        original_filename: found.original_filename,
        mime_type: found.mime_type,
        status: found.status,
        byte_count: Number(found.byte_count),
        record_count: found.record_count,
        content_sha256: found.content_sha256,
        source_created_at: found.source_created_at ? found.source_created_at.toISOString() : null,
        source_exported_at: found.source_exported_at ? found.source_exported_at.toISOString() : null,
        imported_at: found.imported_at.toISOString(),
        provenance_metadata: found.provenance_metadata,
        filter_summary: found.filter_summary,
      };
    }
  } catch {
    // Fall back to storage lookup
  }

  const backend = getStorageBackendForBucket(record?.bucket_id || OLD_STORAGE_BUCKET);

  if (record) {
    const bytes = await backend.getBytes(record.storage_path);
    const envelope = JSON.parse(bytes.toString("utf8")) as ArchivedManifestEnvelope;
    return { record, envelope };
  }

  // Storage search fallback
  const all = await listArchivedManifests(ownerId, storageOwnerUuid);
  const matched = all.find((r) => r.id === archiveId || r.manifest_id === archiveId);

  if (!matched) {
    throw new Error(`Archived manifest not found for ID: "${archiveId}".`);
  }

  const fallbackBackend = getStorageBackendForBucket(matched.bucket_id || OLD_STORAGE_BUCKET);
  const bytes = await fallbackBackend.getBytes(matched.storage_path);
  const envelope = JSON.parse(bytes.toString("utf8")) as ArchivedManifestEnvelope;
  return { record: matched, envelope };
}
