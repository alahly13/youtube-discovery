import { AppShell } from "@/components/layout/app-shell";
import { Dashboard } from "@/components/pages/dashboard";

export default function Home() {
  return (
    <AppShell>
      <Dashboard />
    </AppShell>
  );
}
