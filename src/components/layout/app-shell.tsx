"use client";

import { Activity, Bell, Database, Menu, PanelLeftClose, PanelLeftOpen, Search } from "lucide-react";
import { ThemeToggle } from "@/components/layout/theme-toggle";
import { Navigation } from "@/components/layout/navigation";
import { Badge } from "@/components/ui/badge";
import { useYouTubeWorkspaceStore } from "@/lib/state/youtube-workspace-store";
import { Button } from "@/components/ui/button";
import { useEffect, useState } from "react";

export function AppShell({ children }: { children: React.ReactNode }) {
  const { isSidebarOpen, toggleSidebar } = useYouTubeWorkspaceStore();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Avoid hydration mismatch by assuming open on server, 
  // then using the actual persisted state once mounted.
  const isOpen = mounted ? isSidebarOpen : true;

  return (
    <div className="min-h-screen bg-background text-foreground overflow-x-hidden">
      {/* Desktop Sidebar */}
      <aside 
        className={`fixed inset-y-0 left-0 z-40 hidden w-[var(--sidebar-width)] border-r border-border bg-surface/95 p-4 lg:flex lg:flex-col transition-transform duration-300 ease-in-out ${
          isOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="mb-6 flex items-center gap-3">
          <div className="flex shrink-0 h-10 w-10 items-center justify-center rounded-lg bg-primary-soft text-primary">
            <Search className="h-5 w-5" />
          </div>
          <div className={`transition-opacity duration-200 delay-100 ${isOpen ? "opacity-100" : "opacity-0"}`}>
            <p className="text-base font-semibold whitespace-nowrap">YouTube Discovery</p>
            <p className="font-mono text-xs text-muted whitespace-nowrap">Research Terminal</p>
          </div>
        </div>
        <Navigation />
      </aside>

      {/* Main Content Area */}
      <div 
        className={`transition-[padding] duration-300 ease-in-out ${
          isOpen ? "lg:pl-[var(--sidebar-width)]" : "lg:pl-0"
        }`}
      >
        <header className="sticky top-0 z-30 border-b border-border bg-background/85 px-4 py-3 backdrop-blur md:px-6">
          <div className="mx-auto flex max-w-[1600px] items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              {/* Mobile menu button */}
              <button
                className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-surface text-muted lg:hidden"
                aria-label="Open navigation"
                title="Open navigation"
              >
                <Menu className="h-4 w-4" />
              </button>

              {/* Desktop Sidebar Toggle */}
              <Button
                variant="ghost"
                className="hidden lg:inline-flex h-9 w-9 px-0 text-muted hover:text-foreground"
                onClick={toggleSidebar}
                aria-label="Toggle Sidebar"
                title="Toggle Sidebar"
              >
                {isOpen ? <PanelLeftClose className="h-5 w-5" /> : <PanelLeftOpen className="h-5 w-5" />}
              </Button>

              <div className="hidden items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2 text-sm text-muted md:flex xl:flex">
                <Search className="h-4 w-4" />
                <span className="truncate">Search settings fetch; local filters never call YouTube</span>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <Badge tone="primary" className="hidden sm:inline-flex">
                <Activity className="h-3.5 w-3.5" />
                <span className="hidden xl:inline">Quota-aware</span>
              </Badge>
              <Badge tone="ai" className="hidden sm:inline-flex">
                <Database className="h-3.5 w-3.5" />
                <span className="hidden xl:inline">Manifest-first</span>
              </Badge>
              <button className="hidden h-9 w-9 items-center justify-center rounded-lg border border-border bg-surface text-muted md:inline-flex hover:bg-surface-muted hover:text-foreground transition-colors" aria-label="Notifications" title="Notifications">
                <Bell className="h-4 w-4" />
              </button>
              <ThemeToggle />
            </div>
          </div>
        </header>
        <main className="mx-auto max-w-[1600px] px-4 py-6 md:px-6 lg:py-8">
          {children}
        </main>
      </div>

      {/* Mobile Bottom Navigation */}
      <div className="border-t border-border bg-surface p-4 lg:hidden">
        <Navigation mobile />
      </div>
    </div>
  );
}
