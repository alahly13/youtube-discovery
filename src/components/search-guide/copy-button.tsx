"use client";

import { Check, Copy } from "lucide-react";
import { useState } from "react";

/* ── CopyButton — small clipboard helper for guide code examples ──────
   Client-isolated so the guide page itself stays a server component.
   Writes the exact example text; shows a brief confirmation, no dialogs. */
export function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Clipboard unavailable (permissions/SSR edge): fall back silently.
      const area = document.createElement("textarea");
      area.value = text;
      document.body.appendChild(area);
      area.select();
      document.execCommand("copy");
      document.body.removeChild(area);
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      aria-label={`Copy example: ${label}`}
      title="Copy to clipboard"
      className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md border border-border bg-surface px-2 text-[11px] font-medium text-muted transition hover:border-primary/50 hover:text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
    >
      {copied ? <Check className="h-3 w-3 text-success" /> : <Copy className="h-3 w-3" />}
      <span>{copied ? "Copied" : "Copy"}</span>
    </button>
  );
}
