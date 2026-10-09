"use client";

import { CheckCircle2, Database, Loader2, PlugZap, UploadCloud, XCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { authFetch } from "@/lib/client/auth-fetch";

/**
 * Storage & Migration — Blob readiness (no secret values) + one-click
 * idempotent import of legacy disk data and browser saved-search titles.
 * localStorage remains an optional cache; Blob is authoritative.
 */

interface StorageStatus {
  blob: { configured: boolean; authMode: string | null; storeIdSet: boolean };
  encryptionAvailable: boolean;
  username: string | null;
  counts: Record<string, number>;
  sessionTtlSeconds: number;
}

interface VerifyReport {
  checks: Array<{ name: string; passed: boolean; detail: string }>;
  allPassed: boolean;
  authMode: string | null;
  storeIdentity: "verified" | "unverified" | "not-checked";
  observedHost: string | null;
}

function readBrowserSavedTitles(): Array<{ id: string; title: string; query: string }> {
  try {
    const raw = localStorage.getItem("youtube-discovery-workspace");
    if (!raw) return [];
    const parsed = JSON.parse(raw) as {
      state?: { savedSearches?: Array<{ id: string; title: string; query: string }> };
    };
    const list = parsed?.state?.savedSearches;
    if (!Array.isArray(list)) return [];
    return list
      .filter((s) => s && typeof s.id === "string" && typeof s.title === "string")
      .slice(0, 200)
      .map((s) => ({ id: s.id, title: s.title, query: typeof s.query === "string" ? s.query : s.title }));
  } catch {
    return [];
  }
}

export function StorageMigrationCard() {
  const [status, setStatus] = useState<StorageStatus | null>(null);
  const [migrating, setMigrating] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [verifyReport, setVerifyReport] = useState<VerifyReport | null>(null);
  const [report, setReport] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchStatus = async () => {
    try {
      const res = await authFetch("/api/admin/storage-status");
      if (res.ok) setStatus(await res.json());
    } catch {
      // Status is informational; routes enforce strictly.
    }
  };

  /* eslint-disable react-hooks/set-state-in-effect -- Mount-only storage status */
  useEffect(() => {
    void fetchStatus();
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

  const handleVerify = async () => {
    setVerifying(true);
    setError(null);
    try {
      const res = await authFetch("/api/admin/storage-verify", { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok && !data.checks) throw new Error(data.error || "Verification failed");
      setVerifyReport(data);
      await fetchStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Verification failed");
    } finally {
      setVerifying(false);
    }
  };

  const handleMigrate = async () => {
    setMigrating(true);
    setError(null);
    setReport(null);
    try {
      const res = await authFetch("/api/admin/migrate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ savedTitles: readBrowserSavedTitles() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Migration failed");
      const fmt = (c: { imported: number; skipped: number; failed: number }) =>
        `${c.imported} imported, ${c.skipped} skipped, ${c.failed} failed`;
      setReport(
        `Playlists: ${fmt(data.playlists)} · Searches: ${fmt(data.searches)} · Keys: ${fmt(data.keys)} · ` +
          `Titles: ${data.titlesImported} imported, ${data.titlesSkipped} skipped. Disk originals left in place.`,
      );
      await fetchStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Migration failed");
    } finally {
      setMigrating(false);
    }
  };

  return (
    <Card>
      <CardHeader title="Private Blob Storage & Migration" eyebrow="Authoritative persistence" />
      <div className="space-y-3 p-4">
        <div className="flex flex-wrap gap-2 text-xs">
          <Badge tone={status?.blob.configured ? "success" : "danger"}>
            <Database className="mr-1 h-3 w-3" />
            Blob {status ? (status.blob.configured ? `connected (${status.blob.authMode})` : "NOT configured") : "…"}
          </Badge>
          <Badge tone={status?.encryptionAvailable ? "success" : "warning"}>
            Key encryption {status ? (status.encryptionAvailable ? "ready" : "UNAVAILABLE") : "…"}
          </Badge>
          {status && (
            <>
              <Badge>Playlists in Blob: {status.counts.playlists ?? 0}</Badge>
              <Badge>Saved searches in Blob: {status.counts.savedSearches ?? 0}</Badge>
              <Badge>Session TTL: {Math.round(status.sessionTtlSeconds / 86400)}d</Badge>
            </>
          )}
        </div>
        <p className="text-xs leading-relaxed text-muted">
          Playlists, saved search history (complete records), and encrypted API key settings persist in the private
          Blob store under <code className="font-mono">youtube-discovery/v1/</code> and survive redeploys. Large
          records are chunked transparently. Run migration to import legacy disk data and browser saved-search titles
          (idempotent — safe to re-run; originals are never deleted by migration).
        </p>
        {error && <p role="alert" className="rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger">{error}</p>}
        {report && (
          <p className="flex items-start gap-2 rounded-lg border border-success/40 bg-success/10 px-3 py-2 text-xs text-success">
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /> {report}
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="primary" className="h-9 gap-2 px-4 text-xs" disabled={migrating} onClick={handleMigrate}>
            {migrating ? <Loader2 className="h-4 w-4 animate-spin" /> : <UploadCloud className="h-4 w-4" />}
            {migrating ? "Migrating…" : "Migrate Legacy Data to Blob"}
          </Button>
          <Button type="button" variant="secondary" className="h-9 gap-2 px-4 text-xs" disabled={verifying} onClick={handleVerify}>
            {verifying ? <Loader2 className="h-4 w-4 animate-spin" /> : <PlugZap className="h-4 w-4" />}
            {verifying ? "Checking…" : "Run Connection Check"}
          </Button>
        </div>
        {verifyReport && (
          <div className="space-y-1.5 rounded-lg border border-border bg-surface-muted/30 p-3">
            <p className="text-xs font-semibold text-foreground">
              Connection check: {verifyReport.allPassed ? "all passed" : "issues found"}
              {" "}· store identity: {verifyReport.storeIdentity}
            </p>
            {verifyReport.checks.map((c) => (
              <p key={c.name} className="flex items-start gap-2 text-[11px] text-muted">
                {c.passed ? (
                  <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success" />
                ) : (
                  <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-danger" />
                )}
                <span>
                  <code className="font-mono font-semibold text-foreground">{c.name}</code> — {c.detail}
                </span>
              </p>
            ))}
          </div>
        )}
      </div>
    </Card>
  );
}
