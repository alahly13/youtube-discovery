"use client";

import { useEffect, useMemo, useRef } from "react";
import { DEFAULT_WATCH_SETTINGS, WATCH_SETTINGS_STORAGE_KEY, type WatchExperienceSettings } from "@/lib/watch-settings";

interface YtPlayer { destroy?: () => void; }
interface YtPlayerCtor { new (element: HTMLElement, config: { videoId: string; playerVars: Record<string, number> }): YtPlayer; }
interface YtNamespace { Player?: YtPlayerCtor; }
declare global { interface Window { YT?: YtNamespace; onYouTubeIframeAPIReady?: () => void; } }

export function WatchPlayer({ videoId }: { videoId: string }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const playerRef = useRef<YtPlayer | null>(null);
  const settings = useMemo<WatchExperienceSettings>(() => {
    try { return { ...DEFAULT_WATCH_SETTINGS, ...(JSON.parse(localStorage.getItem(WATCH_SETTINGS_STORAGE_KEY) ?? "{}") as Partial<WatchExperienceSettings>) }; } catch { return DEFAULT_WATCH_SETTINGS; }
  }, []);

  useEffect(() => {
    const init = () => {
      if (!window.YT?.Player || !containerRef.current) return;
      playerRef.current = new window.YT.Player(containerRef.current, {
        videoId,
        playerVars: { autoplay: settings.defaultAutoplay ? 1 : 0, controls: settings.showPlayerControls ? 1 : 0, rel: 0, modestbranding: 1 },
      });
    };
    if (window.YT?.Player) init(); else {
      const script = document.createElement("script"); script.src = "https://www.youtube.com/iframe_api"; document.body.appendChild(script);
      window.onYouTubeIframeAPIReady = init;
    }
    return () => playerRef.current?.destroy?.();
  }, [videoId, settings.defaultAutoplay, settings.showPlayerControls]);

  return <div className="aspect-video w-full overflow-hidden rounded-xl border border-border bg-black" ref={containerRef} />;
}
