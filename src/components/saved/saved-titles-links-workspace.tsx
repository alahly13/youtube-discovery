"use client";

import {
  AlertTriangle,
  Bookmark,
  Check,
  CloudUpload,
  ExternalLink,
  FileText,
  Link2,
  Loader2,
  Pencil,
  Plus,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  classifyResourceRecord,
  type ResourceType,
} from "@/lib/resources/resource-taxonomy";
import { deleteEntityLocally, saveEntityLocally } from "@/lib/storage/indexeddb-store";
import { useMergedDataset } from "@/lib/storage/use-merged-dataset";
import { syncCoordinator } from "@/lib/sync/sync-coordinator";
import { formatDate } from "@/lib/utils/format";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * Saved Titles & Links Workspace — /saved-titles-links
 * ──────────────────────────────────────────────────────────────────────────
 * Scope: First-class local-first workspace for SAVED_TITLE and SAVED_LINK
 *        records stored in the canonical REFERENCES dataset.
 *
 * Why this page exists:
 *   Saved titles and saved links previously only existed inside the OLD
 *   archive browser. This page makes them part of the live NEW pipeline:
 *   IndexedDB projection -> outbox -> /api/sync/save-all -> R2 manifest ->
 *   PostgreSQL saved_references -> hydration.
 *
 * Taxonomy rules (do not weaken):
 *   - SAVED_TITLE and SAVED_LINK are resource types, not dataset types.
 *   - The discriminator is written explicitly (`savedKind` + `resourceType`).
 *   - Saved searches are deliberately excluded; they are a separate page and
 *     a separate resource type.
 *   - Original YouTube titles are never overwritten by a custom display title
 *     stored here.
 * ═══════════════════════════════════════════════════════════════════════════
 */

interface SavedReferenceRecord {
  id: string;
  recordId?: string;
  resourceType?: ResourceType | string;
  resourceId?: string;
  savedKind?: "SAVED_TITLE" | "SAVED_LINK";
  title: string;
  url?: string;
  notes?: string;
  createdAt?: string;
  updatedAt?: string;
  savedAt?: string;
  originDeviceId?: string;
  originDeviceLabel?: string;
  _localStatus?: string;
  _syncStatus?: string;
}

type ReferenceKind = "SAVED_TITLE" | "SAVED_LINK";
type KindFilter = "ALL" | ReferenceKind;
type SortOption = "newest" | "oldest" | "title";

interface EditorState {
  recordId: string | null;
  kind: ReferenceKind;
  title: string;
  url: string;
  notes: string;
}

const EMPTY_EDITOR: EditorState = {
  recordId: null,
  kind: "SAVED_TITLE",
  title: "",
  url: "",
  notes: "",
};

const MAX_TITLE_LENGTH = 512;
const MAX_URL_LENGTH = 2048;
const MAX_NOTES_LENGTH = 4000;

function isValidHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value.trim());
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Normalizes a URL only for duplicate detection. The stored URL keeps the
 * user's original text; identity is never derived from this normalization.
 */
function normalizeUrlForComparison(value: string): string {
  try {
    const parsed = new URL(value.trim());
    parsed.hash = "";
    const path = parsed.pathname.replace(/\/+$/, "") || "/";
    return `${parsed.protocol}//${parsed.host.toLowerCase()}${path}${parsed.search}`;
  } catch {
    return value.trim().toLowerCase();
  }
}

function referenceKindOf(record: SavedReferenceRecord): ReferenceKind | null {
  const classification = classifyResourceRecord(record as unknown as Record<string, unknown>, {
    datasetType: "REFERENCES",
  });
  if (classification.resourceType === "SAVED_TITLE") return "SAVED_TITLE";
  if (classification.resourceType === "SAVED_LINK") return "SAVED_LINK";
  return null;
}

function recordIdOf(record: SavedReferenceRecord): string {
  return String(record.recordId || record.id || "").trim();
}

function recordTimestamp(record: SavedReferenceRecord): number {
  for (const value of [record.updatedAt, record.createdAt, record.savedAt]) {
    if (typeof value === "string") {
      const parsed = Date.parse(value);
      if (!Number.isNaN(parsed)) return parsed;
    }
  }
  return 0;
}

