"use client";

import {
  AlertCircle,
  Archive,
  ArrowLeft,
  CheckCircle2,
  Eye,
  FileCode,
  Filter,
  HardDrive,
  Layers,
  Loader2,
  RefreshCw,
  Search,
  Sparkles,
  Upload,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button, ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { RawJsonInspectorDialog } from "@/components/saved/raw-json-inspector-dialog";
import { formatBytes, formatDate } from "@/lib/utils/format";
import type { ArchivedManifestRecord } from "@/lib/old/archive-store";

interface ManifestItem {
  id?: string;
  title?: string;
  channelTitle?: string;
  itemType?: string;
  publishedAt?: string;
  [key: string]: unknown;
}

export function ManifestViewerWorkspace() {
  const [manifests, setManifests] = useState<ArchivedManifestRecord[]>([]);
  const [selectedManifestId, setSelectedManifestId] = useState<string>("");
  const [manifestData, setManifestData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [loadingContent, setLoadingContent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<string>("ALL");
  const [inspectedItem, setInspectedItem] = useState<unknown | null>(null);

  // Load list of registered manifests
  const loadManifestList = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/old/list");
      if (!res.ok) throw new Error("Failed to load registered manifests.");
      const data = await res.json();
      const list = data.manifests || [];
      setManifests(list);
      if (list.length > 0 && !selectedManifestId) {
        setSelectedManifestId(list[0].id);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load manifests.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadManifestList();
  }, []);

  // Fetch full manifest content when selection changes
  useEffect(() => {
    if (!selectedManifestId) {
      setManifestData(null);
      return;
    }

    async function loadContent() {
      setLoadingContent(true);
      setError(null);
      try {
        const res = await fetch(`/api/old/${selectedManifestId}`);
        if (!res.ok) throw new Error("Failed to load manifest content.");
        const data = await res.json();
        setManifestData(data.envelope || null);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Error reading manifest.");
      } finally {
        setLoadingContent(false);
      }
    }

    void loadContent();
  }, [selectedManifestId]);

  // Client-side local file inspection
  const handleLocalFileLoad = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const file = e.target.files[0];
      const reader = new FileReader();
      reader.onload = (event) => {
        try {
          const content = event.target?.result as string;
          const parsed = JSON.parse(content);
          setManifestData({
            schema_version: parsed.schema_version || "local",
            manifest_metadata: {
              manifest_id: file.name,
              category: "local-inspection",
              source_format: "local_file",
              byte_count: file.size,
              record_count: Array.isArray(parsed.items) ? parsed.items.length : Array.isArray(parsed) ? parsed.length : 1,
              content_sha256: "client-computed",
            },
            payload: {
              items: Array.isArray(parsed.items) ? parsed.items : Array.isArray(parsed) ? parsed : [parsed],
            },
          });
          setSelectedManifestId("LOCAL_FILE");
        } catch {
          setError("Failed to parse local JSON file.");
        }
      };
      reader.readAsText(file);
    }
  };

  // Filter items by search query and type
  const items: ManifestItem[] = manifestData?.payload?.items || [];
  const filteredItems = useMemo(() => {
    return items.filter((item) => {
      // Type filter
      if (typeFilter !== "ALL") {
        const t = String(item.itemType || item.type || "").toUpperCase();
        if (typeFilter === "SHORTS" && !t.includes("SHORT")) return false;
        if (typeFilter === "VIDEO" && t.includes("SHORT")) return false;
        if (typeFilter === "CHANNELS" && !t.includes("CHANNEL")) return false;
        if (typeFilter === "PLAYLISTS" && !t.includes("PLAYLIST")) return false;
      }

      // Search filter
      if (!searchQuery.trim()) return true;
      const q = searchQuery.toLowerCase();
      const title = String(item.title || item.name || "").toLowerCase();
      const channel = String(item.channelTitle || "").toLowerCase();
      return title.includes(q) || channel.includes(q) || JSON.stringify(item).toLowerCase().includes(q);
    });
  }, [items, searchQuery, typeFilter]);

  return (
    <div className="space-y-6">
      {/* Workspace Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between border-b border-border/80 pb-5">
        <div>
          <div className="flex items-center gap-2 mb-1.5">
            <Badge tone="ai" className="text-[10px] uppercase font-bold tracking-wider">
              100% READ-ONLY VIEWER
            </Badge>
            <Badge tone="success" className="text-[10px] font-semibold">
              Zero Storage Mutation
            </Badge>
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground flex items-center gap-2.5">
            <Eye className="h-6 w-6 text-primary" />
            <span>Manifest Viewer & Inspector</span>
          </h1>
          <p className="mt-1 text-xs text-muted max-w-2xl leading-relaxed">
            Inspect the exact payload, provenance metadata, items, and cryptographic digests of registered
            manifests or local files without altering storage or database state.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <label htmlFor="local-file-inspect">
            <Button
              type="button"
              variant="secondary"
              className="h-9 gap-1.5 px-3 text-xs pointer-events-none"
            >
              <Upload className="h-3.5 w-3.5" />
              <span>Inspect Local File…</span>
            </Button>
          </label>
          <input
            id="local-file-inspect"
            type="file"
            accept=".json,.ndjson"
            onChange={handleLocalFileLoad}
            className="hidden"
          />

          <ButtonLink href="/manifests/upload" variant="primary" className="h-9 gap-1.5 px-3.5 text-xs">
            <Upload className="h-4 w-4" />
            <span>Upload Manifest</span>
          </ButtonLink>
        </div>
      </div>

      {/* Manifest Selector & Metadata Bar */}
      <Card className="p-4 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="space-y-1">
            <label className="text-xs font-semibold text-foreground">
              Selected Manifest:
            </label>
            <select
              value={selectedManifestId}
              onChange={(e) => setSelectedManifestId(e.target.value)}
              className="h-9 rounded-lg border border-border bg-surface px-3 text-xs text-foreground focus:outline-hidden focus:ring-1 focus:ring-primary min-w-[280px]"
            >
              {selectedManifestId === "LOCAL_FILE" && (
                <option value="LOCAL_FILE">Local File (Client-Inspected)</option>
              )}
              {manifests.length === 0 && selectedManifestId !== "LOCAL_FILE" && (
                <option value="">No registered manifests found</option>
              )}
              {manifests.map((m) => (
                <option key={m.id} value={m.id}>
                  [{m.category}] {m.manifest_id} ({m.record_count} items)
                </option>
              ))}
            </select>
          </div>

          {Boolean(manifestData?.manifest_metadata) && (
            <div className="flex flex-wrap items-center gap-3 text-xs font-mono">
              <Badge tone="neutral">
                {String(manifestData.manifest_metadata.record_count)} records
              </Badge>
              <Badge tone="neutral">
                {formatBytes(manifestData.manifest_metadata.byte_count)}
              </Badge>
              <Badge tone="ai">
                {String(manifestData.manifest_metadata.category)}
              </Badge>
            </div>
          )}
        </div>

        {/* Provenance Metadata Drawer */}
        {Boolean(manifestData?.manifest_metadata) && (
          <div className="rounded-xl border border-border/70 bg-surface-muted/30 p-3.5 text-xs space-y-1 font-mono text-muted">
            <p><strong>Storage Path:</strong> <span className="text-primary">{String(manifestData.manifest_metadata.storage_path || `asdy/old/${manifestData.manifest_metadata.category}/${manifestData.manifest_metadata.manifest_id}/manifest.json`)}</span></p>
            <p className="truncate"><strong>SHA-256:</strong> {String(manifestData.manifest_metadata.content_sha256)}</p>
            {manifestData.manifest_metadata.source_created_at ? (
              <p><strong>Historical Created At:</strong> {String(manifestData.manifest_metadata.source_created_at)}</p>
            ) : null}
          </div>
        )}
      </Card>

      {/* Filter and Search Bar */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
        <div className="relative flex-1 w-full">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search within manifest records…"
            className="w-full h-9 pl-9 pr-3 rounded-lg border border-border bg-surface text-xs text-foreground placeholder:text-muted focus:outline-hidden focus:ring-1 focus:ring-primary"
          />
        </div>

        <div className="flex items-center gap-1.5 self-start sm:self-auto">
          {["ALL", "VIDEO", "SHORTS", "CHANNELS", "PLAYLISTS"].map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTypeFilter(t)}
              className={`h-8 px-2.5 rounded-lg text-xs font-semibold transition ${
                typeFilter === t
                  ? "bg-primary text-white"
                  : "bg-surface-muted/60 text-muted hover:text-foreground"
              }`}
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      {/* Items Display Grid */}
      {loadingContent ? (
        <div className="flex flex-col items-center justify-center p-12 text-center text-xs text-muted">
          <Loader2 className="h-6 w-6 animate-spin text-primary mb-2" />
          <span>Loading manifest items…</span>
        </div>
      ) : filteredItems.length === 0 ? (
        <Card className="p-10 text-center space-y-2 text-xs text-muted">
          <p className="font-semibold text-foreground">No items to display</p>
          <p>Select a manifest from the dropdown or inspect a local file.</p>
        </Card>
      ) : (
        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs text-muted px-1">
            <span>Showing {filteredItems.length} of {items.length} items</span>
          </div>

          <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
            {filteredItems.map((item, idx) => {
              const title = item.title || item.name || `Item #${idx + 1}`;
              const channel = item.channelTitle || item.channel || item.owner || "";
              const itemType = item.itemType || item.type || "ITEM";

              return (
                <Card
                  key={idx}
                  className="p-4 flex flex-col justify-between hover:border-border transition space-y-3"
                >
                  <div className="space-y-1">
                    <div className="flex items-center justify-between">
                      <Badge tone="neutral" className="text-[10px] uppercase font-bold font-mono">
                        {String(itemType)}
                      </Badge>
                      <button
                        type="button"
                        onClick={() => setInspectedItem(item)}
                        className="text-[11px] text-primary hover:underline font-mono"
                      >
                        Inspect Raw
                      </button>
                    </div>
                    <h3 className="text-xs font-bold text-foreground line-clamp-2 pt-1" title={String(title)}>
                      {String(title)}
                    </h3>
                    {Boolean(channel) && (
                      <p className="text-[11px] text-muted truncate">{String(channel)}</p>
                    )}
                  </div>

                  <div className="pt-2 border-t border-border/50 text-[10px] text-muted flex items-center justify-between">
                    <span>Index: #{idx + 1}</span>
                    {Boolean(item.publishedAt) && <span>{String(item.publishedAt).slice(0, 10)}</span>}
                  </div>
                </Card>
              );
            })}
          </div>
        </div>
      )}

      {/* Raw JSON Modal */}
      {Boolean(inspectedItem) && (
        <RawJsonInspectorDialog
          item={inspectedItem}
          open={Boolean(inspectedItem)}
          onClose={() => setInspectedItem(null)}
          title="Manifest Record Inspector"
        />
      )}
    </div>
  );
}
