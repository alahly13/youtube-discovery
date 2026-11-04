/**
 * ═══════════════════════════════════════════════════════════════════════════
 * YouTube Discovery 2026 — Local Research Reminders ("I Will Search For")
 * ──────────────────────────────────────────────────────────────────────────
 * Scope: 100% Client-Only Browser-Local Research Reminders Store.
 *
 * CRITICAL ARCHITECTURAL BOUNDARIES (PHASE 10 & 15):
 *   1. Strictly Local-Only: Data NEVER leaves the client browser.
 *   2. ZERO Cloud Calls: No Supabase PostgreSQL, no Supabase Storage,
 *      no Cloudflare Workers, no Cloudflare R2, no Next.js server endpoints.
 *   3. ISOLATED from Outbox: Never queued in pending_operations or synced
 *      via "Save All".
 *   4. Multi-User Partitioned: Partitioned strictly by authenticated Supabase UUID.
 *   5. Duplicate Prevention: Stable IDs and ownerId+videoId indexing.
 *   6. Accumulated Manifest: Materializes an exportable canonical JSON manifest.
 * ═══════════════════════════════════════════════════════════════════════════
 */

import {
  openLocalDatabase,
  createReadWriteTransaction,
  IDB_STORES,
} from "./indexeddb-store";

export type ResearchReminderStatus = "TO_RESEARCH" | "IN_PROGRESS" | "INVESTIGATED";

export interface ResearchReminderItem {
  reminderId: string;
  ownerId: string;
  provider: "youtube";
  videoId: string;
  title: string;
  channelId?: string;
  channelTitle?: string;
  description?: string;
  thumbnailUrl?: string;
  originalUrl: string;
  sourceQuery?: string;
  addedAt: string;
  status: ResearchReminderStatus;
  notes?: string;
  rawMetadata?: Record<string, unknown>;
}

export interface ResearchRemindersManifest {
  manifestType: "LOCAL_RESEARCH_REMINDERS";
  manifestVersion: 1;
  ownerId: string;
  createdAt: string;
  updatedAt: string;
  itemCount: number;
  items: ResearchReminderItem[];
}

export const REMINDERS_CHANGE_EVENT = "yt_research_reminders_changed";

/**
 * Dispatches a lightweight window event for cross-component reactivity.
 */
function notifyRemindersChanged(ownerId: string) {
  if (typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent(REMINDERS_CHANGE_EVENT, { detail: { ownerId, timestamp: Date.now() } })
    );
  }
}

/**
 * Generates a stable deterministic reminder ID for an owner and video.
 */
export function buildReminderId(ownerId: string, videoId: string): string {
  const safeOwner = ownerId.replace(/[^a-zA-Z0-9]/g, "").slice(0, 12);
  const safeVideo = videoId.replace(/[^a-zA-Z0-9_-]/g, "");
  return `rem_yt_${safeVideo}_${safeOwner}`;
}

/**
 * Adds an item to the local "I Will Search For" repository in IndexedDB.
 * Guarantees zero outbox queuing and zero cloud communication.
 */
export async function addResearchReminder(
  ownerId: string,
  params: {
    videoId: string;
    title: string;
    channelId?: string;
    channelTitle?: string;
    description?: string;
    thumbnailUrl?: string;
    originalUrl?: string;
    sourceQuery?: string;
    notes?: string;
    rawMetadata?: Record<string, unknown>;
  }
): Promise<{ ok: boolean; reminder: ResearchReminderItem; alreadyExists?: boolean }> {
  const db = await openLocalDatabase();
  const reminderId = buildReminderId(ownerId, params.videoId);

  const existing = await getResearchReminderByVideoId(ownerId, params.videoId);
  if (existing) {
    return { ok: true, reminder: existing, alreadyExists: true };
  }

  const reminder: ResearchReminderItem = {
    reminderId,
    ownerId,
    provider: "youtube",
    videoId: params.videoId,
    title: params.title || "Untitled YouTube Item",
    channelId: params.channelId,
    channelTitle: params.channelTitle,
    description: params.description,
    thumbnailUrl: params.thumbnailUrl,
    originalUrl: params.originalUrl || `https://www.youtube.com/watch?v=${params.videoId}`,
    sourceQuery: params.sourceQuery || "",
    addedAt: new Date().toISOString(),
    status: "TO_RESEARCH",
    notes: params.notes || "",
    rawMetadata: params.rawMetadata,
  };

  return new Promise((resolve, reject) => {
    const tx = createReadWriteTransaction(db, [IDB_STORES.LOCAL_RESEARCH_REMINDERS]);
    const store = tx.objectStore(IDB_STORES.LOCAL_RESEARCH_REMINDERS);

    store.put(reminder);

    tx.oncomplete = () => {
      notifyRemindersChanged(ownerId);
      resolve({ ok: true, reminder, alreadyExists: false });
    };
    tx.onerror = () => {
      reject(tx.error || new Error("Failed to save local research reminder"));
    };
  });
}

/**
 * Checks if a specific video ID has already been saved as a reminder by the owner.
 */
export async function getResearchReminderByVideoId(
  ownerId: string,
  videoId: string
): Promise<ResearchReminderItem | null> {
  const db = await openLocalDatabase();

  return new Promise((resolve, reject) => {
    const tx = db.transaction([IDB_STORES.LOCAL_RESEARCH_REMINDERS], "readonly");
    const store = tx.objectStore(IDB_STORES.LOCAL_RESEARCH_REMINDERS);

    if (store.indexNames.contains("ownerId_videoId")) {
      const index = store.index("ownerId_videoId");
      const req = index.get([ownerId, videoId]);
      req.onsuccess = () => resolve((req.result as ResearchReminderItem) || null);
      req.onerror = () => reject(req.error);
    } else {
      const reminderId = buildReminderId(ownerId, videoId);
      const req = store.get(reminderId);
      req.onsuccess = () => resolve((req.result as ResearchReminderItem) || null);
      req.onerror = () => reject(req.error);
    }
  });
}

