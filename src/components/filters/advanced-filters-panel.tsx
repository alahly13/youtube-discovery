"use client";

import {
  AlertTriangle,
  Calendar,
  ChevronDown,
  Eye,
  Filter,
  Hash,
  MessageCircle,
  Search,
  ThumbsUp,
  Timer,
  X,
} from "lucide-react";
import { useMemo, useState } from "react";
import type { YouTubeDiscoveryItemType, YouTubeResultFilters } from "@/types/youtube";
import { DEFAULT_YOUTUBE_RESULT_FILTERS, YOUTUBE_ITEM_TYPES } from "@/types/youtube";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { formatItemType } from "@/lib/utils/format";

/* ═══════════════════════════════════════════════════════════════════════════
   Advanced Filters Panel — shared across search, channel, playlist, and
   manifest workspaces. All interactions are LOCAL ONLY — no YouTube API
   calls are triggered by filter changes.
   ──────────────────────────────────────────────────────────────────────────
   Zero-safe: uses `parseFilterNumber` to convert input strings to numbers
   or null. Empty string → null, "0" → 0. Never drops zero values.
   ═══════════════════════════════════════════════════════════════════════════ */

interface AdvancedFiltersPanelProps {
  filters: YouTubeResultFilters;
  onFiltersChange: (filters: YouTubeResultFilters) => void;
  /** Total number of items before filtering */
  totalCount: number;
  /** Number of items after filtering */
  filteredCount: number;
  /** Default sort value when resetting filters */
  defaultSort?: YouTubeResultFilters["sort"];
  /** Placeholder for keyword search */
  searchPlaceholder?: string;
  /** Show result type filter toggles */
  showTypeFilters?: boolean;
  /** Compact mode hides some sections by default */
  compact?: boolean;
}

/**
 * Zero-safe number parsing for filter inputs. Returns null for empty strings,
 * and preserves 0 as a valid number. This is critical for treating "0 views"
 * as a real filter boundary instead of clearing the filter.
 */
