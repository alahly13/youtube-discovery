"use client";

import {
  Archive,
  BookOpen,
  Bookmark,
  BookmarkCheck,
  ChevronDown,
  ChevronRight,
  Database,
  Download,
  Eye,
  FileText,
  FolderOutput,
  HardDrive,
  History,
  Home,
  LinkIcon,
  ListVideo,
  PlaySquare,
  Search,
  Settings,
  Sparkles,
  Tv,
  Upload,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils/format";
import { DailymotionIcon } from "@/components/layout/dailymotion-icon";
import { SignOutButton } from "@/components/layout/sign-out-button";

interface NavItem {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  external?: boolean;
}

interface NavSection {
  title?: string;
  items: NavItem[];
}

const mainNavSections: NavSection[] = [
  {
    items: [
      { href: "/", label: "Dashboard", icon: Home },
    ],
  },
  {
    title: "MY LIBRARY",
    items: [
      { href: "/saved", label: "Saved Items", icon: BookmarkCheck },
      { href: "/dashboard/i-will-search-for", label: "I Will Search For", icon: Bookmark },
      { href: "/playlist-manager", label: "Playlist Manager", icon: ListVideo },
      { href: "/saved-searches", label: "Saved Searches", icon: FileText },
      { href: "/history", label: "Search History", icon: History },
    ],
  },
  {
    title: "YOUTUBE EXPLORER",
    items: [
      { href: "/search", label: "Search", icon: Search },
      { href: "/search-guide", label: "Search Guide 2026", icon: BookOpen },
      { href: "/channels", label: "Channels", icon: Tv },
      { href: "/playlists", label: "YouTube Playlists", icon: PlaySquare },
      { href: "/ai-search", label: "AI Discovery", icon: Sparkles },
      { href: "/link-explorer", label: "Link Explorer", icon: LinkIcon },
    ],
  },
  {
    title: "STORAGE & MANIFESTS",
    items: [
      { href: "/manifests", label: "Storage Explorer", icon: HardDrive },
      { href: "/dashboard/local-data", label: "Local Data Center", icon: Database },
      { href: "/other-actions", label: "Other Actions", icon: Sparkles },
      { href: "/manifests/upload", label: "Upload Manifest", icon: Upload },
      { href: "/manifests/viewer", label: "Manifest Viewer", icon: Eye },
      { href: "/manifests/export", label: "Manifest Export", icon: FolderOutput },
    ],
  },
];

const oldArchiveItems: NavItem[] = [
  { href: "/old", label: "OLD Archive Overview", icon: Archive },
  { href: "/old/saved-items", label: "OLD Saved Items", icon: BookmarkCheck },
  { href: "/old/saved-playlists", label: "OLD Saved Playlists", icon: ListVideo },
  { href: "/old/saved-titles-links", label: "OLD Saved Titles & Links", icon: Bookmark },
  { href: "/old/saved-search-history", label: "OLD Saved Search History", icon: History },
];

const mobileQuickNav = [
  { href: "/", label: "Home", icon: Home },
  { href: "/search", label: "Search", icon: Search },
  { href: "/saved", label: "Saved", icon: BookmarkCheck },
  { href: "/playlist-manager", label: "Playlists", icon: ListVideo },
  { href: "/settings", label: "Settings", icon: Settings },
];

export function Navigation({ mobile = false }: { mobile?: boolean }) {
  const pathname = usePathname();
  const isOldRoute = pathname.startsWith("/old");
  const [oldOpen, setOldOpen] = useState(true);

  useEffect(() => {
    if (isOldRoute) {
      setOldOpen(true);
    }
  }, [isOldRoute]);

  // Bottom mobile navigation bar (compact 5 items)
  if (mobile) {
    return (
      <nav className="grid grid-cols-5 gap-1 text-center" aria-label="Mobile Navigation">
        {mobileQuickNav.map((item) => {
          const Icon = item.icon;
          const active =
            pathname === item.href || (item.href !== "/" && pathname.startsWith(item.href));

          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex flex-col items-center justify-center gap-1 rounded-lg py-2 text-[11px] transition",
                active
                  ? "bg-primary-soft text-primary font-semibold"
                  : "text-muted hover:bg-surface-muted hover:text-foreground"
              )}
            >
              <Icon className="h-4 w-4 shrink-0" />
              <span className="truncate max-w-[56px]">{item.label}</span>
            </Link>
          );
        })}
      </nav>
    );
  }

  // Full sectioned sidebar navigation
  return (
    <nav className="flex flex-1 min-h-0 flex-col gap-5 overflow-y-auto pr-1 pb-4 text-xs" aria-label="Sidebar Navigation">
      {mainNavSections.map((section, idx) => (
        <div key={idx} className="flex flex-col gap-1">
          {section.title && (
            <div className="px-3 pb-1 pt-1 text-[10px] font-bold uppercase tracking-wider text-muted/70">
              {section.title}
            </div>
          )}
          {section.items.map((item) => {
            const Icon = item.icon;
            const active =
              pathname === item.href || (item.href !== "/" && pathname.startsWith(item.href));

            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex min-h-9 items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors",
                  active
                    ? "bg-primary-soft text-primary font-semibold shadow-xs"
                    : "text-muted hover:bg-surface-muted hover:text-foreground"
                )}
              >
                <Icon
                  className={cn(
                    "h-4 w-4 shrink-0",
                    active ? "text-primary" : "text-muted group-hover:text-foreground"
                  )}
                />
                <span className="truncate">{item.label}</span>
              </Link>
            );
          })}
        </div>
      ))}

      {/* COLLAPSIBLE OLD ARCHIVE SECTION (Exactly 4 Categories + Overview) */}
      <div className="flex flex-col gap-1 border-t border-border/50 pt-2">
        <button
          type="button"
          onClick={() => setOldOpen((prev) => !prev)}
          className="flex items-center justify-between px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-muted/70 hover:text-foreground transition-colors"
          aria-expanded={oldOpen}
          aria-label="Toggle OLD Archive navigation"
        >
          <span className="flex items-center gap-1.5">
            <Archive className="h-3 w-3 text-primary/70" />
            <span>OLD ARCHIVE</span>
          </span>
          {oldOpen ? (
            <ChevronDown className="h-3.5 w-3.5 text-muted/60" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5 text-muted/60" />
          )}
        </button>

        {oldOpen && (
          <div className="flex flex-col gap-1 pl-1">
            {oldArchiveItems.map((item) => {
              const Icon = item.icon;
              const active =
                item.href === "/old"
                  ? pathname === "/old"
                  : pathname === item.href || pathname.startsWith(item.href + "/");

              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "flex min-h-9 items-center gap-2.5 rounded-lg px-3 py-1.5 text-xs transition-colors",
                    active
                      ? "bg-primary-soft text-primary font-semibold shadow-xs"
                      : "text-muted hover:bg-surface-muted hover:text-foreground"
                  )}
                >
                  <Icon
                    className={cn(
                      "h-3.5 w-3.5 shrink-0",
                      active ? "text-primary" : "text-muted group-hover:text-foreground"
                    )}
                  />
                  <span className="truncate">{item.label}</span>
                </Link>
              );
            })}
          </div>
        )}
      </div>

      {/* SYSTEM Section */}
      <div className="flex flex-col gap-1 border-t border-border/50 pt-2">
        <div className="px-3 pb-1 text-[10px] font-bold uppercase tracking-wider text-muted/70">
          SYSTEM
        </div>
        <Link
          href="/download-center"
          className={cn(
            "flex min-h-9 items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors",
            pathname === "/download-center" || pathname.startsWith("/download-center/")
              ? "bg-primary-soft text-primary font-semibold shadow-xs"
              : "text-muted hover:bg-surface-muted hover:text-foreground"
          )}
        >
          <Download className="h-4 w-4 shrink-0 text-muted" />
          <span className="truncate">Download Center (مركز التحميل)</span>
        </Link>
        <Link
          href="/settings"
          className={cn(
            "flex min-h-9 items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors",
            pathname === "/settings" || pathname.startsWith("/settings/")
              ? "bg-primary-soft text-primary font-semibold shadow-xs"
              : "text-muted hover:bg-surface-muted hover:text-foreground"
          )}
        >
          <Settings className="h-4 w-4 shrink-0 text-muted" />
          <span className="truncate">Settings</span>
        </Link>
      </div>

      {/* COMPANION Section */}
      <div className="flex flex-col gap-1 border-t border-border/50 pt-3">
        <div className="px-3 pb-1 text-[10px] font-bold uppercase tracking-wider text-muted/70">
          COMPANION
        </div>
        <a
          href="https://dailymotion-discovery.vercel.app/"
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Open Dailymotion Discovery in a new tab"
          title="Open Dailymotion Discovery (external app)"
          className="flex min-h-9 items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-muted hover:bg-surface-muted hover:text-foreground transition-colors"
        >
          <DailymotionIcon className="h-4 w-4 shrink-0 text-muted" />
          <span className="truncate">Dailymotion Discovery</span>
        </a>
      </div>

      {/* Architecture badge/note */}
      <div className="mt-2 rounded-lg border border-border/70 bg-surface-muted/60 p-2.5 text-[11px] leading-relaxed text-muted">
        <p className="font-semibold text-foreground/80">YouTube Discovery 2026</p>
        <p className="mt-0.5 text-muted/80">Dedicated OLD & NEW Storage separation with zero-quota search cache.</p>
      </div>

      {/* Account / Sign Out Section */}
      <div className="mt-2 border-t border-border/50 pt-2">
        <SignOutButton variant="sidebar" />
      </div>
    </nav>
  );
}
