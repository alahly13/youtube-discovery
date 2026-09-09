"use client";

import { useEffect, useRef, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { useYouTubeWorkspaceStore } from "@/lib/state/youtube-workspace-store";

declare global { interface Window { YT?: { Player?: new (element: HTMLElement, config: unknown) => { destroy?: () => void } }; onYouTubeIframeAPIReady?: () => void } }

interface PlayerErrorEvent {
  data?: number;
}

export function WatchPlayer({ videoId }: { videoId: string }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const playerRef = useRef<{ destroy?: () => void } | null>(null);
  const watchSettings = useYouTubeWorkspaceStore((s) => s.watchSettings);
  const [errorState, setErrorState] = useState<{
    videoId: string;
    message: string;
  } | null>(null);

  const currentError = errorState?.videoId === videoId ? errorState.message : null;

  useEffect(() => {
    const initializePlayer = () => {
      if (!window.YT?.Player || !containerRef.current) return;
      playerRef.current?.destroy?.();
      playerRef.current = new window.YT.Player(containerRef.current, {
        videoId,
        events: { 
          onReady: () => undefined, 
          onStateChange: () => undefined,
          onError: (e: PlayerErrorEvent) => {
            const errorCode = e?.data;
            if (errorCode === 2) {
              setErrorState({ videoId, message: "Invalid video ID format." });
            } else if (errorCode === 5) {
              setErrorState({ videoId, message: "HTML5 player error." });
            } else if (errorCode === 100) {
              setErrorState({ videoId, message: "Video not found or has been removed." });
            } else if (errorCode === 101 || errorCode === 150) {
              setErrorState({ videoId, message: "Playback restricted by owner." });
            } else {
              setErrorState({ videoId, message: `Unknown player error (${errorCode}).` });
            }
          }
        },
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

  if (currentError) {
    return (
      <div className="flex aspect-video w-full flex-col items-center justify-center rounded-xl border border-border bg-black text-white/80 gap-3">
        <AlertTriangle className="h-10 w-10 text-danger" />
        <p className="font-medium text-lg">Video Unavailable</p>
        <p className="text-sm opacity-80 text-center max-w-sm px-4">{currentError}</p>
      </div>
    );
  }

  return (
    <div className="aspect-video w-full overflow-hidden rounded-xl border border-border bg-black" id={`yt-player-${videoId}`}>
      <div ref={containerRef} />
    </div>
  );
}
