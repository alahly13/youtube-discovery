import { Settings } from "lucide-react";
import { AppShell } from "@/components/layout/app-shell";
import { WorkspacePage } from "@/components/pages/workspace-page";
import { SettingsClient } from "./settings-client";

export default function SettingsPage() {
  const envStatus = {
    youtubeApiEnabled: !!process.env.YOUTUBE_API_KEY,
    geminiApiEnabled: !!process.env.GEMINI_API_KEY,
    databaseEnabled: !!process.env.DATABASE_URL,
    youtubeQuotaBudget: parseInt(process.env.YOUTUBE_DAILY_QUOTA_BUDGET || "10000", 10),
    defaultPageSize: parseInt(process.env.YOUTUBE_SEARCH_PAGE_SIZE || "25", 10),
    defaultMaxPages: parseInt(process.env.YOUTUBE_SEARCH_MAX_PAGES || "3", 10),
    defaultMaxItems: parseInt(process.env.YOUTUBE_SEARCH_MAX_ITEMS || "150", 10),
  };

  return (
    <AppShell>
      <WorkspacePage 
        icon={Settings} 
        eyebrow="Settings" 
        title="API Status, Quota, and Environment" 
        description="Controls YouTube watch and discovery behavior."
      >
        <SettingsClient envStatus={envStatus} />
      </WorkspacePage>
    </AppShell>
  );
}
