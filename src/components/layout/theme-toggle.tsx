"use client";

import { Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

/* ═══════════════════════════════════════════════════════════════════════════
   Theme Toggle — SSR-safe dark/light mode switch
   ──────────────────────────────────────────────────────────────────────────
   Initial state defaults to `true` (dark) on the server to avoid hydration
   mismatch. On mount, reads the real DOM class to synchronize. This avoids
   the `document is not defined` ReferenceError during Next.js prerendering.
   ═══════════════════════════════════════════════════════════════════════════ */

export function ThemeToggle() {
  /* Default to dark on server; synchronize with real DOM on mount */
  const [dark, setDark] = useState(true);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    /* Read the current theme from the DOM after hydration */
    setDark(document.documentElement.classList.contains("dark"));
    setMounted(true);
  }, []);

  function toggleTheme() {
    const nextDark = !dark;
    setDark(nextDark);
    document.documentElement.classList.toggle("dark", nextDark);
    localStorage.setItem("youtube-discovery-theme", nextDark ? "dark" : "light");
  }

  /* Render a placeholder during SSR to avoid layout shift */
  if (!mounted) {
    return (
      <Button aria-label="Toggle theme" variant="ghost" className="h-9 w-9 px-0" title="Toggle theme">
        <Moon className="h-4 w-4" />
      </Button>
    );
  }

  return (
    <Button aria-label="Toggle theme" variant="ghost" className="h-9 w-9 px-0" onClick={toggleTheme} title="Toggle theme">
      {dark ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
    </Button>
  );
}
