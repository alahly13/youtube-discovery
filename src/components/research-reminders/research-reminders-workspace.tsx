"use client";

import {
  Bookmark,
  Calendar,
  Check,
  CheckCircle2,
  ChevronDown,
  Clock,
  Download,
  ExternalLink,
  Filter,
  Layers,
  ListFilter,
  MessageSquare,
  Play,
  RotateCcw,
  Search,
  Sparkles,
  Trash2,
  Tv,
  X,
} from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  useResearchReminders,
} from "@/lib/storage/use-research-reminders";
import type {
  ResearchReminderItem,
  ResearchReminderStatus,
} from "@/lib/storage/research-reminders-store";
import { formatDate, formatRelativeDate } from "@/lib/utils/format";

type StatusFilter = "ALL" | ResearchReminderStatus;
type SortOption = "newest" | "oldest" | "title_az";

export function ResearchRemindersWorkspace() {
  const {
    reminders,
    isLoading,
    ownerId,
    removeReminder,
    setStatus,
    clearAll,
    exportManifest,
  } = useResearchReminders();

  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("ALL");
  const [sortOption, setSortOption] = useState<SortOption>("newest");
  const [editingNotesId, setEditingNotesId] = useState<string | null>(null);
  const [notesBuffer, setNotesBuffer] = useState("");
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [exporting, setExporting] = useState(false);

  // Status counts
  const counts = useMemo(() => {
    let toResearch = 0;
    let inProgress = 0;
    let investigated = 0;
    for (const r of reminders) {
      if (r.status === "TO_RESEARCH") toResearch++;
      else if (r.status === "IN_PROGRESS") inProgress++;
      else if (r.status === "INVESTIGATED") investigated++;
    }
    return { all: reminders.length, toResearch, inProgress, investigated };
  }, [reminders]);

  // Filtered & Sorted reminders
  const filteredReminders = useMemo(() => {
    let result = reminders.filter((r) => {
      if (statusFilter !== "ALL" && r.status !== statusFilter) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const titleMatch = r.title.toLowerCase().includes(q);
        const channelMatch = r.channelTitle?.toLowerCase().includes(q);
        const queryMatch = r.sourceQuery?.toLowerCase().includes(q);
        const notesMatch = r.notes?.toLowerCase().includes(q);
        if (!titleMatch && !channelMatch && !queryMatch && !notesMatch) return false;
      }
      return true;
    });

    result = [...result].sort((a, b) => {
      if (sortOption === "newest") {
        return new Date(b.addedAt).getTime() - new Date(a.addedAt).getTime();
      }
      if (sortOption === "oldest") {
        return new Date(a.addedAt).getTime() - new Date(b.addedAt).getTime();
      }
      if (sortOption === "title_az") {
        return a.title.localeCompare(b.title);
      }
      return 0;
    });

    return result;
  }, [reminders, statusFilter, searchQuery, sortOption]);

  // Group by date
  const groupedReminders = useMemo(() => {
    const groups: { [key: string]: { label: string; items: ResearchReminderItem[] } } = {};
    for (const r of filteredReminders) {
      const d = new Date(r.addedAt);
      const now = new Date();
      const isToday =
        d.getFullYear() === now.getFullYear() &&
        d.getMonth() === now.getMonth() &&
        d.getDate() === now.getDate();

      const yesterday = new Date(now);
      yesterday.setDate(now.getDate() - 1);
      const isYesterday =
        d.getFullYear() === yesterday.getFullYear() &&
        d.getMonth() === yesterday.getMonth() &&
        d.getDate() === yesterday.getDate();

      let label = d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
      let key = `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
      if (isToday) {
        label = `Today — ${label}`;
        key = "today";
      } else if (isYesterday) {
        label = `Yesterday — ${label}`;
        key = "yesterday";
      }

      if (!groups[key]) {
        groups[key] = { label, items: [] };
      }
      groups[key].items.push(r);
    }
    return Object.values(groups);
  }, [filteredReminders]);

  async function handleDownloadManifest() {
    setExporting(true);
    try {
      const { jsonString } = await exportManifest();
      const blob = new Blob([jsonString], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `local-research-reminders-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error("Export failed:", err);
    } finally {
      setExporting(false);
    }
  }

  function handleStartEditNotes(item: ResearchReminderItem) {
    setEditingNotesId(item.reminderId);
    setNotesBuffer(item.notes || "");
  }

  async function handleSaveNotes(item: ResearchReminderItem) {
    await setStatus(item.reminderId, item.status, notesBuffer);
    setEditingNotesId(null);
  }

  return (
    <div className="flex flex-col gap-6">
      {/* ── Banner: Local-Only Security Guarantee ──────────────────────── */}
      <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 text-xs dark:bg-amber-950/20">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-2.5">
            <Bookmark className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
            <div>
              <p className="font-semibold text-amber-900 dark:text-amber-200">
                قائمة سأبحث عنه — مفكرة بحث شخصية محلية 100% (I Will Search For)
              </p>
              <p className="mt-0.5 text-muted-foreground leading-relaxed">
                عناصر لفتت انتباهك أثناء البحث وتريد مراجعتها لاحقًا. هذه البيانات تُحفظ{" "}
                <span className="font-bold underline text-foreground">فقط وحصريًا داخل متصفحك الحالي</span>{" "}
                (IndexedDB)، ولا تُرسل مطلقًا إلى قواعد بيانات السحابة (PostgreSQL) أو وحدات Cloudflare R2.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Button
              variant="secondary"
              size="sm"
              onClick={handleDownloadManifest}
              disabled={reminders.length === 0 || exporting}
              className="gap-1.5 text-xs h-8"
              title="Download local JSON manifest"
            >
              <Download className="h-3.5 w-3.5 text-primary" />
              <span>Export Manifest</span>
            </Button>
            {reminders.length > 0 && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowClearConfirm(true)}
                className="gap-1.5 text-xs h-8 text-rose-500 hover:bg-rose-500/10 hover:text-rose-600"
                title="Clear all local reminders"
              >
                <Trash2 className="h-3.5 w-3.5" />
                <span>Clear All</span>
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* ── Filter Bar & Metrics ───────────────────────────────────────── */}
      <div className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-4 shadow-2xs">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          {/* Search query input */}
          <div className="relative flex-1">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted" />
            <input
              type="text"
              placeholder="Search reminders by title, channel, query, or notes..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="h-9 w-full rounded-lg border border-border bg-surface-muted pl-9 pr-8 text-xs text-foreground placeholder:text-muted focus:border-primary focus:outline-hidden"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery("")}
                className="absolute right-2.5 top-2.5 text-muted hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>

          {/* Sort selector */}
          <div className="flex items-center gap-2">
            <ListFilter className="h-4 w-4 text-muted shrink-0" />
            <select
              value={sortOption}
              onChange={(e) => setSortOption(e.target.value as SortOption)}
              className="h-9 rounded-lg border border-border bg-surface px-2.5 text-xs text-foreground focus:border-primary focus:outline-hidden"
            >
              <option value="newest">Newest Added First</option>
              <option value="oldest">Oldest Added First</option>
              <option value="title_az">Title (A – Z)</option>
            </select>
          </div>
        </div>

        {/* Status filter pills */}
        <div className="flex flex-wrap items-center gap-1.5 pt-1 border-t border-border/60">
          <button
            type="button"
            onClick={() => setStatusFilter("ALL")}
            className={`rounded-full px-3 py-1 text-xs font-medium transition cursor-pointer ${
              statusFilter === "ALL"
                ? "bg-foreground text-background"
                : "bg-surface-muted text-muted hover:text-foreground"
            }`}
          >
            All Reminders ({counts.all})
          </button>
          <button
            type="button"
            onClick={() => setStatusFilter("TO_RESEARCH")}
            className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition cursor-pointer ${
              statusFilter === "TO_RESEARCH"
                ? "bg-amber-600 text-white"
                : "bg-surface-muted text-amber-600 dark:text-amber-400 hover:bg-amber-500/10"
            }`}
          >
            <span className="h-2 w-2 rounded-full bg-amber-500" />
            To Research ({counts.toResearch})
          </button>
          <button
            type="button"
            onClick={() => setStatusFilter("IN_PROGRESS")}
            className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition cursor-pointer ${
              statusFilter === "IN_PROGRESS"
                ? "bg-blue-600 text-white"
                : "bg-surface-muted text-blue-600 dark:text-blue-400 hover:bg-blue-500/10"
            }`}
          >
            <span className="h-2 w-2 rounded-full bg-blue-500" />
            In Progress ({counts.inProgress})
          </button>
          <button
            type="button"
            onClick={() => setStatusFilter("INVESTIGATED")}
            className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition cursor-pointer ${
              statusFilter === "INVESTIGATED"
                ? "bg-emerald-600 text-white"
                : "bg-surface-muted text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/10"
            }`}
          >
            <span className="h-2 w-2 rounded-full bg-emerald-500" />
            Investigated ({counts.investigated})
          </button>
        </div>
      </div>

      {/* ── Reminders List / Grid ──────────────────────────────────────── */}
      {isLoading ? (
        <div className="flex h-48 items-center justify-center text-xs text-muted">
          Loading local reminders from IndexedDB…
        </div>
      ) : filteredReminders.length === 0 ? (
        <Card className="flex flex-col items-center justify-center gap-3 p-12 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-amber-500/10 text-amber-500">
            <Bookmark className="h-6 w-6" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-foreground">
              {reminders.length === 0 ? "No research reminders yet" : "No reminders match your filter"}
            </h3>
            <p className="mt-1 max-w-sm text-xs text-muted leading-relaxed">
              {reminders.length === 0
                ? "Click the bookmark icon on any YouTube search result card to set it aside here for future investigation without permanently saving it to the cloud."
                : "Try clearing your search query or switching the status filter to view other saved reminders."}
            </p>
          </div>
          {reminders.length === 0 && (
            <Link
              href="/search"
              className="mt-2 inline-flex h-8 items-center justify-center gap-1.5 rounded-lg bg-primary px-3 text-xs font-semibold text-primary-foreground shadow-xs transition hover:bg-primary/90"
            >
              <Search className="h-3.5 w-3.5" />
              <span>Go to YouTube Search</span>
            </Link>
          )}
        </Card>
      ) : (
        <div className="flex flex-col gap-6">
          {groupedReminders.map((group) => (
            <div key={group.label} className="flex flex-col gap-3">
              {/* Daily date grouping delimiter */}
              <div className="flex items-center gap-2 border-b border-border/80 pb-1.5">
                <Calendar className="h-3.5 w-3.5 text-muted" />
                <h4 className="text-xs font-semibold uppercase tracking-wider text-muted">
                  {group.label}
                </h4>
                <span className="text-[11px] text-muted/70">({group.items.length})</span>
              </div>

              {/* Items grid */}
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {group.items.map((item) => {
                  const isEditing = editingNotesId === item.reminderId;

                  return (
                    <article
                      key={item.reminderId}
                      className="yt-card group flex flex-col justify-between overflow-hidden rounded-xl border border-border bg-surface shadow-xs transition hover:border-border-strong hover:shadow-sm"
                    >
                      {/* Media preview */}
                      <div className="relative aspect-video w-full bg-surface-muted overflow-hidden">
                        {item.thumbnailUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={item.thumbnailUrl}
                            alt=""
                            className="h-full w-full object-cover transition duration-300 group-hover:scale-102"
                            loading="lazy"
                          />
                        ) : (
                          <div className="flex h-full items-center justify-center text-xs text-muted">
                            <Play className="h-6 w-6 opacity-40" />
                          </div>
                        )}

                        {/* Status Badge overlay */}
                        <div className="absolute left-2 top-2">
                          {item.status === "TO_RESEARCH" && (
                            <Badge tone="warning" className="shadow-xs font-semibold text-[10px]">
                              🟡 To Research
                            </Badge>
                          )}
                          {item.status === "IN_PROGRESS" && (
                            <Badge tone="primary" className="shadow-xs font-semibold text-[10px]">
                              🔵 In Progress
                            </Badge>
                          )}
                          {item.status === "INVESTIGATED" && (
                            <Badge tone="success" className="shadow-xs font-semibold text-[10px]">
                              🟢 Investigated
                            </Badge>
                          )}
                        </div>

                        {/* Direct Watch Button Overlay */}
                        <a
                          href={item.originalUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="absolute inset-0 flex items-center justify-center bg-black/30 opacity-0 transition group-hover:opacity-100"
                          title="Open on YouTube"
                        >
                          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg">
                            <Play className="h-5 w-5 ml-0.5 fill-current" />
                          </span>
                        </a>
                      </div>

                      {/* Content block */}
                      <div className="flex flex-1 flex-col gap-2.5 p-3.5">
                        <div className="min-w-0">
                          <h4
                            className="line-clamp-2 text-xs font-bold leading-snug text-foreground hover:text-primary transition"
                            title={item.title}
                          >
                            <a href={item.originalUrl} target="_blank" rel="noreferrer">
                              {item.title}
                            </a>
                          </h4>
                          {item.channelTitle && (
                            <p className="mt-1 flex items-center gap-1 text-[11px] text-muted truncate">
                              <Tv className="h-3 w-3 shrink-0 opacity-70" />
                              <span>{item.channelTitle}</span>
                            </p>
                          )}
                        </div>

                        {/* Metadata tags */}
                        <div className="flex flex-wrap items-center gap-1 text-[10px] text-muted">
                          {item.sourceQuery && (
                            <span className="rounded bg-surface-muted px-1.5 py-0.5 font-medium truncate max-w-[140px]" title={`Query: ${item.sourceQuery}`}>
                              🔎 {item.sourceQuery}
                            </span>
                          )}
                          <span className="opacity-40">·</span>
                          <span title={formatDate(item.addedAt)}>
                            Added {formatRelativeDate(item.addedAt)}
                          </span>
                        </div>

                        {/* Notes section */}
                        <div className="mt-1 rounded-lg border border-border/60 bg-surface-muted/50 p-2 text-xs">
                          {isEditing ? (
                            <div className="flex flex-col gap-2">
                              <textarea
                                value={notesBuffer}
                                onChange={(e) => setNotesBuffer(e.target.value)}
                                placeholder="Add private local notes (only visible on this device)..."
                                rows={2}
                                className="w-full rounded border border-border bg-surface p-1.5 text-xs text-foreground focus:border-primary focus:outline-hidden"
                              />
                              <div className="flex items-center justify-end gap-1.5">
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => setEditingNotesId(null)}
                                  className="h-6 px-2 text-[11px]"
                                >
                                  Cancel
                                </Button>
                                <Button
                                  variant="primary"
                                  size="sm"
                                  onClick={() => handleSaveNotes(item)}
                                  className="h-6 px-2 text-[11px]"
                                >
                                  Save Note
                                </Button>
                              </div>
                            </div>
                          ) : (
                            <div
                              onClick={() => handleStartEditNotes(item)}
                              className="cursor-pointer group/note"
                            >
                              {item.notes ? (
                                <p className="line-clamp-3 text-[11px] text-foreground leading-relaxed italic">
                                  &ldquo;{item.notes}&rdquo;
                                </p>
                              ) : (
                                <p className="text-[11px] text-muted group-hover/note:text-foreground transition flex items-center gap-1">
                                  <MessageSquare className="h-3 w-3 opacity-60" />
                                  <span>Click to add private local notes…</span>
                                </p>
                              )}
                            </div>
                          )}
                        </div>

                        {/* Status switcher & Actions bar */}
                        <div className="mt-auto flex items-center justify-between gap-1 pt-2 border-t border-border/50">
                          {/* Quick status selector */}
                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() => setStatus(item.reminderId, "TO_RESEARCH")}
                              className={`rounded p-1 text-[10px] transition cursor-pointer ${
                                item.status === "TO_RESEARCH"
                                  ? "bg-amber-500/20 text-amber-600 font-bold"
                                  : "text-muted hover:text-foreground"
                              }`}
                              title="Set status: To Research"
                            >
                              🟡
                            </button>
                            <button
                              type="button"
                              onClick={() => setStatus(item.reminderId, "IN_PROGRESS")}
                              className={`rounded p-1 text-[10px] transition cursor-pointer ${
                                item.status === "IN_PROGRESS"
                                  ? "bg-blue-500/20 text-blue-600 font-bold"
                                  : "text-muted hover:text-foreground"
                              }`}
                              title="Set status: In Progress"
                            >
                              🔵
                            </button>
                            <button
                              type="button"
                              onClick={() => setStatus(item.reminderId, "INVESTIGATED")}
                              className={`rounded p-1 text-[10px] transition cursor-pointer ${
                                item.status === "INVESTIGATED"
                                  ? "bg-emerald-500/20 text-emerald-600 font-bold"
                                  : "text-muted hover:text-foreground"
                              }`}
                              title="Set status: Investigated"
                            >
                              🟢
                            </button>
                          </div>

                          {/* Secondary actions */}
                          <div className="flex items-center gap-1">
                            <a
                              href={item.originalUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex h-7 w-7 items-center justify-center rounded border border-border bg-surface text-muted transition hover:bg-surface-muted hover:text-foreground"
                              title="Open on YouTube"
                            >
                              <ExternalLink className="h-3.5 w-3.5" />
                            </a>
                            <button
                              type="button"
                              onClick={() => removeReminder(item.reminderId)}
                              className="inline-flex h-7 w-7 items-center justify-center rounded border border-border bg-surface text-muted transition hover:border-rose-500/30 hover:bg-rose-500/10 hover:text-rose-500"
                              title="Remove from reminders"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Clear Confirmation Modal ───────────────────────────────────── */}
      {showClearConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
          <Card className="w-full max-w-md p-6 flex flex-col gap-4 shadow-xl">
            <div className="flex items-center gap-3 text-rose-500">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-rose-500/10">
                <Trash2 className="h-5 w-5" />
              </div>
              <h3 className="text-base font-bold text-foreground">Clear All Local Reminders?</h3>
            </div>
            <p className="text-xs text-muted leading-relaxed">
              This will remove all {reminders.length} reminder entries from your current browser&apos;s
              IndexedDB storage. Because these reminders are strictly local and not synchronized to the cloud,
              this action cannot be undone.
            </p>
            <div className="flex items-center justify-end gap-2 pt-2">
              <Button variant="secondary" size="sm" onClick={() => setShowClearConfirm(false)}>
                Cancel
              </Button>
              <Button
                variant="danger"
                size="sm"
                onClick={async () => {
                  await clearAll();
                  setShowClearConfirm(false);
                }}
              >
                Yes, Clear All
              </Button>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
