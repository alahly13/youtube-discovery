"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { YouTubeManifest } from "@/types/manifest";
import type { PersistedLastSearch } from "@/types/manifest";
import type { NormalizedYouTubeDiscoveryItem, SavedSearch, SearchHistoryItem, YouTubeResultFilters } from "@/types/youtube";
import {
  saveEntityLocally,
  deleteEntityLocally,
  getLocalEntities,
  getPendingOperations,
} from "@/lib/storage/indexeddb-store";
import { syncCoordinator } from "@/lib/sync/sync-coordinator";
import { undoRedoService, UNDO_REDO_EVENT } from "@/lib/undo-redo/undo-redo-service";
import { classifyResourceRecord } from "@/lib/resources/resource-taxonomy";

export type SuggestionSourcePriority = "manifest" | "same_channel" | "mixed";

export interface WatchExperienceSettings {
  defaultAutoplay: boolean;
  suggestedVideosCount: 10 | 20 | 30;
  suggestionSourcePriority: SuggestionSourcePriority;
  includeSameChannel: boolean;
  includeCrossChannel: boolean;
  preferRecentVideos: boolean;
  preferHighViewVideos: boolean;
  showShortsLikeVideos: boolean;
  showPlayerControls: boolean;
  autoplayNext: boolean;
}

export const DEFAULT_WATCH_SETTINGS: WatchExperienceSettings = {
  defaultAutoplay: false,
  suggestedVideosCount: 10,
  suggestionSourcePriority: "manifest",
  includeSameChannel: true,
  includeCrossChannel: true,
  preferRecentVideos: true,
  preferHighViewVideos: false,
  showShortsLikeVideos: true,
  showPlayerControls: true,
  autoplayNext: false,
};

export interface FetchSettings {
  pageSize: number;
  maxPages: number;
  maxItems: number;
  /** Default safeSearch policy: none (unrestricted/sensitive allowed), moderate, or strict */
  defaultSafeSearch: "none" | "moderate" | "strict";
}

export const DEFAULT_FETCH_SETTINGS: FetchSettings = {
  pageSize: 25,
  maxPages: 3,
  maxItems: 150,
  defaultSafeSearch: "none",
};

interface YouTubeWorkspaceStore {
  currentOwnerId: string;
  currentManifest: YouTubeManifest | null;
  savedManifestIds: string[];
  savedItems: NormalizedYouTubeDiscoveryItem[];
  savedSearches: SavedSearch[];
  searchHistory: SearchHistoryItem[];
  watchSettings: WatchExperienceSettings;
  fetchSettings: FetchSettings;
  isSidebarOpen: boolean;
  lastSearch: PersistedLastSearch | null;
  setCurrentOwnerId: (ownerId: string) => void;
  setCurrentManifest: (manifest: YouTubeManifest | null) => void;
  markManifestSaved: (manifestId: string) => void;
  toggleItemSaved: (item: NormalizedYouTubeDiscoveryItem) => void;
  removeLocalItemAfterCloudCommit: (platformItemId: string) => void;
  removeLocalItemsBatchAfterCloudCommit: (platformItemIds: string[]) => void;
  removeLocalSavedSearchAfterCloudCommit: (id: string) => void;
  removeLocalSavedSearchesBatchAfterCloudCommit: (ids: string[]) => void;
  removeLocalSearchHistoryAfterCloudCommit: (id: string) => void;
  removeLocalSearchHistoryBatchAfterCloudCommit: (ids: string[]) => void;
  saveSearch: (search: Omit<SavedSearch, "id" | "createdAt">) => SavedSearch;
  updateSavedSearch: (id: string, patch: Partial<SavedSearch>) => void;
  deleteSavedSearch: (id: string) => void;
  togglePinSavedSearch: (id: string) => void;
  recordSearchHistory: (item: Omit<SearchHistoryItem, "id" | "timestamp"> & { id?: string }) => SearchHistoryItem;
  deleteSearchHistoryItem: (id: string) => void;
  clearSearchHistory: () => void;
  setLastSearch: (search: PersistedLastSearch) => void;
  updateLastSearchFilters: (filters: YouTubeResultFilters) => void;
  clearLastSearch: () => void;
  updateWatchSettings: (settings: Partial<WatchExperienceSettings>) => void;
  updateFetchSettings: (settings: Partial<FetchSettings>) => void;
  toggleSidebar: () => void;
}

import {
  formatSearchTtlRemaining,
  isSearchExpired,
} from "@/lib/config/search-storage-config";

