import { History } from "lucide-react";
import { AppShell } from "@/components/layout/app-shell";
import { WorkspacePage } from "@/components/pages/workspace-page";

export default function HistoryPage() {
  return (
    <AppShell>
      <WorkspacePage
        icon={History}
        eyebrow="Fetch history"
        title="Search and Fetch History"
        description="Operational jobs, page attempts, provider request logs, and quota events are modeled in Prisma for future durable history."
      />
    </AppShell>
  );
}