function parseFilterNumber(value: string): number | null {
  if (value === "") return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

/** Month names for the month filter dropdown */
const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** Filterable item types — excludes internal/unsupported types */
const FILTERABLE_ITEM_TYPES: YouTubeDiscoveryItemType[] = [
  "video", "shorts_like", "channel", "playlist",
];

export function AdvancedFiltersPanel({
  filters,
  onFiltersChange,
  totalCount,
  filteredCount,
  defaultSort = "api_order",
  searchPlaceholder = "Search inside results…",
  showTypeFilters = true,
  compact = false,
}: AdvancedFiltersPanelProps) {
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({
    search: true,
    sort: true,
    types: !compact,
    numeric: !compact,
    dates: !compact,
    presence: !compact,
    channel: !compact,
  });

  const toggleSection = (key: string) =>
    setOpenSections((prev) => ({ ...prev, [key]: !prev[key] }));

  const update = (patch: Partial<YouTubeResultFilters>) =>
    onFiltersChange({ ...filters, ...patch });

  /* ── Validation warnings for invalid ranges ───────────────────────── */
  const rangeWarnings = useMemo(() => {
    const warns: string[] = [];
    if (filters.minViews !== null && filters.maxViews !== null && filters.minViews > filters.maxViews) {
      warns.push("Views: min > max");
    }
    if (filters.minLikes !== null && filters.maxLikes !== null && filters.minLikes > filters.maxLikes) {
      warns.push("Likes: min > max");
    }
    if (filters.minComments !== null && filters.maxComments !== null && filters.minComments > filters.maxComments) {
      warns.push("Comments: min > max");
    }
    if (filters.durationMinSec !== null && filters.durationMaxSec !== null && filters.durationMinSec > filters.durationMaxSec) {
      warns.push("Duration: min > max");
    }
    if (filters.yearFrom !== null && filters.yearTo !== null && filters.yearFrom > filters.yearTo) {
      warns.push("Year range: from > to");
    }
    return warns;
  }, [filters]);

  /* ── Active filter chips for quick removal ─────────────────────────── */
  const activeChips = useMemo(() => {
    const chips: Array<{ label: string; clear: () => void }> = [];

    if (filters.keyword) {
      chips.push({ label: `Keyword: "${filters.keyword}"`, clear: () => update({ keyword: "" }) });
    }
    if (filters.channelName) {
      chips.push({ label: `Channel: ${filters.channelName}`, clear: () => update({ channelName: null }) });
    }
    if (filters.language) {
      chips.push({ label: `Language: ${filters.language}`, clear: () => update({ language: null }) });
    }
    if (filters.minViews !== null) {
      chips.push({ label: `Views ≥ ${filters.minViews}`, clear: () => update({ minViews: null }) });
    }
    if (filters.maxViews !== null) {
      chips.push({ label: `Views ≤ ${filters.maxViews}`, clear: () => update({ maxViews: null }) });
    }
    if (filters.minLikes !== null) {
      chips.push({ label: `Likes ≥ ${filters.minLikes}`, clear: () => update({ minLikes: null }) });
    }
    if (filters.maxLikes !== null) {
      chips.push({ label: `Likes ≤ ${filters.maxLikes}`, clear: () => update({ maxLikes: null }) });
    }
    if (filters.minComments !== null) {
      chips.push({ label: `Comments ≥ ${filters.minComments}`, clear: () => update({ minComments: null }) });
    }
    if (filters.maxComments !== null) {
      chips.push({ label: `Comments ≤ ${filters.maxComments}`, clear: () => update({ maxComments: null }) });
    }
    if (filters.durationMinSec !== null) {
      chips.push({ label: `Duration ≥ ${filters.durationMinSec}s`, clear: () => update({ durationMinSec: null }) });
    }
    if (filters.durationMaxSec !== null) {
      chips.push({ label: `Duration ≤ ${filters.durationMaxSec}s`, clear: () => update({ durationMaxSec: null }) });
    }
    if (filters.year !== null) {
      chips.push({ label: `Year: ${filters.year}`, clear: () => update({ year: null }) });
    }
    if (filters.month !== null) {
      chips.push({ label: `Month: ${MONTH_NAMES[filters.month - 1]}`, clear: () => update({ month: null }) });
    }
    if (filters.yearFrom !== null) {
      chips.push({ label: `From year: ${filters.yearFrom}`, clear: () => update({ yearFrom: null }) });
    }
    if (filters.yearTo !== null) {
      chips.push({ label: `To year: ${filters.yearTo}`, clear: () => update({ yearTo: null }) });
    }
    if (filters.publishedAfter) {
      chips.push({ label: `After: ${filters.publishedAfter}`, clear: () => update({ publishedAfter: null }) });
    }
    if (filters.publishedBefore) {
      chips.push({ label: `Before: ${filters.publishedBefore}`, clear: () => update({ publishedBefore: null }) });
    }
    if (filters.shortsLikeOnly) {
      chips.push({ label: "Shorts-like only", clear: () => update({ shortsLikeOnly: false }) });
    }
    if (filters.hasThumbnail !== "any") {
      chips.push({ label: `Thumbnail: ${filters.hasThumbnail}`, clear: () => update({ hasThumbnail: "any" }) });
    }
    if (filters.hasDescription !== "any") {
      chips.push({ label: `Description: ${filters.hasDescription}`, clear: () => update({ hasDescription: "any" }) });
    }
    if (filters.hasLanguage !== "any") {
      chips.push({ label: `Language tag: ${filters.hasLanguage}`, clear: () => update({ hasLanguage: "any" }) });
    }
    if (filters.itemTypes.length > 0) {
      chips.push({
        label: `Types: ${filters.itemTypes.map(formatItemType).join(", ")}`,
        clear: () => update({ itemTypes: [] }),
      });
    }
    if (filters.sort !== defaultSort) {
      chips.push({ label: `Sort: ${filters.sort.replace(/_/g, " ")}`, clear: () => update({ sort: defaultSort }) });
    }

    return chips;
  }, [filters, defaultSort]);

  const hasActiveFilters = activeChips.length > 0;

  return (
    <Card className="col-span-12 xl:col-span-3">
      <CardHeader
        title="Advanced filters"
        eyebrow="Local only — no API calls"
        action={
          <div className="flex items-center gap-2">
            {hasActiveFilters && (
              <button
                className="text-xs text-danger hover:underline"
                onClick={() => onFiltersChange({ ...DEFAULT_YOUTUBE_RESULT_FILTERS, sort: defaultSort })}
              >
                Reset all
              </button>
            )}
          </div>
        }
      />

      {/* ── Results count ──────────────────────────────────────────────── */}
      <div className="mb-4 flex items-center gap-2">
        <Filter className="h-3.5 w-3.5 text-muted" />
        <span className="text-xs text-muted">
          Showing <strong className="text-foreground">{filteredCount}</strong> of{" "}
          <strong className="text-foreground">{totalCount}</strong> results
        </span>
      </div>

      {/* ── Range validation warnings ──────────────────────────────────── */}
      {rangeWarnings.length > 0 && (
        <div className="mb-4 rounded-lg border border-warning/30 bg-warning/5 p-3">
          <div className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
            <div className="space-y-1">
              {rangeWarnings.map((w) => (
                <p key={w} className="text-xs text-warning">{w}</p>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── Active filter chips ────────────────────────────────────────── */}
      {activeChips.length > 0 && (
        <div className="mb-4 flex flex-wrap gap-1.5">
          {activeChips.map((chip) => (
            <Badge key={chip.label} className="pr-1">
              <span className="max-w-[14rem] truncate">{chip.label}</span>
              <button
                className="ml-1 rounded p-0.5 hover:bg-surface-raised"
                onClick={chip.clear}
                aria-label={`Remove ${chip.label}`}
              >
                <X className="h-3 w-3" />
              </button>
            </Badge>
          ))}
        </div>
      )}

      <div className="space-y-1">
        {/* ═══ Search Section ═══════════════════════════════════════════ */}
        <FilterSection
          title="Search"
          icon={<Search className="h-3.5 w-3.5" />}
          isOpen={openSections.search ?? true}
          onToggle={() => toggleSection("search")}
        >
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
            <input
              className="filter-input pl-9"
              placeholder={searchPlaceholder}
              value={filters.keyword}
              onChange={(e) => update({ keyword: e.target.value })}
            />
          </div>
        </FilterSection>

        {/* ═══ Sort Section ═════════════════════════════════════════════ */}
        <FilterSection
          title="Sort"
          icon={<Hash className="h-3.5 w-3.5" />}
          isOpen={openSections.sort ?? true}
          onToggle={() => toggleSection("sort")}
        >
          <select
            className="filter-input"
            value={filters.sort}
            onChange={(e) => update({ sort: e.target.value as YouTubeResultFilters["sort"] })}
          >
            <option value="api_order">Original order</option>
            <option value="latest">Newest first</option>
            <option value="oldest">Oldest first</option>
            <option value="most_views">Most views</option>
            <option value="least_views">Least views</option>
            <option value="most_likes">Most likes</option>
            <option value="least_likes">Least likes</option>
            <option value="most_comments">Most comments</option>
            <option value="least_comments">Least comments</option>
            <option value="shortest">Shortest</option>
            <option value="longest">Longest</option>
            <option value="title_az">Title A→Z</option>
            <option value="title_za">Title Z→A</option>
            <option value="engagement_desc">Highest engagement</option>
            <option value="engagement_asc">Lowest engagement</option>
          </select>
        </FilterSection>

        {/* ═══ Result Type Section ══════════════════════════════════════ */}
        {showTypeFilters && (
          <FilterSection
            title="Result type"
            icon={<Filter className="h-3.5 w-3.5" />}
            isOpen={openSections.types ?? false}
            onToggle={() => toggleSection("types")}
          >
            <div className="flex flex-wrap gap-1.5">
              {FILTERABLE_ITEM_TYPES.map((type) => {
                const isActive = filters.itemTypes.includes(type);
                return (
                  <button
                    key={type}
                    className={`rounded-md border px-2.5 py-1 text-xs font-medium transition ${
                      isActive
                        ? "border-primary/40 bg-primary-soft text-primary"
                        : "border-border bg-surface text-muted hover:bg-surface-muted hover:text-foreground"
                    }`}
                    onClick={() => {
                      const next = isActive
                        ? filters.itemTypes.filter((t) => t !== type)
                        : [...filters.itemTypes, type];
                      update({ itemTypes: next });
                    }}
                  >
                    {formatItemType(type)}
                  </button>
                );
              })}
            </div>
            <label className="mt-2 flex items-center gap-2 text-xs text-muted">
              <input
                type="checkbox"
                className="accent-primary"
                checked={filters.shortsLikeOnly}
                onChange={(e) => update({ shortsLikeOnly: e.target.checked })}
              />
              Shorts-like only
            </label>
          </FilterSection>
        )}

        {/* ═══ Numeric Ranges Section ══════════════════════════════════ */}
        <FilterSection
          title="Numeric ranges"
          icon={<Eye className="h-3.5 w-3.5" />}
          isOpen={openSections.numeric ?? false}
          onToggle={() => toggleSection("numeric")}
        >
          {/* Views */}
          <FilterRangeRow
            label="Views"
            icon={<Eye className="h-3 w-3 text-muted" />}
            minValue={filters.minViews}
            maxValue={filters.maxViews}
            onMinChange={(v) => update({ minViews: v })}
            onMaxChange={(v) => update({ maxViews: v })}
            isInvalid={filters.minViews !== null && filters.maxViews !== null && filters.minViews > filters.maxViews}
          />
          {/* Likes */}
          <FilterRangeRow
            label="Likes"
            icon={<ThumbsUp className="h-3 w-3 text-muted" />}
            minValue={filters.minLikes}
            maxValue={filters.maxLikes}
            onMinChange={(v) => update({ minLikes: v })}
            onMaxChange={(v) => update({ maxLikes: v })}
            isInvalid={filters.minLikes !== null && filters.maxLikes !== null && filters.minLikes > filters.maxLikes}
          />
          {/* Comments */}
          <FilterRangeRow
            label="Comments"
            icon={<MessageCircle className="h-3 w-3 text-muted" />}
            minValue={filters.minComments}
            maxValue={filters.maxComments}
            onMinChange={(v) => update({ minComments: v })}
            onMaxChange={(v) => update({ maxComments: v })}
            isInvalid={filters.minComments !== null && filters.maxComments !== null && filters.minComments > filters.maxComments}
          />
          {/* Duration */}
          <FilterRangeRow
            label="Duration (sec)"
            icon={<Timer className="h-3 w-3 text-muted" />}
            minValue={filters.durationMinSec}
            maxValue={filters.durationMaxSec}
            onMinChange={(v) => update({ durationMinSec: v })}
            onMaxChange={(v) => update({ durationMaxSec: v })}
            isInvalid={filters.durationMinSec !== null && filters.durationMaxSec !== null && filters.durationMinSec > filters.durationMaxSec}
          />
        </FilterSection>

        {/* ═══ Date Filters Section ════════════════════════════════════ */}
        <FilterSection
          title="Date filters"
          icon={<Calendar className="h-3.5 w-3.5" />}
          isOpen={openSections.dates ?? false}
          onToggle={() => toggleSection("dates")}
        >
          {/* Year */}
          <div>
            <label className="mb-1 block text-xs text-muted">Exact year</label>
            <input
              type="number"
              min={2005}
              max={2030}
              className="filter-input"
              placeholder="Any year"
              value={filters.year ?? ""}
              onChange={(e) => update({ year: parseFilterNumber(e.target.value) })}
            />
          </div>

          {/* Month */}
          <div>
            <label className="mb-1 block text-xs text-muted">Month</label>
            <select
              className="filter-input"
              value={filters.month ?? ""}
              onChange={(e) => update({ month: e.target.value ? Number(e.target.value) : null })}
            >
              <option value="">Any month</option>
              {MONTH_NAMES.map((name, i) => (
                <option key={name} value={i + 1}>{name}</option>
              ))}
            </select>
          </div>

          {/* Year range */}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="mb-1 block text-xs text-muted">Year from</label>
              <input
                type="number"
                min={2005}
                max={2030}
                className="filter-input"
                placeholder="Min"
                value={filters.yearFrom ?? ""}
                onChange={(e) => update({ yearFrom: parseFilterNumber(e.target.value) })}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-muted">Year to</label>
              <input
                type="number"
                min={2005}
                max={2030}
                className="filter-input"
                placeholder="Max"
                value={filters.yearTo ?? ""}
                onChange={(e) => update({ yearTo: parseFilterNumber(e.target.value) })}
              />
            </div>
          </div>

          {/* Full date range (from/to calendar) */}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="mb-1 block text-xs text-muted">Published after</label>
              <input
                type="date"
                className="filter-input"
                value={filters.publishedAfter ?? ""}
                onChange={(e) => update({ publishedAfter: e.target.value || null })}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-muted">Published before</label>
              <input
                type="date"
                className="filter-input"
                value={filters.publishedBefore ?? ""}
                onChange={(e) => update({ publishedBefore: e.target.value || null })}
              />
            </div>
          </div>
        </FilterSection>

        {/* ═══ Channel / Owner Section ═════════════════════════════════ */}
        <FilterSection
          title="Channel / owner"
          icon={<Search className="h-3.5 w-3.5" />}
          isOpen={openSections.channel ?? false}
          onToggle={() => toggleSection("channel")}
        >
          <div>
            <label className="mb-1 block text-xs text-muted">Channel name</label>
            <input
              className="filter-input"
              placeholder="Filter by channel name"
              value={filters.channelName ?? ""}
              onChange={(e) => update({ channelName: e.target.value || null })}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-muted">Language code</label>
            <input
              className="filter-input"
              placeholder="e.g. en, ar, es"
              value={filters.language ?? ""}
              onChange={(e) => update({ language: e.target.value || null })}
            />
          </div>
        </FilterSection>

        {/* ═══ Presence Filters Section ════════════════════════════════ */}
        <FilterSection
          title="Presence"
          icon={<Filter className="h-3.5 w-3.5" />}
          isOpen={openSections.presence ?? false}
          onToggle={() => toggleSection("presence")}
        >
          <FilterPresenceRow
            label="Has thumbnail"
            value={filters.hasThumbnail}
            onChange={(v) => update({ hasThumbnail: v })}
          />
          <FilterPresenceRow
            label="Has description"
            value={filters.hasDescription}
            onChange={(v) => update({ hasDescription: v })}
          />
          <FilterPresenceRow
            label="Has language tag"
            value={filters.hasLanguage}
            onChange={(v) => update({ hasLanguage: v })}
          />
        </FilterSection>
      </div>

      {/* ── Reset all button ───────────────────────────────────────────── */}
      {hasActiveFilters && (
        <Button
          variant="ghost"
          className="mt-3 w-full"
          onClick={() => onFiltersChange({ ...DEFAULT_YOUTUBE_RESULT_FILTERS, sort: defaultSort })}
        >
          <X className="h-4 w-4" />
          Reset all filters
        </Button>
      )}
    </Card>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   Subcomponents
   ═══════════════════════════════════════════════════════════════════════════ */

/** Collapsible filter section with icon, title, and chevron toggle */
function FilterSection({
  title,
  icon,
  isOpen,
  onToggle,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  isOpen: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-border/50 bg-surface/50">
      <button
        className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-xs font-semibold text-foreground transition hover:bg-surface-muted"
        onClick={onToggle}
      >
        {icon}
        <span className="flex-1">{title}</span>
        <ChevronDown
          className={`h-3.5 w-3.5 text-muted transition ${isOpen ? "" : "-rotate-90"}`}
        />
      </button>
      {isOpen && (
        <div className="space-y-2.5 border-t border-border/40 px-3 pb-3 pt-2.5">
          {children}
        </div>
      )}
    </div>
  );
}

/**
 * Numeric range input row with min/max. Uses parseFilterNumber to ensure
 * "0" becomes 0 (not null) for zero-safe filtering.
 */
function FilterRangeRow({
  label,
  icon,
  minValue,
  maxValue,
  onMinChange,
  onMaxChange,
  isInvalid,
}: {
  label: string;
  icon: React.ReactNode;
  minValue: number | null;
  maxValue: number | null;
  onMinChange: (v: number | null) => void;
  onMaxChange: (v: number | null) => void;
  isInvalid?: boolean;
}) {
  return (
    <div>
      <div className="mb-1 flex items-center gap-1.5">
        {icon}
        <label className="text-xs text-muted">{label}</label>
        {isInvalid && (
          <span title="Min is greater than max">
            <AlertTriangle className="h-3 w-3 text-warning" />
          </span>
        )}
      </div>
      <div className={`grid grid-cols-2 gap-2 ${isInvalid ? "ring-1 ring-warning/40 rounded-lg" : ""}`}>
        <input
          type="number"
          min={0}
          className="filter-input"
          placeholder="Min"
          value={minValue ?? ""}
          onChange={(e) => onMinChange(parseFilterNumber(e.target.value))}
        />
        <input
          type="number"
          min={0}
          className="filter-input"
          placeholder="Max"
          value={maxValue ?? ""}
          onChange={(e) => onMaxChange(parseFilterNumber(e.target.value))}
        />
      </div>
    </div>
  );
}

/** Presence filter row with any/yes/no options */
function FilterPresenceRow({
  label,
  value,
  onChange,
}: {
  label: string;
  value: "any" | "yes" | "no";
  onChange: (v: "any" | "yes" | "no") => void;
}) {
  return (
    <div className="flex items-center justify-between">
      <label className="text-xs text-muted">{label}</label>
      <div className="flex gap-1">
        {(["any", "yes", "no"] as const).map((option) => (
          <button
            key={option}
            className={`rounded px-2 py-0.5 text-xs transition ${
              value === option
                ? "bg-primary-soft text-primary"
                : "text-muted hover:bg-surface-muted hover:text-foreground"
            }`}
            onClick={() => onChange(option)}
          >
            {option}
          </button>
        ))}
      </div>
    </div>
  );
}