/**
 * Resolves the local IndexedDB owner partition.
 *
 * The old `"asdy-admin"` value is intentionally treated as unset: it was a
 * shared demo partition, not a real owner. Writes without a resolved owner are
 * skipped so local data can never be stranded in an invisible partition.
 */
function resolveLocalOwnerId(stateOwnerId: string | null | undefined): string | null {
  const candidate =
    stateOwnerId && stateOwnerId !== "asdy-admin"
      ? stateOwnerId
      : syncCoordinator.getOwnerId();
  const clean = candidate?.trim();
  return clean && clean !== "asdy-admin" ? clean : null;
}

/**
 * Validates whether a persisted search session is still fresh against the configurable TTL
 * and contains valid manifest items.
 */
export function isLastSearchValid(lastSearch: PersistedLastSearch | null | undefined): boolean {
  if (!lastSearch || typeof lastSearch.searchedAt !== "number" || !lastSearch.manifest) {
    return false;
  }
  return !isSearchExpired(lastSearch.searchedAt, lastSearch.expiresAt);
}

/**
 * Formats the elapsed time and remaining TTL for a persisted search.
 */
export function formatSearchCacheAge(
  searchedAt: number,
  expiresAt?: number,
): { elapsedText: string; remainingText: string } {
  return formatSearchTtlRemaining(searchedAt, expiresAt);
}



