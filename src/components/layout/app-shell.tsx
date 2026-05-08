import { Activity, Bell, Database, Menu, Search } from "lucide-react";
import { ThemeToggle } from "@/components/layout/theme-toggle";
import { Navigation } from "@/components/layout/navigation";
import { Badge } from "@/components/ui/badge";

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* The desktop sidebar owns app-level navigation only. Protected truth,
          provider keys, and persistence authority stay inside server routes. */}
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-[var(--sidebar-width)] border-r border-border bg-surface/95 p-4 lg:flex lg:flex-col">
        <div className="mb-6 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary-soft text-primary">
            <Search className="h-5 w-5" />
          </div>
          <div>
            <p className="text-base font-semibold">YouTube Discovery</p>
            <p className="font-mono text-xs text-muted">Research Terminal</p>
          </div>
        </div>
        <Navigation />
      </aside>

      <div className="lg:pl-[var(--sidebar-width)]">
        <header className="sticky top-0 z-30 border-b border-border bg-background/85 px-4 py-3 backdrop-blur md:px-6">
          <div className="mx-auto flex max-w-[1600px] items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <button
                className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-surface text-muted lg:hidden"
                aria-label="Open navigation"
                title="Open navigation"
              >
                <Menu className="h-4 w-4" />
              </button>
              <div className="hidden items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2 text-sm text-muted md:flex">
                <Search className="h-4 w-4" />
                <span>Search settings fetch; local filters never call YouTube</span>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Badge tone="primary">
                <Activity className="h-3.5 w-3.5" />
                Quota-aware
              </Badge>
              <Badge tone="ai">
                <Database className="h-3.5 w-3.5" />
                Manifest-first
              </Badge>
              <button className="hidden h-9 w-9 items-center justify-center rounded-lg border border-border bg-surface text-muted md:inline-flex" aria-label="Notifications" title="Notifications">
                <Bell className="h-4 w-4" />
              </button>
              <ThemeToggle />
            </div>
          </div>
        </header>
        <main className="mx-auto max-w-[1600px] px-4 py-6 md:px-6 lg:py-8">{children}</main>
      </div>

      <div className="border-t border-border bg-surface p-4 lg:hidden">
        <Navigation mobile />
      </div>
    </div>
  );
}
