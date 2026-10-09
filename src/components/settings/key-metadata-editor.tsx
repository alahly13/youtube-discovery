"use client";

import { Check, Loader2, X } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { authFetch } from "@/lib/client/auth-fetch";

/**
 * Per-key metadata editor: Gmail/account label, Google Cloud project
 * association, display name, enabled state, rotation priority. Key VALUES
 * are never shown or edited here (add a new key to rotate secrets).
 */

export interface KeyEditInitial {
  id: string;
  label: string;
  accountLabel?: string | null;
  projectId?: string | null;
  projectDisplayName?: string | null;
  enabled: boolean;
  status: string;
  order?: number;
}

export function KeyMetadataEditor({
  initial,
  onSaved,
  onCancel,
}: {
  initial: KeyEditInitial;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const disabled = initial.status === "disabled" ? false : initial.enabled;
  const [label, setLabel] = useState(initial.label);
  const [accountLabel, setAccountLabel] = useState(initial.accountLabel ?? "");
  const [projectId, setProjectId] = useState(initial.projectId ?? "");
  const [projectDisplayName, setProjectDisplayName] = useState(initial.projectDisplayName ?? "");
  const [enabled, setEnabled] = useState(disabled);
  const [order, setOrder] = useState(String(initial.order ?? 0));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await authFetch(`/api/youtube/keys/${encodeURIComponent(initial.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          label: label.trim(),
          accountLabel: accountLabel.trim() || null,
          projectId: projectId.trim() || null,
          projectDisplayName: projectDisplayName.trim() || null,
          enabled,
          order: Number(order) || 0,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Failed to save key settings");
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save key settings");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-lg border border-primary/30 bg-primary-soft/20 p-3.5">
      <div className="grid gap-2.5 sm:grid-cols-2">
        <div>
          <label className="mb-1 block text-[11px] font-medium text-muted">Key name</label>
          <input type="text" value={label} onChange={(e) => setLabel(e.target.value)} className="filter-input text-xs" />
        </div>
        <div>
          <label className="mb-1 block text-[11px] font-medium text-muted">Gmail / account label (e.g. Gmail Account 1)</label>
          <input
            type="text"
            value={accountLabel}
            onChange={(e) => setAccountLabel(e.target.value)}
            placeholder="Optional — labels only, never a password"
            className="filter-input text-xs"
          />
        </div>
        <div>
          <label className="mb-1 block text-[11px] font-medium text-muted">Google Cloud project ID</label>
          <input
            type="text"
            value={projectId}
            onChange={(e) => setProjectId(e.target.value)}
            placeholder="e.g. my-yt-project-123456"
            className="filter-input font-mono text-xs"
          />
        </div>
        <div>
          <label className="mb-1 block text-[11px] font-medium text-muted">Project display name (optional)</label>
          <input
            type="text"
            value={projectDisplayName}
            onChange={(e) => setProjectDisplayName(e.target.value)}
            placeholder="e.g. Main Research Project"
            className="filter-input text-xs"
          />
        </div>
        <label className="flex items-center gap-2 text-xs">
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} className="accent-primary" />
          Enabled for rotation
        </label>
        <div>
          <label className="mb-1 block text-[11px] font-medium text-muted">Rotation priority (lower runs first)</label>
          <input
            type="number"
            min={0}
            max={1000}
            value={order}
            onChange={(e) => setOrder(e.target.value)}
            className="filter-input text-xs"
          />
        </div>
      </div>
      <p className="mt-2 text-[11px] text-muted">
        A manually entered project ID is labeled <strong>admin-declared</strong> until the app observes correlated
        quota behavior proving shared quota (<strong>verified</strong>). Gmail labels never establish project ownership.
      </p>
      {error && <p role="alert" className="mt-2 rounded-md border border-danger/40 bg-danger/10 px-2 py-1 text-[11px] text-danger">{error}</p>}
      <div className="mt-2.5 flex justify-end gap-2">
        <Button type="button" variant="ghost" className="h-8 px-3 text-xs" onClick={onCancel}>
          <X className="h-3.5 w-3.5" /> Cancel
        </Button>
        <Button type="button" variant="primary" className="h-8 px-3 text-xs" disabled={saving || !label.trim()} onClick={handleSave}>
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
          Save
        </Button>
      </div>
    </div>
  );
}
