import { Bookmark, FileText, HardDrive } from "lucide-react";
import { AppShell } from "@/components/layout/app-shell";
import { WorkspacePage } from "@/components/pages/workspace-page";
import { SavedTitlesLinksWorkspace } from "@/components/saved/saved-titles-links-workspace";
import { SavedSearchesWorkspace } from "@/components/saved/saved-searches-workspace";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * Consolidated References Library — /saved-titles-links (2026)
 * ───────────────────────────────────────────────────────────────────────────
 * Architecture:
 *   Hosts two strictly isolated sub-workspaces backed by canonical storage:
 *     1. Section A (`#saved-titles-links`): Saved Titles & Reference Links
 *        (`SAVED_TITLE`, `SAVED_LINK` -> IndexedDB `entities_saved_references` /
 *         OPFS `references` -> R2 `asdy/persistence/<ownerId>/references/...` ->
 *         PostgreSQL `saved_references`)
 *     2. Section B (`#saved-searches`): Saved Search Presets
 *        (`SAVED_SEARCH` -> IndexedDB + Zustand -> R2 `references/` ->
 *         PostgreSQL `saved_search_presets`)
 *
 * Separation & Visual Clarity:
 *   A clear horizontal divider separates the two domains so titles/links and
 *   saved search presets maintain independent filters, cards, state, 3-way
 *   reconciliation, and append-only R2 upload + local cleanup pipelines.
 * ═══════════════════════════════════════════════════════════════════════════
 */

export default function SavedTitlesLinksPage() {
  return (
    <AppShell>
      <WorkspacePage
        icon={Bookmark}
        eyebrow="My Library · References & Search Presets"
        title="Saved Titles, Links & Saved Searches"
        description="Unified Cloudflare R2 & PostgreSQL reference library with strictly separated workspaces: Saved Titles & Links above, and Pinned Saved Searches below under a clear divider."
      >
        {/* Quick Section Anchor Navigator */}
        <nav
          aria-label="References workspace sections"
          className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border/80 bg-surface p-3 shadow-xs"
        >
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
            <HardDrive className="h-4 w-4 text-primary" />
            <span>Canonical R2 Prefix:</span>
            <code className="rounded bg-surface-muted px-1.5 py-0.5 font-mono text-[11px] text-foreground">
              asdy/persistence/&lt;owner&gt;/references/
            </code>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <a
              href="#saved-titles-links"
              className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface-muted/70 px-3 py-1.5 text-xs font-semibold text-foreground transition hover:border-primary/50 hover:bg-primary-soft/40"
            >
              <Bookmark className="h-3.5 w-3.5 text-primary" />
              <span>1. Saved Titles & Links</span>
            </a>
            <a
              href="#saved-searches"
              className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface-muted/70 px-3 py-1.5 text-xs font-semibold text-foreground transition hover:border-primary/50 hover:bg-primary-soft/40"
            >
              <FileText className="h-3.5 w-3.5 text-amber-500" />
              <span>2. Saved Searches</span>
            </a>
          </div>
        </nav>

        {/* SECTION A: SAVED TITLES & REFERENCE LINKS */}
        <section id="saved-titles-links" className="scroll-mt-20 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 pb-3">
            <div className="flex items-center gap-2.5">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary-soft text-primary">
                <Bookmark className="h-4 w-4" />
              </div>
              <div>
                <h2 className="text-base font-bold tracking-tight text-foreground sm:text-lg">
                  Saved Titles & Reference Links
                </h2>
                <p className="text-xs text-muted">
                  External URLs, article links, and titled bookmarks (`SAVED_LINK` & `SAVED_TITLE`).
                </p>
              </div>
            </div>
          </div>

          <SavedTitlesLinksWorkspace />
        </section>

        {/* CLEAR VISUAL SECTION DIVIDER */}
        <div
          id="saved-searches"
          role="separator"
          aria-label="Saved Searches Section"
          className="relative my-12 flex scroll-mt-20 items-center justify-center"
        >
          <div
            aria-hidden="true"
            className="h-0.5 w-full rounded-full bg-gradient-to-r from-transparent via-primary/60 to-transparent"
          />
          <span className="absolute inline-flex items-center gap-2 rounded-full border-2 border-primary/40 bg-background px-4 py-1 text-xs font-bold tracking-wide text-primary uppercase shadow-sm">
            <FileText className="h-3.5 w-3.5" />
            <span>Saved Searches Section</span>
          </span>
        </div>

        {/* SECTION B: SAVED SEARCH PRESETS */}
        <section aria-labelledby="saved-searches-heading" className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 pb-3">
            <div className="flex items-center gap-2.5">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-500/15 text-amber-500">
                <FileText className="h-4 w-4" />
              </div>
              <div>
                <h2
                  id="saved-searches-heading"
                  className="text-base font-bold tracking-tight text-foreground sm:text-lg"
                >
                  Saved Search Presets & Pinned Queries
                </h2>
                <p className="text-xs text-muted">
                  Isolated preset shelf for reusable YouTube Discovery search queries, filters, and notes (`SAVED_SEARCH`).
                </p>
              </div>
            </div>
          </div>

          <SavedSearchesWorkspace />
        </section>
      </WorkspacePage>
    </AppShell>
  );
}
