import { Settings } from "lucide-react";
import { AppShell } from "@/components/layout/app-shell";
import { WorkspacePage } from "@/components/pages/workspace-page";
import { Card, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export default function SettingsPage() {
  const settings = [
    "YOUTUBE_API_KEY server-only",
    "GEMINI_API_KEY server-only",
    "DATABASE_URL server-only",
    "NEXT_PUBLIC_APP_URL browser-safe",
    "No NEXT_PUBLIC_YOUTUBE_API_KEY",
    "No NEXT_PUBLIC_GEMINI_API_KEY",
  ];

  return (
    <AppShell>
      <WorkspacePage
        icon={Settings}
        eyebrow="Settings"
        title="API Status, Quota, and Environment"
        description="Environment setup is documented through .env.example, README, and guarded validation scripts without printing secrets."
      >
        <Card>
          <CardHeader title="Environment map" eyebrow="Secret-safe" />
          <div className="flex flex-wrap gap-2">
            {settings.map((setting) => (
              <Badge key={setting} tone={setting.startsWith("No ") ? "danger" : "neutral"}>
                {setting}
              </Badge>
            ))}
          </div>
        </Card>
      </WorkspacePage>
    </AppShell>
  );
}
