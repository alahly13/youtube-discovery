"use client";

import { useState, useEffect, useCallback } from "react";
import {
  cloudHydrationService,
  type HydrationProgress,
} from "./cloud-hydration-service";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * React Hook: useCloudHydration
 * ──────────────────────────────────────────────────────────────────────────
 * Provides real-time reactive hydration progress and a manual retry action.
 * ═══════════════════════════════════════════════════════════════════════════
 */
export function useCloudHydration(ownerId = "asdy-admin", autoStart = true) {
  const [progress, setProgress] = useState<HydrationProgress>(() =>
    cloudHydrationService.getProgress()
  );

  useEffect(() => {
    const unsubscribe = cloudHydrationService.subscribe((p) => {
      setProgress(p);
    });

    if (autoStart && cloudHydrationService.getProgress().state === "NOT_HYDRATED") {
      cloudHydrationService.hydrateAllDatasets(ownerId).catch(() => {});
    }

    return () => {
      unsubscribe();
    };
  }, [ownerId, autoStart]);

  const retryHydration = useCallback(() => {
    return cloudHydrationService.hydrateAllDatasets(ownerId, true);
  }, [ownerId]);

  return {
    ...progress,
    isHydrating:
      progress.state !== "READY" &&
      progress.state !== "FAILED" &&
      progress.state !== "NOT_HYDRATED",
    retryHydration,
  };
}
