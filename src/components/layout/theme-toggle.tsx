"use client";

import { Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";

/* ═══════════════════════════════════════════════════════════════════════════
   Theme Toggle — Compact pill-switch with animated sun/moon transition
   ──────────────────────────────────────────────────────────────────────────
   SSR-safe: defaults to dark on server, reads real DOM class on mount.
   Persists choice to localStorage under key "youtube-discovery-theme".
   The inline script in layout.tsx runs before paint to prevent FOUC.

   Visual: 44×24 pill track with a 18px sliding knob. Sun and Moon icons
   sit at opposite ends of the track; the knob slides over the active one.
   Transition is 250ms ease for the slide + icon opacity swap.
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

  function toggle() {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle("dark", next);
    localStorage.setItem("youtube-discovery-theme", next ? "dark" : "light");
  }

  /* SSR placeholder — same dimensions, no interactivity, avoids layout shift */
  const resolvedDark = mounted ? dark : true;

  return (
    <button
      type="button"
      role="switch"
      aria-checked={!resolvedDark}
      aria-label={resolvedDark ? "Switch to light mode" : "Switch to dark mode"}
      title={resolvedDark ? "Switch to light mode" : "Switch to dark mode"}
      onClick={mounted ? toggle : undefined}
      className="theme-toggle-track group"
      style={{ opacity: mounted ? 1 : 0.5 }}
    >
      {/* ── Icons sitting at each end of the track ──────────────── */}
      <Sun
        className="theme-toggle-icon-sun"
        style={{ opacity: resolvedDark ? 0.35 : 1 }}
      />
      <Moon
        className="theme-toggle-icon-moon"
        style={{ opacity: resolvedDark ? 1 : 0.35 }}
      />

      {/* ── Sliding knob ────────────────────────────────────────── */}
      <span
        className="theme-toggle-knob"
        style={{ transform: resolvedDark ? "translateX(20px)" : "translateX(0)" }}
      />
    </button>
  );
}
