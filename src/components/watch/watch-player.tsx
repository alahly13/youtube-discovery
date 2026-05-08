"use client";

import { useEffect, useRef } from "react";
import { useYouTubeWorkspaceStore } from "@/lib/state/youtube-workspace-store";

declare global { interface Window { YT?: { Player?: new (element: HTMLElement, config: unknown) => { destroy?: () => void } }; onYouTubeIframeAPIReady?: () => void } }

export function WatchPlayer({ videoId }: { videoId: string }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const playerRef = useRef<{ destroy?: () => void } | null>(null);
  const watchSettings = useYouTubeWorkspaceStore((s) => s.watchSettings);

  useEffect(() => {
    const initializePlayer = () => {
      if (!window.YT?.Player || !containerRef.current) return;
      playerRef.current?.destroy?.();
      playerRef.current = new window.YT.Player(containerRef.current, {
        videoId,
        events: { onReady: () => undefined, onStateChange: () => undefined },
        playerVars: { autoplay: watchSettings.defaultAutoplay ? 1 : 0, controls: watchSettings.showPlayerControls ? 1 : 0, rel: 0, modestbranding: 1 },
      });
    };

    if (window.YT?.Player) initializePlayer();
    else {
      const script = document.createElement("script");
      script.src = "https://www.youtube.com/iframe_api";
      document.body.appendChild(script);
      window.onYouTubeIframeAPIReady = initializePlayer;
    }

    return () => playerRef.current?.destroy?.();
  }, [videoId, watchSettings.defaultAutoplay, watchSettings.showPlayerControls]);

  return <div className="aspect-video w-full overflow-hidden rounded-xl border border-border bg-black" ref={containerRef} />;
}
