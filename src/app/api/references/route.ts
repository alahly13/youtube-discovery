import "server-only";

import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/require-auth";
import {
  resolveLegacyOwnerIds,
  resolveProfileId,
  resolveStorageOwnerId,
} from "@/lib/auth/storage-owner";
import { prisma } from "@/lib/db/prisma";
import { getR2WorkerStorageClient } from "@/lib/storage/r2-worker-storage-client";
import {
  buildDatasetPrefix,
  buildHistoricalDatasetPrefix,
  buildVersionPointerKey,
} from "@/lib/storage/canonical-paths";

export const dynamic = "force-dynamic";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * Authoritative Cloud References & Saved Searches Endpoint (`GET /api/references`)
 * ───────────────────────────────────────────────────────────────────────────
 * Scope:
 *   Reads committed `REFERENCES` records across BOTH:
 *     1. Cloudflare R2 (`asdy/persistence/<storageOwnerUuid>/references/...`
 *        via NEW Worker `version.json` -> `manifest.json` -> immutable parts +
 *        read-only `before-app-updating/` historical generations).
 *     2. Supabase PostgreSQL (`saved_references` and `saved_search_presets`).
 *
 * Sub-dataset Separation:
 *   - `?kind=titles_links` -> strictly returns `SAVED_TITLE` and `SAVED_LINK`
 *   - `?kind=searches`     -> strictly returns `SAVED_SEARCH`
 *   - `?kind=all` (default) -> returns both partitioned lists plus combined `items`
 *
 * Ensures that after verified cloud upload & local browser cleanup, both the
 * Saved Titles & Links section AND the Saved Searches section on `/saved-titles-links`
 * display authoritative `R2 Cloud` (`CLOUD_ONLY`) items with zero cross-contamination.
 * ═══════════════════════════════════════════════════════════════════════════
 */

export interface CloudReferenceEntry {
  id: string;
  recordId: string;
  resourceType: "SAVED_TITLE" | "SAVED_LINK" | "SAVED_SEARCH";
  savedKind: "SAVED_TITLE" | "SAVED_LINK" | "SAVED_SEARCH";
  title: string;
  url?: string;
  notes?: string;
  query?: string;
  resourceSelection?: unknown;
  settings?: Record<string, unknown>;
  filters?: Record<string, unknown>;
  isPinned?: boolean;
  tags?: string[];
  savedAt: string;
  createdAt: string;
  updatedAt?: string;
  generationId?: string;
  partKey?: string;
  r2ManifestKey?: string;
  _storageState: "CLOUD_ONLY";
  _sourceLocation: "CLOUD";
  _localStatus: "COMMITTED";
  _syncStatus: "COMMITTED";
}

function classifyReferenceKind(
  raw: Record<string, unknown>
): "SAVED_TITLE" | "SAVED_LINK" | "SAVED_SEARCH" {
  const explicit = String(raw.resourceType || raw.savedKind || "").trim().toUpperCase();
  if (explicit === "SAVED_SEARCH") return "SAVED_SEARCH";
  if (explicit === "SAVED_LINK") return "SAVED_LINK";
  if (explicit === "SAVED_TITLE") return "SAVED_TITLE";
  if (typeof raw.query === "string" || typeof raw.query_text === "string" || raw.settings) {
    return "SAVED_SEARCH";
  }
  if (typeof raw.url === "string" && raw.url.trim().length > 0) {
    return "SAVED_LINK";
  }
  return "SAVED_TITLE";
}

