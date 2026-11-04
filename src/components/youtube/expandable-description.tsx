"use client";

import { ChevronDown, ChevronUp } from "lucide-react";
import { useState } from "react";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * YouTube Discovery — Expandable Description Component (2026 Standard)
 * ──────────────────────────────────────────────────────────────────────────
 * Scope: Reusable, accessible, unobtrusive description display for all
 *        YouTube item cards (videos, channels, playlists, saved items).
 *
 * Guarantees:
 *   1. Collapsed by default: Preserves vertical screen real-estate with
 *      a neat 2-line preview and ChevronDown indicator.
 *   2. Unobtrusive toggle: Smooth chevron toggle ("Read more" / "Show less").
 *   3. Zero layout breakage: Card expands naturally with proper line-height
 *      and whitespace wrapping.
 *   4. Independent card state: Operates strictly local to each item instance.
 *   5. Action Isolation: Uses stopPropagation to prevent parent card click events.
 *   6. Graceful empty state: Returns null if description is null or empty.
 * ═══════════════════════════════════════════════════════════════════════════
 */

export interface ExpandableDescriptionProps {
  description?: string | null;
  className?: string;
  maxCollapsedLength?: number;
}

export function ExpandableDescription({
  description,
  className = "",
  maxCollapsedLength = 120,
}: ExpandableDescriptionProps) {
  const [expanded, setExpanded] = useState(false);

  if (!description || !description.trim()) {
    return null;
  }

  const cleanText = description.trim();
  const isLong = cleanText.length > maxCollapsedLength || cleanText.includes("\n");

  return (
    <div
      className={`mt-2 rounded-lg border border-border/50 bg-surface-muted/30 p-2 text-xs transition-all ${className}`}
    >
      <div className="flex items-center justify-between gap-2 pb-1">
        <span className="text-[10px] font-bold uppercase tracking-wider text-muted/70">
          Description
        </span>
        {isLong && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setExpanded((prev) => !prev);
            }}
            className="inline-flex cursor-pointer items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-semibold text-primary transition-colors hover:text-primary/80 focus:outline-none focus:ring-1 focus:ring-primary"
            aria-expanded={expanded}
            aria-label={expanded ? "Collapse description" : "Expand description"}
          >
            <span>{expanded ? "Show less" : "Read more"}</span>
            {expanded ? (
              <ChevronUp className="h-3 w-3" />
            ) : (
              <ChevronDown className="h-3 w-3" />
            )}
          </button>
        )}
      </div>

      <p
        className={`leading-relaxed whitespace-pre-line text-foreground/90 select-text ${
          expanded ? "break-words" : "line-clamp-2 break-words"
        }`}
      >
        {cleanText}
      </p>
    </div>
  );
}
