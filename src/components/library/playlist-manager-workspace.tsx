"use client";

import {
  Edit2,
  FolderPlus,
  Layers,
  Library,
  ListVideo,
  Loader2,
  MoreVertical,
  Play,
  Plus,
  Search,
  Trash2,
  Video,
  X,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { UserPlaylistIndexEntry } from "@/types/library";
import { useUserPlaylistsStore } from "@/lib/state/user-playlists-store";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { formatDate } from "@/lib/utils/format";

type PlaylistSortOption = "updated_desc" | "created_desc" | "name_az" | "items_desc";

export function PlaylistManagerWorkspace() {
  const index = useUserPlaylistsStore((s) => s.index);
  const indexLoaded = useUserPlaylistsStore((s) => s.indexLoaded);
  const fetchIndex = useUserPlaylistsStore((s) => s.fetchIndex);
  const createPlaylist = useUserPlaylistsStore((s) => s.createPlaylist);
  const renamePlaylist = useUserPlaylistsStore((s) => s.renamePlaylist);
  const updatePlaylistDescription = useUserPlaylistsStore((s) => s.updatePlaylistDescription);
  const deletePlaylist = useUserPlaylistsStore((s) => s.deletePlaylist);

  const [searchQuery, setSearchQuery] = useState("");
  const [sortOption, setSortOption] = useState<PlaylistSortOption>("updated_desc");

  // Create modal state
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [isCreating, setIsCreating] = useState(false);

  // Edit modal state
  const [editingEntry, setEditingEntry] = useState<UserPlaylistIndexEntry | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [isSavingEdit, setIsSavingEdit] = useState(false);

  // Delete modal state
  const [deletingEntry, setDeletingEntry] = useState<UserPlaylistIndexEntry | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  useEffect(() => {
    if (!indexLoaded) {
      void fetchIndex();
    }
  }, [indexLoaded, fetchIndex]);

  // Filter and sort playlists
  const filteredPlaylists = useMemo(() => {
    return index.filter((p) => {
      if (!searchQuery.trim()) return true;
      const q = searchQuery.toLowerCase();
      const matchName = p.name?.toLowerCase().includes(q);
      const matchDesc = p.description?.toLowerCase().includes(q);
      return matchName || matchDesc;
    });
  }, [index, searchQuery]);

  const sortedPlaylists = useMemo(() => {
    const list = [...filteredPlaylists];
    switch (sortOption) {
      case "updated_desc":
        return list.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      case "created_desc":
        return list.sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
      case "name_az":
        return list.sort((a, b) => a.name.localeCompare(b.name));
      case "items_desc":
        return list.sort((a, b) => b.itemCount - a.itemCount);
      default:
        return list;
    }
  }, [filteredPlaylists, sortOption]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    const title = newTitle.trim();
    if (!title || isCreating) return;

    setIsCreating(true);
    const created = await createPlaylist(title, newDescription.trim() || null);
    setIsCreating(false);

    if (created) {
      setNewTitle("");
      setNewDescription("");
      setIsCreateOpen(false);
    }
  };

  const handleOpenEdit = (entry: UserPlaylistIndexEntry) => {
    setEditingEntry(entry);
    setEditTitle(entry.name);
    setEditDescription(entry.description || "");
  };

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingEntry || !editTitle.trim() || isSavingEdit) return;

    setIsSavingEdit(true);
    const titleChanged = editTitle.trim() !== editingEntry.name;
    const descChanged = (editDescription.trim() || null) !== (editingEntry.description || null);

    if (titleChanged) {
      await renamePlaylist(editingEntry.id, editTitle.trim());
    }
    if (descChanged) {
      await updatePlaylistDescription(editingEntry.id, editDescription.trim() || null);
    }

    setIsSavingEdit(false);
    setEditingEntry(null);
  };

  const handleConfirmDelete = async () => {
    if (!deletingEntry || isDeleting) return;
    setIsDeleting(true);
    await deletePlaylist(deletingEntry.id);
    setIsDeleting(false);
    setDeletingEntry(null);
  };

  return (
    <div className="space-y-8">
      {/* Top Controls Bar */}
      <Card className="p-4 sm:p-5 shadow-sm border border-border/80">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          {/* Search Input */}
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted" />
            <input
              type="text"
              placeholder="Search playlists by name or description..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="h-10 w-full rounded-lg border border-border bg-surface pl-10 pr-9 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--ring)] transition"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery("")}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted hover:text-foreground"
                aria-label="Clear search"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>

          {/* Sort Selector & Create Action */}
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted">Sort:</span>
              <select
                value={sortOption}
                onChange={(e) => setSortOption(e.target.value as PlaylistSortOption)}
                aria-label="Sort playlists"
                className="h-9 rounded-lg border border-border bg-surface px-3 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-[var(--ring)]"
              >
                <option value="updated_desc">Recently Updated</option>
                <option value="created_desc">Date Created</option>
                <option value="name_az">Title (A to Z)</option>
                <option value="items_desc">Most Items</option>
              </select>
            </div>

            <Button
              variant="primary"
              onClick={() => setIsCreateOpen(true)}
              className="h-9 px-4 text-xs font-semibold gap-1.5 shadow-xs"
            >
              <Plus className="h-4 w-4" />
              <span>Create Playlist</span>
            </Button>
          </div>
        </div>
      </Card>

      {/* Main Content / Grid */}
      {!indexLoaded ? (
        <Card className="flex items-center justify-center p-14 text-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted" />
          <span className="ml-3 text-sm text-muted">Loading your personal playlists...</span>
        </Card>
      ) : sortedPlaylists.length > 0 ? (
        <div className="space-y-4">
          <div className="flex items-center justify-between text-xs text-muted">
            <p>
              Showing <strong>{sortedPlaylists.length}</strong> of {index.length}{" "}
              {index.length === 1 ? "playlist" : "playlists"}
            </p>
          </div>

          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-3">
            {sortedPlaylists.map((entry) => (
              <PlaylistCard
                key={entry.id}
                entry={entry}
                onEdit={() => handleOpenEdit(entry)}
                onDelete={() => setDeletingEntry(entry)}
              />
            ))}
          </div>
        </div>
      ) : (
        <Card className="flex flex-col items-center justify-center p-14 text-center">
          <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-primary-soft text-primary">
            <Library className="h-7 w-7" />
          </div>
          <h3 className="text-base font-semibold text-foreground">
            {index.length === 0 ? "No personal playlists yet" : "No playlists match your search"}
          </h3>
          <p className="mt-1 text-xs text-muted max-w-md">
            {index.length === 0
              ? "Create your first personal playlist to organize videos, YouTube playlists, channels, and custom research notes into custom sections."
              : "Try adjusting your search terms or clearing the filter to find what you're looking for."}
          </p>
          {index.length === 0 && (
            <div className="mt-6">
              <Button
                variant="primary"
                onClick={() => setIsCreateOpen(true)}
                className="h-9 px-5 text-xs font-semibold gap-1.5"
              >
                <Plus className="h-4 w-4" />
                <span>Create Your First Playlist</span>
              </Button>
            </div>
          )}
        </Card>
      )}

      {/* Create Playlist Modal */}
      {isCreateOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs">
          <div className="w-full max-w-md rounded-xl border border-border bg-surface p-6 shadow-2xl">
            <div className="flex items-center justify-between border-b border-border/60 pb-3">
              <div className="flex items-center gap-2">
                <FolderPlus className="h-5 w-5 text-primary" />
                <h3 className="text-base font-semibold text-foreground">Create New Playlist</h3>
              </div>
              <button
                type="button"
                onClick={() => setIsCreateOpen(false)}
                className="rounded-md p-1 text-muted hover:bg-surface-muted hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleCreate} className="mt-4 space-y-4">
              <div>
                <label htmlFor="create-title" className="mb-1 block text-xs font-medium text-foreground">
                  Playlist Title <span className="text-danger">*</span>
                </label>
                <input
                  id="create-title"
                  type="text"
                  required
                  placeholder="e.g. AI Research 2026, React Tutorials..."
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  className="h-10 w-full rounded-lg border border-border bg-surface px-3 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--ring)]"
                  autoFocus
                />
              </div>

              <div>
                <label htmlFor="create-desc" className="mb-1 block text-xs font-medium text-muted">
                  Description (optional)
                </label>
                <textarea
                  id="create-desc"
                  rows={3}
                  placeholder="Notes about this playlist or research focus..."
                  value={newDescription}
                  onChange={(e) => setNewDescription(e.target.value)}
                  className="w-full rounded-lg border border-border bg-surface p-3 text-xs focus:outline-none focus:ring-2 focus:ring-[var(--ring)]"
                />
              </div>

              <div className="flex justify-end gap-2.5 pt-2">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setIsCreateOpen(false)}
                  disabled={isCreating}
                >
                  Cancel
                </Button>
                <Button type="submit" variant="primary" disabled={!newTitle.trim() || isCreating}>
                  {isCreating ? <Loader2 className="h-4 w-4 animate-spin" /> : "Create Playlist"}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit / Rename Playlist Modal */}
      {editingEntry && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs">
          <div className="w-full max-w-md rounded-xl border border-border bg-surface p-6 shadow-2xl">
            <div className="flex items-center justify-between border-b border-border/60 pb-3">
              <div className="flex items-center gap-2">
                <Edit2 className="h-5 w-5 text-primary" />
                <h3 className="text-base font-semibold text-foreground">Manage Playlist Details</h3>
              </div>
              <button
                type="button"
                onClick={() => setEditingEntry(null)}
                className="rounded-md p-1 text-muted hover:bg-surface-muted hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleSaveEdit} className="mt-4 space-y-4">
              <div>
                <label htmlFor="edit-title" className="mb-1 block text-xs font-medium text-foreground">
                  Playlist Title <span className="text-danger">*</span>
                </label>
                <input
                  id="edit-title"
                  type="text"
                  required
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                  className="h-10 w-full rounded-lg border border-border bg-surface px-3 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--ring)]"
                  autoFocus
                />
              </div>

              <div>
                <label htmlFor="edit-desc" className="mb-1 block text-xs font-medium text-muted">
                  Description
                </label>
                <textarea
                  id="edit-desc"
                  rows={3}
                  value={editDescription}
                  onChange={(e) => setEditDescription(e.target.value)}
                  className="w-full rounded-lg border border-border bg-surface p-3 text-xs focus:outline-none focus:ring-2 focus:ring-[var(--ring)]"
                />
              </div>

              <div className="flex justify-end gap-2.5 pt-2">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setEditingEntry(null)}
                  disabled={isSavingEdit}
                >
                  Cancel
                </Button>
                <Button type="submit" variant="primary" disabled={!editTitle.trim() || isSavingEdit}>
                  {isSavingEdit ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save Changes"}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {deletingEntry && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs">
          <div className="w-full max-w-sm rounded-xl border border-border bg-surface p-6 shadow-2xl">
            <h3 className="text-base font-semibold text-foreground">Delete Playlist?</h3>
            <p className="mt-2 text-xs leading-relaxed text-muted">
              Are you sure you want to permanently delete <strong>{deletingEntry.name}</strong>?
              This removes the playlist manifest and section structures. Items in your Saved Items library will remain untouched.
            </p>
            <div className="mt-6 flex justify-end gap-2.5">
              <Button
                type="button"
                variant="ghost"
                onClick={() => setDeletingEntry(null)}
                disabled={isDeleting}
              >
                Cancel
              </Button>
              <Button
                type="button"
                variant="danger"
                onClick={handleConfirmDelete}
                disabled={isDeleting}
              >
                {isDeleting ? <Loader2 className="h-4 w-4 animate-spin" /> : "Delete Playlist"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * High-craft, readable playlist card with prominent video thumbnails,
 * rich badges, readable typography, and quick action buttons.
 */
function PlaylistCard({
  entry,
  onEdit,
  onDelete,
}: {
  entry: UserPlaylistIndexEntry;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <Card className="group relative flex flex-col overflow-hidden rounded-xl border border-border/80 bg-surface shadow-xs transition hover:border-primary/40 hover:shadow-md">
      {/* Prominent Video Thumbnail Gallery / Lead Collage */}
      <Link href={`/saved/${entry.id}`} className="block relative aspect-video w-full overflow-hidden bg-surface-muted">
        {entry.thumbnails && entry.thumbnails.length > 0 ? (
          <div className="grid h-full w-full grid-cols-2 gap-0.5 bg-black/20">
            {entry.thumbnails.slice(0, 4).map((thumb, idx) => (
              <div key={idx} className="relative h-full w-full overflow-hidden">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={thumb}
                  alt=""
                  loading="lazy"
                  className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-102"
                />
              </div>
            ))}
          </div>
        ) : (
          <div className="flex h-full w-full flex-col items-center justify-center gap-2 text-muted">
            <ListVideo className="h-10 w-10 opacity-30" />
            <span className="text-[11px] font-medium text-muted">Empty playlist</span>
          </div>
        )}

        {/* Item Count Overlay Badge */}
        <div className="absolute bottom-2.5 right-2.5 flex items-center gap-1.5 rounded-md bg-black/85 px-2 py-1 text-xs font-semibold text-white backdrop-blur-xs">
          <Video className="h-3.5 w-3.5 text-primary" />
          <span>{entry.itemCount} items</span>
        </div>

        {/* Section Count Overlay Badge */}
        {entry.groupCount > 0 && (
          <div className="absolute top-2.5 left-2.5 flex items-center gap-1 rounded-md bg-black/75 px-2 py-0.5 text-[10px] font-medium text-white backdrop-blur-xs">
            <Layers className="h-3 w-3" />
            <span>{entry.groupCount} sections</span>
          </div>
        )}
      </Link>

      {/* Body Information */}
      <div className="flex flex-1 flex-col p-4 sm:p-5">
        {/* Title & Quick Actions Menu */}
        <div className="flex items-start justify-between gap-2">
          <Link
            href={`/saved/${entry.id}`}
            className="line-clamp-2 text-base font-bold text-foreground transition-colors hover:text-primary leading-tight tracking-tight"
            title={entry.name}
          >
            {entry.name}
          </Link>

          {/* Action Menu Dropdown */}
          <div className="relative shrink-0">
            <button
              type="button"
              onClick={() => setMenuOpen(!menuOpen)}
              className="flex h-7 w-7 items-center justify-center rounded-md text-muted hover:bg-surface-muted hover:text-foreground transition"
              aria-label="Playlist actions"
            >
              <MoreVertical className="h-4 w-4" />
            </button>

            {menuOpen && (
              <>
                <div className="fixed inset-0 z-20" onClick={() => setMenuOpen(false)} />
                <div className="absolute right-0 top-8 z-30 w-36 rounded-lg border border-border bg-surface py-1 shadow-lg text-xs">
                  <button
                    type="button"
                    onClick={() => {
                      setMenuOpen(false);
                      onEdit();
                    }}
                    className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-foreground hover:bg-surface-muted"
                  >
                    <Edit2 className="h-3.5 w-3.5 text-muted" />
                    <span>Edit Details</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setMenuOpen(false);
                      onDelete();
                    }}
                    className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-danger hover:bg-danger/10"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    <span>Delete</span>
                  </button>
                </div>
              </>
            )}
          </div>
        </div>

        {/* Description */}
        {entry.description ? (
          <p className="mt-1.5 line-clamp-2 text-xs text-muted leading-relaxed">
            {entry.description}
          </p>
        ) : (
          <p className="mt-1.5 text-xs italic text-muted/60">No description provided</p>
        )}

        {/* Content Tags / Breakdowns */}
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          {(entry.counts.videos ?? 0) > 0 && (
            <Badge tone="neutral" className="text-[10px]">
              {entry.counts.videos} videos
            </Badge>
          )}
          {(entry.counts.shorts ?? 0) > 0 && (
            <Badge tone="neutral" className="text-[10px]">
              ⚡ {entry.counts.shorts} Shorts
            </Badge>
          )}
          {(entry.counts.channels ?? 0) > 0 && (
            <Badge tone="neutral" className="text-[10px]">
              {entry.counts.channels} channels
            </Badge>
          )}
          {(entry.counts.youtubePlaylists ?? 0) > 0 && (
            <Badge tone="neutral" className="text-[10px]">
              {entry.counts.youtubePlaylists} playlists
            </Badge>
          )}
        </div>

        {/* Card Footer */}
        <div className="mt-auto pt-4 flex items-center justify-between border-t border-border/60">
          <span className="text-[11px] text-muted">
            Updated {formatDate(entry.updatedAt)}
          </span>

          <Link
            href={`/saved/${entry.id}`}
            className="inline-flex items-center gap-1.5 rounded-lg bg-primary-soft px-3 py-1.5 text-xs font-semibold text-primary hover:bg-primary/20 transition"
          >
            <Play className="h-3 w-3 fill-current" />
            <span>Open</span>
          </Link>
        </div>
      </div>
    </Card>
  );
}
