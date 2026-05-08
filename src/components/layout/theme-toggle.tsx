"use client";

import { Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

/* ═══════════════════════════════════════════════════════════════════════════
   Theme Toggle — Single Button
   ──────────────────────────────────────────────────────────────────────────
   SSR-safe: defaults to dark on server, reads real DOM class on mount.
   Persists choice to localStorage under key "youtube-discovery-theme".
   Animated transition swaps between Sun and Moon.
   ═══════════════════════════════════════════════════════════════════════════ */

export function ThemeToggle() {
  const [dark, setDark] = useState(true);
  const [mounted, setMounted] = useState(false);

  /* eslint-disable react-hooks/set-state-in-effect -- One-time DOM sync on mount; cannot avoid setState for theme truth */
  useEffect(() => {
    setDark(document.documentElement.classList.contains("dark"));
    setMounted(true);
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

  function toggleTheme() {
    const nextDark = !dark;
    setDark(nextDark);
    document.documentElement.classList.toggle("dark", nextDark);
    localStorage.setItem("youtube-discovery-theme", nextDark ? "dark" : "light");
  }

  const resolvedDark = mounted ? dark : true;

  return (
    <Button
      aria-label="Toggle theme"
      variant="ghost"
      className="relative h-9 w-9 px-0 overflow-hidden"
      onClick={mounted ? toggleTheme : undefined}
      title="Toggle theme"
    >
      <Sun
        className={`absolute h-4 w-4 transition-all duration-300 ease-in-out ${
          resolvedDark ? "translate-y-8 opacity-0" : "translate-y-0 opacity-100"
        }`}
      />
      <Moon
        className={`absolute h-4 w-4 transition-all duration-300 ease-in-out ${
          resolvedDark ? "translate-y-0 opacity-100" : "-translate-y-8 opacity-0"
        }`}
      />
    </Button>
  );
}