async function readR2Json(
  r2Client: ReturnType<typeof getR2WorkerStorageClient>,
  key: string,
  storageOwnerUuid: string
): Promise<Record<string, unknown> | null> {
  try {
    const obj = await r2Client.getObject("NEW", key, { storageOwnerUuid });
    return JSON.parse(obj.data.toString("utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function mapRawReference(
  raw: Record<string, unknown>,
  provenance: { generationId?: string; partKey?: string; r2ManifestKey?: string }
): CloudReferenceEntry | null {
  const id = String(raw.recordId || raw.id || "").trim();
  if (!id) return null;
  const kind = classifyReferenceKind(raw);
  const createdAt = String(raw.createdAt || raw.savedAt || new Date().toISOString());
  const savedAt = String(raw.savedAt || raw.createdAt || createdAt);
  const tags = Array.isArray(raw.tags)
    ? raw.tags.filter((item): item is string => typeof item === "string")
    : undefined;

  return {
    id,
    recordId: id,
    resourceType: kind,
    savedKind: kind,
    title: String(raw.title || raw.name || raw.query || raw.query_text || "Untitled"),
    url: typeof raw.url === "string" ? raw.url : undefined,
    notes: typeof raw.notes === "string" ? raw.notes : undefined,
    query:
      typeof raw.query === "string"
        ? raw.query
        : typeof raw.query_text === "string"
          ? raw.query_text
          : undefined,
    resourceSelection: raw.resourceSelection,
    settings:
      raw.settings && typeof raw.settings === "object"
        ? (raw.settings as Record<string, unknown>)
        : undefined,
    filters:
      raw.filters && typeof raw.filters === "object"
        ? (raw.filters as Record<string, unknown>)
        : undefined,
    isPinned: raw.isPinned === true ? true : undefined,
    tags,
    savedAt,
    createdAt,
    updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : undefined,
    generationId: provenance.generationId,
    partKey: provenance.partKey,
    r2ManifestKey: provenance.r2ManifestKey,
    _storageState: "CLOUD_ONLY",
    _sourceLocation: "CLOUD",
    _localStatus: "COMMITTED",
    _syncStatus: "COMMITTED",
  };
}

export async function GET(request: Request) {
  const auth = await requireAdmin(request);
  if (!auth.ok) return auth.response;

  const storageOwnerUuid = resolveStorageOwnerId(auth.admin);
  if (!storageOwnerUuid) {
    return NextResponse.json(
      { ok: false, error: "Unable to resolve a canonical storage owner for this session." },
      { status: 500 }
    );
  }

  const { searchParams } = new URL(request.url);
  const kindParam = (searchParams.get("kind") || "all").toLowerCase();
  const profileId = resolveProfileId(auth.admin);
  const allowedOwners = resolveLegacyOwnerIds(auth.admin);
  const byId = new Map<string, CloudReferenceEntry>();

  let r2Error: string | null = null;
  let activeGenerationId: string | null = null;
  let activeManifestKey: string | null = null;

  try {
    const r2Client = getR2WorkerStorageClient();
    const ownerCandidates = Array.from(new Set([storageOwnerUuid, ...allowedOwners]));

    for (const ownerCandidate of ownerCandidates) {
      const pointerKey = buildVersionPointerKey(ownerCandidate, "REFERENCES");
      const pointer = await readR2Json(r2Client, pointerKey, storageOwnerUuid);
      const manifestKey =
        (typeof pointer?.manifestKey === "string" && pointer.manifestKey) ||
        (typeof pointer?.manifestPath === "string" && pointer.manifestPath) ||
        null;

      if (!manifestKey) continue;
      activeManifestKey = manifestKey;
      activeGenerationId =
        typeof pointer?.generationId === "string" ? pointer.generationId : null;

      const manifest = await readR2Json(r2Client, manifestKey, storageOwnerUuid);
      const parts = Array.isArray(manifest?.parts)
        ? (manifest.parts as Array<{ storagePath?: string }>)
        : [];

      for (const part of parts) {
        if (!part?.storagePath) continue;
        const partPayload = await readR2Json(r2Client, part.storagePath, storageOwnerUuid);
        const records = Array.isArray(partPayload?.records)
          ? (partPayload.records as Record<string, unknown>[])
          : Array.isArray(partPayload?.items)
            ? (partPayload.items as Record<string, unknown>[])
            : [];

        for (const raw of records) {
          const mapped = mapRawReference(raw, {
            generationId: activeGenerationId ?? undefined,
            partKey: part.storagePath,
            r2ManifestKey: manifestKey,
          });
          if (mapped && !byId.has(mapped.id)) {
            byId.set(mapped.id, mapped);
          }
        }
      }

      // Historical `before-app-updating/` read-only scan
      try {
        const histPrefix = buildHistoricalDatasetPrefix(ownerCandidate, "REFERENCES");
        const listed = await r2Client.listObjects("NEW", histPrefix, {
          storageOwnerUuid,
          limit: 50,
        });
        for (const obj of listed.objects) {
          if (!obj.key.endsWith("manifest.json")) continue;
          const hManifest = await readR2Json(r2Client, obj.key, storageOwnerUuid);
          const hParts = Array.isArray(hManifest?.parts)
            ? (hManifest.parts as Array<{ storagePath?: string }>)
            : [];
          for (const hPart of hParts) {
            if (!hPart?.storagePath) continue;
            const partPayload = await readR2Json(r2Client, hPart.storagePath, storageOwnerUuid);
            const records = Array.isArray(partPayload?.records)
              ? (partPayload.records as Record<string, unknown>[])
              : Array.isArray(partPayload?.items)
                ? (partPayload.items as Record<string, unknown>[])
                : [];
            for (const raw of records) {
              const mapped = mapRawReference(raw, {
                generationId:
                  typeof hManifest?.generationId === "string"
                    ? hManifest.generationId
                    : "historical",
                partKey: hPart.storagePath,
                r2ManifestKey: obj.key,
              });
              if (mapped && !byId.has(mapped.id)) {
                byId.set(mapped.id, mapped);
              }
            }
          }
        }
      } catch {
        // No historical prefix present yet
      }

      if (byId.size > 0) break;
    }
  } catch (err) {
    r2Error = err instanceof Error ? err.message : "Failed to query R2 references snapshot.";
  }

  // Merge authoritative PostgreSQL tables (`saved_references` + `saved_search_presets`)
  try {
    const profile = await prisma.userProfile.findFirst({
      where: {
        OR: [
          { storage_owner_uuid: storageOwnerUuid },
          ...(profileId ? [{ id: profileId }] : []),
          ...(auth.admin.userId ? [{ auth_user_id: auth.admin.userId }] : []),
        ],
      },
      select: { id: true },
    });

    if (profile) {
      const [dbRefs, dbSearches] = await Promise.all([
        prisma.savedReference.findMany({
          where: { owner_id: profile.id },
          orderBy: { saved_at: "desc" },
          take: 500,
        }),
        prisma.savedSearchPreset.findMany({
          where: { owner_id: profile.id },
          orderBy: [{ is_pinned: "desc" }, { created_at: "desc" }],
          take: 500,
        }),
      ]);

      for (const ref of dbRefs) {
        const canonicalId = ref.record_id || ref.id;
        const kind: "SAVED_TITLE" | "SAVED_LINK" =
          ref.resource_type === "SAVED_LINK" || Boolean(ref.url) ? "SAVED_LINK" : "SAVED_TITLE";
        const existing = byId.get(canonicalId);

        byId.set(canonicalId, {
          id: canonicalId,
          recordId: canonicalId,
          resourceType: kind,
          savedKind: kind,
          title: ref.title,
          url: ref.url ?? existing?.url,
          notes: ref.notes ?? existing?.notes,
          tags: ref.tags?.length ? ref.tags : existing?.tags,
          isPinned: ref.is_pinned || existing?.isPinned || undefined,
          savedAt: ref.saved_at.toISOString(),
          createdAt: ref.created_at.toISOString(),
          updatedAt: ref.updated_at.toISOString(),
          generationId: ref.generation_id || existing?.generationId,
          partKey: existing?.partKey,
          r2ManifestKey: ref.r2_manifest_key || existing?.r2ManifestKey,
          _storageState: "CLOUD_ONLY",
          _sourceLocation: "CLOUD",
          _localStatus: "COMMITTED",
          _syncStatus: "COMMITTED",
        });
      }

      for (const preset of dbSearches) {
        const canonicalId = preset.record_id || preset.id;
        const existing = byId.get(canonicalId);

        byId.set(canonicalId, {
          id: canonicalId,
          recordId: canonicalId,
          resourceType: "SAVED_SEARCH",
          savedKind: "SAVED_SEARCH",
          title: preset.title,
          query: preset.query_text,
          notes: preset.notes ?? existing?.notes,
          resourceSelection: preset.resource_selection ?? existing?.resourceSelection ?? "ALL",
          settings:
            (preset.search_settings as unknown as Record<string, unknown>) ||
            existing?.settings ||
            {},
          filters:
            (preset.filter_snapshot as unknown as Record<string, unknown> | undefined) ||
            existing?.filters,
          isPinned: preset.is_pinned || existing?.isPinned || false,
          tags: preset.tags?.length ? preset.tags : existing?.tags,
          savedAt: preset.saved_at.toISOString(),
          createdAt: preset.created_at.toISOString(),
          updatedAt: preset.updated_at.toISOString(),
          generationId: preset.generation_id || existing?.generationId,
          partKey: existing?.partKey,
          r2ManifestKey: preset.r2_manifest_key || existing?.r2ManifestKey,
          _storageState: "CLOUD_ONLY",
          _sourceLocation: "CLOUD",
          _localStatus: "COMMITTED",
          _syncStatus: "COMMITTED",
        });
      }
    }
  } catch (dbErr) {
    console.warn("[GET /api/references] PostgreSQL read fallback warning:", dbErr);
  }

  const allEntries = Array.from(byId.values());
  const titlesAndLinks = allEntries
    .filter((entry) => entry.resourceType === "SAVED_TITLE" || entry.resourceType === "SAVED_LINK")
    .sort((a, b) => new Date(b.savedAt).getTime() - new Date(a.savedAt).getTime());

  const savedSearches = allEntries
    .filter((entry) => entry.resourceType === "SAVED_SEARCH")
    .sort((a, b) => {
      if (a.isPinned && !b.isPinned) return -1;
      if (!a.isPinned && b.isPinned) return 1;
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });

  const filteredItems =
    kindParam === "titles_links"
      ? titlesAndLinks
      : kindParam === "searches"
        ? savedSearches
        : allEntries;

  return NextResponse.json({
    ok: true,
    datasetType: "REFERENCES",
    datasetPrefix: buildDatasetPrefix(storageOwnerUuid, "REFERENCES"),
    activeGenerationId,
    activeManifestKey,
    totalCount: filteredItems.length,
    r2Warning: r2Error,
    titlesAndLinks,
    savedSearches,
    items: filteredItems,
  });
}
