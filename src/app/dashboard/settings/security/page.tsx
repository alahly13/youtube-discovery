import { AppShell } from "@/components/layout/app-shell";
import { AccountSecurityCard } from "@/components/settings/account-security";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Account Security | YouTube Discovery",
  description: "Administrator account security, password management, and authoritative Supabase Auth settings.",
};

export default function SecuritySettingsPage() {
  return (
    <AppShell>
      <div className="mx-auto max-w-4xl space-y-6 px-4 py-8">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-foreground">Account Security</h1>
          <p className="mt-1 text-xs text-muted">
            Manage your single administrator credentials and configure authoritative Supabase Auth access.
          </p>
        </div>

        <AccountSecurityCard />
      </div>
    </AppShell>
  );
}
