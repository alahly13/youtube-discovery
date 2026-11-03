"use client";

import {
  AlertCircle,
  Archive,
  ArrowRight,
  Bookmark,
  BookmarkCheck,
  CheckCircle2,
  Database,
  FileCode,
  HardDrive,
  History,
  Layers,
  ListVideo,
  Loader2,
  Lock,
  Plus,
  ShieldCheck,
  Upload,
} from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button, ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { formatBytes } from "@/lib/utils/format";

type UploadDestination = "OLD" | "NEW";
type OldCategory = "saved-items" | "saved-playlists" | "saved-titles-links" | "saved-search-history";
type DatasetType = "SAVED_VIDEOS" | "SAVED_PLAYLISTS" | "SAVED_SEARCHES" | "SEARCH_HISTORY";

const OLD_CATEGORIES: Array<{
  id: OldCategory;
  title: string;
  prefix: string;
  icon: React.ComponentType<{ className?: string }>;
  description: string;
}> = [
  {
    id: "saved-items",
    title: "OLD Saved Items",
    prefix: "asdy/old/saved-items/",
    icon: BookmarkCheck,
    description: "Historical saved videos, shorts, channels, and playlists.",
  },
  {
    id: "saved-playlists",
    title: "OLD Saved Playlists",
    prefix: "asdy/old/saved-playlists/",
    icon: ListVideo,
    description: "Historical user playlists, curated groups, and entries.",
  },
  {
    id: "saved-titles-links",
    title: "OLD Saved Titles & Links",
    prefix: "asdy/old/saved-titles-links/",
    icon: Bookmark,
    description: "Historical query titles, presets, research queries, and reference links.",
  },
  {
    id: "saved-search-history",
    title: "OLD Saved Search History",
    prefix: "asdy/old/saved-search-history/",
    icon: History,
    description: "Historical search queries, execution records, and manifest IDs.",
  },
];

const DATASET_TYPES: Array<{ id: DatasetType; label: string; description: string }> = [
  { id: "SAVED_VIDEOS", label: "Saved Videos (Active)", description: "Saved videos and personal library entities." },
  { id: "SAVED_PLAYLISTS", label: "User Playlists (Active)", description: "Personal playlists, groups, and video ordering." },
  { id: "SAVED_SEARCHES", label: "Saved Searches (Active)", description: "Pinned queries, presets, and research phrases." },
  { id: "SEARCH_HISTORY", label: "Search History (Active)", description: "Chronological search query audit logs." },
];

