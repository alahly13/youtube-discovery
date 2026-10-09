"use client";

import {
  AlertCircle,
  Check,
  CheckCircle2,
  Key,
  Loader2,
  Pencil,
  Plus,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { useEffect, useState } from "react";
import { authFetch } from "@/lib/client/auth-fetch";
import { AccountSecurityCard } from "@/components/settings/account-security";
import { KeyMetadataEditor } from "@/components/settings/key-metadata-editor";
import { QuotaDashboardCard } from "@/components/settings/quota-dashboard";
import { StorageMigrationCard } from "@/components/settings/storage-migration";
import { useYouTubeWorkspaceStore } from "@/lib/state/youtube-workspace-store";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";

export interface EnvStatus {
  youtubeApiEnabled: boolean;
  geminiApiEnabled: boolean;
  databaseEnabled: boolean;
  youtubeQuotaBudget: number;
  defaultPageSize: number;
  defaultMaxPages: number;
  defaultMaxItems: number;
}

interface SafeApiKeyItem {
  id: string;
  label: string;
  masked: string;
  source: "env" | "custom";
  isActive: boolean;
  createdAt: string;
  accountLabel?: string | null;
  projectId?: string | null;
  projectDisplayName?: string | null;
  projectAssociation?: "verified" | "declared" | "unknown";
  status?: string;
  order?: number;
}

export function SettingsClient({ envStatus }: { envStatus: EnvStatus }) {
  const watchSettings = useYouTubeWorkspaceStore((s) => s.watchSettings);
  const updateWatchSettings = useYouTubeWorkspaceStore((s) => s.updateWatchSettings);
  
  const fetchSettings = useYouTubeWorkspaceStore((s) => s.fetchSettings);
  const updateFetchSettings = useYouTubeWorkspaceStore((s) => s.updateFetchSettings);

  /* ── YouTube API Key Management State ──────────────────────────────── */
  const [apiKeys, setApiKeys] = useState<SafeApiKeyItem[]>([]);
  const [activeKey, setActiveKey] = useState<SafeApiKeyItem | null>(null);
  const [loadingKeys, setLoadingKeys] = useState(false);
  const [keyActionLoading, setKeyActionLoading] = useState<string | null>(null);
  const [newKeyLabel, setNewKeyLabel] = useState("");
  const [newKeyValue, setNewKeyValue] = useState("");
  const [newKeyAccount, setNewKeyAccount] = useState("");
  const [newKeyProject, setNewKeyProject] = useState("");
  const [newKeyProjectName, setNewKeyProjectName] = useState("");
  const [keyError, setKeyError] = useState<string | null>(null);
  const [keySuccess, setKeySuccess] = useState<string | null>(null);
  const [editingKeyId, setEditingKeyId] = useState<string | null>(null);
  const [quotaRefresh, setQuotaRefresh] = useState(0);

  const fetchKeys = async () => {
    setLoadingKeys(true);
    try {
      const res = await authFetch("/api/youtube/keys");
      if (res.ok) {
        const data = await res.json();
        setApiKeys(data.keys || []);
        setActiveKey(data.activeKey || null);
      }
    } catch {
      // Ignore network errors
    } finally {
      setLoadingKeys(false);
    }
  };

  /* eslint-disable react-hooks/set-state-in-effect -- Mount-only API key fetch */
  useEffect(() => {
    fetchKeys();
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

  const handleSelectKey = async (keyId: string) => {
    setKeyActionLoading(`select-${keyId}`);
    setKeyError(null);
    setKeySuccess(null);
    try {
      const res = await authFetch("/api/youtube/keys/select", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keyId }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Failed to select active key");
      }
      setKeySuccess("Active YouTube API key updated successfully.");
      setTimeout(() => setKeySuccess(null), 3000);
      await fetchKeys();
      setQuotaRefresh((v) => v + 1);
    } catch (err) {
      setKeyError(err instanceof Error ? err.message : "Failed to select key");
    } finally {
      setKeyActionLoading(null);
    }
  };

  const handleAddKey = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newKeyValue.trim()) return;

    setKeyActionLoading("add");
    setKeyError(null);
    setKeySuccess(null);
    try {
      const res = await authFetch("/api/youtube/keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          label: newKeyLabel.trim() || undefined,
          apiKey: newKeyValue.trim(),
          accountLabel: newKeyAccount.trim() || undefined,
          projectId: newKeyProject.trim() || undefined,
          projectDisplayName: newKeyProjectName.trim() || undefined,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Failed to add API key");
      }
      setNewKeyLabel("");
      setNewKeyValue("");
      setNewKeyAccount("");
      setNewKeyProject("");
      setNewKeyProjectName("");
      setKeySuccess("Added custom YouTube API key successfully.");
      setTimeout(() => setKeySuccess(null), 3000);
      await fetchKeys();
      setQuotaRefresh((v) => v + 1);
    } catch (err) {
      setKeyError(err instanceof Error ? err.message : "Failed to add key");
    } finally {
      setKeyActionLoading(null);
    }
  };

  const handleDeleteKey = async (keyId: string) => {
    setKeyActionLoading(`delete-${keyId}`);
    setKeyError(null);
    setKeySuccess(null);
    try {
      const res = await authFetch(`/api/youtube/keys/${encodeURIComponent(keyId)}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Failed to delete API key");
      }
      setKeySuccess("Custom API key deleted.");
      setTimeout(() => setKeySuccess(null), 3000);
      await fetchKeys();
      setQuotaRefresh((v) => v + 1);
    } catch (err) {
      setKeyError(err instanceof Error ? err.message : "Failed to delete key");
    } finally {
      setKeyActionLoading(null);
    }
  };

  const calculateQuota = () => {
    // Basic estimation: Search costs 100, plus videos.list
    const estimatedCostPerFetch = 100 + fetchSettings.pageSize;
    return Math.floor(envStatus.youtubeQuotaBudget / estimatedCostPerFetch);
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader title="Watch Experience Settings" eyebrow="Controls /watch playback behavior" />
        <div className="grid gap-3 p-4 md:grid-cols-2">
          <label className="flex items-center gap-2 text-sm">
            <input 
              type="checkbox" 
              checked={watchSettings.defaultAutoplay} 
              onChange={(e)=>updateWatchSettings({defaultAutoplay:e.target.checked})} 
              className="accent-primary"
            />
            Default autoplay
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input 
              type="checkbox" 
              checked={watchSettings.autoplayNext} 
              onChange={(e)=>updateWatchSettings({autoplayNext:e.target.checked})} 
              className="accent-primary"
            />
            Autoplay next video
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input 
              type="checkbox" 
              checked={watchSettings.showPlayerControls} 
              onChange={(e)=>updateWatchSettings({showPlayerControls:e.target.checked})} 
              className="accent-primary"
            />
            Show player controls
          </label>
        </div>
      </Card>
      
      <Card>
        <CardHeader title="YouTube Fetch Controls" eyebrow="Controls API consumption per request" />
        <div className="grid gap-4 p-4 md:grid-cols-3">
          <div>
            <label className="mb-1 block text-sm font-medium">Search Page Size</label>
            <p className="mb-2 text-xs text-muted">Number of results per API page (Default: {envStatus.defaultPageSize})</p>
            <input 
              type="number" 
              className="filter-input" 
              min={5} max={50} 
              value={fetchSettings.pageSize} 
              onChange={(e) => updateFetchSettings({ pageSize: Number(e.target.value) || 5 })}
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">Max Pages</label>
            <p className="mb-2 text-xs text-muted">Maximum pages to fetch automatically (Default: {envStatus.defaultMaxPages})</p>
            <input 
              type="number" 
              className="filter-input" 
              min={1} max={10} 
              value={fetchSettings.maxPages} 
              onChange={(e) => updateFetchSettings({ maxPages: Number(e.target.value) || 1 })}
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">Max Total Items</label>
            <p className="mb-2 text-xs text-muted">Absolute cap on fetched items (Default: {envStatus.defaultMaxItems})</p>
            <input 
              type="number" 
              className="filter-input" 
              min={50} max={500} 
              value={fetchSettings.maxItems} 
              onChange={(e) => updateFetchSettings({ maxItems: Number(e.target.value) || 50 })}
            />
          </div>
          <div className="md:col-span-3 border-t border-border/50 pt-3">
            <label className="mb-1 block text-sm font-medium">Default SafeSearch & Sensitivity Policy</label>
            <p className="mb-2 text-xs text-muted">
              Select default content filtering behavior for provider searches. <strong>None</strong> disables censorship, permitting all sensitive, mature (18+ / 35+), and unrestricted YouTube content.
            </p>
            <select 
              className="filter-input max-w-md" 
              value={fetchSettings.defaultSafeSearch ?? "none"} 
              onChange={(e) => updateFetchSettings({ defaultSafeSearch: e.target.value as "none" | "moderate" | "strict" })}
            >
              <option value="none">None (Unrestricted — Sensitive, Mature & 18+/35+ Content Allowed)</option>
              <option value="moderate">Moderate (Standard YouTube Filtering)</option>
              <option value="strict">Strict (Highest Censorship)</option>
            </select>
          </div>
        </div>
        <div className="border-t border-border bg-surface-muted p-4">
            <p className="text-sm">
              Estimated searches allowed per day with current settings: <strong>~{calculateQuota()} searches</strong> 
              <span className="text-muted ml-2">(Quota budget: {envStatus.youtubeQuotaBudget})</span>
            </p>
            {fetchSettings.pageSize * fetchSettings.maxPages > 100 && (
                <p className="mt-1 text-xs text-warning flex items-center gap-1">
                  <AlertCircle className="h-3 w-3" />
                  Warning: High limits will consume YouTube API quota quickly.
                </p>
            )}
        </div>
      </Card>

      {/* ── YouTube API Key Management Card ───────────────────────────── */}
      <Card>
        <CardHeader
          title="YouTube API Key Management"
          eyebrow="Multi-key rotation and active provider credentials"
        />
        <div className="space-y-4 p-4">
          <p className="text-xs text-muted leading-relaxed">
            Configure multiple YouTube Data API v3 keys to distribute quota usage or switch providers seamlessly.
            The environment variable <code className="font-mono text-foreground font-semibold">YOUTUBE_API_KEY</code> is always
            available as the safe default fallback. Custom keys are stored securely server-side and never exposed in plaintext to the browser.
          </p>

          {/* Active Key Status Banner */}
          {activeKey && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-primary/40 bg-primary-soft/30 p-3.5">
              <div className="flex items-center gap-2.5">
                <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary text-white">
                  <Key className="h-4 w-4" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-foreground">
                      Active Key: {activeKey.label || (activeKey.source === "env" ? "Environment Key" : "Custom Key")}
                    </span>
                    <Badge tone={activeKey.source === "env" ? "primary" : "neutral"} className="text-[10px]">
                      {activeKey.source === "env" ? "ENV Default" : "Custom"}
                    </Badge>
                  </div>
                  <span className="font-mono text-xs text-muted">
                    Masked: {activeKey.masked}
                  </span>
                </div>
              </div>
              <Badge tone="success" className="text-xs">
                <CheckCircle2 className="mr-1 h-3.5 w-3.5" /> Currently Active
              </Badge>
            </div>
          )}

          {/* Feedback messages */}
          {keyError && (
            <div className="flex items-center gap-2 rounded-lg border border-danger/40 bg-danger/10 p-3 text-xs text-danger">
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span>{keyError}</span>
            </div>
          )}
          {keySuccess && (
            <div className="flex items-center gap-2 rounded-lg border border-success/40 bg-success/10 p-3 text-xs text-success">
              <Check className="h-4 w-4 shrink-0" />
              <span>{keySuccess}</span>
            </div>
          )}

          {/* Configured Keys List */}
          <div className="space-y-2">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-muted">Configured API Keys</h4>
            {loadingKeys ? (
              <div className="flex items-center justify-center p-6 text-xs text-muted">
                <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading API keys…
              </div>
            ) : apiKeys.length === 0 ? (
              <p className="text-xs text-muted">No API keys registered.</p>
            ) : (
              <div className="divide-y divide-border/60 rounded-lg border border-border bg-surface">
                {apiKeys.map((k) => (
                  <div key={k.id}>
                  <div className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="space-y-0.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-xs font-medium text-foreground">{k.label}</span>
                        <Badge tone={k.source === "env" ? "primary" : "neutral"} className="text-[10px]">
                          {k.source === "env" ? "ENV" : "Custom"}
                        </Badge>
                        {k.isActive && (
                          <span className="inline-flex items-center rounded-full bg-success/15 px-2 py-0.5 text-[10px] font-semibold text-success">
                            Active
                          </span>
                        )}
                        {k.source === "custom" && k.projectAssociation === "verified" && (
                          <Badge tone="success" className="text-[10px]">Verified pool</Badge>
                        )}
                        {k.source === "custom" && k.projectAssociation === "declared" && (
                          <Badge tone="warning" className="text-[10px]">Declared (unverified)</Badge>
                        )}
                      </div>
                      <p className="font-mono text-[11px] text-muted">{k.masked}</p>
                      {k.source === "custom" && (k.accountLabel || k.projectId) && (
                        <p className="text-[11px] text-muted">
                          {k.accountLabel && <span>{k.accountLabel}</span>}
                          {k.accountLabel && k.projectId && <span> · </span>}
                          {k.projectId && <span className="font-mono">{k.projectId}</span>}
                          {k.projectDisplayName && <span> ({k.projectDisplayName})</span>}
                        </p>
                      )}
                    </div>

                    <div className="flex items-center gap-2 self-end sm:self-auto">
                      {!k.isActive ? (
                        <Button
                          type="button"
                          variant="secondary"
                          className="h-7 px-2.5 text-xs"
                          disabled={keyActionLoading !== null}
                          onClick={() => handleSelectKey(k.id)}
                        >
                          {keyActionLoading === `select-${k.id}` ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            "Use this key"
                          )}
                        </Button>
                      ) : (
                        <span className="text-[11px] font-medium text-success flex items-center gap-1">
                          <Check className="h-3.5 w-3.5" /> In Use
                        </span>
                      )}

                      {k.source === "custom" && (
                        <>
                          <Button
                            type="button"
                            variant="ghost"
                            className="h-7 w-7 p-0 text-muted hover:text-foreground"
                            disabled={keyActionLoading !== null}
                            onClick={() => setEditingKeyId(editingKeyId === k.id ? null : k.id)}
                            title="Edit key labels and project association"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            className="h-7 w-7 p-0 text-muted hover:text-danger hover:bg-danger/10"
                            disabled={keyActionLoading !== null}
                            onClick={() => handleDeleteKey(k.id)}
                            title="Delete this custom API key"
                          >
                            {keyActionLoading === `delete-${k.id}` ? (
                              <Loader2 className="h-3 w-3 animate-spin" />
                            ) : (
                              <Trash2 className="h-3.5 w-3.5" />
                            )}
                          </Button>
                        </>
                      )}
                    </div>
                  </div>
                  {editingKeyId === k.id && k.source === "custom" && (
                    <div className="border-t border-border/60 p-3">
                      <KeyMetadataEditor
                        initial={{
                          id: k.id,
                          label: k.label,
                          accountLabel: k.accountLabel,
                          projectId: k.projectId,
                          projectDisplayName: k.projectDisplayName,
                          enabled: k.status !== "disabled",
                          status: k.status ?? "available",
                          order: k.order,
                        }}
                        onCancel={() => setEditingKeyId(null)}
                        onSaved={() => {
                          setEditingKeyId(null);
                          void fetchKeys();
                          setQuotaRefresh((v) => v + 1);
                        }}
                      />
                    </div>
                  )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Add New Key Form */}
          <div className="rounded-lg border border-border/80 bg-surface-muted/30 p-3.5">
            <h4 className="mb-2 text-xs font-semibold text-foreground flex items-center gap-1.5">
              <Plus className="h-3.5 w-3.5 text-primary" />
              Add Custom YouTube API Key
            </h4>
            <form onSubmit={handleAddKey} className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-[11px] font-medium text-muted">
                    Key Label / Description <span className="text-danger">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Backup Key 2, Client Quota Key"
                    value={newKeyLabel}
                    onChange={(e) => setNewKeyLabel(e.target.value)}
                    className="filter-input text-xs"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-[11px] font-medium text-muted">
                    API Key Value <span className="text-danger">*</span>
                  </label>
                  <input
                    type="password"
                    required
                    placeholder="AIzaSy..."
                    value={newKeyValue}
                    onChange={(e) => setNewKeyValue(e.target.value)}
                    className="filter-input text-xs font-mono"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-[11px] font-medium text-muted">
                    Gmail / Account Label (optional)
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. Gmail Account 1"
                    value={newKeyAccount}
                    onChange={(e) => setNewKeyAccount(e.target.value)}
                    className="filter-input text-xs"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-[11px] font-medium text-muted">
                    Google Cloud Project ID (optional)
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. my-yt-project-123456"
                    value={newKeyProject}
                    onChange={(e) => setNewKeyProject(e.target.value)}
                    className="filter-input font-mono text-xs"
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="mb-1 block text-[11px] font-medium text-muted">
                    Project Display Name (optional)
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. Main Research Project"
                    value={newKeyProjectName}
                    onChange={(e) => setNewKeyProjectName(e.target.value)}
                    className="filter-input text-xs"
                  />
                </div>
              </div>
              <div className="flex items-center justify-between pt-1">
                <span className="text-[11px] text-muted flex items-center gap-1">
                  <ShieldCheck className="h-3.5 w-3.5 text-success" />
                  Preserved server-side only. Masked upon save.
                </span>
                <Button
                  type="submit"
                  variant="primary"
                  className="h-8 gap-1.5 px-3 text-xs"
                  disabled={keyActionLoading === "add" || !newKeyValue.trim()}
                >
                  {keyActionLoading === "add" ? (
                    <>
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      <span>Saving…</span>
                    </>
                  ) : (
                    <>
                      <Plus className="h-3.5 w-3.5" />
                      <span>Add Key</span>
                    </>
                  )}
                </Button>
              </div>
            </form>
          </div>
        </div>
      </Card>

      {/* ── Quota Pools & Usage (per-project monitoring) ──────────── */}
      <QuotaDashboardCard refreshToken={quotaRefresh} />

      {/* ── Private Blob Storage & Migration ──────────────────────── */}
      <StorageMigrationCard />

      {/* ── Account Security (single administrator) ─────────────────── */}
      <AccountSecurityCard />

      <Card>
        <CardHeader title="Environment & API Status" eyebrow="Server-side integrations" />
        <div className="space-y-3 p-4">
          <div className="flex items-center justify-between border-b border-border pb-3">
             <div>
                <p className="text-sm font-medium">YouTube Data API v3</p>
                <p className="text-xs text-muted">Required for fetching real metadata.</p>
             </div>
             {envStatus.youtubeApiEnabled ? (
               <Badge tone="success"><CheckCircle2 className="mr-1 h-3 w-3"/> Connected</Badge>
             ) : (
               <Badge tone="danger"><AlertCircle className="mr-1 h-3 w-3"/> Missing</Badge>
             )}
          </div>
          <div className="flex items-center justify-between border-b border-border pb-3">
             <div>
                <p className="text-sm font-medium">Gemini API</p>
                <p className="text-xs text-muted">Required for AI analysis features.</p>
             </div>
             {envStatus.geminiApiEnabled ? (
               <Badge tone="success"><CheckCircle2 className="mr-1 h-3 w-3"/> Connected</Badge>
             ) : (
               <Badge tone="danger"><AlertCircle className="mr-1 h-3 w-3"/> Missing</Badge>
             )}
          </div>
          <div className="flex items-center justify-between">
             <div>
                <p className="text-sm font-medium">PostgreSQL Database (Prisma)</p>
                <p className="text-xs text-muted">Required for durable persistence.</p>
             </div>
             {envStatus.databaseEnabled ? (
               <Badge tone="success"><CheckCircle2 className="mr-1 h-3 w-3"/> Configured</Badge>
             ) : (
               <Badge tone="warning"><AlertCircle className="mr-1 h-3 w-3"/> Runtime only</Badge>
             )}
          </div>
        </div>
      </Card>
    </div>
  );
}
