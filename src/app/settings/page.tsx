"use client";

import { Settings } from "lucide-react";
import { AppShell } from "@/components/layout/app-shell";
import { WorkspacePage } from "@/components/pages/workspace-page";
import { Card, CardHeader } from "@/components/ui/card";
import { useYouTubeWorkspaceStore } from "@/lib/state/youtube-workspace-store";

export default function SettingsPage() {
  const watchSettings = useYouTubeWorkspaceStore((s) => s.watchSettings);
  const updateWatchSettings = useYouTubeWorkspaceStore((s) => s.updateWatchSettings);

  return <AppShell><WorkspacePage icon={Settings} eyebrow="Settings" title="API Status, Quota, and Environment" description="Controls YouTube watch and discovery behavior.">
    <Card><CardHeader title="Watch Experience Settings" eyebrow="Controls /watch playback behavior" />
      <div className="grid gap-3 p-4 md:grid-cols-2">
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={watchSettings.defaultAutoplay} onChange={(e)=>updateWatchSettings({defaultAutoplay:e.target.checked})} />Default autoplay</label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={watchSettings.autoplayNext} onChange={(e)=>updateWatchSettings({autoplayNext:e.target.checked})} />Autoplay next video</label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={watchSettings.showPlayerControls} onChange={(e)=>updateWatchSettings({showPlayerControls:e.target.checked})} />Show player controls</label>
      </div>
    </Card>
  </WorkspacePage></AppShell>;
}
