import { Suspense } from "react";
import { AppShell } from "@/components/layout/app-shell";
import { SearchWorkspace } from "@/components/search/search-workspace";

export default function SearchPage() {
  return (
    <AppShell>
      <Suspense fallback={<div className="p-8 text-center text-sm text-muted">Loading search workspace…</div>}>
        <SearchWorkspace />
      </Suspense>
    </AppShell>
  );
}