export function ManifestUploadWorkspace() {
  const [destination, setDestination] = useState<UploadDestination>("OLD");
  const [oldCategory, setOldCategory] = useState<OldCategory>("saved-items");
  const [datasetType, setDatasetType] = useState<DatasetType>("SAVED_VIDEOS");
  const [datasetName, setDatasetName] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploadResult, setUploadResult] = useState<{
    ok: boolean;
    destination: string;
    bucket: string;
    storagePath: string;
    byteCount: number;
    recordCount: number;
    sha256: string;
    manifestId?: string;
    category?: string;
    generationNumber?: number;
  } | null>(null);

  // Derive calculated target destination path preview
  const derivedOldPath = selectedFile
    ? `asdy/old/${oldCategory}/<unique-manifest-id>/${selectedFile.name.endsWith(".json") ? "manifest.json" : selectedFile.name}`
    : `asdy/old/${oldCategory}/<unique-manifest-id>/manifest.json`;

  const derivedNewPath = `<storage_owner_uuid>/persistence/datasets/<dataset-id>/generations/<gen-id>/parts/part-000001.json`;

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setError(null);
    setUploadResult(null);
    if (e.target.files && e.target.files.length > 0) {
      const f = e.target.files[0];
      setSelectedFile(f);
    }
  };

  const handleUpload = async () => {
    if (!selectedFile) {
      setError("Please select a manifest file first.");
      return;
    }

    setUploading(true);
    setError(null);
    setUploadResult(null);

    try {
      const formData = new FormData();
      formData.append("file", selectedFile);
      formData.append("destination", destination);

      if (destination === "OLD") {
        formData.append("category", oldCategory);
      } else {
        formData.append("datasetType", datasetType);
        if (datasetName.trim()) {
          formData.append("datasetName", datasetName.trim());
        }
      }

      const res = await fetch("/api/manifests/upload", {
        method: "POST",
        body: formData,
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || `Upload failed with HTTP ${res.status}.`);
      }

      setUploadResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Manifest upload failed.");
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="space-y-8 max-w-4xl mx-auto">
      {/* Workspace Header */}
      <div className="border-b border-border/80 pb-5">
        <div className="flex items-center gap-2 mb-2">
          <Badge tone="primary" className="text-[10px] uppercase font-bold tracking-wider">
            STORAGE ROUTER
          </Badge>
          <Badge tone="success" className="text-[10px] font-semibold">
            Strict Bucket Separation
          </Badge>
        </div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground flex items-center gap-2.5">
          <Upload className="h-6 w-6 text-primary" />
          <span>Upload Manifest to Storage</span>
        </h1>
        <p className="mt-1 text-xs text-muted leading-relaxed">
          Upload and verify manifest archives into the dedicated private storage buckets. Choose between the
          isolated historical OLD bucket or the active generational NEW bucket.
        </p>
      </div>

      {/* STEP 1: Storage Destination Choice */}
      <div className="space-y-3">
        <label className="text-xs font-bold uppercase tracking-wider text-muted">
          1. Choose Storage Destination Bucket
        </label>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {/* OLD Bucket Choice */}
          <button
            type="button"
            onClick={() => {
              setDestination("OLD");
              setError(null);
              setUploadResult(null);
            }}
            className={`text-left p-5 rounded-2xl border transition-all ${
              destination === "OLD"
                ? "border-primary bg-primary-soft/40 shadow-xs ring-1 ring-primary"
                : "border-border/80 bg-surface hover:bg-surface-muted/50"
            }`}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  <Archive className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-foreground">OLD Bucket</h3>
                  <code className="text-[11px] font-mono text-primary">old-youtube-discovery-private</code>
                </div>
              </div>
              <Badge tone="ai" className="font-mono text-[10px]">asdy/old/</Badge>
            </div>
            <p className="mt-3 text-xs text-muted leading-relaxed">
              Historical manifests, recovered browser data, and legacy archives. Strictly isolated from active application tables.
            </p>
          </button>

          {/* NEW Bucket Choice */}
          <button
            type="button"
            onClick={() => {
              setDestination("NEW");
              setError(null);
              setUploadResult(null);
            }}
            className={`text-left p-5 rounded-2xl border transition-all ${
              destination === "NEW"
                ? "border-primary bg-primary-soft/40 shadow-xs ring-1 ring-primary"
                : "border-border/80 bg-surface hover:bg-surface-muted/50"
            }`}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                  <HardDrive className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-foreground">NEW Bucket</h3>
                  <code className="text-[11px] font-mono text-emerald-600 dark:text-emerald-400">new-youtube-discovery-private</code>
                </div>
              </div>
              <Badge tone="success" className="font-mono text-[10px]">persistence/</Badge>
            </div>
            <p className="mt-3 text-xs text-muted leading-relaxed">
              Active application datasets, generational parts, and verified sync batches. Enforces revision consistency.
            </p>
          </button>
        </div>
      </div>

      {/* STEP 2: Category Selector (When OLD selected) */}
      {destination === "OLD" && (
        <div className="space-y-3">
          <label className="text-xs font-bold uppercase tracking-wider text-muted">
            2. Select Exact OLD Archive Category
          </label>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {OLD_CATEGORIES.map((cat) => {
              const Icon = cat.icon;
              const isSelected = oldCategory === cat.id;
              return (
                <button
                  key={cat.id}
                  type="button"
                  onClick={() => setOldCategory(cat.id)}
                  className={`text-left p-4 rounded-xl border transition-all ${
                    isSelected
                      ? "border-primary bg-primary-soft/30 ring-1 ring-primary"
                      : "border-border/70 bg-surface hover:bg-surface-muted/40"
                  }`}
                >
                  <div className="flex items-center gap-2.5 mb-1.5">
                    <Icon className="h-4 w-4 text-primary" />
                    <span className="text-xs font-bold text-foreground">{cat.title}</span>
                  </div>
                  <code className="block font-mono text-[11px] text-primary/80 mb-1">
                    {cat.prefix}
                  </code>
                  <p className="text-[11px] text-muted line-clamp-2 leading-relaxed">
                    {cat.description}
                  </p>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* STEP 2: Dataset Selector (When NEW selected) */}
      {destination === "NEW" && (
        <div className="space-y-4">
          <label className="text-xs font-bold uppercase tracking-wider text-muted">
            2. Select Application Dataset Type
          </label>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {DATASET_TYPES.map((dt) => {
              const isSelected = datasetType === dt.id;
              return (
                <button
                  key={dt.id}
                  type="button"
                  onClick={() => setDatasetType(dt.id)}
                  className={`text-left p-4 rounded-xl border transition-all ${
                    isSelected
                      ? "border-emerald-500 bg-emerald-500/10 ring-1 ring-emerald-500"
                      : "border-border/70 bg-surface hover:bg-surface-muted/40"
                  }`}
                >
                  <span className="text-xs font-bold text-foreground block mb-1">{dt.label}</span>
                  <p className="text-[11px] text-muted">{dt.description}</p>
                </button>
              );
            })}
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-foreground">
              Optional Dataset Display Name
            </label>
            <input
              type="text"
              value={datasetName}
              onChange={(e) => setDatasetName(e.target.value)}
              placeholder={`e.g. Production-${datasetType}`}
              className="w-full h-9 rounded-lg border border-border bg-surface px-3 text-xs text-foreground focus:outline-hidden focus:ring-1 focus:ring-primary"
            />
          </div>
        </div>
      )}

      {/* STEP 3: File Input & Target Preview */}
      <div className="space-y-4">
        <label className="text-xs font-bold uppercase tracking-wider text-muted">
          3. Select Manifest File & Review Destination
        </label>

        {/* Calculated Storage Path Preview Banner */}
        <div className="rounded-xl border border-border/80 bg-surface-muted/40 p-4 space-y-1.5">
          <div className="flex items-center justify-between text-xs font-semibold text-muted">
            <span>Calculated Destination Path</span>
            <Badge tone="neutral" className="font-mono text-[10px]">
              {destination === "OLD" ? "old-youtube-discovery-private" : "new-youtube-discovery-private"}
            </Badge>
          </div>
          <code className="block font-mono text-xs text-primary font-bold break-all bg-surface p-2.5 rounded-lg border border-border/60">
            {destination === "OLD" ? derivedOldPath : derivedNewPath}
          </code>
          <p className="text-[11px] text-muted">
            {destination === "OLD"
              ? "Each manifest receives a dedicated collision-resistant subdirectory to ensure zero file overwrite."
              : "Generational persistence ensures immutable parts with atomic revision pointers in PostgreSQL."}
          </p>
        </div>

        {/* File Drop / Select Area */}
        <div className="rounded-2xl border-2 border-dashed border-border/80 bg-surface p-8 text-center space-y-3 hover:border-primary/60 transition">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-primary-soft text-primary">
            <Upload className="h-6 w-6" />
          </div>
          <div className="space-y-1">
            <p className="text-sm font-semibold text-foreground">
              {selectedFile ? selectedFile.name : "Choose a manifest file to upload"}
            </p>
            <p className="text-xs text-muted">
              Supported formats: JSON, NDJSON, JSONL, ZIP (up to 50 MiB)
            </p>
          </div>

          <input
            type="file"
            id="manifest-file-input"
            accept=".json,.ndjson,.jsonl,.zip,application/json,application/zip"
            onChange={handleFileChange}
            className="hidden"
          />

          <label htmlFor="manifest-file-input">
            <Button
              type="button"
              variant="secondary"
              className="h-9 px-4 text-xs font-semibold pointer-events-none"
            >
              Browse Files…
            </Button>
          </label>

          {selectedFile && (
            <div className="pt-2 text-xs text-muted flex items-center justify-center gap-4">
              <span>Size: <strong>{formatBytes(selectedFile.size)}</strong></span>
              <span>Type: <strong>{selectedFile.type || "application/octet-stream"}</strong></span>
            </div>
          )}
        </div>
      </div>

      {/* Error Notice */}
      {error && (
        <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-xs text-destructive flex items-center gap-2.5">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span className="font-medium">{error}</span>
        </div>
      )}

      {/* Success Receipt */}
      {uploadResult && (
        <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-5 space-y-3 text-xs animate-in fade-in">
          <div className="flex items-center gap-2 font-bold text-emerald-600 dark:text-emerald-400 text-sm">
            <CheckCircle2 className="h-5 w-5" />
            <span>Manifest Upload & Storage Verification Succeeded!</span>
          </div>

          <div className="space-y-1.5 font-mono text-[11px] text-foreground bg-surface/70 p-3.5 rounded-xl border border-emerald-500/20">
            <p><strong>Destination:</strong> {uploadResult.destination} Bucket ({uploadResult.bucket})</p>
            <p><strong>Storage Path:</strong> <span className="text-primary">{uploadResult.storagePath}</span></p>
            <p><strong>Size:</strong> {formatBytes(uploadResult.byteCount)} ({uploadResult.recordCount} records)</p>
            <p className="truncate"><strong>SHA-256:</strong> {uploadResult.sha256}</p>
            {uploadResult.manifestId && (
              <p><strong>Manifest ID:</strong> {uploadResult.manifestId} ({uploadResult.category})</p>
            )}
            {uploadResult.generationNumber !== undefined && (
              <p><strong>Committed Generation:</strong> #{uploadResult.generationNumber}</p>
            )}
          </div>

          <div className="flex items-center gap-3 pt-2">
            {uploadResult.destination === "OLD" ? (
              <Link
                href={`/old/${uploadResult.category || "saved-items"}`}
                className="text-xs font-semibold text-primary hover:underline flex items-center gap-1"
              >
                <span>View in OLD Archive</span>
                <ArrowRight className="h-3 w-3" />
              </Link>
            ) : (
              <Link
                href="/manifests"
                className="text-xs font-semibold text-primary hover:underline flex items-center gap-1"
              >
                <span>View in Storage Explorer</span>
                <ArrowRight className="h-3 w-3" />
              </Link>
            )}
            <Link
              href="/manifests/viewer"
              className="text-xs text-muted hover:text-foreground"
            >
              Open in Manifest Viewer
            </Link>
          </div>
        </div>
      )}

      {/* Upload Action */}
      <div className="flex items-center justify-end gap-3 pt-4 border-t border-border/80">
        <ButtonLink href="/manifests" variant="ghost" className="h-9 px-4 text-xs">
          Cancel
        </ButtonLink>

        <Button
          type="button"
          variant="primary"
          onClick={handleUpload}
          disabled={uploading || !selectedFile}
          className="h-9 gap-2 px-6 text-xs font-semibold shadow-xs"
        >
          {uploading ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              <span>Verifying & Uploading…</span>
            </>
          ) : (
            <>
              <Upload className="h-4 w-4" />
              <span>Upload to {destination} Storage</span>
            </>
          )}
        </Button>
      </div>
    </div>
  );
}
