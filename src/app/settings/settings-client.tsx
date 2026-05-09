"use client";

import { AlertCircle, CheckCircle2 } from "lucide-react";
import { useYouTubeWorkspaceStore } from "@/lib/state/youtube-workspace-store";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader } from "@/components/ui/card";

export interface EnvStatus {
  youtubeApiEnabled: boolean;
  geminiApiEnabled: boolean;
  databaseEnabled: boolean;
  youtubeQuotaBudget: number;
  defaultPageSize: number;
  defaultMaxPages: number;
  defaultMaxItems: number;
}

export function SettingsClient({ envStatus }: { envStatus: EnvStatus }) {
  const watchSettings = useYouTubeWorkspaceStore((s) => s.watchSettings);
  const updateWatchSettings = useYouTubeWorkspaceStore((s) => s.updateWatchSettings);
  
  const fetchSettings = useYouTubeWorkspaceStore((s) => s.fetchSettings);
  const updateFetchSettings = useYouTubeWorkspaceStore((s) => s.updateFetchSettings);

  const calculateQuota = () => {
    // Basic estimation: Search costs 100, plus videos.list
    const estimatedCostPerFetch = 100 + fetchSettings.pageSize;
    return Math.floor(envStatus.youtubeQuotaBudget / estimatedCostPerFetch);
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader title="Watch Experience Settings" eyebrow="Controls /watch playback behavior" />
        <div className="grid gap-3 p-4 md:grid-cols-2">
          <label className="flex items-center gap-2 text-sm">
            <input 
              type="checkbox" 
              checked={watchSettings.defaultAutoplay} 
              onChange={(e)=>updateWatchSettings({defaultAutoplay:e.target.checked})} 
              className="accent-primary"
            />
            Default autoplay
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input 
              type="checkbox" 
              checked={watchSettings.autoplayNext} 
              onChange={(e)=>updateWatchSettings({autoplayNext:e.target.checked})} 
              className="accent-primary"
            />
            Autoplay next video
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input 
              type="checkbox" 
              checked={watchSettings.showPlayerControls} 
              onChange={(e)=>updateWatchSettings({showPlayerControls:e.target.checked})} 
              className="accent-primary"
            />
            Show player controls
          </label>
        </div>
      </Card>
      
      <Card>
        <CardHeader title="YouTube Fetch Controls" eyebrow="Controls API consumption per request" />
        <div className="grid gap-4 p-4 md:grid-cols-3">
          <div>
            <label className="mb-1 block text-sm font-medium">Search Page Size</label>
            <p className="mb-2 text-xs text-muted">Number of results per API page (Default: {envStatus.defaultPageSize})</p>
            <input 
              type="number" 
              className="filter-input" 
              min={5} max={50} 
              value={fetchSettings.pageSize} 
              onChange={(e) => updateFetchSettings({ pageSize: Number(e.target.value) || 5 })}
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">Max Pages</label>
            <p className="mb-2 text-xs text-muted">Maximum pages to fetch automatically (Default: {envStatus.defaultMaxPages})</p>
            <input 
              type="number" 
              className="filter-input" 
              min={1} max={10} 
              value={fetchSettings.maxPages} 
              onChange={(e) => updateFetchSettings({ maxPages: Number(e.target.value) || 1 })}
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">Max Total Items</label>
            <p className="mb-2 text-xs text-muted">Absolute cap on fetched items (Default: {envStatus.defaultMaxItems})</p>
            <input 
              type="number" 
              className="filter-input" 
              min={50} max={500} 
              value={fetchSettings.maxItems} 
              onChange={(e) => updateFetchSettings({ maxItems: Number(e.target.value) || 50 })}
            />
          </div>
        </div>
        <div className="border-t border-border bg-surface-muted p-4">
            <p className="text-sm">
              Estimated searches allowed per day with current settings: <strong>~{calculateQuota()} searches</strong> 
              <span className="text-muted ml-2">(Quota budget: {envStatus.youtubeQuotaBudget})</span>
            </p>
            {fetchSettings.pageSize * fetchSettings.maxPages > 100 && (
                <p className="mt-1 text-xs text-warning flex items-center gap-1">
                  <AlertCircle className="h-3 w-3" />
                  Warning: High limits will consume YouTube API quota quickly.
                </p>
            )}
        </div>
      </Card>

      <Card>
        <CardHeader title="Environment & API Status" eyebrow="Server-side integrations" />
        <div className="space-y-3 p-4">
          <div className="flex items-center justify-between border-b border-border pb-3">
             <div>
                <p className="text-sm font-medium">YouTube Data API v3</p>
                <p className="text-xs text-muted">Required for fetching real metadata.</p>
             </div>
             {envStatus.youtubeApiEnabled ? (
               <Badge tone="success"><CheckCircle2 className="mr-1 h-3 w-3"/> Connected</Badge>
             ) : (
               <Badge tone="danger"><AlertCircle className="mr-1 h-3 w-3"/> Missing</Badge>
             )}
          </div>
          <div className="flex items-center justify-between border-b border-border pb-3">
             <div>
                <p className="text-sm font-medium">Gemini API</p>
                <p className="text-xs text-muted">Required for AI analysis features.</p>
             </div>
             {envStatus.geminiApiEnabled ? (
               <Badge tone="success"><CheckCircle2 className="mr-1 h-3 w-3"/> Connected</Badge>
             ) : (
               <Badge tone="danger"><AlertCircle className="mr-1 h-3 w-3"/> Missing</Badge>
             )}
          </div>
          <div className="flex items-center justify-between">
             <div>
                <p className="text-sm font-medium">PostgreSQL Database (Prisma)</p>
                <p className="text-xs text-muted">Required for durable persistence.</p>
             </div>
             {envStatus.databaseEnabled ? (
               <Badge tone="success"><CheckCircle2 className="mr-1 h-3 w-3"/> Configured</Badge>
             ) : (
               <Badge tone="warning"><AlertCircle className="mr-1 h-3 w-3"/> Runtime only</Badge>
             )}
          </div>
        </div>
      </Card>
    </div>
  );
}
