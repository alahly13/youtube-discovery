"use client";

import { Check, Copy, FileCode, X } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * Raw JSON Inspector Dialog
 * ──────────────────────────────────────────────────────────────────────────
 * Scope: Workstream B / Saved Items — Phase 1.5
 * Displays authentic, unmutated raw JSON metadata for any selected YouTube
 * or archived item, complete with one-click copy and line numbering.
 * ═══════════════════════════════════════════════════════════════════════════
 */

export function RawJsonInspectorDialog({
  item,
  open,
  onClose,
  title = "Raw Metadata Inspection",
}: {
  item: unknown;
  open: boolean;
  onClose: () => void;
  title?: string;
}) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape" && open) {
        onClose();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  if (!open || !item) return null;

  const jsonString = JSON.stringify(item, null, 2);
  const itemTitle =
    typeof item === "object" && item !== null && "title" in item
      ? String((item as { title?: unknown }).title || "")
      : "";

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(jsonString);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-xs animate-in fade-in duration-200">
      <div
        className="flex max-h-[85vh] w-full max-w-3xl flex-col rounded-2xl border border-border bg-surface shadow-2xl overflow-hidden"
        role="dialog"
        aria-modal="true"
        aria-labelledby="raw-json-title"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border/80 px-6 py-4 bg-surface-muted/50">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <FileCode className="h-4 w-4" />
            </div>
            <div>
              <h3 id="raw-json-title" className="text-sm font-semibold text-foreground">
                {title}
              </h3>
              <p className="text-xs text-muted">
                {itemTitle ? itemTitle.slice(0, 70) : "Raw Item JSON"}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="secondary"
              onClick={handleCopy}
              className="h-8 gap-1.5 px-3 text-xs"
            >
              {copied ? (
                <>
                  <Check className="h-3.5 w-3.5 text-emerald-500" />
                  <span>Copied</span>
                </>
              ) : (
                <>
                  <Copy className="h-3.5 w-3.5" />
                  <span>Copy JSON</span>
                </>
              )}
            </Button>
            <button
              type="button"
              onClick={onClose}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-muted hover:bg-surface hover:text-foreground transition"
              aria-label="Close dialog"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* JSON Code Viewer */}
        <div className="flex-1 overflow-auto p-4 bg-background font-mono text-xs">
          <pre className="text-foreground/90 whitespace-pre-wrap break-all leading-relaxed select-all">
            {jsonString}
          </pre>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-border/80 px-6 py-3 bg-surface-muted/40 text-[11px] text-muted">
          <span>{jsonString.split("\n").length} lines • {Buffer.byteLength(jsonString, "utf8")} bytes</span>
          <span>Authentic Unmutated Metadata</span>
        </div>
      </div>
    </div>
  );
}