/**
 * Fast boolean check if video is in reminders.
 */
export async function isResearchReminderSaved(ownerId: string, videoId: string): Promise<boolean> {
  const item = await getResearchReminderByVideoId(ownerId, videoId);
  return Boolean(item);
}

/**
 * Removes a reminder from the local IndexedDB store.
 */
export async function removeResearchReminder(ownerId: string, videoIdOrReminderId: string): Promise<boolean> {
  const db = await openLocalDatabase();

  return new Promise((resolve, reject) => {
    const tx = createReadWriteTransaction(db, [IDB_STORES.LOCAL_RESEARCH_REMINDERS]);
    const store = tx.objectStore(IDB_STORES.LOCAL_RESEARCH_REMINDERS);

    // Try deleting by direct ID or compute from videoId
    const targetKey = videoIdOrReminderId.startsWith("rem_yt_")
      ? videoIdOrReminderId
      : buildReminderId(ownerId, videoIdOrReminderId);

    store.delete(targetKey);

    tx.oncomplete = () => {
      notifyRemindersChanged(ownerId);
      resolve(true);
    };
    tx.onerror = () => reject(tx.error || new Error("Failed to remove reminder"));
  });
}

/**
 * Retrieves all research reminders for the specified owner.
 */
export async function getAllResearchReminders(ownerId: string): Promise<ResearchReminderItem[]> {
  const db = await openLocalDatabase();

  return new Promise((resolve, reject) => {
    const tx = db.transaction([IDB_STORES.LOCAL_RESEARCH_REMINDERS], "readonly");
    const store = tx.objectStore(IDB_STORES.LOCAL_RESEARCH_REMINDERS);

    let req: IDBRequest;
    if (store.indexNames.contains("ownerId")) {
      const index = store.index("ownerId");
      req = index.getAll(ownerId);
    } else {
      req = store.getAll();
    }

    req.onsuccess = () => {
      const rows = (req.result as ResearchReminderItem[]) || [];
      const filtered = rows.filter((r) => r.ownerId === ownerId);
      // Sort newest added first
      filtered.sort((a, b) => new Date(b.addedAt).getTime() - new Date(a.addedAt).getTime());
      resolve(filtered);
    };
    req.onerror = () => reject(req.error || new Error("Failed to load reminders"));
  });
}

/**
 * Updates status and optional private notes for a reminder.
 */
export async function updateResearchReminder(
  ownerId: string,
  reminderId: string,
  patch: {
    status?: ResearchReminderStatus;
    notes?: string;
  }
): Promise<void> {
  const db = await openLocalDatabase();

  return new Promise((resolve, reject) => {
    const tx = createReadWriteTransaction(db, [IDB_STORES.LOCAL_RESEARCH_REMINDERS]);
    const store = tx.objectStore(IDB_STORES.LOCAL_RESEARCH_REMINDERS);
    const getReq = store.get(reminderId);

    getReq.onsuccess = () => {
      const existing = getReq.result as ResearchReminderItem | undefined;
      if (!existing || existing.ownerId !== ownerId) {
        resolve();
        return;
      }

      const updated: ResearchReminderItem = {
        ...existing,
        status: patch.status ?? existing.status,
        notes: patch.notes !== undefined ? patch.notes : existing.notes,
      };

      store.put(updated);
    };

    tx.oncomplete = () => {
      notifyRemindersChanged(ownerId);
      resolve();
    };
    tx.onerror = () => reject(tx.error || new Error("Failed to update reminder"));
  });
}

/**
 * Clears all research reminders belonging to the current owner.
 */
export async function clearAllResearchReminders(ownerId: string): Promise<number> {
  const reminders = await getAllResearchReminders(ownerId);
  if (reminders.length === 0) return 0;

  const db = await openLocalDatabase();

  return new Promise((resolve, reject) => {
    const tx = createReadWriteTransaction(db, [IDB_STORES.LOCAL_RESEARCH_REMINDERS]);
    const store = tx.objectStore(IDB_STORES.LOCAL_RESEARCH_REMINDERS);

    for (const r of reminders) {
      store.delete(r.reminderId);
    }

    tx.oncomplete = () => {
      notifyRemindersChanged(ownerId);
      resolve(reminders.length);
    };
    tx.onerror = () => reject(tx.error || new Error("Failed to clear reminders"));
  });
}

/**
 * Exports the accumulated research reminders manifest as a JSON object and string.
 */
export async function exportResearchRemindersManifest(ownerId: string): Promise<{
  manifest: ResearchRemindersManifest;
  jsonString: string;
}> {
  const items = await getAllResearchReminders(ownerId);
  const now = new Date().toISOString();

  const oldest = items.length > 0 ? items[items.length - 1].addedAt : now;
  const newest = items.length > 0 ? items[0].addedAt : now;

  const manifest: ResearchRemindersManifest = {
    manifestType: "LOCAL_RESEARCH_REMINDERS",
    manifestVersion: 1,
    ownerId,
    createdAt: oldest,
    updatedAt: newest,
    itemCount: items.length,
    items,
  };

  return {
    manifest,
    jsonString: JSON.stringify(manifest, null, 2),
  };
}
