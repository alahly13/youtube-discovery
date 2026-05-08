"use client";

import {
  Archive,
  Bot,
  Compass,
  FolderKanban,
  History,
  Home,
  Library,
  LinkIcon,
  ListVideo,
  PlaySquare,
  Search,
  Settings,
  Tv,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils/format";

const navItems = [
  { href: "/", label: "Dashboard", icon: Home },
  { href: "/search", label: "Search", icon: Search },
  { href: "/ai-search", label: "AI Search", icon: Bot },
  { href: "/link-explorer", label: "Link Explorer", icon: LinkIcon },
  { href: "/channels", label: "Channels", icon: Tv },
  { href: "/channel-explorer", label: "Channel Explorer", icon: Compass },
  { href: "/playlists", label: "Playlists", icon: ListVideo },
  { href: "/playlist-explorer", label: "Playlist Explorer", icon: PlaySquare },
  { href: "/manifests", label: "Manifests", icon: Archive },
  { href: "/collections", label: "Collections", icon: FolderKanban },
  { href: "/saved", label: "Saved", icon: Library },
  { href: "/history", label: "History", icon: History },
  { href: "/settings", label: "Settings", icon: Settings },
] as const;

export function Navigation({ mobile = false }: { mobile?: boolean }) {
  const pathname = usePathname();

  return (
    <nav className={cn("flex flex-col gap-1", mobile && "grid grid-cols-2")}>
      {navItems.map((item) => {
        const Icon = item.icon;
        const active = pathname === item.href || (item.href !== "/" && pathname.startsWith(item.href));

        return (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              "flex min-h-10 items-center gap-3 rounded-lg px-3 py-2 text-sm transition",
              active ? "bg-primary-soft text-primary" : "text-muted hover:bg-surface-muted hover:text-foreground",
            )}
          >
            <Icon className="h-4 w-4 shrink-0" />
            <span>{item.label}</span>
          </Link>
        );
      })}
      <div className="mt-3 rounded-lg border border-border bg-surface-muted p-3 text-xs text-muted">
        Community posts stay unsupported until an official API endpoint exposes them.
      </div>
    </nav>
  );
}
