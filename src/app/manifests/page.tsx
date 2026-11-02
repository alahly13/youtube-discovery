"use client";

import { Archive, HardDrive, Layers } from "lucide-react";
import { useState } from "react";
import { AppShell } from "@/components/layout/app-shell";
import { WorkspacePage } from "@/components/pages/workspace-page";
import { ManifestStorageExplorer } from "@/components/manifests/manifest-storage-explorer";
import { ManifestListWorkspace } from "@/components/manifests/manifest-list-workspace";

/* ═══════════════════════════════════════════════════════════════════════════
   Manifest Storage Explorer & Manifest Library Page — /manifests
   ──────────────────────────────────────────────────────────────────────────
   Dual-layer architecture inspection tool:
     1. Physical Storage Explorer: Authoritative PostgreSQL registry and
        physical immutable Supabase Storage parts, with real-time 6-state
        reconciliation, downloads, and generation ZIP exports.
     2. Runtime Manifests: In-memory provider fetch snapshots.
   ═══════════════════════════════════════════════════════════════════════════ */

export default function ManifestsPage() {
  const [activeTab, setActiveTab] = useState<"storage" | "runtime">("storage");

  return (
    <AppShell>
      <WorkspacePage
        icon={Archive}
        eyebrow="Manifest Storage Explorer"
        title="Physical Storage & Manifest Registry"
        description="Dual-layer inspection workbench: PostgreSQL serves as the authoritative transactional registry while Supabase Storage holds physical immutable JSON manifest parts. Inspect generations, verify hashes, and reconcile storage health."
      >
        <div className="space-y-6">
          {/* View Mode Toggle */}
          <div className="flex border-b border-border/80">
            <button
              type="button"
              onClick={() => setActiveTab("storage")}
              className={`flex items-center gap-2 border-b-2 px-4 py-2.5 text-xs font-semibold transition ${
                activeTab === "storage"
                  ? "border-primary text-primary"
                  : "border-transparent text-muted hover:text-foreground"
              }`}
            >
              <HardDrive className="h-4 w-4" />
              Physical Storage Explorer
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("runtime")}
              className={`flex items-center gap-2 border-b-2 px-4 py-2.5 text-xs font-semibold transition ${
                activeTab === "runtime"
                  ? "border-primary text-primary"
                  : "border-transparent text-muted hover:text-foreground"
              }`}
            >
              <Layers className="h-4 w-4" />
              Runtime Fetch Manifests
            </button>
          </div>

          {/* Active Workspace View */}
          {activeTab === "storage" ? (
            <ManifestStorageExplorer />
          ) : (
            <ManifestListWorkspace />
          )}
        </div>
      </WorkspacePage>
    </AppShell>
  );
}
