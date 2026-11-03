"use client";

import { LogOut, Loader2 } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils/format";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * Sign Out Button Component
 * ──────────────────────────────────────────────────────────────────────────
 * Scope: Layout & Authentication UX
 *
 * Provides a reliable, secure sign-out mechanism:
 * 1. Invokes POST /api/auth/logout to revoke Supabase Auth sessions
 *    and clear HTTP-only session cookies.
 * 2. Redirects cleanly to /login upon completion.
 * 3. Supports header, sidebar, and compact variants.
 * ═══════════════════════════════════════════════════════════════════════════
 */

interface SignOutButtonProps {
  className?: string;
  variant?: "header" | "sidebar";
  showLabel?: boolean;
}

export function SignOutButton({
  className,
  variant = "header",
  showLabel = true,
}: SignOutButtonProps) {
  const [signingOut, setSigningOut] = useState(false);

  const handleSignOut = async () => {
    if (signingOut) return;
    setSigningOut(true);
    try {
      await fetch("/api/auth/logout", {
        method: "POST",
        credentials: "same-origin",
      });
    } catch (err) {
      console.warn("[auth] Sign out network warning:", err);
    } finally {
      // Hard redirect to ensure all memory state and cookies are flushed
      window.location.href = "/login";
    }
  };

  if (variant === "sidebar") {
    return (
      <button
        type="button"
        onClick={handleSignOut}
        disabled={signingOut}
        className={cn(
          "flex w-full min-h-9 items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors text-red-500 hover:bg-red-500/10 hover:text-red-600 dark:text-red-400 dark:hover:bg-red-950/30 dark:hover:text-red-300 disabled:opacity-50 cursor-pointer",
          className
        )}
        title="Sign Out of YouTube Discovery"
        aria-label="Sign Out"
      >
        {signingOut ? (
          <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
        ) : (
          <LogOut className="h-4 w-4 shrink-0" />
        )}
        <span className="truncate font-semibold">
          {signingOut ? "Signing Out…" : "Sign Out"}
        </span>
      </button>
    );
  }

  // Header variant
  return (
    <button
      type="button"
      onClick={handleSignOut}
      disabled={signingOut}
      className={cn(
        "inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border border-border bg-surface px-2.5 sm:px-3 text-xs font-semibold text-muted transition-colors hover:border-red-500/40 hover:bg-red-500/10 hover:text-red-600 dark:hover:text-red-400 disabled:opacity-50 cursor-pointer shadow-2xs",
        className
      )}
      title="Sign Out of YouTube Discovery"
      aria-label="Sign Out"
    >
      {signingOut ? (
        <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
      ) : (
        <LogOut className="h-3.5 w-3.5 shrink-0 text-red-500/80" />
      )}
      {showLabel && (
        <span className="hidden sm:inline">
          {signingOut ? "Signing Out…" : "Sign Out"}
        </span>
      )}
    </button>
  );
}
