"use client";

import { Settings } from "lucide-react";
import { useState } from "react";
import { AppShell } from "@/components/layout/app-shell";
import { WorkspacePage } from "@/components/pages/workspace-page";
import { Card, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { DEFAULT_WATCH_SETTINGS, WATCH_SETTINGS_STORAGE_KEY, type WatchExperienceSettings } from "@/lib/watch-settings";

export default function SettingsPage() {
  const [watchSettings, setWatchSettings] = useState<WatchExperienceSettings>(() => {
    try {
      return { ...DEFAULT_WATCH_SETTINGS, ...(JSON.parse(localStorage.getItem(WATCH_SETTINGS_STORAGE_KEY) ?? "{}") as Partial<WatchExperienceSettings>) };
    } catch {
      return DEFAULT_WATCH_SETTINGS;
    }
  });

  function update<K extends keyof WatchExperienceSettings>(key: K, value: WatchExperienceSettings[K]) {
    const next = { ...watchSettings, [key]: value }; setWatchSettings(next); localStorage.setItem(WATCH_SETTINGS_STORAGE_KEY, JSON.stringify(next));
  }

  return <AppShell><WorkspacePage icon={Settings} eyebrow="Settings" title="API Status, Quota, and Environment" description="Environment setup is documented through .env.example, README, and guarded validation scripts without printing secrets."><Card><CardHeader title="Watch Experience Settings" eyebrow="Controls /watch playback behavior" /><div className="grid gap-3 p-4 md:grid-cols-2">{(["defaultAutoplay","autoplayNext","showPlayerControls","preferRecentVideos","preferHighViews","showShortsLikeInSuggestions"] as const).map((k) => <label key={k} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={watchSettings[k]} onChange={(e) => update(k, e.target.checked)} />{k}</label>)}<label className="text-sm">Suggested count<input type="number" className="mt-1 h-10 w-full rounded-lg border border-border bg-surface px-3" value={watchSettings.suggestedVideosCount} onChange={(e) => update("suggestedVideosCount", Number(e.target.value) || 1)} /></label><label className="text-sm">Source priority<select className="mt-1 h-10 w-full rounded-lg border border-border bg-surface px-3" value={watchSettings.suggestionSourcePriority} onChange={(e) => update("suggestionSourcePriority", e.target.value as WatchExperienceSettings["suggestionSourcePriority"])}><option value="manifest">manifest</option><option value="same_channel">same channel</option><option value="mixed">mixed</option></select></label></div></Card><Card><CardHeader title="Environment map" eyebrow="Secret-safe" /><div className="flex flex-wrap gap-2 p-4">{["YOUTUBE_API_KEY server-only","GEMINI_API_KEY server-only","DATABASE_URL server-only","NEXT_PUBLIC_APP_URL browser-safe","No NEXT_PUBLIC_YOUTUBE_API_KEY","No NEXT_PUBLIC_GEMINI_API_KEY"].map((setting)=><Badge key={setting} tone={setting.startsWith("No ")?"danger":"neutral"}>{setting}</Badge>)}</div></Card></WorkspacePage></AppShell>;
}