export function SavedTitlesLinksWorkspace() {
  const {
    items,
    pendingCount,
    isLoading,
    refresh,
  } = useMergedDataset<SavedReferenceRecord>("REFERENCES");

  const [query, setQuery] = useState("");
  const [kindFilter, setKindFilter] = useState<KindFilter>("ALL");
  const [sortOption, setSortOption] = useState<SortOption>("newest");
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  // REFERENCES also contains saved searches. This workspace is deliberately
  // limited to the two reference resource types it owns.
  const references = useMemo(() => {
    return items
      .map((record) => ({ record, kind: referenceKindOf(record) }))
      .filter(
        (entry): entry is { record: SavedReferenceRecord; kind: ReferenceKind } =>
          entry.kind !== null
      );
  }, [items]);

  const counts = useMemo(() => {
    let titles = 0;
    let links = 0;
    for (const entry of references) {
      if (entry.kind === "SAVED_TITLE") titles += 1;
      else links += 1;
    }
    return { titles, links, total: references.length };
  }, [references]);

  const visibleReferences = useMemo(() => {
    const q = query.trim().toLowerCase();

    const filtered = references.filter(({ record, kind }) => {
      if (kindFilter !== "ALL" && kind !== kindFilter) return false;
      if (!q) return true;
      return (
        String(record.title || "").toLowerCase().includes(q) ||
        String(record.url || "").toLowerCase().includes(q) ||
        String(record.notes || "").toLowerCase().includes(q) ||
        recordIdOf(record).toLowerCase().includes(q)
      );
    });

    filtered.sort((a, b) => {
      if (sortOption === "title") {
        return String(a.record.title || "").localeCompare(String(b.record.title || ""));
      }
      const delta = recordTimestamp(b.record) - recordTimestamp(a.record);
      return sortOption === "oldest" ? -delta : delta;
    });

    return filtered;
  }, [references, query, kindFilter, sortOption]);

  const startCreate = (kind: ReferenceKind) => {
    setFormError(null);
    setStatusMessage(null);
    setEditor({ ...EMPTY_EDITOR, kind });
  };

  const startEdit = (record: SavedReferenceRecord, kind: ReferenceKind) => {
    setFormError(null);
    setStatusMessage(null);
    setEditor({
      recordId: recordIdOf(record),
      kind,
      title: String(record.title || ""),
      url: String(record.url || ""),
      notes: String(record.notes || ""),
    });
  };

  const closeEditor = () => {
    if (saving) return;
    setEditor(null);
    setFormError(null);
  };

  const findDuplicate = (draft: EditorState): SavedReferenceRecord | null => {
    const title = draft.title.trim().toLowerCase();
    const url = draft.url.trim() ? normalizeUrlForComparison(draft.url) : "";

    for (const { record, kind } of references) {
      if (draft.recordId && recordIdOf(record) === draft.recordId) continue;
      if (kind !== draft.kind) continue;

      if (draft.kind === "SAVED_LINK" && url) {
        if (record.url && normalizeUrlForComparison(record.url) === url) return record;
      }
      if (draft.kind === "SAVED_TITLE" && title) {
        if (String(record.title || "").trim().toLowerCase() === title) return record;
      }
    }
    return null;
  };

  const handleSave = async () => {
    if (!editor) return;

    const ownerId = syncCoordinator.getOwnerId();
    if (!ownerId) {
      setFormError("Canonical owner is still resolving. Please retry in a moment.");
      return;
    }

    const title = editor.title.trim();
    const url = editor.url.trim();

    if (!title) {
      setFormError("A title is required.");
      return;
    }
    if (title.length > MAX_TITLE_LENGTH) {
      setFormError(`Title must be ${MAX_TITLE_LENGTH} characters or fewer.`);
      return;
    }
    if (editor.kind === "SAVED_LINK" && !url) {
      setFormError("A saved link requires a URL.");
      return;
    }
    if (url && !isValidHttpUrl(url)) {
      setFormError("The URL must be an absolute http(s) URL.");
      return;
    }
    if (url.length > MAX_URL_LENGTH) {
      setFormError(`URL must be ${MAX_URL_LENGTH} characters or fewer.`);
      return;
    }
    if (editor.notes.length > MAX_NOTES_LENGTH) {
      setFormError(`Notes must be ${MAX_NOTES_LENGTH} characters or fewer.`);
      return;
    }

    const duplicate = findDuplicate(editor);
    if (duplicate) {
      setFormError(
        editor.kind === "SAVED_LINK"
          ? `This link is already saved as "${duplicate.title}".`
          : `A saved title with this name already exists ("${duplicate.title}").`
      );
      return;
    }

    setSaving(true);
    setFormError(null);

    try {
      const now = new Date().toISOString();
      const recordId = editor.recordId || crypto.randomUUID();
      const existing = editor.recordId
        ? references.find((entry) => recordIdOf(entry.record) === editor.recordId)?.record
        : undefined;

      const record: SavedReferenceRecord & Record<string, unknown> = {
        ...(existing || {}),
        id: existing?.id || recordId,
        recordId,
        resourceId: url || recordId,
        resourceType: editor.kind,
        savedKind: editor.kind,
        title,
        notes: editor.notes.trim() || undefined,
        url: url || undefined,
        createdAt: existing?.createdAt || now,
        updatedAt: now,
        savedAt: existing?.savedAt || now,
        originDeviceId: existing?.originDeviceId,
        originDeviceLabel: existing?.originDeviceLabel,
      };

      await saveEntityLocally(ownerId, "REFERENCES", recordId, record);
      await syncCoordinator.refreshSummary();
      refresh();
      setEditor(null);
      setStatusMessage(
        `${editor.kind === "SAVED_LINK" ? "Link" : "Title"} saved locally. It will sync with the next Save All.`
      );
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Failed to save the reference locally.");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (record: SavedReferenceRecord) => {
    const ownerId = syncCoordinator.getOwnerId();
    if (!ownerId) return;

    const entityId = recordIdOf(record);
    if (!entityId) return;

    setDeletingId(entityId);
    try {
      await deleteEntityLocally(ownerId, "REFERENCES", entityId);
      await syncCoordinator.refreshSummary();
      refresh();
      setStatusMessage("Reference deleted locally. The deletion will sync with the next Save All.");
    } catch (err) {
      setStatusMessage(err instanceof Error ? err.message : "Failed to delete the reference.");
    } finally {
      setDeletingId(null);
    }
  };

  const handleSaveAll = async () => {
    setSyncing(true);
    setStatusMessage(null);
    try {
      const result = await syncCoordinator.saveAll();
      setStatusMessage(
        result.ok
          ? `Cloud sync completed for ${result.syncedCount} pending operation(s).`
          : result.error || "Cloud sync did not complete."
      );
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Toolbar */}
      <Card className="border border-border/80 p-4 shadow-sm sm:p-5">
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="relative w-full max-w-md flex-1">
              <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
              <input
                type="text"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search saved titles, links, notes, or record IDs..."
                className="h-10 w-full rounded-lg border border-border bg-surface pl-10 pr-9 text-sm transition focus:outline-none focus:ring-2 focus:ring-[var(--ring)]"
              />
              {query && (
                <button
                  type="button"
                  onClick={() => setQuery("")}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted hover:text-foreground"
                  aria-label="Clear filter"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="primary"
                onClick={() => startCreate("SAVED_TITLE")}
                className="h-9 gap-1.5 px-3 text-xs font-semibold"
              >
                <Plus className="h-3.5 w-3.5" />
                <span>New Title</span>
              </Button>
              <Button
                type="button"
                variant="secondary"
                onClick={() => startCreate("SAVED_LINK")}
                className="h-9 gap-1.5 px-3 text-xs font-semibold"
              >
                <Link2 className="h-3.5 w-3.5" />
                <span>New Link</span>
              </Button>
              <Button
                type="button"
                variant="secondary"
                onClick={handleSaveAll}
                disabled={syncing || pendingCount === 0}
                className="h-9 gap-1.5 px-3 text-xs font-semibold"
                title="Upload pending local changes to Cloudflare R2 and PostgreSQL"
              >
                {syncing ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <CloudUpload className="h-3.5 w-3.5" />
                )}
                <span>{syncing ? "Syncing…" : "Save All"}</span>
                {pendingCount > 0 && (
                  <span className="rounded-full bg-primary-foreground px-1.5 text-[10px] font-bold text-primary">
                    {pendingCount}
                  </span>
                )}
              </Button>
            </div>
          </div>

          <div className="flex flex-col gap-3 border-t border-border/60 pt-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-wrap items-center gap-1.5">
              {(
                [
                  { value: "ALL", label: "All", count: counts.total },
                  { value: "SAVED_TITLE", label: "Titles", count: counts.titles },
                  { value: "SAVED_LINK", label: "Links", count: counts.links },
                ] as const
              ).map((filter) => (
                <button
                  key={filter.value}
                  type="button"
                  onClick={() => setKindFilter(filter.value)}
                  className={`rounded-full px-3 py-1 text-xs font-medium transition ${
                    kindFilter === filter.value
                      ? "bg-primary-soft text-primary"
                      : "bg-surface-muted/60 text-muted hover:text-foreground"
                  }`}
                >
                  {filter.label} ({filter.count})
                </button>
              ))}
            </div>

            <div className="flex items-center gap-2 text-xs text-muted">
              <span>Sort</span>
              <select
                value={sortOption}
                onChange={(event) => setSortOption(event.target.value as SortOption)}
                className="h-8 rounded-md border border-border bg-surface px-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              >
                <option value="newest">Newest first</option>
                <option value="oldest">Oldest first</option>
                <option value="title">Title A–Z</option>
              </select>
            </div>
          </div>
        </div>
      </Card>

      {statusMessage && (
        <div className="flex items-start gap-2 rounded-lg border border-border/70 bg-surface-muted/50 px-3 py-2 text-xs text-muted">
          <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success" />
          <span>{statusMessage}</span>
        </div>
      )}

      {/* Editor */}
      {editor && (
        <Card className="border border-primary/30 bg-primary/5 p-4 shadow-sm sm:p-5">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <h3 className="flex items-center gap-2 text-sm font-bold text-foreground">
                {editor.kind === "SAVED_LINK" ? (
                  <Link2 className="h-4 w-4 text-primary" />
                ) : (
                  <FileText className="h-4 w-4 text-primary" />
                )}
                {editor.recordId ? "Edit reference" : `New ${editor.kind === "SAVED_LINK" ? "link" : "title"}`}
              </h3>
              <p className="mt-0.5 text-xs text-muted">
                Stored in the REFERENCES dataset and synced to R2 + PostgreSQL.
              </p>
            </div>
            <button
              type="button"
              onClick={closeEditor}
              className="rounded-lg p-1.5 text-muted transition hover:bg-surface-muted hover:text-foreground"
              aria-label="Close editor"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-muted">
                Title
              </label>
              <input
                type="text"
                value={editor.title}
                maxLength={MAX_TITLE_LENGTH}
                onChange={(event) =>
                  setEditor((current) =>
                    current ? { ...current, title: event.target.value } : current
                  )
                }
                placeholder="A clear, human-readable title"
                className="h-10 w-full rounded-lg border border-border bg-surface px-3 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--ring)]"
              />
            </div>

            <div className="sm:col-span-2">
              <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-muted">
                URL {editor.kind === "SAVED_LINK" ? "(required)" : "(optional)"}
              </label>
              <input
                type="url"
                value={editor.url}
                maxLength={MAX_URL_LENGTH}
                onChange={(event) =>
                  setEditor((current) =>
                    current ? { ...current, url: event.target.value } : current
                  )
                }
                placeholder="https://..."
                className="h-10 w-full rounded-lg border border-border bg-surface px-3 font-mono text-xs focus:outline-none focus:ring-2 focus:ring-[var(--ring)]"
              />
            </div>

            <div className="sm:col-span-2">
              <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-muted">
                Notes
              </label>
              <textarea
                value={editor.notes}
                maxLength={MAX_NOTES_LENGTH}
                onChange={(event) =>
                  setEditor((current) =>
                    current ? { ...current, notes: event.target.value } : current
                  )
                }
                rows={3}
                placeholder="Why is this worth keeping? Research context, tags, reminders..."
                className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--ring)]"
              />
            </div>
          </div>

          {formError && (
            <div className="mt-3 flex items-start gap-2 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>{formError}</span>
            </div>
          )}

          <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
            <Button
              type="button"
              variant="secondary"
              onClick={closeEditor}
              disabled={saving}
              className="h-9 px-3 text-xs"
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="primary"
              onClick={handleSave}
              disabled={saving}
              className="h-9 gap-1.5 px-3 text-xs font-semibold"
            >
              {saving ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Check className="h-3.5 w-3.5" />
              )}
              <span>{saving ? "Saving…" : "Save locally"}</span>
            </Button>
          </div>
        </Card>
      )}

      {/* List */}
      {isLoading && references.length === 0 ? (
        <Card className="flex items-center justify-center p-12 text-sm text-muted">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          Loading local references…
        </Card>
      ) : visibleReferences.length === 0 ? (
        <Card className="flex flex-col items-center justify-center p-14 text-center">
          <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-surface-muted text-muted">
            <Bookmark className="h-7 w-7 text-primary opacity-60" />
          </div>
          <h3 className="text-base font-semibold text-foreground">
            {references.length === 0
              ? "No saved titles or links yet"
              : "No references match your filters"}
          </h3>
          <p className="mt-1 max-w-md text-xs text-muted">
            {references.length === 0
              ? "Create a title-only note or preserve an external link. Everything is saved locally first, then synchronized to Cloudflare R2 and PostgreSQL."
              : "Try a different search term or switch the kind filter."}
          </p>
          <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
            <Button
              type="button"
              variant="primary"
              onClick={() => startCreate("SAVED_TITLE")}
              className="h-9 gap-1.5 px-3 text-xs font-semibold"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>New Title</span>
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => startCreate("SAVED_LINK")}
              className="h-9 gap-1.5 px-3 text-xs font-semibold"
            >
              <Link2 className="h-3.5 w-3.5" />
              <span>New Link</span>
            </Button>
          </div>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {visibleReferences.map(({ record, kind }) => {
            const recordId = recordIdOf(record);
            const isPending =
              record._localStatus === "LOCAL_PENDING" || record._syncStatus === "LOCAL";
            const timestamp = record.updatedAt || record.createdAt || record.savedAt;

            return (
              <Card
                key={recordId}
                className="flex flex-col justify-between rounded-xl border border-border/80 bg-surface p-4 transition hover:shadow-md"
              >
                <div className="min-w-0">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
                        <Badge tone={kind === "SAVED_LINK" ? "primary" : "neutral"}>
                          {kind === "SAVED_LINK" ? "LINK" : "TITLE"}
                        </Badge>
                        {isPending ? (
                          <span className="rounded bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-amber-600 dark:text-amber-400">
                            Pending sync
                          </span>
                        ) : (
                          <span className="rounded bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-600 dark:text-emerald-400">
                            Cloud committed
                          </span>
                        )}
                      </div>
                      <h4 className="line-clamp-2 text-base font-bold leading-snug tracking-tight text-foreground">
                        {record.title || "Untitled reference"}
                      </h4>
                    </div>
                  </div>

                  {record.url && (
                    <a
                      href={record.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-2 inline-flex max-w-full items-center gap-1 text-xs text-primary hover:underline"
                      title={record.url}
                    >
                      <ExternalLink className="h-3 w-3 shrink-0" />
                      <span className="truncate">{record.url}</span>
                    </a>
                  )}

                  {record.notes && (
                    <p className="mt-2 line-clamp-3 rounded-md bg-surface-muted/60 p-2 text-xs italic text-muted">
                      {record.notes}
                    </p>
                  )}

                  <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-muted">
                    {timestamp && <span>Updated {formatDate(timestamp)}</span>}
                    {record.originDeviceLabel && <span>via {record.originDeviceLabel}</span>}
                    <span className="truncate font-mono" title={recordId}>
                      {recordId}
                    </span>
                  </div>
                </div>

                <div className="mt-4 flex items-center justify-end gap-1.5 border-t border-border/50 pt-3">
                  <button
                    type="button"
                    onClick={() => startEdit(record, kind)}
                    className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted transition hover:bg-surface-muted hover:text-foreground"
                    title="Edit reference"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                    <span>Edit</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDelete(record)}
                    disabled={deletingId === recordId}
                    className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted transition hover:bg-danger/10 hover:text-danger disabled:opacity-50"
                    title="Delete reference"
                  >
                    {deletingId === recordId ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Trash2 className="h-3.5 w-3.5" />
                    )}
                    <span>Delete</span>
                  </button>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
