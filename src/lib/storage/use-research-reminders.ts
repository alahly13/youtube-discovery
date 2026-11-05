"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import {
  getAllResearchReminders,
  addResearchReminder,
  removeResearchReminder,
  updateResearchReminder,
  clearAllResearchReminders,
  exportResearchRemindersManifest,
  isResearchReminderSaved,
  REMINDERS_CHANGE_EVENT,
  type ResearchReminderItem,
  type ResearchReminderStatus,
  type ResearchRemindersManifest,
} from "./research-reminders-store";
import type { NormalizedYouTubeDiscoveryItem } from "@/types/youtube";
import { syncCoordinator } from "@/lib/sync/sync-coordinator";

export function useResearchReminders(ownerId = "") {
  const [reminders, setReminders] = useState<ResearchReminderItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [activeOwnerId, setActiveOwnerId] = useState(
    () => ownerId || syncCoordinator.getOwnerId()
  );

  // Synchronize the canonical owner from the coordinator first, then from
  // `/api/auth/status`. The auth user id is only a legacy fallback; research
  // reminders are client-only but must still live in the same partition as the
  // rest of the user's local data.
  useEffect(() => {
    let active = true;
    if (ownerId) {
      setActiveOwnerId(ownerId);
      return () => {
        active = false;
      };
    }

    const coordinatorOwner = syncCoordinator.getOwnerId();
    if (coordinatorOwner) {
      setActiveOwnerId(coordinatorOwner);
      return () => {
        active = false;
      };
    }

    fetch("/api/auth/status")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        const resolved = String(data?.storageOwnerUuid || data?.userId || "").trim();
        if (active && resolved && resolved !== "asdy-admin") {
          setActiveOwnerId(resolved);
        }
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [ownerId]);

  const loadReminders = useCallback(async () => {
    if (!activeOwnerId) {
      setReminders([]);
      setIsLoading(false);
      return;
    }
    try {
      const data = await getAllResearchReminders(activeOwnerId);
      setReminders(data);
    } catch (err) {
      console.warn("[useResearchReminders] Failed to load reminders:", err);
    } finally {
      setIsLoading(false);
    }
  }, [activeOwnerId]);

  useEffect(() => {
    loadReminders();

    function handleEvent(e: Event) {
      const detail = (e as CustomEvent).detail;
      if (!detail || !detail.ownerId || detail.ownerId === activeOwnerId) {
        loadReminders();
      }
    }

    if (typeof window !== "undefined") {
      window.addEventListener(REMINDERS_CHANGE_EVENT, handleEvent);
      return () => {
        window.removeEventListener(REMINDERS_CHANGE_EVENT, handleEvent);
      };
    }
  }, [activeOwnerId, loadReminders]);

  const savedVideoIds = useMemo(() => {
    const set = new Set<string>();
    for (const r of reminders) {
      set.add(r.videoId);
    }
    return set;
  }, [reminders]);

  const isSaved = useCallback(
    (videoId: string) => savedVideoIds.has(videoId),
    [savedVideoIds]
  );

  const toggleReminder = useCallback(
    async (item: NormalizedYouTubeDiscoveryItem, sourceQuery = "") => {
      const videoId = item.platformItemId;
      if (savedVideoIds.has(videoId)) {
        await removeResearchReminder(activeOwnerId, videoId);
        return false;
      } else {
        await addResearchReminder(activeOwnerId, {
          videoId,
          title: item.title,
          channelId: item.channelId ?? undefined,
          channelTitle: item.channelTitle ?? undefined,
          description: item.description ?? undefined,
          thumbnailUrl: item.thumbnailUrl ?? undefined,
          originalUrl: item.url,
          sourceQuery,
          rawMetadata: {
            durationSeconds: item.durationSeconds ?? undefined,
            viewsCount: item.viewsCount ?? undefined,
            publishedAt: item.publishedAt ?? undefined,
            itemType: item.itemType,
          },
        });
        return true;
      }
    },
    [activeOwnerId, savedVideoIds]
  );

  const setStatus = useCallback(
    async (reminderId: string, status: ResearchReminderStatus, notes?: string) => {
      await updateResearchReminder(activeOwnerId, reminderId, { status, notes });
    },
    [activeOwnerId]
  );

  const removeReminder = useCallback(
    async (videoIdOrReminderId: string) => {
      await removeResearchReminder(activeOwnerId, videoIdOrReminderId);
    },
    [activeOwnerId]
  );

  const clearAll = useCallback(async () => {
    await clearAllResearchReminders(activeOwnerId);
  }, [activeOwnerId]);

  const exportManifest = useCallback(async (): Promise<{
    manifest: ResearchRemindersManifest;
    jsonString: string;
  }> => {
    return exportResearchRemindersManifest(activeOwnerId);
  }, [activeOwnerId]);

  return {
    reminders,
    isLoading,
    ownerId: activeOwnerId,
    isSaved,
    toggleReminder,
    removeReminder,
    setStatus,
    clearAll,
    exportManifest,
    refresh: loadReminders,
  };
}
