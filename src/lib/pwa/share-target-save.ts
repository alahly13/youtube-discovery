/**
 * ═══════════════════════════════════════════════════════════════════════════
 * Web Share Target — Local-First Save Orchestration
 * ──────────────────────────────────────────────────────────────────────────
 * Scope: Validates a reviewed shared link, writes it to the canonical
 *        REFERENCES dataset through the existing local-first outbox, and
 *        attempts an immediate cloud Save All.
 *
 * Why this file exists:
 *   The review page needs one testable decision point that returns explicit
 *   outcomes (auth required, invalid, duplicate, saved/synced, saved/pending,
 *   failed). Dependencies are injectable so automated tests can prove those
 *   outcomes without IndexedDB, a browser, or a live Supabase session.
 *
 * Architecture guarantees:
 *   - Uses `saveEntityLocally` (IndexedDB projection + outbox in one atomic
 *     transaction). No parallel storage system is introduced.
 *   - Uses the deterministic shared-link record id so the same URL cannot
 *     quietly create a second record after a retry or a second device.
 *   - Local save success is never reported as cloud success. If Save All
 *     fails, the record remains pending and the UI can retry.
 * ═══════════════════════════════════════════════════════════════════════════
 */

import {
  SAVED_REFERENCE_LIMITS,
  isValidHttpUrl,
} from "../saved-references/link-identity";
import { buildSharedLinkRecordId } from "./share-target";

export interface SharedLinkDraft {
  url: string;
  title: string;
  notes?: string;
}

export interface SharedLinkDuplicate {
  title?: string;
  recordId?: string;
}

export interface SharedLinkSaveDependencies {
  saveEntityLocally: (
    ownerId: string,
    datasetType: "REFERENCES",
    entityId: string,
    record: Record<string, unknown>
  ) => Promise<unknown>;
  refreshSummary: () => Promise<void>;
  saveAll: () => Promise<{ ok: boolean; syncedCount: number; error?: string }>;
  now?: () => Date;
}

export type SharedLinkSaveResult =
  | { status: "AUTH_REQUIRED"; message: string }
  | { status: "INVALID"; message: string }
  | {
      status: "DUPLICATE";
      message: string;
      duplicateTitle?: string;
      recordId?: string;
    }
  | {
      status: "SAVED";
      message: string;
      recordId: string;
      sync: "SYNCED" | "PENDING";
      syncError?: string;
    }
  | { status: "FAILED"; message: string; localSaved: boolean };

export interface SaveSharedLinkParams {
  draft: SharedLinkDraft;
  ownerId: string | null;
  /**
   * Server-side or local duplicate discovered before the save attempt. The
   * module refuses to write a duplicate even if the caller forgot to disable
   * its submit button.
   */
  duplicate?: SharedLinkDuplicate | null;
  deps: SharedLinkSaveDependencies;
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.trim()
    ? error.message.trim()
    : fallback;
}

/**
 * Saves a reviewed shared link. The deterministic record id is derived from
 * the normalized URL, not from a random UUID or the title.
 */
export async function saveSharedLink(
  params: SaveSharedLinkParams
): Promise<SharedLinkSaveResult> {
  const ownerId = typeof params.ownerId === "string" ? params.ownerId.trim() : "";
  const url = typeof params.draft.url === "string" ? params.draft.url.trim() : "";
  const title =
    typeof params.draft.title === "string" ? params.draft.title.trim() : "";
  const notes =
    typeof params.draft.notes === "string" ? params.draft.notes.trim() : "";

  // Fail closed until the canonical storage owner is known. Writing under an
  // empty/guessed owner would create an invisible local partition.
  if (!ownerId) {
    return {
      status: "AUTH_REQUIRED",
      message: "Sign in to save this shared link to your library.",
    };
  }

  if (!isValidHttpUrl(url)) {
    return {
      status: "INVALID",
      message: "The shared URL is not a valid absolute HTTP or HTTPS link.",
    };
  }

  if (url.length > SAVED_REFERENCE_LIMITS.url) {
    return {
      status: "INVALID",
      message: `The URL must be ${SAVED_REFERENCE_LIMITS.url} characters or fewer.`,
    };
  }

  if (!title) {
    return {
      status: "INVALID",
      message: "A title is required before saving this link.",
    };
  }

  if (title.length > SAVED_REFERENCE_LIMITS.title) {
    return {
      status: "INVALID",
      message: `The title must be ${SAVED_REFERENCE_LIMITS.title} characters or fewer.`,
    };
  }

  if (notes.length > SAVED_REFERENCE_LIMITS.notes) {
    return {
      status: "INVALID",
      message: `Notes must be ${SAVED_REFERENCE_LIMITS.notes} characters or fewer.`,
    };
  }

  if (params.duplicate) {
    const duplicateTitle = params.duplicate.title?.trim();
    return {
      status: "DUPLICATE",
      message: duplicateTitle
        ? `This link is already saved as "${duplicateTitle}".`
        : "This link is already saved in your library.",
      duplicateTitle: duplicateTitle || undefined,
      recordId: params.duplicate.recordId?.trim() || undefined,
    };
  }

  const recordId = buildSharedLinkRecordId(url);
  const now = (params.deps.now ? params.deps.now() : new Date()).toISOString();

  const record: Record<string, unknown> = {
    id: recordId,
    recordId,
    // The database column is VARCHAR(256). A URL can be up to 2048
    // characters, so the stable record id is the safe resource identity.
    resourceId: recordId,
    resourceType: "SAVED_LINK",
    savedKind: "SAVED_LINK",
    title,
    url,
    notes: notes || undefined,
    createdAt: now,
    updatedAt: now,
    savedAt: now,
    source: "PWA_SHARE_TARGET",
  };

  try {
    await params.deps.saveEntityLocally(ownerId, "REFERENCES", recordId, record);
  } catch (error) {
    return {
      status: "FAILED",
      message: errorMessage(
        error,
        "Failed to save the shared link locally. Your browser storage may be full or unavailable."
      ),
      localSaved: false,
    };
  }

  try {
    await params.deps.refreshSummary();
  } catch {
    // The local write is already committed. Summary refresh is non-decisive.
  }

  let syncResult: { ok: boolean; syncedCount: number; error?: string };
  try {
    syncResult = await params.deps.saveAll();
  } catch (error) {
    syncResult = {
      ok: false,
      syncedCount: 0,
      error: errorMessage(error, "Cloud synchronization did not complete."),
    };
  }

  if (syncResult.ok) {
    return {
      status: "SAVED",
      recordId,
      sync: "SYNCED",
      message: "Saved to Saved Titles & Links and synced to the cloud.",
    };
  }

  return {
    status: "SAVED",
    recordId,
    sync: "PENDING",
    message:
      "Saved locally. Cloud synchronization is pending and will retry automatically.",
    syncError: syncResult.error,
  };
}
