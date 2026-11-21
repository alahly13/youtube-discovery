import { BookmarkCheck } from "lucide-react";
import { AppShell } from "@/components/layout/app-shell";
import { WorkspacePage } from "@/components/pages/workspace-page";
import { SavedItemsWorkspace } from "@/components/saved/saved-items-workspace";

/* ═══════════════════════════════════════════════════════════════════════════
   Dedicated Saved Items Workspace — /ssaved (2026 Production)
   ──────────────────────────────────────────────────────────────────────────
   Authoritative unified library for saved YouTube entities (Videos, Channels,
   Playlists). Fully synchronized across Local Browser storage and Cloudflare R2
   (New Bucket) with Supabase PostgreSQL audit synchronization.

   Features 3 distinct persistence states:
     1. NEWLY ADDED — LOCAL BROWSER (LOCAL_ONLY)
     2. LOCAL + R2 CLOUD (LOCAL_AND_CLOUD — Synchronization Recovery)
     3. FROM R2 CLOUD — COMPLETE ARCHIVE (CLOUD_ONLY)
   ═══════════════════════════════════════════════════════════════════════════ */

export default function SSavedPage() {
  return (
    <AppShell>
      <WorkspacePage
        icon={BookmarkCheck}
        eyebrow="My Library"
        title="Saved Items"
        description="Unified workspace for your saved YouTube videos, channels, and playlists. Fully synchronized across local browser storage and Cloudflare R2 authoritative archive."
      >
        <SavedItemsWorkspace />
      </WorkspacePage>
    </AppShell>
  );
}
