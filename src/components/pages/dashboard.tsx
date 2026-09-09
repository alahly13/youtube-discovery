"use client";

import {
  Bookmark,
  Bot,
  Compass,
  Database,
  Download,
  Library,
  ListVideo,
  Search,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Tv,
} from "lucide-react";
import Link from "next/link";
import { useSyncExternalStore } from "react";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { useYouTubeWorkspaceStore } from "@/lib/state/youtube-workspace-store";

const noopSubscribe = () => () => {};

export function Dashboard() {
  const isMounted = useSyncExternalStore(noopSubscribe, () => true, () => false);
  const { savedSearches, savedItems, currentManifest, fetchSettings } = useYouTubeWorkspaceStore();

  const searchCount = isMounted ? savedSearches.length : 0;
  const itemCount = isMounted ? savedItems.length : 0;
  const manifestItemsCount = isMounted && currentManifest ? currentManifest.normalizedItems.length : 0;
  const isUnrestricted = isMounted && fetchSettings.defaultSafeSearch === "none";

  const dynamicStats = [
    {
      label: "Saved Search Titles",
      value: String(searchCount),
      icon: Bookmark,
      href: "/saved",
      hint: "Custom-titled queries",
    },
    {
      label: "Saved Library Items",
      value: String(itemCount),
      icon: Library,
      href: "/saved",
      hint: "Videos, channels & playlists",
    },
    {
      label: "Active Manifest Items",
      value: String(manifestItemsCount),
      icon: Database,
      href: "/search",
      hint: currentManifest ? currentManifest.title : "No active manifest",
    },
    {
      label: "Default SafeSearch",
      value: isUnrestricted ? "Unrestricted" : "Moderate",
      icon: isUnrestricted ? ShieldAlert : ShieldCheck,
      href: "/settings",
      hint: isUnrestricted ? "18+ & 35+ Sensitive Allowed" : "Standard filtered mode",
      highlight: isUnrestricted,
    },
  ];

  return (
    <div className="space-y-6">
      {/* ── Hero Banner ──────────────────────────────────────────────── */}
      <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_24rem]">
        <Card className="p-6">
          <div className="max-w-3xl">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone="primary">Official YouTube Data API only</Badge>
              {isUnrestricted && (
                <Badge tone="success" className="unrestricted-glow font-medium">
                  🔞 18+/35+ Sensitive Content Mode Active
                </Badge>
              )}
            </div>
            <h1 className="mt-4 text-3xl font-semibold text-foreground md:text-4xl">
              Public YouTube metadata discovery, organized as reusable manifests.
            </h1>
            <p className="mt-3 max-w-2xl text-base text-muted">
              Search provider metadata with unrestricted mature content discovery, save search titles, hydrate details, filter locally, export manifest records, and run scoped AI analysis.
            </p>
          </div>
          <div className="mt-6 flex flex-wrap gap-3">
            <ButtonLink href="/search" variant="primary">
              <Search className="h-4 w-4" />
              Open Search
            </ButtonLink>
            <ButtonLink href="/channel-explorer" variant="secondary">
              <Compass className="h-4 w-4" />
              Channel Explorer
            </ButtonLink>
            <ButtonLink href="/playlist-explorer" variant="secondary">
              <ListVideo className="h-4 w-4" />
              Playlist Explorer
            </ButtonLink>
            <ButtonLink href="/ai-search" variant="ai">
              <Bot className="h-4 w-4" />
              AI Workspace
            </ButtonLink>
          </div>
        </Card>

        {/* ── System Posture ────────────────────────────────────────── */}
        <Card>
          <CardHeader title="System posture" eyebrow="Runtime boundaries" />
          <div className="space-y-3 text-sm">
            <Boundary icon={<ShieldCheck className="h-4 w-4" />} label="Secrets" value="Server-only env vars" />
            <Boundary icon={<Download className="h-4 w-4" />} label="Exports" value="JSON and NDJSON manifests" />
            <Boundary icon={<Tv className="h-4 w-4" />} label="Channels" value="Uploads playlist workflow" />
            <Boundary icon={<Bot className="h-4 w-4" />} label="AI" value="Scoped metadata context" />
          </div>
        </Card>
      </section>

      {/* ── Live Telemetry Cards ────────────────────────────────────── */}
      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {dynamicStats.map((stat) => {
          const Icon = stat.icon;
          return (
            <Link key={stat.label} href={stat.href} className="group block">
              <Card className={`h-full transition hover:-translate-y-0.5 hover:border-primary/50 ${stat.highlight ? "border-emerald-500/40 bg-emerald-500/5" : ""}`}>
                <div className="flex items-center justify-between">
                  <p className="text-xs font-medium uppercase tracking-wider text-muted group-hover:text-foreground">
                    {stat.label}
                  </p>
                  <Icon className={`h-5 w-5 ${stat.highlight ? "text-emerald-500" : "text-muted group-hover:text-primary"} transition-colors`} />
                </div>
                <p className="mt-3 font-mono text-2xl font-semibold text-foreground md:text-3xl">
                  {stat.value}
                </p>
                <p className="mt-1 line-clamp-1 text-xs text-muted">
                  {stat.hint}
                </p>
              </Card>
            </Link>
          );
        })}
      </section>

      {/* ── Quick Discovery Launch Hub ──────────────────────────────── */}
      <section className="grid gap-4 md:grid-cols-3">
        <Link href="/search" className="group block">
          <Card className="p-5 transition hover:-translate-y-0.5 hover:border-primary/40">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary-soft text-primary">
                <Search className="h-5 w-5" />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-foreground group-hover:text-primary transition-colors">
                  YouTube Search Workspace
                </h3>
                <p className="mt-0.5 text-xs text-muted">
                  Query videos, channels, playlists with SafeSearch &quot;none&quot; & 18+ filters
                </p>
              </div>
            </div>
          </Card>
        </Link>

        <Link href="/channel-explorer" className="group block">
          <Card className="p-5 transition hover:-translate-y-0.5 hover:border-primary/40">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-surface-muted text-foreground">
                <Compass className="h-5 w-5" />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-foreground group-hover:text-primary transition-colors">
                  Channel Explorer
                </h3>
                <p className="mt-0.5 text-xs text-muted">
                  Resolve any handle or ID to discover complete upload manifests
                </p>
              </div>
            </div>
          </Card>
        </Link>

        <Link href="/playlist-explorer" className="group block">
          <Card className="p-5 transition hover:-translate-y-0.5 hover:border-primary/40">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-surface-muted text-foreground">
                <ListVideo className="h-5 w-5" />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-foreground group-hover:text-primary transition-colors">
                  Playlist Explorer
                </h3>
                <p className="mt-0.5 text-xs text-muted">
                  Explore full public playlist manifests in original order
                </p>
              </div>
            </div>
          </Card>
        </Link>
      </section>

      {/* ── Recent Manifests & AI Assistance ────────────────────────── */}
      <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_24rem]">
        <Card>
          <CardHeader title="Manifest Workspace Status" eyebrow="Local manifest state" />
          {currentManifest ? (
            <div className="space-y-3 p-1">
              <div className="rounded-lg border border-border bg-surface p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-semibold text-foreground">{currentManifest.title}</span>
                  <Badge tone="success">Active</Badge>
                </div>
                <div className="mt-2 flex flex-wrap gap-4 text-xs text-muted">
                  <span>Type: <strong className="text-foreground">{currentManifest.manifestType}</strong></span>
                  <span>Items: <strong className="font-mono text-foreground">{currentManifest.normalizedItems.length}</strong></span>
                  <span>Estimated Quota: <strong className="font-mono text-foreground">{currentManifest.quotaCostEstimate} units</strong></span>
                </div>
                <div className="mt-3 flex gap-2">
                  <ButtonLink href="/search" variant="secondary" className="h-8 px-3 text-xs">
                    View in Search
                  </ButtonLink>
                  <ButtonLink href="/saved" variant="secondary" className="h-8 px-3 text-xs">
                    Saved Library
                  </ButtonLink>
                </div>
              </div>
            </div>
          ) : (
            <div className="p-6 text-center text-sm text-muted">
              <p>No active manifest in current session.</p>
              <p className="mt-1 text-xs">Execute a search or explore a channel to build a manifest.</p>
              <ButtonLink href="/search" variant="secondary" className="mt-4 h-8 px-3 text-xs">
                Start Search
              </ButtonLink>
            </div>
          )}
        </Card>

        <Card className="border-ai/30">
          <CardHeader title="AI sessions" eyebrow="Grounded assistants" />
          <p className="text-sm text-muted">
            AI routes are present and validate scope, item count, evidence refs, limitations, and confirmation-only suggestions. Missing Gemini keys return an honest unavailable response.
          </p>
          <ButtonLink href="/ai-search" variant="ai" className="mt-4 w-full">
            <Sparkles className="h-4 w-4" />
            Open AI Search
          </ButtonLink>
        </Card>
      </section>
    </div>
  );
}

function Boundary({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-lg border border-border bg-surface-muted p-3">
      <div className="flex items-center gap-2 text-muted">
        {icon}
        <span>{label}</span>
      </div>
      <span className="text-right font-medium text-foreground">{value}</span>
    </div>
  );
}