// This client store preserves non-secret workspace context across Search,
// Watch, Channel, and Playlist navigation. It intentionally stores only
// normalized manifest metadata and user display preferences; provider keys,
// database authority, and privileged persistence stay on server routes.
export const useYouTubeWorkspaceStore = create<YouTubeWorkspaceStore>()(
  persist(
    (set) => ({
      currentOwnerId: "",
      currentManifest: null,
      savedManifestIds: [],
      savedItems: [],
      savedSearches: [],
      searchHistory: [],
      watchSettings: DEFAULT_WATCH_SETTINGS,
      fetchSettings: DEFAULT_FETCH_SETTINGS,
      isSidebarOpen: true,
      setCurrentOwnerId: (ownerId) => set({ currentOwnerId: ownerId }),
      setCurrentManifest: (manifest) => set({ currentManifest: manifest }),
      markManifestSaved: (manifestId) =>
        set((state) => ({
          savedManifestIds: state.savedManifestIds.includes(manifestId)
            ? state.savedManifestIds
            : [...state.savedManifestIds, manifestId],
          currentManifest:
            state.currentManifest?.manifestId === manifestId
              ? { ...state.currentManifest, saved: true }
              : state.currentManifest,
        })),
      toggleItemSaved: (item) =>
        set((state) => {
          const owner = resolveLocalOwnerId(state.currentOwnerId);
          const isSaved = state.savedItems.some(
            (i) => i.platformItemId === item.platformItemId && i.itemType === item.itemType
          );
          if (isSaved) {
            if (typeof window !== "undefined" && owner) {
              void (async () => {
                const beforeState =
                  (await undoRedoService.captureBeforeState(
                    owner,
                    "SAVED_ITEMS",
                    item.platformItemId
                  )) ?? (item as unknown as Record<string, unknown>);
                await undoRedoService.executeMutation({
                  ownerId: owner,
                  scope: "SAVED_ITEMS",
                  datasetType: "SAVED_ITEMS",
                  commandType: "REMOVE_SAVED_ITEM",
                  label: `Remove saved item "${item.title.slice(0, 42)}"`,
                  changes: [
                    {
                      datasetType: "SAVED_ITEMS",
                      entityId: item.platformItemId,
                      beforeState,
                      afterState: null,
                    },
                  ],
                });
                await syncCoordinator.refreshSummary();
              })().catch(console.error);
            }
            return {
              savedItems: state.savedItems.filter(
                (i) => !(i.platformItemId === item.platformItemId && i.itemType === item.itemType)
              ),
            };
          }

          const nowIso = new Date().toISOString();
          const itemToSave = {
            ...item,
            savedAt: item.savedAt || item.collectedAt || nowIso,
            rawJson: undefined,
          };

          if (typeof window !== "undefined" && owner) {
            void (async () => {
              const beforeState = await undoRedoService.captureBeforeState(
                owner,
                "SAVED_ITEMS",
                item.platformItemId
              );
              await undoRedoService.executeMutation({
                ownerId: owner,
                scope: "SAVED_ITEMS",
                datasetType: "SAVED_ITEMS",
                commandType: "SAVE_ITEM",
                label: `Save "${item.title.slice(0, 42)}"`,
                changes: [
                  {
                    datasetType: "SAVED_ITEMS",
                    entityId: item.platformItemId,
                    beforeState,
                    afterState: itemToSave as unknown as Record<string, unknown>,
                  },
                ],
              });
              await syncCoordinator.refreshSummary();
            })().catch(console.error);
          }

          return { savedItems: [itemToSave, ...state.savedItems] };
        }),
      removeLocalItemAfterCloudCommit: (platformItemId: string) => {
        const cleanId = platformItemId.replace(/^youtube:/, "");
        set((state) => ({
          savedItems: state.savedItems.filter(
            (item) => (item.platformItemId || item.id?.replace(/^youtube:/, "")) !== cleanId
          ),
        }));
      },
      removeLocalItemsBatchAfterCloudCommit: (platformItemIds: string[]) => {
        const cleanSet = new Set(platformItemIds.map((id) => id.replace(/^youtube:/, "")));
        set((state) => ({
          savedItems: state.savedItems.filter(
            (item) => !cleanSet.has(item.platformItemId || item.id?.replace(/^youtube:/, "") || "")
          ),
        }));
      },
      removeLocalSavedSearchAfterCloudCommit: (id: string) => {
        const cleanId = id.trim();
        set((state) => ({
          savedSearches: state.savedSearches.filter((s) => s.id !== cleanId),
        }));
      },
      removeLocalSavedSearchesBatchAfterCloudCommit: (ids: string[]) => {
        const cleanSet = new Set(ids.map((id) => id.trim()));
        set((state) => ({
          savedSearches: state.savedSearches.filter((s) => !cleanSet.has(s.id)),
        }));
      },
      removeLocalSearchHistoryAfterCloudCommit: (id: string) => {
        const cleanId = id.trim();
        set((state) => ({
          searchHistory: state.searchHistory.filter((h) => h.id !== cleanId),
        }));
      },
      removeLocalSearchHistoryBatchAfterCloudCommit: (ids: string[]) => {
        const cleanSet = new Set(ids.map((id) => id.trim()));
        set((state) => ({
          searchHistory: state.searchHistory.filter((h) => !cleanSet.has(h.id)),
        }));
      },
      saveSearch: (searchData) => {
        const id = `search-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        const newSearch: SavedSearch = {
          ...searchData,
          id,
          createdAt: new Date().toISOString(),
        };
        const recordPayload: Record<string, unknown> = {
          ...(newSearch as unknown as Record<string, unknown>),
          recordId: id,
          resourceType: "SAVED_SEARCH",
          resourceId: id,
        };
        set((state) => {
          const owner = resolveLocalOwnerId(state.currentOwnerId);
          if (typeof window !== "undefined" && owner) {
            void (async () => {
              await undoRedoService.executeMutation({
                ownerId: owner,
                scope: "SAVED_SEARCHES",
                datasetType: "REFERENCES",
                commandType: "CREATE_SAVED_SEARCH",
                label: `Save search "${newSearch.title.slice(0, 40)}"`,
                changes: [
                  {
                    datasetType: "REFERENCES",
                    entityId: id,
                    beforeState: null,
                    afterState: recordPayload,
                  },
                ],
              });
              await syncCoordinator.refreshSummary();
            })().catch(console.error);
          }
          return {
            savedSearches: [newSearch, ...state.savedSearches],
          };
        });
        return newSearch;
      },
      updateSavedSearch: (id, patch) =>
        set((state) => {
          const owner = resolveLocalOwnerId(state.currentOwnerId);
          const prev = state.savedSearches.find((s) => s.id === id) || null;
          const updated = state.savedSearches.map((s) =>
            s.id === id ? { ...s, ...patch, updatedAt: new Date().toISOString() } : s
          );
          const found = updated.find((s) => s.id === id);
          if (found && typeof window !== "undefined" && owner) {
            void (async () => {
              const beforeState =
                (await undoRedoService.captureBeforeState(owner, "REFERENCES", id)) ??
                (prev ? { ...(prev as unknown as Record<string, unknown>), recordId: id, resourceType: "SAVED_SEARCH" } : null);
              const afterState: Record<string, unknown> = {
                ...(found as unknown as Record<string, unknown>),
                recordId: id,
                resourceType: "SAVED_SEARCH",
                resourceId: id,
              };
              await undoRedoService.executeMutation({
                ownerId: owner,
                scope: "SAVED_SEARCHES",
                datasetType: "REFERENCES",
                commandType: "EDIT_SAVED_SEARCH",
                label: `Edit saved search "${found.title.slice(0, 40)}"`,
                coalesceKey: `edit-search:${id}`,
                changes: [
                  {
                    datasetType: "REFERENCES",
                    entityId: id,
                    beforeState,
                    afterState,
                  },
                ],
              });
              await syncCoordinator.refreshSummary();
            })().catch(console.error);
          }
          return { savedSearches: updated };
        }),
      deleteSavedSearch: (id) =>
        set((state) => {
          const owner = resolveLocalOwnerId(state.currentOwnerId);
          const prev = state.savedSearches.find((s) => s.id === id) || null;
          if (typeof window !== "undefined" && owner) {
            void (async () => {
              const beforeState =
                (await undoRedoService.captureBeforeState(owner, "REFERENCES", id)) ??
                (prev ? { ...(prev as unknown as Record<string, unknown>), recordId: id, resourceType: "SAVED_SEARCH" } : null);
              await undoRedoService.executeMutation({
                ownerId: owner,
                scope: "SAVED_SEARCHES",
                datasetType: "REFERENCES",
                commandType: "DELETE_SAVED_SEARCH",
                label: `Delete saved search "${(prev?.title || id).slice(0, 40)}"`,
                changes: [
                  {
                    datasetType: "REFERENCES",
                    entityId: id,
                    beforeState,
                    afterState: null,
                  },
                ],
              });
              await syncCoordinator.refreshSummary();
            })().catch(console.error);
          }
          return {
            savedSearches: state.savedSearches.filter((s) => s.id !== id),
          };
        }),
      togglePinSavedSearch: (id) =>
        set((state) => {
          const owner = resolveLocalOwnerId(state.currentOwnerId);
          const prev = state.savedSearches.find((s) => s.id === id) || null;
          const updated = state.savedSearches.map((s) =>
            s.id === id ? { ...s, isPinned: !s.isPinned, updatedAt: new Date().toISOString() } : s
          );
          const next = updated.find((s) => s.id === id);
          if (next && typeof window !== "undefined" && owner) {
            void (async () => {
              const beforeState =
                (await undoRedoService.captureBeforeState(owner, "REFERENCES", id)) ??
                (prev ? { ...(prev as unknown as Record<string, unknown>), recordId: id, resourceType: "SAVED_SEARCH" } : null);
              const afterState: Record<string, unknown> = {
                ...(next as unknown as Record<string, unknown>),
                recordId: id,
                resourceType: "SAVED_SEARCH",
                resourceId: id,
              };
              await undoRedoService.executeMutation({
                ownerId: owner,
                scope: "SAVED_SEARCHES",
                datasetType: "REFERENCES",
                commandType: "TOGGLE_PIN_SAVED_SEARCH",
                label: `${next.isPinned ? "Pin" : "Unpin"} search "${next.title.slice(0, 40)}"`,
                changes: [
                  {
                    datasetType: "REFERENCES",
                    entityId: id,
                    beforeState,
                    afterState,
                  },
                ],
              });
              await syncCoordinator.refreshSummary();
            })().catch(console.error);
          }
          return { savedSearches: updated };
        }),
      recordSearchHistory: (itemData) => {
        const id = itemData.id || `hist-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        const newItem: SearchHistoryItem = {
          ...itemData,
          id,
          timestamp: new Date().toISOString(),
        };
        set((state) => {
          const owner = resolveLocalOwnerId(state.currentOwnerId);
          if (typeof window !== "undefined" && owner) {
            saveEntityLocally(owner, "SEARCH_HISTORY", id, newItem as unknown as Record<string, unknown>, "APPEND")
              .then(() => syncCoordinator.refreshSummary())
              .catch(console.error);
          }
          return {
            // Store up to 100 most recent searches in history
            searchHistory: [newItem, ...state.searchHistory.filter((h) => h.id !== id)].slice(0, 100),
          };
        });
        return newItem;
      },
      deleteSearchHistoryItem: (id) =>
        set((state) => {
          const owner = resolveLocalOwnerId(state.currentOwnerId);
          if (typeof window !== "undefined" && owner) {
            deleteEntityLocally(owner, "SEARCH_HISTORY", id)
              .then(() => syncCoordinator.refreshSummary())
              .catch(console.error);
          }
          return {
            searchHistory: state.searchHistory.filter((item) => item.id !== id),
          };
        }),
      clearSearchHistory: () =>
        set(() => {
          return {
            searchHistory: [],
          };
        }),
      lastSearch: null,
      setLastSearch: (search) =>
        set({
          lastSearch: search,
        }),
      updateLastSearchFilters: (filters) =>
        set((state) => ({
          lastSearch: state.lastSearch ? { ...state.lastSearch, filters } : null,
        })),
      clearLastSearch: () =>
        set({
          lastSearch: null,
        }),
      updateWatchSettings: (settings) =>
        set((state) => ({
          watchSettings: {
            ...state.watchSettings,
            ...settings,
          },
        })),
      updateFetchSettings: (settings) =>
        set((state) => ({
          fetchSettings: {
            ...state.fetchSettings,
            ...settings,
          },
        })),
      toggleSidebar: () => set((state) => ({ isSidebarOpen: !state.isSidebarOpen })),
    }),
    {
      name: "youtube-discovery-workspace",
      partialize: (state) => ({
        currentOwnerId: state.currentOwnerId,
        currentManifest: state.currentManifest,
        savedManifestIds: state.savedManifestIds,
        savedItems: state.savedItems,
        savedSearches: state.savedSearches,
        searchHistory: state.searchHistory,
        watchSettings: state.watchSettings,
        fetchSettings: state.fetchSettings,
        isSidebarOpen: state.isSidebarOpen,
        lastSearch: state.lastSearch,
      }),
    },
  ),
);

// Automatic client-side owner UUID synchronization on mount.
// The canonical storage owner is authoritative; the auth user id is only a
// compatibility fallback for legacy profiles without a storage owner value.
if (typeof window !== "undefined") {
  const reconcileWorkspaceStoreFromIndexedDb = async () => {
    const owner = resolveLocalOwnerId(useYouTubeWorkspaceStore.getState().currentOwnerId);
    if (!owner) return;
    try {
      const [localSaved, localRefs, pendingOps] = await Promise.all([
        getLocalEntities<NormalizedYouTubeDiscoveryItem>(owner, "SAVED_ITEMS").catch(() => []),
        getLocalEntities<Record<string, unknown>>(owner, "REFERENCES").catch(() => []),
        getPendingOperations(owner).catch(() => []),
      ]);

      const deletedSaved = new Set(
        pendingOps
          .filter((op) => op.datasetType === "SAVED_ITEMS" && op.operationType === "DELETE")
          .map((op) => op.entityId)
      );
      const deletedRefs = new Set(
        pendingOps
          .filter((op) => op.datasetType === "REFERENCES" && op.operationType === "DELETE")
          .map((op) => op.entityId)
      );

      const nextSavedItems = localSaved.filter((i) => !deletedSaved.has(i.platformItemId));
      const nextSavedSearches: SavedSearch[] = [];
      for (const r of localRefs) {
        const cls = classifyResourceRecord(r, { datasetType: "REFERENCES" });
        if (cls.resourceType === "SAVED_SEARCH" && !deletedRefs.has(String(r.id || r.recordId || ""))) {
          nextSavedSearches.push(r as unknown as SavedSearch);
        }
      }

      // If store has saved items that are not yet in IndexedDB, bridge them into IndexedDB and outbox
      const currentStoreItems = useYouTubeWorkspaceStore.getState().savedItems;
      if (currentStoreItems.length > 0 && localSaved.length === 0) {
        for (const item of currentStoreItems) {
          if (!item.platformItemId || deletedSaved.has(item.platformItemId)) continue;
          await saveEntityLocally(
            owner,
            "SAVED_ITEMS",
            item.platformItemId,
            item as unknown as Record<string, unknown>,
            "UPSERT"
          ).catch(() => {});
        }
        await syncCoordinator.refreshSummary().catch(() => {});
      }

      if (nextSavedItems.length > 0 || localRefs.length > 0) {
        useYouTubeWorkspaceStore.setState((prev) => ({
          savedItems: localSaved.length > 0 || deletedSaved.size > 0 ? nextSavedItems : prev.savedItems,
          savedSearches:
            nextSavedSearches.length > 0 || deletedRefs.size > 0
              ? nextSavedSearches
              : prev.savedSearches,
        }));
      }
    } catch {
      // Keep store resilient on hydration race
    }
  };

  fetch("/api/auth/status")
    .then((r) => (r.ok ? r.json() : null))
    .then((data) => {
      const id = String(data?.storageOwnerUuid || data?.userId || "").trim();
      if (id && id !== "asdy-admin") {
        useYouTubeWorkspaceStore.getState().setCurrentOwnerId(id);
        void reconcileWorkspaceStoreFromIndexedDb();
      }
    })
    .catch(() => {});

  window.addEventListener(UNDO_REDO_EVENT, () => void reconcileWorkspaceStoreFromIndexedDb());
  window.addEventListener("yt-discovery-hydration-changed", () => void reconcileWorkspaceStoreFromIndexedDb());
  window.addEventListener("yt-discovery-owner-changed", () => void reconcileWorkspaceStoreFromIndexedDb());
  window.addEventListener("yt-discovery-local-committed", () => void reconcileWorkspaceStoreFromIndexedDb());
}
